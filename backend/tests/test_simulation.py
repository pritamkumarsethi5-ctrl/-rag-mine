import math

import pytest

from app.adapters import AdapterDisabled, Esp32SerialAdapter, validate_rover_command
from app.config import SimSettings
from app.movement import add_interval, covered_length
from app.routing import NO_ROUTE_MESSAGE
from app.simulation import Simulation


def make(seed=42, **kw):
    return Simulation(SimSettings(seed=seed, **kw))


def seg_state(sim, sid):
    return sim.snapshot()["segments"][sid]["state"]


def settle(sim, secs=120):
    sim.advance(secs)
    return sim.snapshot()


# ---------------------------------------------------------------- baseline / determinism
def test_baseline_is_safe_and_labelled_simulated():
    sim = make()
    snap = sim.snapshot()
    assert snap["safety"]["state"] == "SAFE"
    assert snap["simulated"] is True and snap["mode"] == "SIMULATION"
    assert snap["safety"]["monitoring"]["ratio"] == 1.0


def test_deterministic_for_same_seed():
    a, b = make(7), make(7)
    a.advance(600); b.advance(600)
    sa, sb = a.snapshot(), b.snapshot()
    assert sa["kpi"] == sb["kpi"]
    assert sa["mapping"] == sb["mapping"]
    assert [w["segment_id"] for w in sa["workers"]] == [w["segment_id"] for w in sb["workers"]]
    assert make(7).snapshot()["kpi"] != make(8).snapshot()["kpi"]


def test_history_is_backfilled_with_generated_records():
    sim = make()
    res = sim.history_query(["ch4", "o2"], "all", 6 * 3600, None, None, 120)
    assert res["samples"] >= 700 and len(res["t"]) > 50
    assert all(v is not None for v in res["series"]["o2"]["v"])
    assert res["stats"]["ch4"]["min"] <= res["stats"]["ch4"]["avg"] <= res["stats"]["ch4"]["max"]


def test_history_filters_and_errors():
    sim = make()
    one = sim.history_query(["co2"], "GS-S04", 900, None, None)
    assert one["sensor"] == "GS-S04"
    with pytest.raises(ValueError):
        sim.history_query(["nope"], None, 900, None, None)
    with pytest.raises(ValueError):
        sim.history_query(["ch4"], "GS-ZZ", 900, None, None)
    with pytest.raises(ValueError):
        sim.history_query(["ch4"], None, None, 100.0, 50.0)


def test_oxygen_is_physically_coherent_with_other_gases():
    sim = make()
    sim.trigger_scenario("critical_gas", "S12", "ch4")
    sim.advance(400)
    v = sim.snapshot()["segments"]["S12"]["values"]
    assert v["ch4"] > 2.0
    # methane displaces air: O2 drops a little, but nowhere near random swings
    assert 20.0 < v["o2"] < 20.7


# ---------------------------------------------------------------- scenarios
def test_warning_scenario_changes_state_alert_and_recovers():
    sim = make()
    sim.trigger_scenario("warning", "S10", "ch4")
    snap = settle(sim, 300)
    assert snap["safety"]["state"] == "WARNING" and seg_state(sim, "S10") == "WARNING"
    assert any(a["category"] == "gas_warning" and a["segment_id"] == "S10" for a in snap["alerts"]["recent"])
    snap = settle(sim, 900)  # warning event has a 300 s duration and then decays
    assert snap["safety"]["state"] == "SAFE"
    warn = [a for a in snap["alerts"]["recent"] if a["category"] == "gas_warning" and a["segment_id"] == "S10"]
    assert warn and warn[0]["status"] == "resolved" and warn[0]["resolved_by"] == "auto"


def test_critical_scenario_is_danger_and_cannot_be_overridden():
    sim = make()
    sim.trigger_scenario("critical_gas", "S12", "ch4")
    snap = settle(sim, 400)
    assert snap["safety"]["state"] == "DANGER"
    assert seg_state(sim, "S12") == "DANGER"
    assert snap["segments"]["S12"]["avoid"] and not snap["segments"]["S12"]["traversable"]
    assert snap["emergency"]["active"] and snap["emergency"]["hazards"][0]["segment_id"] == "S12"
    crit = [a for a in snap["alerts"]["recent"] if a["category"] == "critical_gas"]
    assert crit and crit[0]["severity"] == "critical"
    # acknowledging does NOT make the mine safe and the alert stays prominent
    sim.alerts.acknowledge(crit[0]["id"], sim.t)
    snap = settle(sim, 60)
    assert snap["safety"]["state"] == "DANGER"
    a = sim.alerts.get(crit[0]["id"])
    assert a["status"] == "acknowledged" and a["severity"] == "critical"


