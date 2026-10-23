# Replacing the simulator with real ESP32 telemetry (future work)

Today only `SimulatedAdapter` produces data. The ESP32 path is a **disabled stub** (`ENABLE_HARDWARE_ADAPTER=0`).
Sensors in the engine accept data only through `SensorBank.apply(frame)`, which validates every frame, so swapping the
source does not touch the safety engine, routing, alerts or UI.

Frame (one JSON object per sensor node per sample):
```json
{"sensor_id": "GS-S04", "t": 1772438400.0, "status": "ok",
 "values": {"ch4": 0.12, "co": 2.1, "o2": 20.8, "co2": 810, "h2s": 0.1, "temp": 26.4, "rh": 74.0, "pressure": 1010.9}}
```
Steps a future integrator would take:
1. Implement `Esp32SerialAdapter.poll()` to read frames over serial/Wi-Fi and return them; keep it behind the env flag.
2. Frames failing validation (non-finite, out of range, unknown sensor, bad timestamp) are rejected and counted in System Health.
3. Missing frames make the segment stale ⇒ UNKNOWN/WARNING, never SAFE.
4. Rover commands go through `validate_rover_command` (whitelist, max 0.8 m/s, ≤5 s) and a separate, reviewed motor-control path.
5. Calibrate sensors, load site-specific thresholds, and obtain safety certification. This prototype provides none of that.
