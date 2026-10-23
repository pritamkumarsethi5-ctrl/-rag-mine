"""Telemetry: physical-ish simulation model, sensor bank (what the safety engine sees) and history store.

The SensorBank only ever receives *frames* (dicts). The simulated adapter produces them today;
an ESP32 adapter could produce the same frames later (see adapters.py).
"""
from __future__ import annotations

import bisect
import math
import random
from array import array

from .config import GAS_ORDER, METRIC_KEYS
from .mine_graph import MineGraph

STATE_KEYS = ["ch4", "co", "co2", "h2s", "o2", "temp", "rh", "pressure"]
EVENT_KEYS = ["ch4", "co", "co2", "h2s", "o2", "temp"]
SPILL_KEYS = ["ch4", "co", "co2", "h2s", "o2"]
SPILL_FRACTION = 0.25

# plausibility windows used to reject physically impossible frames
PLAUSIBLE = {
    "ch4": (0.0, 100.0), "co": (0.0, 10000.0), "o2": (0.0, 25.0), "co2": (0.0, 1_000_000.0),
    "h2s": (0.0, 1000.0), "temp": (-40.0, 120.0), "rh": (0.0, 100.0), "pressure": (300.0, 1100.0),
}
# stationary standard deviation of the slow natural variation around each baseline
OU_SD = {"ch4": 0.02, "co": 0.6, "co2": 70.0, "h2s": 0.04, "o2": 0.05, "temp": 0.25, "rh": 1.2, "pressure": 0.2}
OU_THETA = {"ch4": 1 / 600, "co": 1 / 600, "co2": 1 / 600, "h2s": 1 / 600, "o2": 1 / 900, "temp": 1 / 1800, "rh": 1 / 1800, "pressure": 1 / 3600}
NOISE = {"ch4": 0.004, "co": 0.12, "co2": 7.0, "h2s": 0.008, "o2": 0.01, "temp": 0.03, "rh": 0.15, "pressure": 0.03}
EVENT_TAU_S = 45.0


class TelemetryModel:
    """Smoothly evolving per-segment conditions with controllable events.

    Oxygen is *derived*: displaced by CH4 and CO2, so scenarios stay physically coherent.
    """

    def __init__(self, graph: MineGraph, seed: int) -> None:
        self.graph = graph
        self.rng = random.Random(seed * 7919 + 1)
        self.seg_ids = sorted(graph.segments)
        self.base: dict[str, dict[str, float]] = {}
        self.x: dict[str, dict[str, float]] = {}
        self.ev: dict[str, dict[str, float]] = {}
        for sid in self.seg_ids:
            seg = graph.segments[sid]
            r = random.Random(f"{seed}-base-{sid}")
            mid_y = sum(p[1] for p in seg.polyline) / len(seg.polyline)
            depth = -mid_y
            dead = graph.is_dead_end_segment(sid)
            self.base[sid] = {
                "ch4": r.uniform(0.06, 0.22) + (0.12 if dead else 0.0) + (0.2 if sid == "S09" else 0.0),
                "co": r.uniform(1.5, 4.5),
                "co2": r.uniform(650, 1050) + depth * 8 + (350 if dead else 0),
                "h2s": r.uniform(0.08, 0.3) + (0.25 if sid == "S09" else 0.0),
                "temp": 22.5 + 0.18 * depth + r.uniform(-0.4, 0.4),
                "rh": r.uniform(70, 82),
                "pressure": 1006.0 + 0.12 * depth,
                "phase": r.uniform(0, 2 * math.pi),
            }
            self.x[sid] = {k: 0.0 for k in STATE_KEYS}
            self.ev[sid] = {k: 0.0 for k in EVENT_KEYS}

    def step(self, t: float, dt: float, targets: dict[str, dict[str, float]]) -> None:
        for sid in self.seg_ids:
            tgt = targets.get(sid, {})
            x = self.x[sid]
            ev = self.ev[sid]
            for k in STATE_KEYS:
                th = OU_THETA[k]
                decay = math.exp(-th * dt)
                x[k] = x[k] * decay + OU_SD[k] * math.sqrt(1.0 - decay * decay) * self.rng.gauss(0.0, 1.0)
            a = 1.0 - math.exp(-dt / EVENT_TAU_S)
            for k in EVENT_KEYS:
                ev[k] += (tgt.get(k, 0.0) - ev[k]) * a
        self._t = t

    def truth(self, sid: str, t: float) -> dict[str, float]:
        b, x, ev = self.base[sid], self.x[sid], self.ev[sid]
        ch4 = max(0.0, b["ch4"] + x["ch4"] + ev["ch4"])
        co = max(0.0, b["co"] + x["co"] + ev["co"])
        co2 = max(350.0, b["co2"] + x["co2"] + ev["co2"])
        h2s = max(0.0, b["h2s"] + x["h2s"] + ev["h2s"])
        o2 = 20.9 * (1 - ch4 / 100.0 - max(0.0, co2 - 420.0) / 1e6) + x["o2"] + ev["o2"]
        temp = b["temp"] + 1.1 * math.sin(2 * math.pi * t / 21600.0 + b["phase"]) + x["temp"] + ev["temp"]
        rh = min(99.0, max(35.0, b["rh"] - 0.3 * (temp - b["temp"]) + x["rh"]))
        pressure = b["pressure"] + 1.4 * math.sin(2 * math.pi * t / 43200.0 + b["phase"]) + x["pressure"]
        return {"ch4": ch4, "co": co, "o2": o2, "co2": co2, "h2s": h2s, "temp": temp, "rh": rh, "pressure": pressure}

    def read(self, sid: str, t: float) -> dict[str, float]:
        """Noisy sensor reading. Always draws the same number of random values (deterministic)."""
        tr = self.truth(sid, t)
        out: dict[str, float] = {}
        for k in METRIC_KEYS:
            n = self.rng.gauss(0.0, NOISE[k])
            lo, hi = PLAUSIBLE[k]
            out[k] = min(hi, max(lo, tr[k] + n))
        return out


