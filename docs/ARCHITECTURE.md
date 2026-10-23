# Architecture (SIMULATION ONLY)

```
 Simulation engine ──frames──▶ SensorBank.apply (validation) ─▶ safety engine ─▶ alerts / routing
        ▲                                                           │
  Adapter boundary                                          snapshot (JSON)
 (Simulated | Esp32 stub)                                           │
                                         FastAPI: REST + /ws/telemetry ─▶ React UI (4 languages)
```

## Backend (`backend/app`)
| Module | Role |
|---|---|
| `config.py` | example thresholds, settings, env flags |
| `mine_graph.py` | deterministic synthetic mine: nodes, segments, geometry, zones |
| `telemetry.py` | OU-process gas/environment model, `SensorBank` frame validation, bucketed `History` |
| `safety.py` | per-segment and mine-wide state machine |
| `routing.py` | Dijkstra with blocked/critical/restricted avoidance, alternates, exits, instructions |
| `movement.py` | travellers along segments, explored-interval merging (coverage) |
| `alerts.py` | keyed alert sync, acknowledge / resolve |
| `simulation.py` | clock, scenarios, workers, rover, navigation, snapshot |
| `service.py` | framework-free API logic (unit-testable) |
| `main.py` | FastAPI wrapper, WebSocket hub, static UI mount |
| `adapters.py` | adapter boundary, disabled ESP32 stub |
| `store.py` | optional SQLite persistence |

## Safety rules (enforced in `safety.py`, covered by tests)
1. Any critical reading ⇒ DANGER, even if the sensor later goes stale.
2. Missing, stale, failed or non-finite data never yields SAFE (UNKNOWN or WARNING).
3. Blocked tunnels are non-traversable; DANGER segments and restricted workings are never routed through.
4. Acknowledging an alert never changes the safety state; critical alerts need an operator to resolve.

## Frontend (`frontend/src`)
Hash-routed React app. `store.tsx` keeps one WebSocket snapshot; `i18n/` holds en/hi/mr/or dictionaries (539 keys each,
verified by `npm run check:i18n`) and localised node/segment names. Alert and navigation sentences are composed in the UI
from structured backend data, so they translate correctly. The 3D scene (`MineScene.tsx`) uses React-Three-Fiber.
