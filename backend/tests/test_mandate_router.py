import pytest
from backend.app.models.payment import PaymentContext, TriageResult, RecoveryDecision, InterventionType
from backend.app.models.mandate import MandateState
from backend.app.services.mandate_router import MandateRouter, route, route_payment
from backend.app.services.recovery_router import route_payment as legacy_route_payment


def test_mandate_revoked_routes_to_block():
    ctx = PaymentContext(
        payment_id="p1",
        amount_inr=500.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.REVOKED,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.BLOCK
    assert decision.eligibility == "PENDING_SAFETY"
    assert decision.reason_code == "MANDATE_REVOKED_NO_RETRY"
    assert decision.policy_id == "mandate_lifecycle_v1"
    assert decision.confidence == 1.0
    assert decision.requires_human is False


def test_error_code_mandate_revoked_routes_to_block():
    ctx = PaymentContext(
        payment_id="p2",
        amount_inr=500.0,
        error_code="mandate_revoked",
        mandate_state=MandateState.ACTIVE,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.BLOCK
    assert decision.reason_code == "MANDATE_REVOKED_NO_RETRY"


def test_new_mandate_routes_to_afa_link():
    ctx = PaymentContext(
        payment_id="p3",
        amount_inr=2000.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.NEW,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.AFA_PAYMENT_LINK
    assert decision.eligibility == "PENDING_SAFETY"
    assert decision.reason_code == "NEW_MANDATE_AFA_REQUIRED"
    assert decision.template_id == "dlt_first_txn_v1"
    assert decision.requires_human is False


def test_first_transaction_routes_to_afa_link():
    ctx = PaymentContext(
        payment_id="p4",
        amount_inr=2000.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
        is_first_transaction=True,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.AFA_PAYMENT_LINK
    assert decision.reason_code == "NEW_MANDATE_AFA_REQUIRED"
    assert decision.template_id == "dlt_first_txn_v1"


def test_active_mandate_insufficient_funds_under_15k():
    ctx = PaymentContext(
        payment_id="p5",
        amount_inr=5000.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.RETRY_LATER
    assert decision.delay_hours == 24
    assert decision.reason_code == "TRANSIENT_FAILURE"
    assert decision.policy_id == "mandate_active_retry_v1"


def test_active_mandate_insufficient_funds_over_15k():
    ctx = PaymentContext(
        payment_id="p6",
        amount_inr=16000.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.AFA_PAYMENT_LINK
    assert decision.reason_code == "AFA_THRESHOLD_EXCEEDED"
    assert decision.policy_id == "regulatory_afa_v1"
    assert decision.template_id == "dlt_afa_threshold_v1"


def test_active_mandate_timeout_delay_1hr():
    ctx = PaymentContext(
        payment_id="p7",
        amount_inr=3000.0,
        error_code="payment_timed_out",
        mandate_state=MandateState.ACTIVE,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.RETRY_LATER
    assert decision.delay_hours == 1
    assert decision.reason_code == "TRANSIENT_TIMEOUT"


def test_active_mandate_expired_card_template():
    ctx = PaymentContext(
        payment_id="p8",
        amount_inr=1000.0,
        error_code="expired_card",
        mandate_state=MandateState.ACTIVE,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.PAYMENT_LINK
    assert decision.template_id == "dlt_card_update_v1"
    assert "EXPIRED_CARD" in decision.reason_code


def test_active_mandate_card_declined_template():
    ctx = PaymentContext(
        payment_id="p9",
        amount_inr=1000.0,
        error_code="card_declined",
        mandate_state=MandateState.ACTIVE,
    )
    decision = MandateRouter.route(ctx)
    assert decision.decision == InterventionType.PAYMENT_LINK
    assert decision.template_id == "dlt_upi_alternate_v1"
    assert "CARD_DECLINED" in decision.reason_code


def test_router_with_explicit_triage():
    ctx = PaymentContext(payment_id="p10", amount_inr=1000.0, error_code="custom")
    custom_triage = TriageResult(
        error_code="custom",
        is_ambiguous=True,
        recommended_action=InterventionType.ESCALATE,
        reason="high_risk_flag",
        confidence=0.6,
        requires_human=True,
    )
    decision = MandateRouter.route(ctx, triage=custom_triage)
    assert decision.decision == InterventionType.ESCALATE
    assert decision.requires_human is True
    assert decision.reason_code == "high_risk_flag"


def test_recovery_router_backward_compatibility():
    ctx = PaymentContext(
        payment_id="p11",
        amount_inr=1000.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
    )
    dec1 = route(ctx)
    dec2 = legacy_route_payment(ctx)
    assert dec1.decision == dec2.decision
    assert dec1.reason_code == dec2.reason_code
