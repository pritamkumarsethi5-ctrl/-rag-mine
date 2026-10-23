"""Centralised safety-state engine (SIMULATION ONLY).

States: SAFE, WARNING, DANGER, UNKNOWN.

Hard rules enforced here (and covered by tests):
  * A critical reading ALWAYS yields DANGER - nothing can override it to SAFE.
  * Missing / stale / invalid sensor data NEVER yields SAFE.
  * A stale or failed sensor whose last known reading was critical stays DANGER.
  * This software does not certify any real mine as safe.
"""
from __future__ import annotations

import math
from typing import Any

from .config import GAS_ORDER, GasDef, SimSettings, ThresholdConfig, sim_iso
from .mine_graph import MineGraph

RANK = {"SAFE": 0, "UNKNOWN": 1, "WARNING": 2, "DANGER": 3}
DISCLAIMER = "SIMULATION ONLY. This prototype does not certify any real mine as safe."


def is_valid(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def classify(g: GasDef, v: float) -> tuple[str, float | None, str | None]:
    """Return (level, threshold_crossed, direction). Critical is checked before warning."""
    if g.crit_high is not None and v >= g.crit_high:
        return "critical", g.crit_high, "high"
    if g.crit_low is not None and v <= g.crit_low:
        return "critical", g.crit_low, "low"
    if g.warn_high is not None and v >= g.warn_high:
        return "warning", g.warn_high, "high"
    if g.warn_low is not None and v <= g.warn_low:
        return "warning", g.warn_low, "low"
    return "ok", None, None


def _worst(a: str, b: str) -> str:
    return a if RANK[a] >= RANK[b] else b


def evaluate_segment(
    seg_id: str,
    sensor: dict | None,
    thresholds: ThresholdConfig,
    now: float,
    stale_after_s: float,
    obstruction: bool = False,
    restricted: bool = False,
) -> dict:
    reasons: list[dict] = []
    state = "SAFE"

    def add(code: str, severity: str, ts: float | None, **kw: Any) -> None:
        reasons.append({"code": code, "severity": severity, "segment_id": seg_id,
                        "ts": sim_iso(ts) if ts is not None else None, **kw})

    last_t = sensor.get("last_update") if sensor else None
    data_ok = False
    stale_or_failed = False

    if sensor is None:
        state = "UNKNOWN"
        add("no_sensor", "warning", None, action="restore_monitoring")
    else:
        age = math.inf if last_t is None else now - last_t
        if not sensor.get("available", False):
            stale_or_failed = True
            add("sensor_unavailable", "warning", last_t, sensor_id=sensor["id"], action="restore_monitoring")
        elif age > stale_after_s:
            stale_or_failed = True
            add("stale_telemetry", "warning", last_t, sensor_id=sensor["id"], age_s=round(age, 1), action="restore_monitoring")
        else:
            data_ok = True

        values = sensor.get("values") or {}
        any_valid = False
        for key in GAS_ORDER:
            g = thresholds.gases[key]
            v = values.get(key)
            if not is_valid(v):
                # A missing / non-finite reading can never count as "within limits".
                add("invalid_reading", "warning", last_t, metric=key, sensor_id=sensor["id"], action="restore_monitoring")
                if state == "SAFE":
                    state = "UNKNOWN"
                continue
            any_valid = True
            level, thr, direction = classify(g, float(v))
            if level == "critical":
                # Critical overrides everything, even if the data is now stale.
                add("gas_critical", "critical", last_t, metric=key, value=round(float(v), 3), unit=g.unit,
                    threshold=thr, direction=direction, stale=stale_or_failed, sensor_id=sensor["id"],
                    action="follow_emergency_procedure")
                state = "DANGER"
            elif level == "warning" and data_ok:
                add("gas_warning", "warning", last_t, metric=key, value=round(float(v), 3), unit=g.unit,
                    threshold=thr, direction=direction, sensor_id=sensor["id"], action="investigate_remotely")
                state = _worst(state, "WARNING")
        if not data_ok or not any_valid:
            state = _worst(state, "UNKNOWN") if state != "DANGER" else state
            if state == "SAFE":
                state = "UNKNOWN"

    if obstruction:
        add("tunnel_blocked", "warning", None, action="route_around")
        state = _worst(state, "WARNING")
    if restricted:
        add("restricted_area", "info", None, action="avoid_restricted")

    avoid = state == "DANGER" or obstruction
    return {
        "segment_id": seg_id,
        "state": state,
        "reasons": reasons,
        "avoid": avoid,
        "obstructed": obstruction,
        "restricted": restricted,
        "traversable": not avoid and not restricted,
        "sensor_fresh": data_ok,
    }


def evaluate_mine(
    graph: MineGraph,
    sensors: dict[str, dict],
    thresholds: ThresholdConfig,
    now: float,
    settings: SimSettings,
    obstructions: set[str] | None = None,
) -> dict:
    obstructions = obstructions or set()
    by_seg: dict[str, dict] = {}
    sensor_for_seg = {s["segment_id"]: s for s in sensors.values()}
    for sid, seg in graph.segments.items():
        by_seg[sid] = evaluate_segment(
            sid, sensor_for_seg.get(sid), thresholds, now, settings.stale_after_s,
            obstruction=sid in obstructions, restricted=seg.restricted,
        )

    total = len(by_seg)
    valid = sum(1 for r in by_seg.values() if r["sensor_fresh"])
    coverage = (valid / total) if total else 0.0
    unknown = [sid for sid, r in by_seg.items() if r["state"] == "UNKNOWN"]
    n_danger = sum(1 for r in by_seg.values() if r["state"] == "DANGER")
    n_warn = sum(1 for r in by_seg.values() if r["state"] == "WARNING")

    if total == 0:
        overall = "UNKNOWN"
    elif n_danger:
        overall = "DANGER"
    elif n_warn:
        overall = "WARNING"
    elif unknown:
        # Missing data can never be SAFE. Too little coverage -> UNKNOWN, otherwise a monitoring WARNING.
        overall = "UNKNOWN" if coverage < settings.min_coverage else "WARNING"
    else:
        overall = "SAFE"

    zones: dict[str, dict] = {}
    for sid, r in by_seg.items():
        z = graph.segments[sid].zone
        zr = zones.setdefault(z, {"zone": z, "state": "SAFE", "segments": []})
        zr["segments"].append(sid)
        if RANK[r["state"]] > RANK[zr["state"]]:
            zr["state"] = r["state"]
    for zr in zones.values():
        zr["avoid"] = any(by_seg[s]["avoid"] for s in zr["segments"])

    triggers: list[dict] = []
    for sid, r in by_seg.items():
        for reason in r["reasons"]:
            if reason["severity"] in ("critical", "warning"):
                triggers.append({**reason, "zone": graph.segments[sid].zone})
    triggers.sort(key=lambda x: (0 if x["severity"] == "critical" else 1, x["segment_id"]))

    action = {
        "DANGER": "follow_emergency_procedure",
        "WARNING": "investigate_remotely",
        "UNKNOWN": "restore_monitoring",
        "SAFE": "continue_monitoring",
    }[overall]
    if overall == "WARNING" and not n_warn and not n_danger:
        action = "restore_monitoring"

    return {
        "simulated": True,
        "state": overall,
        "action": action,
        "disclaimer": DISCLAIMER,
        "triggers": triggers,
        "segments": by_seg,
        "zones": zones,
        "monitoring": {"segments_total": total, "segments_valid": valid, "ratio": round(coverage, 3),
                       "min_required": settings.min_coverage, "unknown_segments": unknown},
        "counts": {"danger": n_danger, "warning": n_warn, "unknown": len(unknown)},
    }
