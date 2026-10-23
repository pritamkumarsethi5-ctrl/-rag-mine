"""API behaviour tested at the service/schema layer (no web framework required)."""
import pytest
from pydantic import ValidationError

from app.schemas import NavStartRequest, RoverCommandRequest, ScenarioRequest, ThresholdUpdate
from app.service import ApiError, Service, parse_range, parse_time
from app.simulation import Simulation


@pytest.fixture()
def svc():
    return Service(Simulation())


def test_health_is_labelled_simulated(svc):
    h = svc.health()
    assert h["mode"] == "SIMULATION" and h["simulated"] is True
    assert h["hardware"]["hardware_adapter_enabled"] is False and h["hardware"]["active_adapter"] == "simulated"


def test_mine_map_schema(svc):
    m = svc.mine_map()
    assert m["connected"] and m["total_length_m"] > 1000 and m["mode"] == "SIMULATION"
    seg = m["segments"][0]
    for k in ("id", "name", "length_m", "width_m", "a", "b", "connected_segments", "polyline", "zone", "restricted"):
        assert k in seg
    assert {n["kind"] for n in m["nodes"]} >= {"portal", "junction", "dead_end", "exit"}


def test_latest_telemetry_websocket_format(svc):
    snap = svc.telemetry_latest()
    for k in ("type", "simulated", "mode", "seq", "t", "sim_time", "running", "speed", "safety", "segments", "workers", "rover",
              "navigation", "alerts", "mapping", "kpi", "health", "emergency", "scenarios", "timeline", "thresholds"):
        assert k in snap, k
    assert snap["type"] == "telemetry" and snap["mode"] == "SIMULATION"
    seg = snap["segments"]["S04"]
    assert {"state", "values", "mapping", "sensor_status", "reasons", "traversable"} <= set(seg)
    assert {"ch4", "co", "o2", "co2", "h2s", "temp", "rh", "pressure"} <= set(seg["values"])
    import json
    json.dumps(snap, allow_nan=False)          # must be strictly JSON serialisable (no NaN / inf)


def test_history_endpoint_ranges_and_csv(svc):
    for r in ("5m", "15m", "1h", "6h"):
        res = svc.telemetry_history("ch4,o2", None, r, None, None)
        assert res["simulated"] and res["t"] and set(res["series"]) == {"ch4", "o2"}
    csv_text = svc.history_csv("ch4,co", "GS-S04", "15m", None, None)
    lines = csv_text.strip().splitlines()
    assert lines[0].startswith("sim_time_utc,simulated,ch4") and lines[1].split(",")[1] == "SIMULATED" and len(lines) > 10
    res = svc.telemetry_history("ch4", None, None, "2026-03-02T07:00:00Z", "2026-03-02T07:30:00Z")
    assert res["from"] == "2026-03-02T07:00:00Z"
    with pytest.raises(ApiError) as e:
        svc.telemetry_history("ch4", None, "banana", None, None)
    assert e.value.status == 422
    with pytest.raises(ApiError) as e:
        svc.telemetry_history("zzz", None, "5m", None, None)
    assert e.value.status == 400
    with pytest.raises(ApiError):
        svc.telemetry_history("ch4", None, None, "not-a-date", None)


def test_parsers():
    assert parse_range("1h") == 3600 and parse_range("120") == 120.0
    assert parse_time("2026-03-02T08:00:00Z") == parse_time("2026-03-02T08:00:00+00:00")
    assert parse_time(None) is None


def test_workers_rover_alerts_routes(svc):
    assert len(svc.workers()["workers"]) == 6
    assert svc.worker("W-101")["worker"]["callsign"] == "Kite"
    with pytest.raises(ApiError) as e:
        svc.worker("W-999")
    assert e.value.status == 404
    r = svc.rover()["rover"]
    assert r["id"] == "ROV-01" and r["simulated"] and isinstance(r["trajectory"], list)
    assert svc.alerts(None, None, None, None, 50)["counts"]["active"] == 0
    rt = svc.routes("W-101", "J-04", "normal")
    assert rt["routes"][0]["found"] and rt["routes"][0]["instructions"] and rt["simulated"]
    em = svc.routes("W-101", None, "emergency")
    assert em["routes"][0]["found"]
    with pytest.raises(ApiError) as e:
        svc.routes("W-101", "NOPE", "normal")
    assert e.value.status == 400
    with pytest.raises(ApiError) as e:
        svc.routes("W-777", "J-01", "normal")
    assert e.value.status == 404
    no = svc.routes("W-101", "DE-02", "normal")
    assert no["message"] == "NO SAFE SIMULATED ROUTE AVAILABLE." and not no["routes"][0]["found"]


