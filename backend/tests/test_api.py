import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_metrics():
    response = client.get("/api/metrics")
    assert response.status_code == 200
    assert "metrics" in response.json()

def test_audit():
    response = client.get("/api/audit")
    assert response.status_code == 200
    assert "events" in response.json()
