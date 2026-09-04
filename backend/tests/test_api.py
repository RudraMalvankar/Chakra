import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "database" in data
    assert "razorpay" in data

def test_metrics():
    response = client.get("/api/metrics")
    assert response.status_code == 200
    assert "metrics" in response.json()

def test_audit():
    response = client.get("/api/audit")
    assert response.status_code == 200
    assert "events" in response.json()