def test_simulation_controls(svc):
    assert svc.start()["running"] is True
    assert svc.pause()["running"] is False
    assert svc.set_speed(10)["speed"] == 10
    with pytest.raises(ApiError) as e:
        svc.set_speed(3)
    assert e.value.status == 400
    res = svc.scenario("critical_gas", "S12", "ch4", None)
    assert res["safety_state"] == "DANGER" or res["active_scenarios"]
    svc.sim.advance(400)
    assert svc.sim_status()["safety_state"] == "DANGER"
    assert svc.reset()["safety_state"] == "SAFE"
    with pytest.raises(ApiError):
        svc.scenario("warning", "S99", None, None)


def test_alert_acknowledge_resolve(svc):
    svc.scenario("critical_gas", "S12", "ch4", None)
    svc.sim.advance(400)
    alert = svc.alerts("critical", "critical_gas", "active", None, 10)["alerts"][0]
    ack = svc.alert_acknowledge(alert["id"])
    assert ack["alert"]["status"] == "acknowledged" and "does not mark the mine safe" in ack["note"]
    assert svc.sim_status()["safety_state"] == "DANGER"
    svc.alert_resolve(alert["id"])
    svc.sim.advance(900)
    assert svc.sim_status()["safety_state"] == "SAFE"
    for fn in (svc.alert_acknowledge, svc.alert_resolve):
        with pytest.raises(ApiError) as e:
            fn("ALR-9999")
        assert e.value.status == 404


def test_search_and_filters(svc):
    svc.scenario("critical_gas", "S12", "co", None)
    svc.scenario("sensor_failure", "S07", None, None)
    svc.sim.advance(300)
    assert all(a["severity"] == "critical" for a in svc.alerts("critical", None, None, None, 50)["alerts"])
    assert svc.alerts(None, "sensor_unavailable", None, None, 50)["alerts"]
    assert svc.alerts(None, None, None, "S12", 50)["alerts"]
    assert svc.alerts(None, None, None, "zzzz-nothing", 50)["alerts"] == []


def test_thresholds_update_flows_into_safety(svc):
    t = svc.thresholds()
    assert t["example_values_only"] is True and "Not legal limits" in t["note"]
    svc.update_threshold("co", warn_high=1.0, crit_high=2.0)   # baseline CO ~2-5 ppm -> now critical
    assert svc.sim_status()["safety_state"] == "DANGER"
    svc.reset_thresholds()
    assert svc.sim_status()["safety_state"] == "SAFE"
    with pytest.raises(ApiError) as e:
        svc.update_threshold("co", warn_high=100.0)
    assert e.value.status == 400


def test_navigation_api(svc):
    res = svc.nav_start("W-101", "J-04", "normal", False)
    assert res["navigation"]["found"] and res["navigation"]["instructions"]
    assert svc.nav_control("W-101", "pause")["navigation"]["paused"] is True
    assert svc.nav_control("W-101", "stop")["navigation"] is None
    bad = svc.nav_start("W-102", "DE-02", "normal", False)
    assert bad["message"] == "NO SAFE SIMULATED ROUTE AVAILABLE."
    with pytest.raises(ApiError):
        svc.nav_start("W-102", "BOGUS", "normal", False)


def test_rover_command_api(svc):
    out = svc.rover_command("forward", 0.5, 1.0)
    assert out["simulated"] is True and "no real motor command" in out["note"].lower()


def test_request_schemas_validate():
    assert ScenarioRequest(scenario="warning", segment_id="S04", gas="ch4").zone is None
    for bad in ({"scenario": "nuke"}, {"scenario": "warning", "segment_id": "x; DROP"}, {"scenario": "warning", "gas": "n2"},
                {"scenario": "warning", "extra": 1}, {"scenario": "comm_loss", "zone": "Moon"}):
        with pytest.raises(ValidationError):
            ScenarioRequest(**bad)
    with pytest.raises(ValidationError):
        RoverCommandRequest(command="forward", speed_mps=9)
    with pytest.raises(ValidationError):
        RoverCommandRequest(command="forward", duration_s=0)
    with pytest.raises(ValidationError):
        NavStartRequest(worker_id="bob")
    with pytest.raises(ValidationError):
        ThresholdUpdate(gas="n2")
