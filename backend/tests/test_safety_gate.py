from backend.app.models.case import RecoveryCase
import pytest
from backend.app.models.case import RecoveryDecision, InterventionType, SafetyEvaluation
from backend.app.models.mandate import MandateState
from backend.app.services.safety_gate import (
    SafetyGate,
    enforce_safety,
    reset_safety_state,
    generate_idempotency_key,
    IDEMPOTENCY_STORE,
    CUSTOMER_INTERVENTION_COUNTS,
)
from backend.app.services.safety_engine import enforce_safety as legacy_enforce_safety


@pytest.fixture(autouse=True)
def clean_state():
    reset_safety_state()
    yield
    reset_safety_state()


def test_safety_gate_fraud_hard_block():
    ctx = RecoveryCase(
        payment_id="p1",
        customer_id="c1",
        amount_inr=1000.0,
        error_code="fraud_flag",
        fraud_flag=True,
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="test",
        policy_id="test",
    )
    final = SafetyGate.evaluate(ctx, proposed)
    assert final.decision == InterventionType.BLOCK
    assert final.eligibility == "BLOCKED"
    assert final.reason_code == "HARD_COMPLIANCE_BLOCK"
    assert final.requires_human is False


def test_safety_gate_revoked_hard_block():
    ctx = RecoveryCase(
        payment_id="p2",
        customer_id="c2",
        amount_inr=1000.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.REVOKED,
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="test",
        policy_id="test",
    )
    final = SafetyGate.evaluate(ctx, proposed)
    assert final.decision == InterventionType.BLOCK
    assert final.eligibility == "BLOCKED"
    assert final.reason_code == "HARD_COMPLIANCE_BLOCK"


def test_safety_gate_first_txn_afa_override():
    ctx = RecoveryCase(
        payment_id="p3",
        customer_id="c3",
        amount_inr=1000.0,
        error_code="insufficient_funds",
        is_first_transaction=True,
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="test",
        policy_id="test",
    )
    final = SafetyGate.evaluate(ctx, proposed)
    assert final.decision == InterventionType.AFA_PAYMENT_LINK
    assert final.reason_code == "SAFETY_MODIFIED_FIRST_TXN_AFA"
    assert final.template_id == "dlt_first_txn_v1"
    assert final.eligibility == "ALLOWED"


def test_safety_gate_afa_limit_15k_override():
    ctx = RecoveryCase(
        payment_id="p4",
        customer_id="c4",
        amount_inr=16000.0,
        error_code="insufficient_funds",
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="test",
        policy_id="test",
    )
    final = SafetyGate.evaluate(ctx, proposed)
    assert final.decision == InterventionType.AFA_PAYMENT_LINK
    assert final.reason_code == "SAFETY_MODIFIED_AFA_LIMIT"
    assert final.template_id == "dlt_afa_threshold_v1"
    assert final.eligibility == "ALLOWED"


def test_safety_gate_boundary_exact_15k():
    ctx = RecoveryCase(
        payment_id="p5",
        customer_id="c5",
        amount_inr=15000.0,
        error_code="insufficient_funds",
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="TRANSIENT_FAILURE",
        policy_id="test",
    )
    final = SafetyGate.evaluate(ctx, proposed)
    assert final.decision == InterventionType.RETRY_LATER
    assert final.eligibility == "ALLOWED"


def test_safety_gate_churn_alert_risk():
    ctx = RecoveryCase(
        payment_id="p6",
        customer_id="c6",
        amount_inr=1000.0,
        error_code="insufficient_funds",
        alerts_ignored=2,
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="test",
        policy_id="test",
    )
    final = SafetyGate.evaluate(ctx, proposed)
    assert final.decision == InterventionType.ESCALATE
    assert final.eligibility == "ESCALATED"
    assert final.reason_code == "HIGH_ALERTS_IGNORED_CHURN_RISK"
    assert final.requires_human is True


