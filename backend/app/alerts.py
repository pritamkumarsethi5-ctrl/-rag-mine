"""Alert centre. Acknowledging an alert never marks the mine safe; critical alerts need an operator."""
from __future__ import annotations

from .config import sim_iso

CATEGORIES = [
    "critical_gas", "gas_warning", "oxygen_range", "sensor_unavailable", "stale_telemetry", "rover_obstacle",
    "worker_hazard", "route_blocked", "comm_lost", "mapping_event", "evacuation",
]
SEVERITIES = ["critical", "warning", "info"]


class AlertCenter:
    def __init__(self, max_alerts: int = 600) -> None:
        self.alerts: list[dict] = []
        self.counter = 0
        self.max_alerts = max_alerts
        self.active_by_key: dict[tuple, str] = {}
        self.suppressed: set[tuple] = set()

    def _new(self, t: float, spec: dict) -> dict:
        self.counter += 1
        a = {
            "id": f"ALR-{self.counter:04d}",
            "severity": spec["severity"],
            "category": spec["category"],
            "zone": spec.get("zone"),
            "segment_id": spec.get("segment_id"),
            "related": spec.get("related"),
            "t": t,
            "time": sim_iso(t),
            "params": spec.get("params", {}),
            "status": "open",  # open | acknowledged | resolved
            "acknowledged_at": None,
            "resolved_at": None,
            "resolved_by": None,
            "condition_active": True,
            "persistent": spec.get("persistent", True),
        }
        self.alerts.append(a)
        if len(self.alerts) > self.max_alerts:
            self.alerts = self.alerts[-self.max_alerts:]
        return a

    def sync(self, t: float, current: dict[tuple, dict]) -> list[dict]:
        """Reconcile alerts with the set of conditions that are true *now*."""
        created: list[dict] = []
        for key, spec in current.items():
            if key in self.active_by_key:
                a = self._get(self.active_by_key[key])
                if a is not None:
                    a["condition_active"] = True
                    a["params"] = spec.get("params", a["params"])
                continue
            if key in self.suppressed:
                continue
            a = self._new(t, spec)
            self.active_by_key[key] = a["id"]
            created.append(a)
        for key in list(self.active_by_key):
            if key in current:
                continue
            a = self._get(self.active_by_key[key])
            if a is None or a["status"] == "resolved":
                self.active_by_key.pop(key, None)
                continue
            a["condition_active"] = False
            if a["severity"] != "critical":
                self._resolve(a, t, "auto")
                self.active_by_key.pop(key, None)
            # critical alerts stay open until an operator resolves them
        self.suppressed &= set(current)
        return created

    def push(self, t: float, spec: dict) -> dict:
        """One-shot event alert (not tied to a continuing condition)."""
        spec = {**spec, "persistent": False}
        a = self._new(t, spec)
        a["condition_active"] = False
        return a

    def _get(self, alert_id: str) -> dict | None:
        for a in reversed(self.alerts):
            if a["id"] == alert_id:
                return a
        return None

    def get(self, alert_id: str) -> dict | None:
        return self._get(alert_id)

    def _resolve(self, a: dict, t: float, by: str) -> None:
        a["status"] = "resolved"
        a["resolved_at"] = sim_iso(t)
        a["resolved_by"] = by

    def acknowledge(self, alert_id: str, t: float) -> dict | None:
        a = self._get(alert_id)
        if a and a["status"] == "open":
            a["status"] = "acknowledged"
            a["acknowledged_at"] = sim_iso(t)
        return a

    def resolve(self, alert_id: str, t: float) -> dict | None:
        a = self._get(alert_id)
        if a and a["status"] != "resolved":
            self._resolve(a, t, "operator")
            for key, aid in list(self.active_by_key.items()):
                if aid == alert_id:
                    self.active_by_key.pop(key)
                    if a["condition_active"]:
                        self.suppressed.add(key)
        return a

    def counts(self) -> dict:
        act = [a for a in self.alerts if a["status"] != "resolved" and a["severity"] in ("critical", "warning")]
        return {
            "active": len(act),
            "critical": sum(1 for a in act if a["severity"] == "critical"),
            "warning": sum(1 for a in act if a["severity"] == "warning"),
            "unacknowledged": sum(1 for a in act if a["status"] == "open"),
            "total": len(self.alerts),
        }

    def list(self, severity: str | None = None, category: str | None = None, status: str | None = None,
             q: str | None = None, limit: int = 200) -> list[dict]:
        out = []
        ql = (q or "").lower()
        for a in reversed(self.alerts):
            if severity and a["severity"] != severity:
                continue
            if category and a["category"] != category:
                continue
            if status == "active" and a["status"] == "resolved":
                continue
            if status in ("open", "acknowledged", "resolved") and a["status"] != status:
                continue
            if ql and ql not in f"{a['id']} {a['category']} {a['zone']} {a['segment_id']} {a['related']} {a['params']}".lower():
                continue
            out.append(a)
            if len(out) >= limit:
                break
        return out
