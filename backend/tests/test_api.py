"""HTTP + WebSocket tests. Requires fastapi and httpx (pip install -r requirements.txt)."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


@pytest.fixture()
def client():
    app = create_app(autostart=False)
    with TestClient(app) as c:
        yield c


def test_required_endpoints_respond(client):
    for url in ("/api/health", "/api/mine/map", "/api/telemetry/latest", "/api/telemetry/history?range=5m", "/api/workers",
                "/api/rover", "/api/alerts", "/api/simulation/status", "/api/analytics?range=1h", "/api/thresholds",
                "/api/routes?worker_id=W-101&dest=J-04"):
        r = client.get(url)
        assert r.status_code == 200, url
        assert r.json()["simulated"] is True if "simulated" in r.json() else True


def test_openapi_documents_schemas(client):
    spec = client.get("/openapi.json").json()
    assert "/api/simulation/scenario" in spec["paths"] and "ScenarioRequest" in spec["components"]["schemas"]


def test_validation_errors_are_rejected(client):
    assert client.post("/api/simulation/scenario", json={"scenario": "bogus"}).status_code == 422
    assert client.post("/api/simulation/speed", json={"speed": 3}).status_code == 400
    assert client.post("/api/rover/command", json={"command": "forward", "speed_mps": 50}).status_code == 422
    assert client.get("/api/telemetry/history?range=banana").status_code == 422
    assert client.get("/api/workers/W-999").status_code == 404
    assert client.post("/api/alerts/ALR-9999/acknowledge").status_code == 404


def test_scenario_flow_and_reset(client):
    assert client.post("/api/simulation/scenario", json={"scenario": "critical_gas", "segment_id": "S12", "gas": "ch4"}).status_code == 200
    client.app.state.sim.advance(400)
    assert client.get("/api/simulation/status").json()["safety_state"] == "DANGER"
    alert = client.get("/api/alerts?severity=critical").json()["alerts"][0]
    assert client.post(f"/api/alerts/{alert['id']}/acknowledge").json()["alert"]["status"] == "acknowledged"
    assert client.get("/api/simulation/status").json()["safety_state"] == "DANGER"
    assert client.post("/api/simulation/reset").json()["safety_state"] == "SAFE"
    assert client.post("/api/simulation/start").json()["running"] is True
    assert client.post("/api/simulation/pause").json()["running"] is False


def test_history_csv_download(client):
    r = client.get("/api/telemetry/history.csv?metrics=ch4&range=15m")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "SIMULATED" in r.text


def test_websocket_telemetry_format(client):
    with client.websocket_connect("/ws/telemetry") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "telemetry" and msg["mode"] == "SIMULATION" and msg["simulated"] is True
    assert set(msg["segments"]) == {f"S{i:02d}" for i in range(1, 17)}
    assert msg["safety"]["state"] in ("SAFE", "WARNING", "DANGER", "UNKNOWN")
    assert len(msg["workers"]) == 6 and msg["rover"]["id"] == "ROV-01"