class SensorBank:
    """Latest state of every sensor node, fed exclusively through validated frames."""

    def __init__(self, graph: MineGraph) -> None:
        self.graph = graph
        self.sensors: dict[str, dict] = {}
        self.rejected = 0
        for sid in sorted(graph.segments):
            seg = graph.segments[sid]
            nid = f"GS-{sid}"
            self.sensors[nid] = {
                "id": nid, "segment_id": sid, "zone": seg.zone,
                "kinds": ["gas multi-sensor", "AHT10-like (temp/RH)", "BMP180-like (pressure)"],
                "available": False, "status": "no_data", "last_update": None, "values": {},
                "position": list(graph.locate(sid, seg.length_m / 2)[0]),
            }

    @staticmethod
    def validate_frame(frame: dict) -> str | None:
        """Return an error string or None when the frame is acceptable."""
        if not isinstance(frame, dict):
            return "frame must be an object"
        if not isinstance(frame.get("sensor_id"), str):
            return "sensor_id missing"
        t = frame.get("t")
        if not isinstance(t, (int, float)) or not math.isfinite(t):
            return "t missing or not finite"
        if frame.get("status") not in ("ok", "fault"):
            return "status must be ok|fault"
        if frame["status"] == "ok":
            vals = frame.get("values")
            if not isinstance(vals, dict):
                return "values missing"
            for k, v in vals.items():
                if k not in PLAUSIBLE:
                    return f"unknown metric {k}"
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
                    return f"{k} not finite"
                lo, hi = PLAUSIBLE[k]
                if not lo <= v <= hi:
                    return f"{k} outside plausible range"
        return None

    def apply(self, frames: list[dict]) -> int:
        accepted = 0
        for f in frames:
            err = self.validate_frame(f)
            s = self.sensors.get(f.get("sensor_id", "")) if isinstance(f, dict) else None
            if err or s is None:
                self.rejected += 1
                continue
            accepted += 1
            s["last_update"] = float(f["t"])
            if f["status"] == "fault":
                s["available"] = False
                s["status"] = "fault"
            else:
                s["available"] = True
                s["status"] = "ok"
                s["values"] = {k: float(v) for k, v in f["values"].items()}
        return accepted

    def status(self, sensor: dict, now: float, stale_after: float) -> str:
        if sensor["status"] == "no_data":
            return "no_data"
        if not sensor["available"]:
            return "fault"
        if sensor["last_update"] is None or now - sensor["last_update"] > stale_after:
            return "stale"
        return "ok"


