"""Central simulation engine (SIMULATION MODE ONLY).

Everything the dashboard shows is generated here: gas / environment telemetry, rover exploration,
worker movement, hazards, alerts and routes. State is deterministic for a given seed.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

from .adapters import SimulatedAdapter, hardware_status, validate_rover_command
from .alerts import AlertCenter
from .config import GAS_ORDER, METRIC_KEYS, SIM_ORIGIN, SimSettings, ThresholdConfig, sim_iso
from .mine_graph import MineGraph, build_default_mine, heading_deg
from .movement import Traveller, add_interval, covered_length
from .routing import Leg, Location, NO_ROUTE_MESSAGE, Route, build_instructions, nearest_exit, plan_route, plan_routes
from .safety import RANK, classify, evaluate_mine
from .store import SqliteStore
from .telemetry import EVENT_KEYS, SPILL_FRACTION, SPILL_KEYS, History, SensorBank, TelemetryModel

SPEEDS = [1, 2, 5, 10, 30, 60]
SCENARIOS = ["warning", "critical_gas", "sensor_failure", "comm_loss", "blocked_tunnel", "evacuation", "clear"]
DEFAULT_SEGMENT = {"warning": "S10", "critical_gas": "S12", "sensor_failure": "S07", "blocked_tunnel": "S03"}
DEFAULT_ZONE = "East"
MAX_SUBSTEP_S = 5.0
COVERAGE_DEFINITION = (
    "Mapping coverage = explored tunnel length / total length of the synthetic mine graph. "
    "Explored length is the union of tunnel intervals the simulated rover has driven while mapping."
)
WORKER_SPECS = [
    ("W-101", "Kite", "S02", 30.0), ("W-102", "Ember", "S06", 20.0), ("W-103", "Quartz", "S10", 40.0),
    ("W-104", "Basalt", "S12", 25.0), ("W-105", "Cinder", "S13", 15.0), ("W-106", "Flint", "S04", 35.0),
]


@dataclass
class Ctx:
    blocked: set[str]
    pen: dict[str, tuple[float, str]]
    sig: tuple
    changed: bool


class Worker:
    def __init__(self, wid: str, callsign: str, graph: MineGraph, seg: str, off: float, speed: float) -> None:
        self.id, self.callsign, self.speed = wid, callsign, speed
        self.tr = Traveller(graph, seg, off)
        self.route: Route | None = None
        self.nav: dict | None = None
        self.dest: str | None = None
        self.dwell_until = 0.0
        self.retry_at = 0.0
        self.evacuated = False
        self.replan = True
        self.speed_now = 0.0
        self.rep = (seg, off, SIM_ORIGIN)  # last REPORTED location (seg, off, t)
        self.reroute_t: float | None = None
        self.exposed_seg: str | None = None
        self.nav_clear_at: float | None = None


class Rover:
    id = "ROV-01"

    def __init__(self, graph: MineGraph, t: float) -> None:
        self.tr = Traveller(graph, "S01", 0.0)
        self.mode = "paused"  # auto | manual | returning | docked | paused
        self.mapping = False
        self.battery = 100.0
        self.speed_now = 0.0
        self.manual_cmd = "stop"
        self.pending_turn: str | None = None
        self.facing = 1
        self.obstacle_until = 0.0
        self.next_obstacle_m = 260.0
        self.odometer = 0.0
        self.target_seg: str | None = None
        self.trajectory: list[list[float]] = []
        self.last_traj_odo = -99.0
        self.last_mapped_t: float | None = None
        self.connection = "online"
        self.rep_t = t
        self.rep_pos = list(self.tr.pos())
        self.rep_seg = "S01"
        self.task = "paused"
        self.obstacles: list[dict] = []
        self.resume_after_charge = False
        self.low_battery_return = False


class Simulation:
    def __init__(self, settings: SimSettings | None = None, thresholds: ThresholdConfig | None = None,
                 store: SqliteStore | None = None) -> None:
        self.settings = settings or SimSettings()
        self.thresholds = thresholds or ThresholdConfig()
        self.graph: MineGraph = build_default_mine()
        self.store = store
        self.running = False
        self.speed = 5.0
        self.last_tick_wall = time.time()
        self.reset_count = 0
        self._init_state()

    # ------------------------------------------------------------------ setup
    def _init_state(self) -> None:
        s = self.settings
        g = self.graph
        self.t = SIM_ORIGIN
        self.seq = 0
        self.comm_zones: set[str] = set()
        self.obstructions: set[str] = set()
        self.rng = random.Random(s.seed + 99)
        self.model = TelemetryModel(g, s.seed)
        self.sensors = SensorBank(g)
        self.adapter = SimulatedAdapter(self.model, g)
        self.history = History(sorted(self.sensors.sensors))
        self.alerts = AlertCenter()
        self.events: list[dict] = []
        self._ev_counter = 0
        self.timeline: list[dict] = []
        self.explored: dict[str, list[list[float]]] = {sid: [] for sid in g.segments}
        self.coverage_history: list[list[float]] = []
        self.exposure_log: list[dict] = []
        self.rover = Rover(g, self.t)
        self.workers = [Worker(w, c, g, seg, off, 1.0 + 0.05 * i) for i, (w, c, seg, off) in enumerate(WORKER_SPECS)]
        for w in self.workers:
            w.rep = (w.tr.seg, w.tr.off, self.t)
        self.safety: dict = {}
        self.ctx = Ctx(set(), {}, (), False)
        self._last_sample_t = -1e18
        self._prev_state: str | None = None
        self._evac_active = False
        self._prev_explored_flags: dict[str, bool] = {sid: False for sid in g.segments}
        self._ambient = self._make_ambient()
        self.events.extend(self._ambient)
        self._backfill()
        # first live frames so sensors are fresh at t0
        self.sensors.apply(self.adapter.poll(self.t, set()))
        if s.rover_autostart:
            self.rover.mode, self.rover.mapping = "auto", True
        self.rover.rep_t = self.t
        self._evaluate()
        self._record_coverage()
        self._finalize()

    def _make_ambient(self) -> list[dict]:
        if not self.settings.ambient_events:
            return []
        r = random.Random(self.settings.seed + 1000)
        t = SIM_ORIGIN - self.settings.backfill_hours * 3600 + 20 * 60
        out: list[dict] = []
        segs = sorted(self.graph.segments)
        gases = ["ch4", "co", "h2s", "co2"]
        while t < SIM_ORIGIN + 48 * 3600:
            sid = r.choice(segs)
            gas = r.choice(gases)
            dur = r.uniform(150, 360)
            gd = self.thresholds.gases[gas]
            delta = (gd.warn_high or 0) * 1.3 - self.model.base[sid][gas]
            self._ev_counter += 1
            out.append({"id": f"EV-{self._ev_counter:04d}", "kind": "gas", "source": "ambient", "segment_id": sid,
                        "zone": self.graph.segments[sid].zone, "deltas": {gas: delta}, "gas": gas,
                        "start": t, "end": t + dur, "cleared": False})
            t += r.uniform(35, 70) * 60
        return out

    def _backfill(self) -> None:
        s = self.settings
        t = SIM_ORIGIN - s.backfill_hours * 3600
        step = 30.0
        while t < SIM_ORIGIN:
            t += step
            self.model.step(t, step, self._targets(t))
            readings = {f"GS-{sid}": self.model.read(sid, t) for sid in self.model.seg_ids}
            self.history.add(t, readings)
        self.t = SIM_ORIGIN
        self._last_sample_t = SIM_ORIGIN

    def reset(self) -> None:
        keep_running, keep_speed = self.running, self.speed
        self._init_state()
        self.running, self.speed = keep_running, keep_speed
        self.reset_count += 1

    # ------------------------------------------------------------------ events
    def _active(self, t: float | None = None) -> list[dict]:
        t = self.t if t is None else t
        return [e for e in self.events if not e["cleared"] and e["start"] <= t and (e["end"] is None or t < e["end"])]

    def _targets(self, t: float) -> dict[str, dict[str, float]]:
        tg: dict[str, dict[str, float]] = {}
        for ev in self._active(t):
            if ev["kind"] != "gas":
                continue
            sid = ev["segment_id"]
            for k, v in ev["deltas"].items():
                tg.setdefault(sid, {})
                tg[sid][k] = tg[sid].get(k, 0.0) + v
                if k in SPILL_KEYS:
                    for nb in self.graph.neighbors_of_segment(sid):
                        tg.setdefault(nb, {})
                        tg[nb][k] = tg[nb].get(k, 0.0) + SPILL_FRACTION * v
        return tg

    def _add_event(self, kind: str, **kw) -> dict:
        self._ev_counter += 1
        ev = {"id": f"EV-{self._ev_counter:04d}", "kind": kind, "source": "scenario", "segment_id": None, "zone": None,
              "deltas": {}, "start": self.t, "end": None, "cleared": False, **kw}
        self.events.append(ev)
        return ev

    def _clear_event(self, ev: dict) -> None:
        ev["cleared"] = True

    def _log(self, event: str, severity: str, **params) -> None:
        self.timeline.append({"t": self.t, "time": sim_iso(self.t), "kind": event, "severity": severity, "params": params})
        if len(self.timeline) > 400:
            self.timeline = self.timeline[-400:]

    # ------------------------------------------------------------------ scenarios
    def trigger_scenario(self, kind: str, segment_id: str | None = None, gas: str | None = None, zone: str | None = None) -> dict:
        res = self._trigger(kind, segment_id, gas, zone)
        self._evaluate()
        self._finalize()
        return res

    def _trigger(self, kind: str, segment_id: str | None, gas: str | None, zone: str | None) -> dict:
        if kind not in SCENARIOS:
            raise ValueError(f"unknown scenario '{kind}'")
        g = self.graph
        if segment_id is not None and segment_id not in g.segments:
            raise ValueError(f"unknown segment '{segment_id}'")
        if zone is not None and zone not in {s.zone for s in g.segments.values()}:
            raise ValueError(f"unknown zone '{zone}'")
        th = self.thresholds.gases
        if kind == "clear":
            n = 0
            for ev in self._active():
                self._clear_event(ev)
                n += 1
            self._log("scenario_clear", "info", cleared=n)
            return {"scenario": kind, "cleared": n}
        if kind in ("warning", "critical_gas"):
            sid = segment_id or DEFAULT_SEGMENT[kind]
            gas = gas or "ch4"
            if gas not in GAS_ORDER:
                raise ValueError(f"unknown gas '{gas}'")
            base = self.model.base[sid]
            d: dict[str, float] = {}
            gd = th[gas]
            if kind == "warning":
                if gas == "o2":
                    d["o2"] = ((gd.warn_low or 19.5) - 0.5) - 20.9
                else:
                    d[gas] = (gd.warn_high or 1.0) * 1.35 - base[gas]
            else:
                if gas == "o2":
                    d["o2"] = ((gd.crit_low or 18.0) - 1.2) - 20.9
                    d["co2"] = 4000.0
                elif gas == "co":  # fire-like: CO and CO2 up, O2 consumed, temperature up
                    d["co"] = (gd.crit_high or 50.0) * 2.2 - base["co"]
                    d["co2"] = 6000.0
                    d["o2"] = -1.0
                    d["temp"] = 10.0
                else:
                    d[gas] = (gd.crit_high or 2.0) * 1.45 - base[gas]
            ev = self._add_event("gas", segment_id=sid, zone=g.segments[sid].zone, deltas=d, gas=gas,
                                 end=self.t + 300 if kind == "warning" else None, scenario=kind)
            self._log("scenario_" + kind, "critical" if kind == "critical_gas" else "warning", segment_id=sid, gas=gas)
            return {"scenario": kind, "event": ev["id"], "segment_id": sid, "gas": gas}
        if kind == "sensor_failure":
            sid = segment_id or DEFAULT_SEGMENT[kind]
            ev = self._add_event("sensor_failure", segment_id=sid, zone=g.segments[sid].zone, sensor_id=f"GS-{sid}")
            self._log("scenario_sensor_failure", "warning", sensor_id=f"GS-{sid}", segment_id=sid)
            return {"scenario": kind, "event": ev["id"], "sensor_id": f"GS-{sid}"}
        if kind == "comm_loss":
            z = zone or (g.segments[segment_id].zone if segment_id else DEFAULT_ZONE)
            ev = self._add_event("comm_loss", zone=z, end=self.t + 240)
            self._log("scenario_comm_loss", "warning", zone=z)
            return {"scenario": kind, "event": ev["id"], "zone": z}
        if kind == "blocked_tunnel":
            sid = segment_id or DEFAULT_SEGMENT[kind]
            ev = self._add_event("blocked_tunnel", segment_id=sid, zone=g.segments[sid].zone)
            self._log("scenario_blocked_tunnel", "warning", segment_id=sid)
            return {"scenario": kind, "event": ev["id"], "segment_id": sid}
        ev = self._add_event("evacuation")
        self._log("scenario_evacuation", "critical")
        return {"scenario": kind, "event": ev["id"]}

    def resolve_incident(self, alert_id: str) -> dict | None:
        a = self.alerts.get(alert_id)
        if a is None:
            return None
        cat = a["category"]
        for ev in self._active():
            if cat in ("critical_gas", "gas_warning", "oxygen_range") and ev["kind"] == "gas" and (
                    ev["segment_id"] == a["segment_id"] or ev["segment_id"] in self.graph.neighbors_of_segment(a["segment_id"] or "")):
                self._clear_event(ev)
            elif cat in ("sensor_unavailable", "stale_telemetry") and ev["kind"] in ("sensor_failure", "comm_loss") and (
                    ev.get("segment_id") == a["segment_id"] or ev.get("zone") == a["zone"]):
                self._clear_event(ev)
            elif cat == "comm_lost" and ev["kind"] == "comm_loss":
                self._clear_event(ev)
            elif cat == "route_blocked" and ev["kind"] == "blocked_tunnel" and ev["segment_id"] == a["segment_id"]:
                self._clear_event(ev)
            elif cat == "evacuation" and ev["kind"] == "evacuation":
                self._clear_event(ev)
        self.alerts.resolve(alert_id, self.t)
        self._log("incident_resolved", "info", alert_id=alert_id, category=cat)
        self._evaluate()
        self._finalize()
        return self.alerts.get(alert_id)

    # ------------------------------------------------------------------ controls
    def start(self) -> None:
        self.running = True

    def pause(self) -> None:
        self.running = False

    def set_speed(self, speed: float) -> None:
        if speed not in SPEEDS:
            raise ValueError(f"speed must be one of {SPEEDS}")
        self.speed = float(speed)

    # ------------------------------------------------------------------ main loop
    def tick(self, wall_dt: float | None = None) -> None:
        """One real-time update: advances the simulated clock by tick_interval * speed."""
        self.last_tick_wall = time.time()
        if not self.running:
            return
        self.advance(self.settings.tick_interval_s * self.speed if wall_dt is None else wall_dt * self.speed)

    def advance(self, seconds: float) -> None:
        n = max(1, math.ceil(seconds / MAX_SUBSTEP_S))
        dt = seconds / n
        for _ in range(n):
            self._substep(dt)
        self._finalize()

    def _substep(self, dt: float) -> None:
        self.t += dt
        t = self.t
        self.model.step(t, dt, self._targets(t))
        active = self._active(t)
        self.adapter.faults = {e["sensor_id"]: "fault" for e in active if e["kind"] == "sensor_failure"}
        comm = {e["zone"] for e in active if e["kind"] == "comm_loss"}
        self.comm_zones = comm
        frames = self.adapter.poll(t, comm)
        self.sensors.apply(frames)
        if t - self._last_sample_t >= self.settings.sample_interval_s - 1e-9:
            self._last_sample_t = t
            readings = {f["sensor_id"]: (f["values"] if f["status"] == "ok" else None) for f in frames}
            self.history.add(t, readings)
            if self.store:
                self.store.write_sample(t, readings)
        self._evaluate()
        self._evac_transition(active)
        for w in self.workers:
            self._update_worker(w, dt)
        self._update_rover(dt)
        self._sync_alerts(active)
        if t - (self.coverage_history[-1][0] if self.coverage_history else -1e18) >= self.settings.sample_interval_s:
            self._record_coverage()

    # ------------------------------------------------------------------ safety / context
    def _evaluate(self) -> None:
        obstr = {e["segment_id"] for e in self._active() if e["kind"] == "blocked_tunnel"}
        self.obstructions = obstr
        self.comm_zones = getattr(self, "comm_zones", set())
        self.safety = evaluate_mine(self.graph, self.sensors.sensors, self.thresholds, self.t, self.settings, obstr)
        blocked: set[str] = set()
        pen: dict[str, tuple[float, str]] = {}
        for sid, r in self.safety["segments"].items():
            if not r["traversable"]:
                blocked.add(sid)
            elif r["state"] == "WARNING":
                pen[sid] = (2.5, "gas_warning")
            elif r["state"] == "UNKNOWN":
                pen[sid] = (3.0, "unknown_data")
        sig = (tuple(sorted(blocked)), tuple(sorted((k, v[1]) for k, v in pen.items())))
        self.ctx = Ctx(blocked, pen, sig, sig != self.ctx.sig)
        st = self.safety["state"]
        if st != self._prev_state:
            if self._prev_state is not None:
                self._log("state_change", "critical" if st == "DANGER" else ("warning" if st in ("WARNING", "UNKNOWN") else "info"),
                          old=self._prev_state, new=st)
            self._prev_state = st

    def _seg_state(self, sid: str) -> str:
        return self.safety["segments"][sid]["state"]

    # ------------------------------------------------------------------ workers
    def _evac_transition(self, active: list[dict]) -> None:
        now = any(e["kind"] == "evacuation" for e in active)
        if now and not self._evac_active:
            for w in self.workers:
                w.nav = {"mode": "emergency", "dest": None, "paused": False, "started": self.t, "traveled": 0.0,
                         "status": "active", "system": True, "alt": False}
                w.replan = True
                w.evacuated = False
        elif not now and self._evac_active:
            for w in self.workers:
                if w.nav and w.nav.get("system"):
                    w.nav = None
                w.evacuated = False
                w.route = None
                w.tr.legs = []
                w.replan = True
        self._evac_active = now

    def _loc(self, tr: Traveller) -> Location:
        return Location.on_segment(tr.seg, tr.off)

    def _plan_worker(self, w: Worker) -> None:
        t = self.t
        ctx = self.ctx
        loc = self._loc(w.tr)
        old_sig = w.route.signature() if (w.route and w.route.found) else None
        nav = w.nav
        route: Route
        if nav and nav["mode"] == "emergency":
            route = nearest_exit(self.graph, loc, ctx.blocked, ctx.pen, w.speed)
            nav["dest"] = route.dest_node if route.found else None
        else:
            dest = nav["dest"] if nav else w.dest
            if dest is None:
                return
            if nav and nav.get("alt") and old_sig is None:
                rs = plan_routes(self.graph, loc, dest, ctx.blocked, ctx.pen, w.speed)
                route = rs[1] if len(rs) > 1 else rs[0]
            else:
                route = plan_route(self.graph, loc, dest, ctx.blocked, ctx.pen, w.speed)
        w.replan = False
        if not route.found:
            w.route = route
            w.tr.legs = []
            w.retry_at = t + 10.0
            if nav is None:
                w.dest = None
                w.dwell_until = t + 10.0
            else:
                nav["status"] = "no_route"
            return
        if nav and nav["status"] == "no_route":
            nav["status"] = "active"
        if old_sig is not None and route.signature() != old_sig and self.ctx.changed and nav is not None:
            w.reroute_t = t
            self.alerts.push(t, {"severity": "warning", "category": "route_blocked", "zone": self.graph.segments[w.tr.seg].zone,
                                 "segment_id": w.tr.seg, "related": {"type": "worker", "id": w.id},
                                 "params": {"kind": "rerouted", "worker_id": w.id, "dest": route.dest_node}})
        w.route = route
        w.tr.set_route(route)
        if not w.tr.legs:
            self._arrive(w)

    def _arrive(self, w: Worker) -> None:
        t = self.t
        w.route = None
        w.tr.legs = []
        nav = w.nav
        if nav is None:
            w.dest = None
            w.dwell_until = t + self.rng.uniform(15, 45)
        elif nav["mode"] == "emergency":
            nav["status"] = "arrived"
            w.evacuated = True
            self._log("worker_evacuated", "info", worker_id=w.id)
        else:
            nav["status"] = "arrived"
            w.nav_clear_at = t + 60.0

    def _update_worker(self, w: Worker, dt: float) -> None:
        t = self.t
        zone = self.graph.segments[w.tr.seg].zone
        if zone not in self.comm_zones:
            w.rep = (w.tr.seg, w.tr.off, t)
        if w.evacuated:
            w.speed_now = 0.0
            return
        nav = w.nav
        if nav and nav["status"] == "arrived" and w.nav_clear_at and t >= w.nav_clear_at:
            w.nav, w.nav_clear_at = None, None
            nav = None
        paused = bool(nav and nav.get("paused"))
        if nav is None and not w.tr.legs and w.dest is None and t >= w.dwell_until:
            self._pick_wander(w)
        need = w.replan or (self.ctx.changed and (w.tr.legs or (nav and nav["status"] in ("active", "no_route"))))
        if nav and nav["status"] == "no_route" and t >= w.retry_at:
            need = True
        if nav and nav["status"] == "active" and not w.tr.legs and w.route is None:
            need = True
        if need and not paused and (nav is None and w.dest is not None or nav and nav["status"] != "arrived"):
            self._plan_worker(w)
        moving = False
        if not paused and w.route is not None and w.route.found and w.tr.legs:
            d = w.speed * dt
            w.tr.advance(d)
            if nav:
                nav["traveled"] += d
            moving = True
            if not w.tr.legs:
                self._arrive(w)
        w.speed_now = w.speed if moving else 0.0
        st = self._seg_state(w.tr.seg)
        if st in ("WARNING", "DANGER"):
            if w.exposed_seg != w.tr.seg:
                w.exposed_seg = w.tr.seg
                self.exposure_log.append({"t": t, "time": sim_iso(t), "worker_id": w.id, "segment_id": w.tr.seg, "state": st})
        else:
            w.exposed_seg = None

    def _pick_wander(self, w: Worker) -> None:
        ids = sorted(self.graph.nodes)
        for _ in range(6):
            dest = self.rng.choice(ids)
            if dest == w.tr.node_at(1.0):
                continue
            r = plan_route(self.graph, self._loc(w.tr), dest, self.ctx.blocked, self.ctx.pen, w.speed)
            if r.found and r.legs:
                w.dest = dest
                w.replan = True
                return
        w.dwell_until = self.t + 10.0

    # navigation API ---------------------------------------------------------
    def worker(self, wid: str) -> Worker:
        for w in self.workers:
            if w.id == wid:
                return w
        raise KeyError(wid)

    def start_navigation(self, worker_id: str, dest_node: str | None, mode: str = "normal", alternate: bool = False) -> dict:
        w = self.worker(worker_id)
        if mode not in ("normal", "emergency"):
            raise ValueError("mode must be normal|emergency")
        if mode == "normal" and (dest_node is None or dest_node not in self.graph.nodes):
            raise ValueError("unknown destination node")
        if self._evac_active:
            raise ValueError("An evacuation is active; workers follow emergency routing.")
        w.nav = {"mode": mode, "dest": dest_node if mode == "normal" else None, "paused": False, "started": self.t,
                 "traveled": 0.0, "status": "active", "system": False, "alt": alternate}
        w.evacuated = False
        w.dest = None
        w.route, w.tr.legs, w.replan = None, [], True
        self._plan_worker(w)
        self._log("navigation_started", "info", worker_id=w.id, mode=mode, dest=dest_node)
        self._finalize()
        return self._nav_summary(w) or {}

    def control_navigation(self, worker_id: str, action: str) -> dict:
        w = self.worker(worker_id)
        if action == "stop":
            if w.nav and w.nav.get("system"):
                raise ValueError("Evacuation routing is controlled by the evacuation incident.")
            w.nav, w.route, w.tr.legs, w.dest = None, None, [], None
            w.dwell_until = self.t + 20.0
            w.evacuated = False
        elif w.nav is None:
            raise ValueError("no active navigation for this worker")
        elif action == "pause":
            w.nav["paused"] = True
        elif action == "resume":
            w.nav["paused"] = False
            w.replan = True
        elif action == "recalculate":
            w.replan = True
            self._plan_worker(w)
        else:
            raise ValueError("action must be pause|resume|stop|recalculate")
        self._finalize()
        return {"worker_id": worker_id, "navigation": self._nav_summary(w)}

    def preview_routes(self, worker_id: str, dest_node: str | None, mode: str = "normal") -> dict:
        w = self.worker(worker_id)
        loc = self._loc(w.tr)
        c = self.ctx
        if mode == "emergency":
            r = nearest_exit(self.graph, loc, c.blocked, c.pen, w.speed)
            routes = [r]
        else:
            if dest_node is None or dest_node not in self.graph.nodes:
                raise ValueError("unknown destination node")
            routes = plan_routes(self.graph, loc, dest_node, c.blocked, c.pen, w.speed)
        return {"simulated": True, "worker_id": worker_id, "mode": mode,
                "blocked_segments": sorted(c.blocked), "routes": [r.to_dict() for r in routes],
                "message": None if routes[0].found else NO_ROUTE_MESSAGE}

    # ------------------------------------------------------------------ rover
    def _ratio(self, sid: str) -> float:
        return covered_length(self.explored[sid]) / max(self.graph.segments[sid].length_m, 1e-9)

    def _record_map(self, covered: list[tuple[str, float, float]]) -> None:
        r = self.rover
        for sid, lo, hi in covered:
            add_interval(self.explored[sid], lo, hi)
            r.last_mapped_t = self.t
            done = self._ratio(sid) >= 0.98
            if done and not self._prev_explored_flags[sid]:
                self._prev_explored_flags[sid] = True
                self._log("segment_mapped", "info", segment_id=sid, name=self.graph.segments[sid].name)
                self.alerts.push(self.t, {"severity": "info", "category": "mapping_event", "zone": self.graph.segments[sid].zone,
                                          "segment_id": sid, "related": {"type": "rover", "id": r.id},
                                          "params": {"kind": "segment_mapped", "coverage_pct": round(self.coverage()["coverage_pct"], 1)}})

    def coverage(self) -> dict:
        total = self.graph.total_length()
        exp = sum(covered_length(v) for v in self.explored.values())
        restricted_unexp = sum(self.graph.segments[s].length_m - covered_length(self.explored[s])
                               for s in self.graph.segments if self.graph.segments[s].restricted)
        n_done = sum(1 for sid in self.graph.segments if self._ratio(sid) >= 0.98)
        r = self.rover
        return {
            "total_m": round(total, 1), "explored_m": round(exp, 1), "remaining_m": round(total - exp, 1),
            "coverage_pct": round(100.0 * exp / total, 2) if total else 0.0,
            "segments_total": len(self.graph.segments), "segments_explored": n_done,
            "restricted_unexplored_m": round(restricted_unexp, 1),
            "current_segment": r.tr.seg, "last_mapped": sim_iso(r.last_mapped_t) if r.last_mapped_t else None,
            "definition": COVERAGE_DEFINITION, "simulated": True, "slam": False,
        }

    def _record_coverage(self) -> None:
        c = self.coverage()
        self.coverage_history.append([self.t, c["coverage_pct"], c["explored_m"]])
        if len(self.coverage_history) > 6000:
            del self.coverage_history[:500]

    def _node_dir(self, node: str, sid: str) -> tuple[float, float]:
        seg = self.graph.segments[sid]
        if seg.a == node:
            _, tan = self.graph.locate(sid, 0.0)
            return tan[0], tan[2]
        _, tan = self.graph.locate(sid, seg.length_m)
        return -tan[0], -tan[2]

    def _pick_next(self, node: str, cur: str, move_vec: tuple[float, float], turn: str | None) -> str | None:
        best, best_score = None, None
        for sid in self.graph.adj[node]:
            if sid == cur or sid in self.ctx.blocked:
                continue
            ox, oz = self._node_dir(node, sid)
            ang = math.degrees(math.atan2(move_vec[0] * oz - move_vec[1] * ox, move_vec[0] * ox + move_vec[1] * oz))
            score = -abs(ang) if turn is None else (ang if turn == "left" else -ang)
            if best_score is None or score > best_score:
                best, best_score = sid, score
        return best

    def _rover_plan_explore(self) -> bool:
        r, c, g = self.rover, self.ctx, self.graph
        loc = self._loc(r.tr)
        best = None
        for sid, seg in g.segments.items():
            if sid in c.blocked or self._ratio(sid) >= 0.98:
                continue
            for end in (seg.a, seg.b):
                route = plan_route(g, loc, end, c.blocked, c.pen, self.settings.rover_speed_mps)
                if route.found and (best is None or route.cost < best[0]):
                    best = (route.cost, route, sid, end)
        if best is None:
            return False
        _, route, sid, end = best
        seg = g.segments[sid]
        legs = list(route.legs)
        if end == seg.a:
            legs.append(Leg(sid, 0.0, seg.length_m, seg.b))
        else:
            legs.append(Leg(sid, seg.length_m, 0.0, seg.a))
        full = Route(found=True, dest_node=legs[-1].to_node or "", legs=legs)
        r.tr.set_route(full)
        r.target_seg = sid
        return True

    def _update_rover(self, dt: float) -> None:
        r, t, g = self.rover, self.t, self.graph
        zone = g.segments[r.tr.seg].zone
        lost = zone in self.comm_zones
        r.connection = "lost" if lost else "online"
        if not lost:
            r.rep_t, r.rep_pos, r.rep_seg = t, list(r.tr.pos()), r.tr.seg
        r.speed_now = 0.0
        speed = self.settings.rover_speed_mps

        if r.mode == "docked":
            r.battery = min(100.0, r.battery + 0.15 * dt)
            r.task = "charging"
            if r.battery >= 95.0:
                r.low_battery_return = False
                if r.resume_after_charge:
                    r.mode, r.mapping, r.resume_after_charge = "auto", True, False
            return
        if r.battery <= 20.0 and r.mode in ("auto", "manual") and not r.low_battery_return:
            r.low_battery_return, r.resume_after_charge = True, r.mode == "auto"
            r.mode, r.mapping = "returning", False
            r.tr.legs = []
            self._log("rover_low_battery", "warning", battery=round(r.battery, 1))
        if t < r.obstacle_until:
            r.task = "obstacle_wait"
            r.battery = max(0.0, r.battery - 0.005 * dt)
            return
        if r.mode == "paused":
            r.task = "paused"
            r.battery = max(0.0, r.battery - 0.004 * dt)
            return

        covered: list[tuple[str, float, float]] = []
        if r.mode == "auto":
            if r.tr.legs and any(l.segment_id in self.ctx.blocked and l.segment_id != r.tr.seg for l in r.tr.legs):
                r.tr.legs = []
            if not r.tr.legs:
                if not self._rover_plan_explore():
                    r.mode, r.mapping = "returning", False
                    self._log("mapping_complete", "info", coverage_pct=self.coverage()["coverage_pct"])
            if r.tr.legs:
                r.task = "exploring" if r.tr.legs[0].segment_id == r.target_seg else "transit"
                covered = r.tr.advance(speed * dt)
                r.facing = r.tr.dir
                r.speed_now = speed
        if r.mode == "returning":
            r.task = "returning_to_base"
            if not r.tr.legs:
                if r.tr.node_at(1.0) == "PORTAL" and r.tr.seg == "S01" and r.tr.off <= 1.0:
                    r.mode = "docked"
                    return
                route = plan_route(g, self._loc(r.tr), "PORTAL", self.ctx.blocked, self.ctx.pen, speed)
                if route.found:
                    r.tr.set_route(route)
                    if not r.tr.legs:
                        r.mode = "docked"
                        return
                else:
                    r.task = "no_route_to_base"
            if r.tr.legs:
                covered = r.tr.advance(speed * dt)
                r.facing = r.tr.dir
                r.speed_now = speed
                if not r.tr.legs and r.tr.node_at(1.0) == "PORTAL":
                    r.mode = "docked"
        elif r.mode == "manual":
            r.task = "manual"
            if r.manual_cmd in ("forward", "backward"):
                sign = 1 if r.manual_cmd == "forward" else -1
                step_speed = speed if sign > 0 else speed * 0.5
                dirn = r.facing * sign
                seg = g.segments[r.tr.seg]

                def pick(node: str, cur: str) -> str | None:
                    mv = self._node_dir(node, cur)
                    mv = (-mv[0], -mv[1])  # outward direction of the segment we are leaving, flipped to travel direction
                    nxt = self._pick_next(node, cur, mv, r.pending_turn)
                    if nxt is not None:
                        r.pending_turn = None
                    return nxt

                prev_seg = r.tr.seg
                cov, blocked_end = r.tr.move_free(step_speed * dt, dirn, pick)
                covered = cov
                r.speed_now = step_speed
                if r.tr.seg != prev_seg:
                    r.facing = r.tr.dir if sign > 0 else -r.tr.dir
                if blocked_end:
                    r.manual_cmd = "stop"
                    r.speed_now = 0.0
                    self._rover_obstacle("end_of_tunnel")
        if r.speed_now > 0:
            r.odometer += r.speed_now * dt
            r.battery = max(0.0, r.battery - 0.02 * dt)
            if r.mapping and covered:
                self._record_map(covered)
            if r.odometer - r.last_traj_odo >= 2.0:
                r.last_traj_odo = r.odometer
                p = r.tr.pos()
                r.trajectory.append([round(p[0], 2), round(p[1], 2), round(p[2], 2), round(t, 1)])
                if len(r.trajectory) > 4000:
                    del r.trajectory[:200]
            if r.mode in ("auto", "returning") and r.odometer >= r.next_obstacle_m:
                r.next_obstacle_m = r.odometer + self.rng.uniform(220, 380)
                r.obstacle_until = t + self.rng.uniform(8, 14)
                self._rover_obstacle("debris")
        else:
            r.battery = max(0.0, r.battery - 0.005 * dt)

    def _rover_obstacle(self, kind: str) -> None:
        r = self.rover
        ev = {"t": self.t, "time": sim_iso(self.t), "kind": kind, "segment_id": r.tr.seg}
        r.obstacles.append(ev)
        r.obstacles = r.obstacles[-20:]
        self.alerts.push(self.t, {"severity": "info", "category": "rover_obstacle", "zone": self.graph.segments[r.tr.seg].zone,
                                  "segment_id": r.tr.seg, "related": {"type": "rover", "id": r.id}, "params": {"kind": kind}})
        self._log("rover_obstacle", "info", kind=kind, segment_id=r.tr.seg)

    def rover_command(self, command: str, speed_mps: float = 0.8, duration_s: float = 1.0) -> dict:
        v = validate_rover_command({"command": command, "speed_mps": speed_mps, "duration_s": duration_s})
        r = self.rover
        cmd = v["command"]
        if r.mode != "manual" and cmd in ("forward", "backward", "stop", "turn_left", "turn_right"):
            r.facing = r.tr.dir
        if cmd in ("forward", "backward"):
            if r.mode == "docked" and r.battery < 15:
                raise ValueError("battery too low to leave the dock")
            r.mode, r.manual_cmd, r.tr.legs = "manual", cmd, []
        elif cmd == "stop":
            r.mode, r.manual_cmd, r.tr.legs = "manual", "stop", []
        elif cmd in ("turn_left", "turn_right"):
            side = "left" if cmd == "turn_left" else "right"
            r.mode, r.manual_cmd, r.tr.legs = "manual", "stop", []
            node = r.tr.node_at(0.6)
            if node is None:
                r.pending_turn = side
            else:
                seg = self.graph.segments[r.tr.seg]
                move_vec = self._node_dir(node, r.tr.seg)
                move_vec = (-move_vec[0], -move_vec[1])
                nxt = self._pick_next(node, r.tr.seg, move_vec, side)
                if nxt is None:
                    self._rover_obstacle("no_branch")
                else:
                    ns = self.graph.segments[nxt]
                    r.tr.seg = nxt
                    r.tr.off, r.facing = (0.0, 1) if ns.a == node else (ns.length_m, -1)
                    r.tr.dir = r.facing
        elif cmd == "start_mapping":
            r.mode, r.mapping, r.low_battery_return = "auto", True, False
            r.tr.legs = []
        elif cmd == "pause_mapping":
            r.mode, r.mapping = "paused", False
            r.tr.legs = []
        elif cmd == "return_to_base":
            r.mode, r.mapping, r.tr.legs = "returning", False, []
        self._finalize()
        return {"simulated": True, "accepted": v, "note": "Simulation only - no real motor command was sent."}

    # ------------------------------------------------------------------ alerts
    def _hazard_segments(self) -> list[str]:
        return [sid for sid, r in self.safety["segments"].items() if r["avoid"]]

    def _worker_hazard(self, w: Worker) -> dict | None:
        best = None
        for hs in self._hazard_segments():
            d = self.graph.distance_to_segment(w.tr.seg, w.tr.off, hs)
            if best is None or d < best["distance_m"]:
                best = {"segment_id": hs, "distance_m": round(d, 1), "near": d <= self.settings.hazard_near_m}
        return best

    def _sync_alerts(self, active: list[dict]) -> None:
        g, t = self.graph, self.t
        cur: dict[tuple, dict] = {}
        for sid, r in self.safety["segments"].items():
            zone = g.segments[sid].zone
            for rs in r["reasons"]:
                code = rs["code"]
                sensor = {"type": "sensor", "id": rs.get("sensor_id")}
                if code in ("gas_critical", "gas_warning"):
                    m = rs["metric"]
                    sev = "critical" if code == "gas_critical" else "warning"
                    cat = "oxygen_range" if m == "o2" else ("critical_gas" if sev == "critical" else "gas_warning")
                    cur[(cat, sid, m, sev)] = {"severity": sev, "category": cat, "zone": zone, "segment_id": sid, "related": sensor,
                                               "params": {"metric": m, "value": rs["value"], "unit": rs["unit"], "threshold": rs["threshold"],
                                                          "direction": rs["direction"], "stale": rs.get("stale", False)}}
                elif code == "sensor_unavailable":
                    cur[("sensor_unavailable", rs["sensor_id"])] = {"severity": "warning", "category": "sensor_unavailable", "zone": zone,
                                                                    "segment_id": sid, "related": sensor, "params": {"sensor_id": rs["sensor_id"]}}
                elif code == "stale_telemetry":
                    cur[("stale_telemetry", rs["sensor_id"])] = {"severity": "warning", "category": "stale_telemetry", "zone": zone,
                                                                 "segment_id": sid, "related": sensor,
                                                                 "params": {"sensor_id": rs["sensor_id"], "age_s": rs.get("age_s")}}
                elif code == "tunnel_blocked":
                    cur[("route_blocked", sid, "tunnel")] = {"severity": "warning", "category": "route_blocked", "zone": zone, "segment_id": sid,
                                                             "related": None, "params": {"kind": "tunnel_blocked"}}
        for z in sorted({e["zone"] for e in active if e["kind"] == "comm_loss"}):
            cur[("comm_lost", "zone", z)] = {"severity": "warning", "category": "comm_lost", "zone": z, "segment_id": None,
                                             "related": None, "params": {"kind": "zone", "zone": z}}
        for w in self.workers:
            age = t - w.rep[2]
            zone = g.segments[w.tr.seg].zone
            if age > self.settings.worker_stale_after_s:
                cur[("comm_lost", w.id)] = {"severity": "warning", "category": "comm_lost", "zone": zone, "segment_id": w.rep[0],
                                            "related": {"type": "worker", "id": w.id}, "params": {"kind": "worker", "worker_id": w.id, "age_s": round(age)}}
            if w.nav and w.nav["status"] == "no_route":
                emer = w.nav["mode"] == "emergency"
                cur[("route_blocked", w.id)] = {"severity": "critical" if emer else "warning", "category": "route_blocked", "zone": zone,
                                                "segment_id": w.tr.seg, "related": {"type": "worker", "id": w.id},
                                                "params": {"kind": "no_route", "worker_id": w.id, "emergency": emer}}
            hz = self._worker_hazard(w)
            if hz and hz["near"] and not w.evacuated:
                inside = hz["distance_m"] <= 0.01
                cur[("worker_hazard", w.id, hz["segment_id"])] = {
                    "severity": "critical" if inside else "warning", "category": "worker_hazard", "zone": zone, "segment_id": hz["segment_id"],
                    "related": {"type": "worker", "id": w.id},
                    "params": {"worker_id": w.id, "distance_m": hz["distance_m"], "inside": inside, "hazard_segment": hz["segment_id"]}}
        r = self.rover
        if t - r.rep_t > self.settings.worker_stale_after_s:
            cur[("comm_lost", "rover")] = {"severity": "warning", "category": "comm_lost", "zone": g.segments[r.tr.seg].zone, "segment_id": r.rep_seg,
                                           "related": {"type": "rover", "id": r.id}, "params": {"kind": "rover", "age_s": round(t - r.rep_t)}}
        if self._evac_active:
            n_ev = sum(1 for w in self.workers if w.evacuated)
            cur[("evacuation",)] = {"severity": "critical", "category": "evacuation", "zone": None, "segment_id": None, "related": None,
                                    "params": {"workers": len(self.workers), "evacuated": n_ev}}
        for a in self.alerts.sync(t, cur):
            self._log("alert", a["severity"], alert_id=a["id"], category=a["category"], segment_id=a["segment_id"], **{k: v for k, v in a["params"].items() if k in ("metric", "worker_id")})
            if self.store:
                self.store.write_alert(a)

    # ------------------------------------------------------------------ snapshots
    def _nav_summary(self, w: Worker) -> dict | None:
        nav = w.nav
        if nav is None:
            return None
        g = self.graph
        found = bool(w.route and w.route.found) or nav["status"] == "arrived"
        legs = w.tr.legs
        dest = nav.get("dest")
        remaining = sum(l.length for l in legs)
        out = {
            "worker_id": w.id, "mode": nav["mode"], "status": nav["status"], "paused": nav["paused"],
            "dest_node": dest, "dest_name": g.nodes[dest].name if dest in g.nodes else None,
            "found": found, "message": None if found else NO_ROUTE_MESSAGE,
            "remaining_m": round(remaining, 1), "eta_s": round(remaining / max(w.speed, 0.01), 1),
            "progress": round(nav["traveled"] / (nav["traveled"] + remaining), 3) if (nav["traveled"] + remaining) > 0 else 1.0,
            "warnings": [], "instructions": [], "path": [], "rerouted_recently": bool(w.reroute_t and self.t - w.reroute_t < 45),
            "system": nav.get("system", False), "alternate": nav.get("alt", False),
        }
        if found and legs and dest:
            tmp = Route(found=True, dest_node=dest, legs=list(legs), distance_m=remaining)
            out["instructions"] = build_instructions(g, tmp)
            path: list[list[float]] = []
            for l in legs:
                for p in g.subpath(l.segment_id, l.start_offset, l.end_offset):
                    pt = [round(c, 2) for c in p]
                    if not path or path[-1] != pt:
                        path.append(pt)
            out["path"] = path
            for l in legs:
                pen = self.ctx.pen.get(l.segment_id)
                if pen and l.segment_id not in [x["segment_id"] for x in out["warnings"]]:
                    out["warnings"].append({"segment_id": l.segment_id, "reason": pen[1]})
        elif found and not legs and dest:
            out["instructions"] = build_instructions(g, Route(found=True, dest_node=dest))
        if out["rerouted_recently"]:
            out["instructions"].insert(0, {"type": "reroute", "text": "Route changed because a hazard was detected."})
        return out

    def _worker_status(self, w: Worker) -> str:
        if w.evacuated:
            return "evacuated"
        nav = w.nav
        if nav and nav["status"] == "no_route":
            return "no_route"
        if nav and nav.get("paused"):
            return "holding"
        if nav and nav["status"] == "arrived":
            return "arrived"
        if nav and nav["mode"] == "emergency":
            return "evacuating"
        return "moving" if w.speed_now > 0 else "idle"

    def _worker_dict(self, w: Worker) -> dict:
        g, t = self.graph, self.t
        seg = g.segments[w.tr.seg]
        age = t - w.rep[2]
        rpos = g.locate(w.rep[0], w.rep[1])[0]
        hz = self._worker_hazard(w)
        ex = nearest_exit(g, self._loc(w.tr), self.ctx.blocked, self.ctx.pen, w.speed)
        dest = (w.nav or {}).get("dest") or w.dest
        return {
            "id": w.id, "callsign": w.callsign, "segment_id": w.tr.seg, "zone": seg.zone,
            "pos": [round(c, 2) for c in rpos], "true_pos": [round(c, 2) for c in w.tr.pos()],
            "reported_segment_id": w.rep[0], "heading": round(w.tr.heading(), 1),
            "status": self._worker_status(w), "speed_mps": round(w.speed_now, 2),
            "last_update": sim_iso(w.rep[2]), "age_s": round(age, 1),
            "stale": age > self.settings.worker_stale_after_s, "comm_lost": seg.zone in self.comm_zones,
            "destination": dest, "destination_name": g.nodes[dest].name if dest in g.nodes else None,
            "route_remaining_m": round(sum(l.length for l in w.tr.legs), 1),
            "route_segments": [l.segment_id for l in w.tr.legs],
            "hazard": hz, "evacuated": w.evacuated, "segment_state": self._seg_state(w.tr.seg),
            "navigating": w.nav is not None, "nav_mode": w.nav["mode"] if w.nav else None,
            "exit": {"found": ex.found, "dest_node": ex.dest_node, "distance_m": round(ex.distance_m, 1),
                     "eta_s": round(ex.eta_s, 1), "segments": ex.segment_ids(),
                     "message": None if ex.found else NO_ROUTE_MESSAGE},
        }

    def _rover_dict(self) -> dict:
        r, g, t = self.rover, self.graph, self.t
        seg = g.segments[r.tr.seg]
        traj = r.trajectory
        stride = max(1, len(traj) // 600)
        age = t - r.rep_t
        return {
            "id": r.id, "simulated": True, "mode": r.mode, "mapping": r.mapping, "task": r.task,
            "segment_id": r.tr.seg, "segment_name": seg.name, "zone": seg.zone,
            "pos": r.rep_pos if r.connection == "lost" else [round(c, 2) for c in r.tr.pos()],
            "reported_segment_id": r.rep_seg,
            "heading": round(self._rover_heading(), 1),
            "speed_mps": round(r.speed_now, 2), "battery_pct": round(r.battery, 1), "connection": r.connection,
            "last_telemetry": sim_iso(r.rep_t), "age_s": round(age, 1), "odometer_m": round(r.odometer, 1),
            "obstacles": r.obstacles[-8:], "trajectory": traj[::stride], "traj_count": len(traj),
            "manual_cmd": r.manual_cmd, "pending_turn": r.pending_turn, "low_battery_return": r.low_battery_return,
            "adapter": "simulated",
        }

    def _rover_heading(self) -> float:
        r = self.rover
        _, tan = self.graph.locate(r.tr.seg, r.tr.off)
        return heading_deg(tan[0] * r.facing, tan[2] * r.facing)

    def _segment_dicts(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for sid, seg in self.graph.segments.items():
            sr = self.safety["segments"][sid]
            sensor = self.sensors.sensors[f"GS-{sid}"]
            ratio = self._ratio(sid)
            vals = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in sensor["values"].items()}
            out[sid] = {
                "id": sid, "name": seg.name, "zone": seg.zone, "length_m": round(seg.length_m, 1), "width_m": seg.width_m,
                "state": sr["state"], "avoid": sr["avoid"], "traversable": sr["traversable"], "obstructed": sr["obstructed"],
                "restricted": seg.restricted, "reasons": sr["reasons"], "sensor_id": sensor["id"],
                "sensor_status": self.sensors.status(sensor, self.t, self.settings.stale_after_s),
                "values": vals, "last_update": sim_iso(sensor["last_update"]) if sensor["last_update"] else None,
                "mapping": {"state": "unexplored" if covered_length(self.explored[sid]) < 0.5 else ("explored" if ratio >= 0.98 else "partial"),
                            "explored_m": round(covered_length(self.explored[sid]), 1), "ratio": round(ratio, 3),
                            "intervals": [[round(a, 1), round(b, 1)] for a, b in self.explored[sid]]},
                "connected": self.graph.neighbors_of_segment(sid),
            }
        return out

    def _kpi(self) -> dict:
        fresh = [s for s in self.sensors.sensors.values() if self.sensors.status(s, self.t, self.settings.stale_after_s) == "ok"]
        env = {}
        for k in ("temp", "rh", "pressure"):
            vals = [s["values"][k] for s in fresh if k in s["values"]]
            now = sum(vals) / len(vals) if vals else None
            past = self.history.latest_aggregate(k, self.t - 300)
            env[k] = {"value": round(now, 2) if now is not None else None, "trend": round(now - past, 3) if (now is not None and past is not None) else None,
                      "sensors": len(vals)}
        gas = {}
        for k in GAS_ORDER:
            vals = [(s["values"][k], s["segment_id"]) for s in fresh if k in s["values"]]
            if vals:
                worst = min(vals) if k == "o2" else max(vals)
                past = self.history.latest_aggregate(k, self.t - 300)
                gas[k] = {"value": round(worst[0], 3), "segment_id": worst[1], "trend": round(worst[0] - past, 4) if past is not None else None}
            else:
                gas[k] = {"value": None, "segment_id": None, "trend": None}
        return {"env": env, "gas": gas}

    def _health(self) -> dict:
        n = {"ok": 0, "fault": 0, "stale": 0, "no_data": 0}
        ages = []
        for s in self.sensors.sensors.values():
            n[self.sensors.status(s, self.t, self.settings.stale_after_s)] += 1
            if s["last_update"] is not None:
                ages.append(self.t - s["last_update"])
        return {
            "engine": "simulated", "running": self.running, "sensors": n, "sensors_total": len(self.sensors.sensors),
            "max_telemetry_age_s": round(max(ages), 1) if ages else None, "history_samples": len(self.history),
            "rejected_frames": self.sensors.rejected, "persistence": self.store.status() if self.store else {"enabled": False},
            "hardware": hardware_status(), "last_tick_wall": self.last_tick_wall, "reset_count": self.reset_count,
        }

    def _finalize(self) -> None:
        self.seq += 1
        g = self.graph
        hazards = [{"segment_id": s, "name": g.segments[s].name, "zone": g.segments[s].zone,
                    "state": self.safety["segments"][s]["state"], "obstructed": self.safety["segments"][s]["obstructed"]}
                   for s in self._hazard_segments()]
        workers = [self._worker_dict(w) for w in self.workers]
        affected = [w["id"] for w in workers if w["hazard"] and w["hazard"]["near"]]
        counts = self.alerts.counts()
        saf = {k: v for k, v in self.safety.items() if k != "segments"}
        saf["state_label"] = self.safety["state"]
        self.snap = {
            "type": "telemetry", "simulated": True, "mode": "SIMULATION", "seq": self.seq, "t": self.t, "sim_time": sim_iso(self.t),
            "running": self.running, "speed": self.speed, "speeds": SPEEDS, "tick_interval_s": self.settings.tick_interval_s,
            "safety": saf, "segments": self._segment_dicts(), "workers": workers, "rover": self._rover_dict(),
            "navigation": [n for n in (self._nav_summary(w) for w in self.workers) if n],
            "alerts": {"counts": counts, "recent": self.alerts.list(limit=40)},
            "mapping": self.coverage(), "kpi": self._kpi(), "health": self._health(),
            "emergency": {"active": bool(hazards) or self._evac_active, "evacuation": self._evac_active, "hazards": hazards,
                          "affected_workers": affected, "rover_affected": any(h["segment_id"] == self.rover.tr.seg for h in hazards)},
            "scenarios": [{"id": e["id"], "kind": e["kind"], "segment_id": e["segment_id"], "zone": e["zone"], "gas": e.get("gas"),
                           "since": sim_iso(e["start"]), "until": sim_iso(e["end"]) if e["end"] else None}
                          for e in self._active() if e["source"] == "scenario"],
            "ambient": [{"id": e["id"], "segment_id": e["segment_id"], "gas": e.get("gas"), "since": sim_iso(e["start"])}
                        for e in self._active() if e["source"] == "ambient"],
            "timeline": self.timeline[-60:],
            "thresholds": self.thresholds.to_dict(),
        }

    def snapshot(self) -> dict:
        return self.snap

    # ------------------------------------------------------------------ analytics
    def history_query(self, metrics: list[str], sensor: str | None, range_s: float | None, t_from: float | None,
                      t_to: float | None, max_points: int = 240) -> dict:
        for m in metrics:
            if m not in METRIC_KEYS:
                raise ValueError(f"unknown metric '{m}'")
        if sensor not in (None, "all") and sensor not in self.sensors.sensors:
            raise ValueError(f"unknown sensor '{sensor}'")
        to = t_to if t_to is not None else self.t
        fr = t_from if t_from is not None else to - (range_s or 900.0)
        if fr >= to:
            raise ValueError("from must be before to")
        res = self.history.query(metrics, sensor, fr, to, max(10, min(max_points, 1000)))
        res.update({"simulated": True, "from": sim_iso(fr), "to": sim_iso(to), "t_from": fr, "t_to": to,
                    "units": {k: (self.thresholds.gases[k].unit if k in self.thresholds.gases else {"temp": "°C", "rh": "%", "pressure": "hPa"}[k]) for k in metrics},
                    "available_from": sim_iso(self.history.t[0]) if self.history.t else None})
        return res

    def analytics(self, range_s: float) -> dict:
        lo, hi = self.history.range(self.t - range_s, self.t)
        th = self.thresholds.gases
        h = self.history
        n_sens, m = h.n, h.m
        gas_idx = {k: METRIC_KEYS.index(k) for k in GAS_ORDER}
        # per sensor per gas: count threshold-crossing EVENTS (level transitions) and time in warning / critical
        events = {"warning": 0, "critical": 0}
        buckets: dict[int, dict] = {}
        width = max(range_s / 24.0, 1.0)
        seg_time: dict[str, dict] = {sid: {"warning_s": 0.0, "critical_s": 0.0} for sid in self.graph.segments}
        prev: dict[tuple[int, str], str] = {}
        for r in range(lo, hi):
            tt = h.t[r]
            row = h.data[r]
            dt = (h.t[r + 1] - tt) if r + 1 < len(h.t) else self.settings.sample_interval_s
            b = int((tt - (self.t - range_s)) / width)
            bk = buckets.setdefault(b, {"t": self.t - range_s + (b + 0.5) * width, "warning": 0, "critical": 0})
            for si in range(n_sens):
                sid = h.sensor_ids[si][3:]
                worst = "ok"
                for gk, gi in gas_idx.items():
                    v = row[si * m + gi]
                    if math.isnan(v):
                        continue
                    lvl, _, _ = classify(th[gk], v)
                    if lvl != "ok" and prev.get((si, gk), "ok") != lvl:
                        events[lvl] += 1
                        bk[lvl] += 1
                    prev[(si, gk)] = lvl
                    if lvl == "critical" or (lvl == "warning" and worst == "ok"):
                        worst = lvl
                if worst == "warning":
                    seg_time[sid]["warning_s"] += dt
                elif worst == "critical":
                    seg_time[sid]["critical_s"] += dt
        cov = [c for c in self.coverage_history if c[0] >= self.t - range_s]
        stride = max(1, len(cov) // 240)
        return {
            "simulated": True, "range_s": range_s, "events": events,
            "event_buckets": [buckets[k] for k in sorted(buckets)],
            "hazard_distribution": [{"segment_id": s, "name": self.graph.segments[s].name, **{k: round(v) for k, v in d.items()}}
                                    for s, d in seg_time.items()],
            "state_distribution": {st: sum(1 for r in self.safety["segments"].values() if r["state"] == st) for st in RANK},
            "coverage": [{"t": c[0], "coverage_pct": c[1], "explored_m": c[2]} for c in cov[::stride]],
            "exposure": [e for e in self.exposure_log if e["t"] >= self.t - range_s][-200:],
            "exposure_total": len([e for e in self.exposure_log if e["t"] >= self.t - range_s]),
            "rover_history": {"odometer_m": round(self.rover.odometer, 1), "trajectory_points": len(self.rover.trajectory)},
            "note": "Computed from generated telemetry records of this simulation session. Worker exposure and coverage series cover this session only.",
        }

    def mine_map(self) -> dict:
        d = self.graph.to_dict()
        d["mode"] = "SIMULATION"
        d["note"] = "Synthetic deterministic layout. Not captured by a real scanner and not real SLAM."
        d["thresholds"] = self.thresholds.to_dict()
        return d
