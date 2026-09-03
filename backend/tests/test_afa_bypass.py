import pytest
from backend.app.services.safety_gate import SafetyGate
from backend.app.models.case import RecoveryCase, InterventionType, RecoveryDecision

def test_afa_voice_recovery_bypass():
    ctx = RecoveryCase(payment_id="p1", amount_inr=16000.0, error_code="insufficient_funds")
    proposed = RecoveryDecision(decision=InterventionType.VOICE_RECOVERY, reason_code="VOICE", policy_id="p1")
    
    final_dec = SafetyGate.evaluate(ctx, proposed)
    
    assert final_dec.decision == InterventionType.AFA_PAYMENT_LINK
    assert final_dec.reason_code == "SAFETY_MODIFIED_AFA_LIMIT"
    assert final_dec.template_id == "dlt_afa_threshold_v1"

def test_afa_reminder_bypass():
    ctx = RecoveryCase(payment_id="p2", amount_inr=16000.0, error_code="insufficient_funds")
    proposed = RecoveryDecision(decision=InterventionType.REMINDER, reason_code="REMINDER", policy_id="p1")
    
    final_dec = SafetyGate.evaluate(ctx, proposed)
    
    assert final_dec.decision == InterventionType.AFA_PAYMENT_LINK
    assert final_dec.reason_code == "SAFETY_MODIFIED_AFA_LIMIT"