@pytest.mark.parametrize("gas", ["ch4", "co", "h2s", "o2"])
def test_every_critical_gas_variant_reaches_danger(gas):
    sim = make()
    sim.trigger_scenario("critical_gas", "S06", gas)
    assert settle(sim, 500)["safety"]["state"] == "DANGER"


def test_resolve_incident_clears_cause_and_alert():
    sim = make()
    sim.trigger_scenario("critical_gas", "S12", "ch4")
    settle(sim, 300)
    aid = next(a["id"] for a in sim.alerts.alerts if a["category"] == "critical_gas")
    sim.resolve_incident(aid)
    snap = settle(sim, 900)
    assert snap["safety"]["state"] == "SAFE"
    assert sim.alerts.get(aid)["status"] == "resolved"
    assert not any(a["category"] == "critical_gas" and a["status"] != "resolved" for a in sim.alerts.alerts)


def test_critical_alert_not_auto_resolved_when_condition_clears():
    sim = make()
    sim.trigger_scenario("critical_gas", "S12", "ch4")
    settle(sim, 300)
    sim.trigger_scenario("clear")
    settle(sim, 900)
    crit = [a for a in sim.alerts.alerts if a["category"] == "critical_gas"]
    assert crit and all(a["status"] != "resolved" for a in crit) and not crit[0]["condition_active"]


def test_sensor_failure_never_silently_safe():
    sim = make()
    sim.trigger_scenario("sensor_failure", "S07")
    snap = settle(sim, 30)
    assert snap["safety"]["state"] != "SAFE"
    assert snap["segments"]["S07"]["state"] == "UNKNOWN" and snap["segments"]["S07"]["sensor_status"] == "fault"
    assert any(a["category"] == "sensor_unavailable" for a in snap["alerts"]["recent"])
    assert snap["health"]["sensors"]["fault"] == 1


def test_comm_loss_makes_data_stale_then_recovers():
    sim = make()
    sim.trigger_scenario("comm_loss", zone="East")
    snap = settle(sim, 60)
    assert snap["safety"]["state"] != "SAFE"
    assert any(a["category"] == "stale_telemetry" for a in snap["alerts"]["recent"])
    assert any(a["category"] == "comm_lost" for a in snap["alerts"]["recent"])
    snap = settle(sim, 400)  # outage lasts 240 s
    assert snap["safety"]["state"] == "SAFE"


def test_stale_worker_location_warning():
    sim = make()
    sim.trigger_scenario("comm_loss", zone="East")
    sim.advance(10)
    in_east = [w for w in sim.workers if sim.graph.segments[w.tr.seg].zone == "East"]
    if not in_east:  # make sure at least one worker is in the zone
        sim.workers[0].tr.seg, sim.workers[0].tr.off = "S13", 10.0
        sim.workers[0].tr.legs = []
        sim.workers[0].route = None
    sim.advance(60)
    assert any(w["stale"] for w in sim.snapshot()["workers"])


def test_blocked_tunnel_is_non_traversable_and_routes_avoid_it():
    sim = make()
    w = sim.workers[0]
    w.tr.seg, w.tr.off, w.tr.legs, w.route = "S01", 5.0, [], None
    sim.trigger_scenario("blocked_tunnel", "S03")
    sim.advance(10)
    assert not sim.snapshot()["segments"]["S03"]["traversable"]
    nav = sim.start_navigation("W-101", "J-04")
    assert nav["found"] and "S03" not in [i.get("segment_id") for i in nav["instructions"]]
    for _ in range(80):
        sim.advance(10)
        for wk in sim.workers:
            if wk.id == "W-101":
                assert wk.tr.seg != "S03"


