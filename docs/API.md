# API (SIMULATION; all responses carry `"simulated": true`)
Base: `http://127.0.0.1:8000` · interactive docs at `/docs`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | status, health, hardware adapter state |
| GET | `/api/mine/map` | nodes, segments, geometry |
| GET | `/api/telemetry/latest` | full snapshot |
| GET | `/api/telemetry/history` | `metrics, sensor, range(5m/15m/1h/6h), from, to, max_points` |
| GET | `/api/telemetry/history.csv` | CSV export (labelled SIMULATED) |
| GET | `/api/workers`, `/api/workers/{id}` | workers + navigation |
| GET | `/api/rover` | rover, trajectory, mapping |
| GET | `/api/alerts` | filters `severity, category, status, q, limit` |
| GET | `/api/routes` | `worker_id, dest, mode=normal|emergency` |
| GET | `/api/analytics` | `range` |
| GET/PUT | `/api/thresholds` | read / update example thresholds; `POST /api/thresholds/reset` |
| GET | `/api/simulation/status` | clock, speed, scenarios |
| POST | `/api/simulation/start|pause|reset|speed|scenario` | control the simulation |
| POST | `/api/rover/command` | simulated rover commands only |
| POST | `/api/navigation/start|control` | worker navigation |
| POST | `/api/alerts/{id}/acknowledge|resolve` | alert workflow |
| WS | `/ws/telemetry` | snapshot pushed every tick |

Errors: `{"detail": "...", "simulated": true}` with 400/404/422.