class History:
    """Compact in-memory telemetry history (generated records, not hardcoded arrays)."""

    def __init__(self, sensor_ids: list[str], maxlen: int = 12000) -> None:
        self.sensor_ids = list(sensor_ids)
        self.idx = {s: i for i, s in enumerate(self.sensor_ids)}
        self.n = len(self.sensor_ids)
        self.m = len(METRIC_KEYS)
        self.maxlen = maxlen
        self.t: list[float] = []
        self.data: list[array] = []

    def add(self, t: float, readings: dict[str, dict[str, float] | None]) -> None:
        a = array("f", [math.nan] * (self.n * self.m))
        for sid, vals in readings.items():
            if not vals:
                continue
            i = self.idx[sid]
            for j, k in enumerate(METRIC_KEYS):
                v = vals.get(k)
                if v is not None:
                    a[i * self.m + j] = v
        self.t.append(t)
        self.data.append(a)
        if len(self.t) > self.maxlen + 500:
            del self.t[:500]
            del self.data[:500]

    def __len__(self) -> int:
        return len(self.t)

    def range(self, t_from: float, t_to: float) -> tuple[int, int]:
        return bisect.bisect_left(self.t, t_from), bisect.bisect_right(self.t, t_to)

    def query(self, metrics: list[str], sensor: str | None, t_from: float, t_to: float, max_points: int = 240) -> dict:
        lo, hi = self.range(t_from, t_to)
        width = max((t_to - t_from) / max_points, 1e-6)
        nb = max_points
        sel = [self.idx[sensor]] if sensor and sensor != "all" else list(range(self.n))
        out: dict = {"t": [], "series": {}, "stats": {}, "sensor": sensor or "all", "samples": hi - lo}
        mi = {k: METRIC_KEYS.index(k) for k in metrics}
        acc: dict[str, dict[str, list]] = {
            k: {"sum": [0.0] * nb, "cnt": [0] * nb, "worst": [None] * nb, "mn": [math.inf] * nb, "mx": [-math.inf] * nb}
            for k in metrics
        }
        tot: dict[str, list[float]] = {k: [0.0, 0, math.inf, -math.inf, math.nan] for k in metrics}  # sum,cnt,min,max,last
        for r in range(lo, hi):
            b = min(nb - 1, int((self.t[r] - t_from) / width))
            row = self.data[r]
            for k, j in mi.items():
                vals = [row[s * self.m + j] for s in sel]
                vals = [v for v in vals if not math.isnan(v)]
                if not vals:
                    continue
                a = acc[k]
                a["sum"][b] += sum(vals)
                a["cnt"][b] += len(vals)
                worst = min(vals) if k == "o2" else max(vals)
                w = a["worst"][b]
                a["worst"][b] = worst if w is None else (min(w, worst) if k == "o2" else max(w, worst))
                a["mn"][b] = min(a["mn"][b], min(vals))
                a["mx"][b] = max(a["mx"][b], max(vals))
                t_ = tot[k]
                t_[0] += sum(vals); t_[1] += len(vals); t_[2] = min(t_[2], min(vals)); t_[3] = max(t_[3], max(vals)); t_[4] = vals[-1] if len(sel) == 1 else sum(vals) / len(vals)
        for b in range(nb):
            if any(acc[k]["cnt"][b] for k in metrics):
                out["t"].append(round(t_from + (b + 0.5) * width, 1))
        keep = [b for b in range(nb) if any(acc[k]["cnt"][b] for k in metrics)]
        for k in metrics:
            a = acc[k]
            avg = [round(a["sum"][b] / a["cnt"][b], 4) if a["cnt"][b] else None for b in keep]
            if len(sel) == 1:
                v = avg
            else:
                v = [round(a["worst"][b], 4) if a["worst"][b] is not None else None for b in keep]
            out["series"][k] = {"v": v, "avg": avg,
                                "min": [round(a["mn"][b], 4) if a["cnt"][b] else None for b in keep],
                                "max": [round(a["mx"][b], 4) if a["cnt"][b] else None for b in keep]}
            t_ = tot[k]
            if t_[1]:
                vv = [x for x in avg if x is not None]
                third = max(1, len(vv) // 3)
                first, last = sum(vv[:third]) / third, sum(vv[-third:]) / third
                mean = t_[0] / t_[1]
                delta = last - first
                span = max(abs(mean) * 0.02, 1e-9)
                trend = "stable" if abs(delta) < span else ("rising" if delta > 0 else "falling")
                hours = max((t_to - t_from) / 3600.0, 1e-6)
                out["stats"][k] = {"min": round(t_[2], 4), "max": round(t_[3], 4), "avg": round(mean, 4),
                                   "last": round(vv[-1], 4), "trend": trend, "delta": round(delta, 4),
                                   "per_hour": round(delta / hours, 4)}
            else:
                out["stats"][k] = None
        return out

    def latest_aggregate(self, metric: str, t: float) -> float | None:
        """Mean across sensors at the sample closest at/before t."""
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0:
            return None
        j = METRIC_KEYS.index(metric)
        row = self.data[i]
        vals = [row[s * self.m + j] for s in range(self.n) if not math.isnan(row[s * self.m + j])]
        if not vals:
            return None
        return (min(vals) if metric == "o2" else max(vals)) if metric in GAS_ORDER else sum(vals) / len(vals)
