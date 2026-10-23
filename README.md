# RAG-Mine — Underground Mine Safety, 3D Mapping & Navigation (SIMULATION ONLY)

> **SIMULATION MODE.** Every reading, worker, rover movement, map, route and alert is generated locally by a deterministic
> simulation engine. Nothing is a real mine measurement, nothing controls real hardware, and this software does **not**
> certify any real mine as safe.

Languages: **English, हिन्दी, मराठी, ଓଡ଼ିଆ** (switch from the top bar; the choice is remembered).

## What it does
- 10 pages: Overview, Live Mine Map (3D), Gas Monitoring, Worker Safety, Rover Control, Navigation & Routes, Alerts & Incidents, Historical Analytics (CSV export), System Health, Settings.
- Synthetic mine graph (14 nodes, 16 tunnel segments, ~1.1 km) with a 3D synthetic point cloud that appears only where the simulated rover has "mapped".
- Safety engine: SAFE / WARNING / DANGER / UNKNOWN. A critical reading is always DANGER; missing, stale or invalid data is never SAFE.
- Dijkstra routing that avoids critical, blocked and restricted tunnels, with alternate routes, nearest emergency exit and turn-by-turn text. If nothing is safe it says **NO SAFE SIMULATED ROUTE AVAILABLE.**
- Simulated workers, autonomous rover (battery, obstacles, coverage), alerts with acknowledge/resolve, scenarios (warning, critical gas, sensor failure, comm loss, blocked tunnel, evacuation, clear).

## Windows PowerShell quick start
Prerequisites: Python 3.10+ and Node.js 18+.

```powershell
cd rag-mine
.\scripts\setup.ps1      # venv + pip install + npm install + build UI
.\scripts\run.ps1        # open http://127.0.0.1:8000
```

Manual equivalent:

```powershell
cd rag-mine\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\frontend
npm install
npm run build
cd ..\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Development with hot reload: `.\scripts\dev.ps1` (API :8000, UI http://localhost:5173).
Tests: `.\scripts\test.ps1` (or `cd backend; python -m pytest -q`). UI translation check: `cd frontend; npm run check:i18n`.

## Configuration (environment variables, see `.env.example`)
| Variable | Default | Meaning |
|---|---|---|
| `RAGMINE_AUTOSTART` | 1 | start the simulation clock at boot |
| `RAGMINE_PERSIST` | 0 | 1 = also store history in SQLite |
| `ENABLE_HARDWARE_ADAPTER` | 0 | **keep 0** — ESP32 adapter is a disabled stub |
| `RAGMINE_CORS` | localhost:5173 | allowed origins in dev |

The default simulation speed is 5× (choices 1, 2, 5, 10, 30, 60). Seed is fixed (42), so runs are reproducible.

## Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, safety rules
- [docs/API.md](docs/API.md) — REST and WebSocket reference
- [docs/SCENARIOS.md](docs/SCENARIOS.md) — scenarios and expected behaviour
- [docs/ESP32_REPLACEMENT.md](docs/ESP32_REPLACEMENT.md) — replacing the simulator with real telemetry later

## Limitations
- The example gas thresholds are **not** legal limits; real values must come from regulations, site procedures and calibrated instruments.
- The 3D map is generated geometry, not LiDAR; exploration is simulated, not SLAM.
- Hindi, Marathi and Odia text is machine-authored; have native speakers review safety wording before any real use.
- Localisation of alert text is built from structured data in the UI; free-form backend strings (e.g. error details) remain English.
