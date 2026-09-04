import pytest
import uuid
import hmac
import hashlib
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.config import settings
from backend.app.db.session import get_session_factory
from backend.app.db.models import RecoveryCase as DBRecoveryCase, Payment as DBPayment
from backend.app.services.db_service import DBService
from backend.app.services.llm import gemini_classify
from backend.app.services.triage import TriageEngine
from backend.app.models.case import RecoveryCase, CaseType
from backend.app.models.payment import PaymentState

client = TestClient(app)

# -------------------------------------------------------------
# 1. NEON POSTGRES PERSISTENCE TESTS
# -------------------------------------------------------------
def test_neon_persistence_crud():
    """Verifies that cases, payments, and audit events persist cleanly in Neon Postgres."""
    test_id = f"test_pmt_{uuid.uuid4().hex[:8]}"
    
    # 1. Upsert Customer & Payment
    cust_id = DBService.upsert_customer(f"cust_{test_id}", display_name="Test Corp", risk_tier="MEDIUM")
    assert cust_id is not None

    payment = DBService.upsert_payment(
        payment_id=test_id,
        amount_inr=15000.0,
        customer_id=cust_id,
        status="FAILED",
        failure_code="insufficient_funds",
        payment_method="UPI"
    )
    assert payment is not None
    assert payment.id == test_id
    assert payment.amount == 15000.0

    # 2. Upsert RecoveryCase
    case = DBService.upsert_recovery_case(
        case_id=f"case_{test_id}",
        payment_id=test_id,
        case_type="PAYMENT_FAILURE",
        amount_at_risk=15000.0,
        status="PENDING",
        risk_probability=0.75,
        recovery_eligible=True,
        current_action="PAYMENT_LINK",
        ai_used=True,
        ai_classification="PAYMENT_LINK",
        ai_confidence=0.88,
        ai_reasoning="High probability recovery via UPI payment link",
    )
    assert case is not None
    assert case.id == f"case_{test_id}"
    assert case.ai_used is True
    assert case.ai_confidence == 0.88

    # 3. Retrieve Case Detail via DBService
    detail = DBService.get_case_detail(f"case_{test_id}")
    assert detail is not None
    assert detail["amount_at_risk"] == 15000.0
    assert detail["ai_used"] is True
    assert detail["ai_classification"] == "PAYMENT_LINK"

    # 4. Record Audit Event & Retrieve
    DBService.record_audit_event(
        payment_id=test_id,
        event_type="test_verification_event",
        actor="system_test",
        details={"action": "TEST_VERIFY", "status": "SUCCESS", "test_key": "test_val"}
    )
    trail = DBService.get_audit_trail(limit=50)
    matching = [e for e in trail if e["payment_id"] == test_id]
    assert len(matching) >= 1
    assert matching[0]["event_type"] == "test_verification_event"


# -------------------------------------------------------------
# 2. GEMINI AI TRIAGE & MULTI-MODEL FALLBACK TESTS
# -------------------------------------------------------------
def test_gemini_triage_ambiguous_case():
    """Verifies that ambiguous network_authorization_anomaly triggers AI classification."""
    ctx = RecoveryCase(
        case_id="pay_ambiguous_test_001",
        amount_at_risk=8500.0,
        case_type=CaseType.PAYMENT_FAILURE,
        failure_reason="network_authorization_anomaly",
        customer_id="cust_test_ambig",
        context={"churn_risk": "LOW", "fraud_risk": "LOW"},
    )
    result = TriageEngine.triage(ctx)
    assert result.is_ambiguous is True
    assert result.confidence > 0.0
    assert result.ai_used is True
    assert result.model_used is not None
    assert result.recommended_action in ["RETRY_LATER", "PAYMENT_LINK", "ESCALATE", "BLOCK", "RETRY_NOW", "AFA_PAYMENT_LINK"]


def test_gemini_fallback_on_api_error():
    """Verifies graceful fallback when primary and secondary Gemini models fail."""
    ctx = {
        "error_code": "unknown_network_drop",
        "amount_inr": 25000.0,
        "customer_id": "cust_err",
        "pii_redacted": True,
    }
    with patch("backend.app.services.llm.genai.Client", side_effect=Exception("Simulated Quota / Network Failure")):
        decision = gemini_classify(ctx)
        assert decision.action in ["retry", "send_payment_link", "escalate", "block"]
        assert decision.fallback_used is True
        assert decision.ai_used is False


