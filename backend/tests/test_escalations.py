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


def test_escalation_actions_lifecycle():
    """Verify operational actions: assign, note, payment link, promise, and resolution."""
    client = TestClient(app)

    # 1. Create a manual escalation
    create_res = client.post("/api/escalations/create", json={
        "case_id": "case_test_esc_ops_01",
        "reason": "CUSTOMER_DISPUTE",
        "priority": "HIGH",
        "notes": "Customer reported unauthorized card debit",
    })
    assert create_res.status_code == 200
    esc = create_res.json()
    esc_id = esc["id"]
    assert esc["status"] == "OPEN"
    assert esc["reason"] == "CUSTOMER_DISPUTE"

    # 2. Assign to specialist
    assign_res = client.post(f"/api/escalations/{esc_id}/assign", json={
        "assigned_to": "Arjun Mehta (Dispute Specialist)",
        "priority": "CRITICAL",
        "notes": "Handed off to tier 2 disputes",
    })
    assert assign_res.status_code == 200
    assert assign_res.json()["assigned_to"] == "Arjun Mehta (Dispute Specialist)"
    assert assign_res.json()["status"] == "ASSIGNED"

    # 3. Add internal case note
    note_res = client.post(f"/api/escalations/{esc_id}/note", json={
        "notes": "Reviewed transaction logs with acquiring bank. Goods were delivered on time.",
        "actor": "Arjun Mehta",
    })
    assert note_res.status_code == 200
    actions = note_res.json()["actions"]
    assert any("Reviewed transaction logs" in a.get("notes", "") for a in actions)

    # 4. Generate recovery payment link
    link_res = client.post(f"/api/escalations/{esc_id}/link", json={
        "amount": 15000.0,
        "description": "Settlement payment for case_test_esc_ops_01",
    })
    assert link_res.status_code == 200
    assert "url" in link_res.json()
    assert link_res.json()["url"].startswith("http")

    # 5. Record Promise to Pay
    promise_res = client.post(f"/api/escalations/{esc_id}/promise", json={
        "promised_amount": 15000.0,
        "promise_date": "2026-09-15",
        "notes": "Customer agreed to pay after invoice clarification",
    })
    assert promise_res.status_code == 200
    assert promise_res.json()["status"] == "PROMISE_RECEIVED"

    # 6. Resolve escalation
    resolve_res = client.post(f"/api/escalations/{esc_id}/resolve", json={
        "resolution": "PROMISE_SCHEDULED",
        "resolution_notes": "Customer confirmed payment scheduled for Sept 15.",
    })
    assert resolve_res.status_code == 200
    assert resolve_res.json()["status"] == "RESOLVED"
    assert resolve_res.json()["resolution"] == "PROMISE_SCHEDULED"

    # 7. Get enriched dossier
    detail_res = client.get(f"/api/escalations/{esc_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["status"] == "RESOLVED"
    assert "actions" in detail
    assert len(detail["actions"]) >= 5
    assert "root_cause_explanation" in detail