def test_no_safe_route_is_reported_not_silently_routed():
    sim = make()
    w = sim.worker("W-103")
    w.tr.seg, w.tr.off, w.tr.legs, w.route = "S10", 20.0, [], None
    sim.trigger_scenario("blocked_tunnel", "S11")
    sim.advance(10)
    nav = sim.start_navigation("W-103", None, mode="emergency")
    assert nav["found"] and nav["dest_node"] != "X-02"   # other exits exist
    # restricted destination is never reachable
    nav2 = sim.start_navigation("W-102", "DE-02")
    assert nav2["found"] is False and nav2["message"] == NO_ROUTE_MESSAGE
    sim.advance(30)
    snap = sim.snapshot()
    assert any(a["category"] == "route_blocked" and a["params"].get("kind") == "no_route" for a in snap["alerts"]["recent"])
    assert next(x for x in snap["workers"] if x["id"] == "W-102")["status"] == "no_route"
    assert sim.worker("W-102").tr.legs == []


def test_route_recalculated_after_hazard_appears():
    sim = make()
    w = sim.worker("W-101")
    w.tr.seg, w.tr.off, w.tr.legs, w.route = "S01", 5.0, [], None
    first = sim.start_navigation("W-101", "J-03")
    assert first["found"]
    first_segments = [i["segment_id"] for i in first["instructions"] if i["type"] != "arrive"]
    assert "S03" in first_segments
    sim.trigger_scenario("critical_gas", "S03", "ch4")
    rerouted = None
    for _ in range(90):
        sim.advance(5)
        assert sim.worker("W-101").tr.seg != "S03"          # never walks into the hazard
        nav = next((n for n in sim.snapshot()["navigation"] if n["worker_id"] == "W-101"), None)
        if nav and nav["rerouted_recently"]:
            rerouted = nav
            break
    assert rerouted is not None, "route was not recalculated after the hazard appeared"
    segs = [i["segment_id"] for i in rerouted["instructions"] if i.get("segment_id")]
    assert "S03" not in segs and segs != first_segments      # a different, hazard-free route
    g = sim.graph
    for a, b in zip(segs, segs[1:]):                         # consecutive legs share a junction
        assert b in g.neighbors_of_segment(a)
    assert rerouted["instructions"][0]["type"] == "reroute"
    assert any(a["category"] == "route_blocked" and a["params"].get("kind") == "rerouted" for a in sim.snapshot()["alerts"]["recent"])
    arrived = False
    for _ in range(120):
        sim.advance(5)
        assert sim.worker("W-101").tr.seg != "S03"
        nav = next((n for n in sim.snapshot()["navigation"] if n["worker_id"] == "W-101"), None)
        if nav and nav["status"] == "arrived":
            arrived = True
            break
    assert arrived
    assert sim.worker("W-101").tr.node_at(1.0) == "J-03"


def test_navigation_controls_and_arrival():
    sim = make()
    w = sim.worker("W-101")
    w.tr.seg, w.tr.off, w.tr.legs, w.route = "S02", 5.0, [], None
    nav = sim.start_navigation("W-101", "J-02")
    total = nav["remaining_m"]
    sim.control_navigation("W-101", "pause")
    sim.advance(60)
    assert math.isclose(sim.snapshot()["navigation"][0]["remaining_m"], total, abs_tol=0.1)
    assert sim.snapshot()["workers"][0]["status"] == "holding"
    sim.control_navigation("W-101", "resume")
    sim.advance(120)
    n = sim.snapshot()["navigation"][0]
    assert n["status"] == "arrived" and n["progress"] == 1.0
    sim.control_navigation("W-101", "stop")
    assert sim.snapshot()["navigation"] == []
    with pytest.raises(ValueError):
        sim.control_navigation("W-101", "pause")
    with pytest.raises(ValueError):
        sim.start_navigation("W-101", "NOPE")
    with pytest.raises(KeyError):
        sim.start_navigation("W-999", "J-01")


def test_evacuation_routes_workers_to_exits_and_marks_them_evacuated():
    sim = make()
    sim.trigger_scenario("evacuation")
    sim.advance(1500)
    snap = sim.snapshot()
    assert snap["emergency"]["evacuation"] and all(w["evacuated"] for w in snap["workers"])
    ends = {w["id"]: sim.worker(w["id"]).tr.node_at(1.0) for w in snap["workers"]}
    assert all(sim.graph.nodes[n].emergency_exit for n in ends.values())
    assert any(a["category"] == "evacuation" and a["severity"] == "critical" for a in snap["alerts"]["recent"])
    with pytest.raises(ValueError):
        sim.start_navigation("W-101", "J-01")


