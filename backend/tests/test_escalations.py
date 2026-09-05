from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.recovery_executor import execute_recovery_pipeline


def test_safety_block_creates_persisted_escalation():
    """A hard mandate block must stop automation and enter the human queue."""
    import asyncio
    case = asyncio.run(execute_recovery_pipeline({
        "payment_id": "pay_escalation_mandate_001",
        "customer_id": "cust_escalation_001",
        "amount": 25000_00,
        "currency": "INR",
        "error_code": "mandate_revoked",
    }, dry_run=True))
    assert case.current_state.value == "BLOCKED"

    client = TestClient(app)
    response = client.get("/api/escalations/")
    assert response.status_code == 200
    escalation = next(item for item in response.json() if item["case_id"] == case.case_id)
    assert escalation["reason"] == "HARD_COMPLIANCE_BLOCK"
    assert escalation["status"] == "OPEN"

    moved = client.post(f"/api/escalations/{escalation['id']}/transition", json={
        "status": "ASSIGNED", "actor": "collections.agent", "assigned_to": "collections.agent",
    })
    assert moved.status_code == 200
    assert moved.json()["status"] == "ASSIGNED"
    assert moved.json()["assigned_to"] == "collections.agent"