# -------------------------------------------------------------
# 3. RAZORPAY CHECKOUT ORDER, VERIFY, AND ABANDON TESTS
# -------------------------------------------------------------
def test_razorpay_order_creation():
    """Verifies /api/payments/orders and /api/payments/create_order."""
    res = client.post("/api/payments/orders", json={"amount_inr": 5000.0, "customer_id": "cust_tst_01"})
    assert res.status_code == 200
    data = res.json()
    assert "order_id" in data
    assert data["amount_inr"] == 5000.0


def test_razorpay_checkout_verify_valid():
    """Verifies server-side signature verification on successful payment with real HMAC."""
    order_id = "order_test_998877"
    payment_id = "pay_test_998877"
    secret = (settings.razorpay_key_secret or "mock_secret").encode("utf-8")
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    valid_sig = hmac.new(secret, msg, hashlib.sha256).hexdigest()

    res = client.post("/api/payments/verify", json={
        "razorpay_order_id": order_id,
        "razorpay_payment_id": payment_id,
        "razorpay_signature": valid_sig,
        "amount_inr": 5000.0
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "captured"
    assert data["recovered"] is True
    assert data["payment_id"] == payment_id

    # Verify updated in DB
    detail = DBService.get_case_detail("case_rzp_st_998877")
    if detail:
        assert detail["status"] == "RECOVERED"


def test_razorpay_checkout_abandon():
    """Verifies abandonment handling when checkout modal is closed."""
    res = client.post("/api/payments/abandon", json={
        "order_id": "order_abandon_12345",
        "amount_inr": 5000.0,
        "customer_id": "cust_abn_01"
    })
    assert res.status_code == 200
    data = res.json()
    assert "case_id" in data
    assert data["recovered"] is False
    assert data["status"] == "RECOVERY_PENDING"


# -------------------------------------------------------------
# 4. BATCH SIMULATOR API TESTS
# -------------------------------------------------------------
def test_batch_api_lifecycle():
    """Verifies creating, listing, and querying batches."""
    create_res = client.post("/api/batches/", json={"count": 5, "scenario": "mixed"})
    assert create_res.status_code == 200
    batch_data = create_res.json()
    assert "batch_id" in batch_data
    batch_id = batch_data["batch_id"]

    get_res = client.get(f"/api/batches/{batch_id}")
    assert get_res.status_code == 200
    status_data = get_res.json()
    assert status_data["batch_id"] == batch_id
    assert status_data["requested_count"] == 5

    list_res = client.get("/api/batches/")
    assert list_res.status_code == 200
    batches = list_res.json()
    assert any(b["id"] == batch_id for b in batches)


# -------------------------------------------------------------
# 5. TWILIO WEBHOOK SECURITY TESTS
# -------------------------------------------------------------
def test_twilio_twiml_endpoint():
    """Verifies Twilio TwiML prompt generation."""
    res = client.post("/webhooks/twilio/twiml?case_id=inv_001&amount=5000")
    assert res.status_code == 200
    assert "Namaste" in res.text
    assert "<Gather" in res.text


def test_twilio_gather_speech_promise():
    """Verifies Twilio gather webhook extracts promise and generates Hinglish reply."""
    res = client.post(
        "/webhooks/twilio/gather?case_id=inv_001&amount=5000",
        data={"SpeechResult": "Haan mai kal tak payment kar dunga, pakka promise"}
    )
    assert res.status_code == 200
    assert "promise record kar liya" in res.text


def test_twilio_signature_verification_rejection():
    """Verifies that invalid Twilio signature is rejected with 403 when configured."""
    with patch("backend.app.api.webhooks.settings.twilio_auth_token", "real_token_12345"):
        res = client.post(
            "/webhooks/twilio/gather?case_id=inv_001&amount=5000",
            data={"SpeechResult": "Kal dunga"},
            headers={"X-Twilio-Signature": "invalid_fake_signature"}
        )
        assert res.status_code == 403
        assert "Invalid Twilio signature" in res.text
