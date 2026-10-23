import math

from app.mine_graph import build_default_mine
from app.telemetry import SensorBank, TelemetryModel

G = build_default_mine()


def frame(**kw):
    f = {"sensor_id": "GS-S01", "t": 10.0, "status": "ok",
         "values": {"ch4": 0.1, "co": 2, "o2": 20.8, "co2": 800, "h2s": 0.1, "temp": 25, "rh": 70, "pressure": 1010}}
    f.update(kw)
    return f


def test_valid_frame_is_applied():
    b = SensorBank(G)
    assert b.apply([frame()]) == 1
    s = b.sensors["GS-S01"]
    assert s["available"] and s["last_update"] == 10.0 and s["values"]["ch4"] == 0.1
    assert b.status(s, 12.0, 15) == "ok" and b.status(s, 100.0, 15) == "stale"


def test_invalid_frames_are_rejected():
    b = SensorBank(G)
    bad = [frame(sensor_id="GS-NOPE"), frame(t=math.nan), frame(status="weird"), frame(values=None),
           frame(values={"ch4": math.nan}), frame(values={"ch4": -5}), frame(values={"o2": 80}),
           frame(values={"bogus": 1}), "not a dict", frame(t="x")]
    assert b.apply(bad) == 0 and b.rejected == len(bad)
    assert b.sensors["GS-S01"]["status"] == "no_data"


def test_fault_frame_marks_unavailable_but_keeps_last_values():
    b = SensorBank(G)
    b.apply([frame()])
    b.apply([frame(t=20.0, status="fault", values=None)])
    s = b.sensors["GS-S01"]
    assert not s["available"] and s["values"]["ch4"] == 0.1 and b.status(s, 21.0, 15) == "fault"


def test_model_is_smooth_not_jumpy():
    m = TelemetryModel(G, 42)
    prev = None
    t = 0.0
    for _ in range(300):
        t += 5
        m.step(t, 5, {})
        v = m.truth("S04", t)
        if prev:
            assert abs(v["ch4"] - prev["ch4"]) < 0.1 and abs(v["temp"] - prev["temp"]) < 0.5
        prev = v
    assert 0 < prev["ch4"] < 1.0 and 20.0 < prev["o2"] < 21.5 and 400 < prev["co2"] < 3000
    assert 20 < prev["temp"] < 35 and 35 < prev["rh"] < 99 and 1000 < prev["pressure"] < 1020