def test_worker_hazard_proximity_is_reported():
    sim = make()
    sim.trigger_scenario("critical_gas", "S12", "ch4")
    sim.advance(400)
    hz = [w["hazard"] for w in sim.snapshot()["workers"]]
    assert all(h and h["segment_id"] == "S12" for h in hz)
    assert min(h["distance_m"] for h in hz) >= 0


# ---------------------------------------------------------------- mapping / rover
def test_coverage_comes_from_graph_intervals():
    sim = make()
    c0 = sim.coverage()
    assert c0["coverage_pct"] == 0 and c0["total_m"] == round(sim.graph.total_length(), 1)
    sim.advance(900)
    c = sim.coverage()
    exp = sum(covered_length(v) for v in sim.explored.values())
    assert math.isclose(c["explored_m"], round(exp, 1)) and 0 < c["coverage_pct"] < 100
    assert math.isclose(c["coverage_pct"], round(100 * exp / sim.graph.total_length(), 2))
    assert math.isclose(c["explored_m"] + c["remaining_m"], c["total_m"], abs_tol=0.2)
    assert c["slam"] is False and c["simulated"] is True
    for sid, ivs in sim.explored.items():
        L = sim.graph.segments[sid].length_m
        assert all(0 <= a < b <= L + 1e-6 for a, b in ivs)


def test_full_exploration_excludes_restricted_and_rover_returns_home():
    sim = make()
    sim.advance(4000)
    c = sim.coverage()
    assert c["segments_explored"] == len(sim.graph.segments) - 1
    assert sim.explored["S09"] == [] and c["restricted_unexplored_m"] > 0
    assert sim.rover.mode == "docked" and sim.rover.tr.seg == "S01"


def test_interval_merge():
    iv = []
    add_interval(iv, 0, 10); add_interval(iv, 20, 30); add_interval(iv, 9, 21)
    assert iv == [[0, 30]]
    add_interval(iv, 40, 50)
    assert covered_length(iv) == 40


def test_rover_only_moves_along_connected_segments():
    sim = make()
    prev = sim.rover.tr.seg
    for _ in range(300):
        sim.advance(10)
        cur = sim.rover.tr.seg
        if cur != prev:
            assert cur in sim.graph.neighbors_of_segment(prev) or cur == prev
            prev = cur


def test_rover_avoids_blocked_segments():
    sim = make()
    sim.trigger_scenario("blocked_tunnel", "S04")
    sim.advance(3000)
    assert sim.explored["S04"] == [] and sim.explored["S05"] == [] or covered_length(sim.explored["S04"]) == 0


def test_rover_manual_commands_move_the_simulation_only():
    sim = make(rover_autostart=False)
    r = sim.rover
    assert r.mode == "paused"
    res = sim.rover_command("forward")
    assert "Simulation only" in res["note"]
    sim.advance(30)
    assert sim.rover.tr.off > 15
    sim.rover_command("stop")
    off = sim.rover.tr.off
    sim.advance(20)
    assert math.isclose(sim.rover.tr.off, off, abs_tol=1e-6)
    sim.rover_command("backward")
    sim.advance(10)
    assert sim.rover.tr.off < off
    sim.rover_command("start_mapping")
    assert sim.rover.mode == "auto" and sim.rover.mapping
    sim.rover_command("pause_mapping")
    assert sim.rover.mode == "paused" and not sim.rover.mapping
    sim.rover_command("return_to_base")
    sim.advance(200)
    assert sim.rover.mode == "docked"
    with pytest.raises(ValueError):
        sim.rover_command("self_destruct")


