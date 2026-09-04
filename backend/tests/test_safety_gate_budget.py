import pytest
from backend.app.services.safety_gate import SafetyGate, CUSTOMER_INTERVENTION_CACHE
from backend.app.models.case import RecoveryCase, RecoveryDecision, InterventionType

def test_budget_limit():
    CUSTOMER_INTERVENTION_CACHE.clear()
    
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_LATER, 
        reason_code="test",
        policy_id="test"
    )
    
    for i in range(3):
        ctx = RecoveryCase(
            case_id=f"c{i}", payment_id=f"p{i}", amount_inr=100, 
            customer_id="cust_budget_test", case_type="PAYMENT_FAILURE", error_code="timeout"
        )
        d = SafetyGate.evaluate(ctx, decision, day="2024-01-01")
        assert d.eligibility == "ALLOWED", f"Attempt {i+1} should be allowed"
        
    # 4th attempt at limit
    ctx = RecoveryCase(
        case_id="c4", payment_id="p4", amount_inr=100, 
        customer_id="cust_budget_test", case_type="PAYMENT_FAILURE", error_code="timeout"
    )
    d4 = SafetyGate.evaluate(ctx, decision, day="2024-01-01")
    assert d4.eligibility == "BLOCKED"
    assert d4.reason_code == "CUSTOMER_BUDGET_EXCEEDED"
