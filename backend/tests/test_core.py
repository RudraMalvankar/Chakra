from backend.app.models.case import RecoveryCase
from backend.app.api.webhooks import verify_signature
from backend.app.services.safety_engine import enforce_safety
from backend.app.schemas.state import RecoveryDecision, InterventionType
import pytest

def test_webhook_signature():
    secret = "test_secret_for_hmac"
    body = b'{"event":"payment.failed"}'
    
    # Valid signature
    import hmac, hashlib
    valid_sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_signature(body, valid_sig, secret) == True
    
    # Invalid signature
    assert verify_signature(body, "invalid_sig", secret) == False

def test_safety_engine_fraud_block():
    context = RecoveryCase(
        payment_id="p1", customer_id="c1", amount_inr=1000, error_code="fraud_flag", fraud_flag=True
    )
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_NOW, eligibility="PENDING", reason_code="test", policy_id="test", confidence=0.99, requires_human=False
    )
    
    final_decision = enforce_safety(context, decision, "2026-01-01")
    assert final_decision.decision == InterventionType.BLOCK
    assert final_decision.reason_code == "HARD_COMPLIANCE_BLOCK"

def test_safety_engine_afa_threshold():
    # Above 15k threshold
    context = RecoveryCase(
        payment_id="p2", customer_id="c2", amount_inr=16000, error_code="insufficient_funds"
    )
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_LATER, eligibility="PENDING", reason_code="test", policy_id="test", confidence=0.99, requires_human=False
    )
    
    final_decision = enforce_safety(context, decision, "2026-01-01")
    assert final_decision.decision == InterventionType.AFA_PAYMENT_LINK
    assert final_decision.reason_code == "SAFETY_MODIFIED_AFA_LIMIT"