def test_manual_turns_at_junction():
    sim = make(rover_autostart=False)
    sim.rover.tr.seg, sim.rover.tr.off = "S02", 5.0
    sim.rover_command("forward")
    sim.advance(120)   # reaches J-02 and must pick a branch or stop at a dead end
    assert sim.rover.tr.seg in sim.graph.segments
    sim.rover_command("stop")
    sim.rover.tr.seg, sim.rover.tr.off, sim.rover.facing, sim.rover.tr.dir = "S02", sim.graph.segments["S02"].length_m, 1, 1
    sim.rover_command("turn_left")
    left = sim.rover.tr.seg
    sim.rover.tr.seg, sim.rover.tr.off, sim.rover.facing, sim.rover.tr.dir = "S02", sim.graph.segments["S02"].length_m, 1, 1
    sim.rover_command("turn_right")
    assert left != sim.rover.tr.seg


def test_hardware_adapter_disabled_by_default_and_commands_validated():
    with pytest.raises(AdapterDisabled):
        Esp32SerialAdapter()
    assert validate_rover_command({"command": "forward", "speed_mps": 0.5, "duration_s": 2})["speed_mps"] == 0.5
    for bad in ({"command": "x"}, {"command": "forward", "speed_mps": 5}, {"command": "forward", "duration_s": 0},
                {"command": "forward", "speed_mps": math.nan}):
        with pytest.raises(ValueError):
            validate_rover_command(bad)
    assert sim_health()["hardware"]["hardware_adapter_enabled"] is False


def sim_health():
    return make().snapshot()["health"]


# ---------------------------------------------------------------- reset / controls
def test_reset_returns_to_baseline_and_dashboard_keeps_working():
    sim = make()
    base_kpi = make().snapshot()["kpi"]
    sim.start()
    sim.set_speed(10)
    sim.trigger_scenario("critical_gas", "S12", "co")
    sim.trigger_scenario("blocked_tunnel", "S03")
    sim.trigger_scenario("sensor_failure", "S07")
    for _ in range(30):
        sim.tick()
    assert sim.snapshot()["safety"]["state"] == "DANGER"
    sim.reset()
    snap = sim.snapshot()
    assert snap["safety"]["state"] == "SAFE" and snap["scenarios"] == [] and snap["alerts"]["counts"]["total"] == 0
    assert snap["mapping"]["coverage_pct"] == 0 and snap["kpi"] == base_kpi
    assert sim.running and sim.speed == 10          # controls are preserved
    assert sim.reset_count == 1
    for _ in range(20):
        sim.tick()
    assert sim.snapshot()["t"] > snap["t"]
    assert sim.snapshot()["segments"]["S12"]["state"] == "SAFE"


def test_pause_resume_and_speed():
    sim = make()
    sim.start()
    sim.set_speed(5)
    t0 = sim.t
    sim.tick()
    assert math.isclose(sim.t - t0, 5.0)
    sim.pause()
    t1 = sim.t
    sim.tick()
    assert sim.t == t1
    with pytest.raises(ValueError):
        sim.set_speed(7)


def test_invalid_scenario_inputs():
    sim = make()
    for kw in ({"kind": "boom"}, {"kind": "warning", "segment_id": "S99"}, {"kind": "warning", "gas": "xx"},
               {"kind": "comm_loss", "zone": "Moon"}):
        with pytest.raises(ValueError):
            sim.trigger_scenario(**kw)


def test_all_scenarios_keep_snapshot_consistent():
    sim = make()
    sim.start()
    for sc in ("warning", "critical_gas", "sensor_failure", "comm_loss", "blocked_tunnel", "evacuation"):
        sim.trigger_scenario(sc)
        for _ in range(15):
            sim.tick()
        snap = sim.snapshot()
        assert snap["safety"]["state"] in ("WARNING", "DANGER", "UNKNOWN")
    sim.trigger_scenario("clear")
    assert sim.snapshot()["scenarios"] == []


def test_analytics_uses_generated_records():
    sim = make()
    sim.trigger_scenario("critical_gas", "S12", "ch4")
    sim.advance(600)
    a = sim.analytics(3600)
    assert a["events"]["warning"] >= 1 or a["events"]["critical"] >= 1
    assert a["events"]["critical"] >= 1
    s12 = next(x for x in a["hazard_distribution"] if x["segment_id"] == "S12")
    assert s12["critical_s"] > 0
    assert sum(b["critical"] for b in a["event_buckets"]) == a["events"]["critical"]
    assert a["state_distribution"]["DANGER"] >= 1
