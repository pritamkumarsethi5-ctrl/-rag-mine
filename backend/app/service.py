"""API business logic, independent of the web framework (so it is unit-testable on its own).

`main.py` only maps HTTP routes onto these methods and translates ApiError into HTTP responses.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from .adapters import hardware_status
from .config import METRIC_KEYS, ThresholdConfig, sim_iso
from .routing import NO_ROUTE_MESSAGE
from .simulation import SPEEDS, Simulation

RANGES = {"5m": 300, "15m": 900, "1h": 3600, "6h": 21600}


class ApiError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def parse_time(value: str | float | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as e:
        raise ApiError(422, f"invalid time '{value}' (use ISO-8601 or epoch seconds)") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def parse_range(value: str | None) -> float:
    if value is None:
        return 900.0
    if value in RANGES:
        return float(RANGES[value])
    try:
        v = float(value)
    except ValueError as e:
        raise ApiError(422, f"range must be one of {list(RANGES)} or a number of seconds") from e
    if not 10 <= v <= 86400:
        raise ApiError(422, "range seconds must be within 10..86400")
    return v


class Service:
    def __init__(self, sim: Simulation) -> None:
        self.sim = sim

    # ---- helpers -----------------------------------------------------------
    def _guard(self, fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except ApiError:
            raise
        except KeyError as e:
            raise ApiError(404, f"not found: {e.args[0]}") from e
        except ValueError as e:
            raise ApiError(400, str(e)) from e

    # ---- read endpoints ---------------------------------------------------
    def health(self) -> dict:
        h = self.sim._health()
        return {"status": "ok", "mode": "SIMULATION", "simulated": True, "sim_time": sim_iso(self.sim.t),
                "running": self.sim.running, "health": h, "hardware": hardware_status()}

    def mine_map(self) -> dict:
        return self.sim.mine_map()

    def telemetry_latest(self) -> dict:
        return self.sim.snapshot()

    def telemetry_history(self, metrics: str | None, sensor: str | None, range_: str | None, from_: str | None,
                          to: str | None, max_points: int = 240) -> dict:
        ms = [m for m in (metrics or "ch4,co,o2,co2,h2s").split(",") if m]
        if not ms:
            raise ApiError(422, "metrics must not be empty")
        return self._guard(self.sim.history_query, ms, sensor, parse_range(range_), parse_time(from_), parse_time(to), max_points)

    def history_csv(self, metrics: str | None, sensor: str | None, range_: str | None, from_: str | None, to: str | None) -> str:
        res = self.telemetry_history(metrics, sensor, range_, from_, to, max_points=1000)
        ms = list(res["series"])
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["sim_time_utc", "simulated"] + [f"{m} ({res['units'][m]}) {res['sensor']}" for m in ms])
        for i, t in enumerate(res["t"]):
            w.writerow([sim_iso(t), "SIMULATED"] + [res["series"][m]["v"][i] for m in ms])
        return buf.getvalue()

    def workers(self) -> dict:
        return {"simulated": True, "workers": self.sim.snapshot()["workers"], "navigation": self.sim.snapshot()["navigation"]}

    def worker(self, wid: str) -> dict:
        for w in self.sim.snapshot()["workers"]:
            if w["id"] == wid:
                nav = next((n for n in self.sim.snapshot()["navigation"] if n["worker_id"] == wid), None)
                return {"simulated": True, "worker": w, "navigation": nav}
        raise ApiError(404, f"worker {wid} not found")

    def rover(self) -> dict:
        r = self.sim.snapshot()["rover"]
        full = dict(r)
        full["trajectory"] = self.sim.rover.trajectory
        return {"simulated": True, "rover": full, "mapping": self.sim.snapshot()["mapping"]}

    def alerts(self, severity: str | None, category: str | None, status: str | None, q: str | None, limit: int) -> dict:
        return {"simulated": True, "counts": self.sim.alerts.counts(),
                "alerts": self.sim.alerts.list(severity, category, status, q, max(1, min(limit, 500)))}

    def routes(self, worker_id: str, dest: str | None, mode: str) -> dict:
        if mode not in ("normal", "emergency"):
            raise ApiError(422, "mode must be normal|emergency")
        return self._guard(self.sim.preview_routes, worker_id, dest, mode)

    def sim_status(self) -> dict:
        s = self.sim
        return {"simulated": True, "running": s.running, "speed": s.speed, "speeds": SPEEDS, "sim_time": sim_iso(s.t),
                "seed": s.settings.seed, "tick_interval_s": s.settings.tick_interval_s, "reset_count": s.reset_count,
                "active_scenarios": s.snapshot()["scenarios"], "safety_state": s.snapshot()["safety"]["state"]}

    def analytics(self, range_: str | None) -> dict:
        return self.sim.analytics(parse_range(range_ or "1h"))

    def thresholds(self) -> dict:
        return {"simulated": True, "example_values_only": True,
                "note": "Example thresholds for a simulated prototype. Not legal limits. Configure against applicable regulations, "
                        "site procedures and calibrated instruments.",
                "thresholds": self.sim.thresholds.to_dict()}

    # ---- control endpoints ---------------------------------------------------
    def start(self) -> dict:
        self.sim.start()
        return self.sim_status()

    def pause(self) -> dict:
        self.sim.pause()
        return self.sim_status()

    def reset(self) -> dict:
        self.sim.reset()
        return self.sim_status()

    def set_speed(self, speed: float) -> dict:
        self._guard(self.sim.set_speed, speed)
        return self.sim_status()

    def scenario(self, scenario: str, segment_id: str | None, gas: str | None, zone: str | None) -> dict:
        res = self._guard(self.sim.trigger_scenario, scenario, segment_id, gas, zone)
        return {"simulated": True, "result": res, **self.sim_status()}

    def update_threshold(self, gas: str, **vals) -> dict:
        cfg: ThresholdConfig = self.sim.thresholds
        self._guard(cfg.update, gas, **vals)
        self.sim._evaluate()
        self.sim._finalize()
        return self.thresholds()

    def reset_thresholds(self) -> dict:
        self.sim.thresholds.reset()
        self.sim._evaluate()
        self.sim._finalize()
        return self.thresholds()

    def rover_command(self, command: str, speed_mps: float, duration_s: float) -> dict:
        return self._guard(self.sim.rover_command, command, speed_mps, duration_s)

    def nav_start(self, worker_id: str, dest_node: str | None, mode: str, alternate: bool) -> dict:
        nav = self._guard(self.sim.start_navigation, worker_id, dest_node, mode, alternate)
        return {"simulated": True, "navigation": nav, "message": None if nav.get("found") else NO_ROUTE_MESSAGE}

    def nav_control(self, worker_id: str, action: str) -> dict:
        return self._guard(self.sim.control_navigation, worker_id, action)

    def alert_acknowledge(self, alert_id: str) -> dict:
        a = self.sim.alerts.acknowledge(alert_id, self.sim.t)
        if a is None:
            raise ApiError(404, f"alert {alert_id} not found")
        self.sim._finalize()
        return {"simulated": True, "alert": a, "note": "Acknowledging an alert does not mark the mine safe."}

    def alert_resolve(self, alert_id: str) -> dict:
        a = self.sim.resolve_incident(alert_id)
        if a is None:
            raise ApiError(404, f"alert {alert_id} not found")
        return {"simulated": True, "alert": a}