def test_safety_gate_network_caps():
    # Visa cap = 15
    ctx_visa_cap = RecoveryCase(
        payment_id="p_v15", customer_id="c_v", amount_inr=1000.0, error_code="insufficient_funds", network="visa", retry_count=15
    )
    proposed = RecoveryDecision(decision=InterventionType.RETRY_LATER, eligibility="PENDING_SAFETY", reason_code="test", policy_id="test")
    res_visa = SafetyGate.evaluate(ctx_visa_cap, proposed)
    assert res_visa.decision == InterventionType.BLOCK
    assert res_visa.reason_code == "NETWORK_RETRY_CAP_REACHED"

    # Visa under cap = 14
    ctx_visa_ok = RecoveryCase(
        payment_id="p_v14", customer_id="c_v", amount_inr=1000.0, error_code="insufficient_funds", network="visa", retry_count=14
    )
    res_visa_ok = SafetyGate.evaluate(ctx_visa_ok, proposed)
    assert res_visa_ok.decision == InterventionType.RETRY_LATER
    assert res_visa_ok.eligibility == "ALLOWED"

    # Mastercard cap = 10
    ctx_mc_cap = RecoveryCase(
        payment_id="p_mc10", customer_id="c_mc", amount_inr=1000.0, error_code="insufficient_funds", network="mastercard", retry_count=10
    )
    res_mc = SafetyGate.evaluate(ctx_mc_cap, proposed)
    assert res_mc.decision == InterventionType.BLOCK
    assert res_mc.reason_code == "NETWORK_RETRY_CAP_REACHED"

    # Rupay cap = 15
    ctx_rupay_cap = RecoveryCase(
        payment_id="p_rup15", customer_id="c_rup", amount_inr=1000.0, error_code="insufficient_funds", network="rupay", retry_count=15
    )
    res_rupay = SafetyGate.evaluate(ctx_rupay_cap, proposed)
    assert res_rupay.decision == InterventionType.BLOCK
    assert res_rupay.reason_code == "NETWORK_RETRY_CAP_REACHED"


def test_safety_gate_idempotency_lock():
    ctx = RecoveryCase(
        payment_id="p_idem_1",
        customer_id="c_idem",
        amount_inr=1000.0,
        error_code="insufficient_funds",
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="TRANSIENT_FAILURE",
        policy_id="test",
    )

    day = "2026-09-02"
    first_run = SafetyGate.evaluate(ctx, proposed, day=day)
    assert first_run.eligibility == "ALLOWED"

    # Duplicate on same day
    duplicate_run = SafetyGate.evaluate(ctx, proposed, day=day)
    assert duplicate_run.decision == InterventionType.BLOCK
    assert duplicate_run.eligibility == "BLOCKED"
    assert duplicate_run.reason_code == "IDEMPOTENCY_DUPLICATE_EVENT"

    # Different day -> ALLOWED (within budget)
    next_day_run = SafetyGate.evaluate(ctx, proposed, day="2026-09-03")
    assert next_day_run.eligibility == "ALLOWED"


def test_safety_gate_customer_budget():
    customer = "cust_budget_test"
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="TRANSIENT_FAILURE",
        policy_id="test",
    )

    for i in range(1, 4):
        ctx = RecoveryCase(payment_id=f"p_b_{i}", customer_id=customer, amount_inr=100.0, error_code="insufficient_funds")
        res = SafetyGate.evaluate(ctx, proposed, day=f"2026-09-0{i}")
        assert res.eligibility == "ALLOWED"

    # 4th intervention in the month -> BLOCK
    ctx_4 = RecoveryCase(payment_id="p_b_4", customer_id=customer, amount_inr=100.0, error_code="insufficient_funds")
    res_4 = SafetyGate.evaluate(ctx_4, proposed, day="2026-09-04")
    assert res_4.decision == InterventionType.BLOCK
    assert res_4.eligibility == "BLOCKED"
    assert res_4.reason_code == "CUSTOMER_BUDGET_EXCEEDED"


def test_safety_gate_detailed_evaluation():
    ctx = RecoveryCase(
        payment_id="p_detail",
        customer_id="c_detail",
        amount_inr=18000.0,
        error_code="insufficient_funds",
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="TRANSIENT_FAILURE",
        policy_id="test",
    )
    eval_res: SafetyEvaluation = SafetyGate.evaluate_detailed(ctx, proposed, day="2026-09-02")
    assert eval_res.allowed is True
    assert eval_res.final_decision == InterventionType.AFA_PAYMENT_LINK
    assert eval_res.modified_from_proposed is True
    assert eval_res.reason_code == "SAFETY_MODIFIED_AFA_LIMIT"
    assert eval_res.idempotency_key is not None
    assert eval_res.budget_count == 1


def test_safety_engine_re_export_compatibility():
    ctx = RecoveryCase(
        payment_id="p_compat",
        customer_id="c_compat",
        amount_inr=1000.0,
        error_code="fraud_flag",
        fraud_flag=True,
    )
    proposed = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="test",
        policy_id="test",
    )
    res = legacy_enforce_safety(ctx, proposed, "2026-09-02")
    assert res.decision == InterventionType.BLOCK
    assert res.reason_code == "HARD_COMPLIANCE_BLOCK"
