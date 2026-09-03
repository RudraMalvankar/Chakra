import pytest
from backend.app.models.case import RecoveryCase, CaseType, InterventionType
from backend.app.models.case import RevenueRiskAssessment
from backend.app.services.recovery_agent import RecoveryAgent

def create_case(case_type, amount, error_code="", retry_count=0, fraud_flag=False, days_overdue=0, promise_status=""):
    ctx = {"days_overdue": days_overdue, "promise_status": promise_status}
    case = RecoveryCase(
        case_id="test1",
        case_type=case_type,
        amount_at_risk=amount,
        error_code=error_code,
        retry_count=retry_count,
        fraud_flag=fraud_flag,
        context=ctx,
        metadata=ctx
    )
    # mock risk assessment
    case.risk_assessment = RevenueRiskAssessment(
        revenue_at_risk_inr=amount,
        recovery_probability=0.6,
        expected_recovery_inr=amount * 0.6,
        priority="MEDIUM",
        urgency="MEDIUM",
        risk_factors=[],
        recovery_window="48h",
        reason="test"
    )
    return case

def test_candidate_generation_and_scoring():
    # Test A & B: Candidates & Scoring
    case = create_case(CaseType.PAYMENT_FAILURE, 1000.0, error_code="insufficient_funds")
    decision = RecoveryAgent.decide(case)
    
    assert len(decision.candidate_actions) >= 3
    # Retry Later should score higher than Retry Now due to modifier
    retry_later = next(c for c in decision.candidate_actions if c.action == "RETRY_LATER")
    retry_now = next(c for c in decision.candidate_actions if c.action == "RETRY_NOW")
    assert retry_later.score > retry_now.score
    assert decision.selected_action == "RETRY_LATER"

def test_previous_interventions_penalty():
    # Test C: Previous interventions
    case_no_retry = create_case(CaseType.PAYMENT_FAILURE, 1000.0, error_code="insufficient_funds", retry_count=0)
    case_with_retry = create_case(CaseType.PAYMENT_FAILURE, 1000.0, error_code="insufficient_funds", retry_count=2)
    
    d1 = RecoveryAgent.decide(case_no_retry)
    d2 = RecoveryAgent.decide(case_with_retry)
    
    c1 = next(c for c in d1.candidate_actions if c.action == "RETRY_LATER")
    c2 = next(c for c in d2.candidate_actions if c.action == "RETRY_LATER")
    
    assert c1.score > c2.score # Penalty applied

def test_retry_cap():
    case = create_case(CaseType.PAYMENT_FAILURE, 1000.0, error_code="insufficient_funds", retry_count=3)
    d = RecoveryAgent.decide(case)
    
    retry_now = next(c for c in d.candidate_actions if c.action == "RETRY_NOW")
    assert not retry_now.eligible
    assert d.selected_action == "ESCALATE"

def test_five_case_types():
    # Test D: Case Types
    c_sub = create_case(CaseType.SUBSCRIPTION, 1000.0, days_overdue=10)
    d_sub = RecoveryAgent.decide(c_sub)
    assert d_sub.selected_action == "VOICE_RECOVERY"
    
    c_chk = create_case(CaseType.CHECKOUT_ABANDONMENT, 1000.0)
    d_chk = RecoveryAgent.decide(c_chk)
    assert d_chk.selected_action == "PAYMENT_LINK"
    
    c_rec = create_case(CaseType.RECEIVABLE, 1000.0, days_overdue=10)
    d_rec = RecoveryAgent.decide(c_rec)
    assert d_rec.selected_action == "REMINDER"
    
    c_ptp = create_case(CaseType.PROMISE_TO_PAY, 1000.0, promise_status="BROKEN")
    d_ptp = RecoveryAgent.decide(c_ptp)
    assert d_ptp.selected_action == "ESCALATE"

def test_safety_afa():
    # Test E: Safety AFA rules
    case = create_case(CaseType.PAYMENT_FAILURE, 20000.0, error_code="insufficient_funds")
    d = RecoveryAgent.decide(case)
    
    assert d.selected_action == "AFA_PAYMENT_LINK"
    retry = next((c for c in d.candidate_actions if c.action == "RETRY_NOW"), None)
    if retry:
        assert not retry.eligible

def test_safety_fraud():
    case = create_case(CaseType.PAYMENT_FAILURE, 1000.0, fraud_flag=True)
    d = RecoveryAgent.decide(case)
    
    assert d.selected_action == "BLOCK"
    block_c = next(c for c in d.candidate_actions if c.action == "BLOCK")
    assert block_c.eligible
    assert block_c.score > 10000

def test_safety_revoked():
    case = create_case(CaseType.PAYMENT_FAILURE, 1000.0, error_code="mandate_revoked")
    d = RecoveryAgent.decide(case)
    
    assert d.selected_action == "BLOCK"

def test_explicit_expected_recovery_math():
    case = create_case(CaseType.PAYMENT_FAILURE, 1000.0, error_code="insufficient_funds")
    decision = RecoveryAgent.decide(case)
    
    # 1. Base probability from Risk Engine baseline is preserved in candidate
    retry_later = next(c for c in decision.candidate_actions if c.action == "RETRY_LATER")
    assert retry_later.base_probability == 0.6
    
    # 2. Probability modifier is applied
    assert retry_later.probability_modifier == 1.1
    
    # 3. Effective probability is clamped correctly (0.6 * 1.1 = 0.66)
    assert retry_later.effective_probability == pytest.approx(0.66)
    
    # 4. Expected recovery = amount * effective probability
    assert retry_later.expected_recovery_inr == pytest.approx(660.0)
