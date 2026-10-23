import math

import pytest

from app.config import SimSettings, ThresholdConfig
from app.mine_graph import build_default_mine
from app.safety import classify, evaluate_mine, evaluate_segment

G = build_default_mine()
TH = ThresholdConfig()
ST = SimSettings()
NOW = 1_000.0
OK = {"ch4": 0.1, "co": 3.0, "o2": 20.8, "co2": 900.0, "h2s": 0.1, "temp": 25.0, "rh": 70.0, "pressure": 1010.0}


def sensors(overrides=None, drop=(), stale=(), fault=()):
    out = {}
    for sid in G.segments:
        if sid in drop:
            continue
        vals = dict(OK)
        vals.update((overrides or {}).get(sid, {}))
        out[f"GS-{sid}"] = {"id": f"GS-{sid}", "segment_id": sid, "available": sid not in fault,
                            "last_update": NOW - (60 if sid in stale else 1), "values": vals}
    return out


def mine(**kw):
    return evaluate_mine(G, sensors(**kw), TH, NOW, ST)


def test_all_good_is_safe():
    r = mine()
    assert r["state"] == "SAFE" and r["simulated"] is True and "SIMULATION" in r["disclaimer"]


@pytest.mark.parametrize("gas,val,level", [
    ("ch4", 0.99, "ok"), ("ch4", 1.0, "warning"), ("ch4", 1.99, "warning"), ("ch4", 2.0, "critical"),
    ("co", 24.9, "ok"), ("co", 25.0, "warning"), ("co", 50.0, "critical"),
    ("o2", 20.9, "ok"), ("o2", 19.5, "warning"), ("o2", 18.0, "critical"), ("o2", 22.0, "warning"), ("o2", 23.5, "critical"),
    ("co2", 4999, "ok"), ("co2", 5000, "warning"), ("co2", 15000, "critical"),
    ("h2s", 4.9, "ok"), ("h2s", 5.0, "warning"), ("h2s", 10.0, "critical"),
])
def test_threshold_boundaries(gas, val, level):
    assert classify(TH.gases[gas], val)[0] == level


def test_warning_and_critical_mine_states():
    assert mine(overrides={"S04": {"ch4": 1.4}})["state"] == "WARNING"
    r = mine(overrides={"S04": {"ch4": 2.6}})
    assert r["state"] == "DANGER"
    assert r["segments"]["S04"]["avoid"] and not r["segments"]["S04"]["traversable"]
    assert r["triggers"][0]["metric"] == "ch4" and r["triggers"][0]["action"] == "follow_emergency_procedure"


def test_critical_overrides_warnings_and_everything_else():
    r = mine(overrides={"S04": {"ch4": 2.6}, "S05": {"co": 30}, "S06": {"o2": 19.0}})
    assert r["state"] == "DANGER"


def test_low_oxygen_is_detected():
    assert mine(overrides={"S02": {"o2": 17.0}})["state"] == "DANGER"
    assert mine(overrides={"S02": {"o2": 19.0}})["state"] == "WARNING"


def test_missing_sensor_never_safe():
    r = mine(drop=["S05"])
    assert r["state"] != "SAFE"
    assert r["segments"]["S05"]["state"] == "UNKNOWN"
    assert any(x["code"] == "no_sensor" for x in r["segments"]["S05"]["reasons"])


def test_failed_sensor_never_safe():
    r = mine(fault=["S05"])
    assert r["state"] != "SAFE" and r["segments"]["S05"]["state"] == "UNKNOWN"


def test_stale_telemetry_never_safe():
    r = mine(stale=["S05"])
    assert r["state"] != "SAFE"
    assert any(x["code"] == "stale_telemetry" for x in r["segments"]["S05"]["reasons"])


def test_low_monitoring_coverage_is_unknown():
    many = list(G.segments)[:8]
    r = mine(stale=many)
    assert r["monitoring"]["ratio"] < ST.min_coverage
    assert r["state"] == "UNKNOWN"


def test_all_sensors_stale_is_unknown_not_safe():
    r = mine(stale=list(G.segments))
    assert r["state"] == "UNKNOWN"


def test_stale_sensor_with_critical_last_reading_stays_danger():
    r = mine(overrides={"S04": {"ch4": 3.0}}, stale=["S04"])
    assert r["state"] == "DANGER"
    assert r["segments"]["S04"]["reasons"][-1]["stale"] or any(x.get("stale") for x in r["segments"]["S04"]["reasons"])


def test_failed_sensor_with_critical_last_reading_stays_danger():
    assert mine(overrides={"S04": {"ch4": 3.0}}, fault=["S04"])["state"] == "DANGER"


def test_invalid_values_do_not_produce_safe():
    for bad in (math.nan, math.inf, None, "x"):
        s = sensors()
        s["GS-S05"]["values"]["ch4"] = bad
        r = evaluate_mine(G, s, TH, NOW, ST)
        assert r["state"] != "SAFE", bad


def test_obstruction_is_non_traversable_warning():
    r = evaluate_mine(G, sensors(), TH, NOW, ST, obstructions={"S03"})
    assert r["state"] == "WARNING" and not r["segments"]["S03"]["traversable"]


def test_restricted_segment_not_traversable_but_not_a_hazard():
    r = mine()
    s09 = r["segments"]["S09"]
    assert s09["restricted"] and not s09["traversable"] and not s09["avoid"] and s09["state"] == "SAFE"


def test_zone_states_and_reasons():
    r = mine(overrides={"S12": {"co": 30}})
    assert r["zones"]["East"]["state"] == "WARNING" and r["zones"]["Main"]["state"] == "SAFE"
    t = r["triggers"][0]
    assert t["metric"] == "co" and t["value"] == 30 and t["threshold"] == 25 and t["ts"]


def test_configurable_thresholds_change_result_and_are_validated():
    cfg = ThresholdConfig()
    cfg.update("ch4", warn_high=0.2, crit_high=0.5)
    r = evaluate_mine(G, sensors(overrides={"S04": {"ch4": 0.6}}), cfg, NOW, ST)
    assert r["state"] == "DANGER"
    with pytest.raises(ValueError):
        cfg.update("ch4", warn_high=3.0)  # above crit_high
    with pytest.raises(ValueError):
        cfg.update("nope", warn_high=1)
    cfg.reset()
    assert cfg.gases["ch4"].warn_high == 1.0


def test_evaluate_segment_without_sensor():
    r = evaluate_segment("S01", None, TH, NOW, 15)
    assert r["state"] == "UNKNOWN"
