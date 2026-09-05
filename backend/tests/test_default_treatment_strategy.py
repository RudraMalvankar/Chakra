"""Tests specifically verifying the 5 default treatment strategy mappings:
1. INSUFFICIENT_FUNDS -> wait / retry later -> payment reminder -> payment link if appropriate
2. BANK TIMEOUT / TRANSIENT NETWORK -> retry later -> respect retry/cooldown limits
3. EXPIRED CARD -> payment link / update payment method -> avoid blind retrying the same instrument
4. FRAUD -> STOP -> BLOCK -> ESCALATE
5. MANDATE REVOKED -> STOP automatic retry -> BLOCK -> ESCALATE / customer remediation
"""
import pytest
from backend.app.models.case import RecoveryCase, CaseType, InterventionType
from backend.app.models.mandate import MandateState
from backend.app.services.mandate_router import MandateRouter
from backend.app.services.recovery_agent import RecoveryAgent
from backend.app.services.safety_gate import SafetyGate
from backend.app.lib.config_utils import get_recovery_policy


def test_recovery_policy_yaml_contains_default_treatment_strategy():
    policy = get_recovery_policy()
    assert "default_treatment_strategy" in policy or "rules" in policy


def test_insufficient_funds_strategy_progression():
    """INSUFFICIENT_FUNDS: wait / retry later -> payment reminder -> payment link if appropriate"""
    # 1. Attempt 0: wait / retry later (24h cooldown)
    ctx_attempt_0 = RecoveryCase(
        payment_id="p_nsf_0",
        amount_inr=2500.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
        retry_count=0,
    )
    dec_0 = MandateRouter.route(ctx_attempt_0)
    assert dec_0.decision == InterventionType.RETRY_LATER
    assert dec_0.delay_hours == 24

    # 2. Attempt 1: payment reminder notice
    ctx_attempt_1 = RecoveryCase(
        payment_id="p_nsf_1",
        amount_inr=2500.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
        retry_count=1,
    )
    dec_1 = MandateRouter.route(ctx_attempt_1)
    assert dec_1.decision == InterventionType.REMINDER

    # 3. Attempt 2: alternative payment link
    ctx_attempt_2 = RecoveryCase(
        payment_id="p_nsf_2",
        amount_inr=2500.0,
        error_code="insufficient_funds",
        mandate_state=MandateState.ACTIVE,
        retry_count=2,
    )
    dec_2 = MandateRouter.route(ctx_attempt_2)
    assert dec_2.decision == InterventionType.PAYMENT_LINK


def test_bank_timeout_transient_network_strategy():
    """BANK TIMEOUT / TRANSIENT NETWORK: retry later -> respect retry/cooldown limits"""
    # Normal transient error with cooldown 1 hour
    ctx_timeout = RecoveryCase(
        payment_id="p_tout_1",
        amount_inr=1500.0,
        error_code="payment_timed_out",
        mandate_state=MandateState.ACTIVE,
        retry_count=1,
    )
    dec = MandateRouter.route(ctx_timeout)
    assert dec.decision == InterventionType.RETRY_LATER
    assert dec.delay_hours == 1

    # Respect retry limits: retry_count >= 3 forces ESCALATE
    ctx_limit_exceeded = RecoveryCase(
        payment_id="p_tout_cap",
        amount_inr=1500.0,
        error_code="payment_timed_out",
        mandate_state=MandateState.ACTIVE,
        retry_count=3,
    )
    dec_cap = MandateRouter.route(ctx_limit_exceeded)
    assert dec_cap.decision == InterventionType.ESCALATE
    assert dec_cap.requires_human is True


def test_expired_card_strategy():
    """EXPIRED CARD: payment link / update payment method -> avoid blind retrying the same instrument"""
    ctx_expired = RecoveryCase(
        payment_id="p_exp_1",
        amount_inr=1200.0,
        error_code="expired_card",
        mandate_state=MandateState.ACTIVE,
    )
    dec = MandateRouter.route(ctx_expired)
    assert dec.decision == InterventionType.PAYMENT_LINK
    assert dec.template_id == "dlt_card_update_v1"

    # In RecoveryAgent, retrying the same instrument must be marked ineligible
    agent_dec = RecoveryAgent.decide(ctx_expired)
    assert agent_dec.selected_action == "PAYMENT_LINK"
    for cand in agent_dec.candidate_actions:
        if cand.action in ["RETRY_NOW", "RETRY_LATER"]:
            assert not cand.eligible
            assert cand.score < -900000


def test_fraud_strategy():
    """FRAUD: STOP -> BLOCK -> ESCALATE"""
    ctx_fraud = RecoveryCase(
        payment_id="p_fraud_1",
        amount_inr=5000.0,
        error_code="fraud_flag",
        fraud_flag=True,
    )
    # 1. Router produces BLOCK with escalation
    dec = MandateRouter.route(ctx_fraud)
    assert dec.decision == InterventionType.BLOCK
    assert dec.requires_human is True

    # 2. SafetyGate enforces BLOCK
    safe = SafetyGate.evaluate(ctx_fraud, dec)
    assert safe.decision == InterventionType.BLOCK
    assert safe.eligibility == "BLOCKED"


def test_mandate_revoked_strategy():
    """MANDATE REVOKED: STOP automatic retry -> BLOCK -> ESCALATE / customer remediation"""
    ctx_revoked = RecoveryCase(
        payment_id="p_rev_1",
        amount_inr=3500.0,
        error_code="mandate_revoked",
        mandate_state=MandateState.REVOKED,
    )
    # 1. Router produces BLOCK
    dec = MandateRouter.route(ctx_revoked)
    assert dec.decision == InterventionType.BLOCK
    assert "MANDATE_REVOKED" in dec.reason_code

    # 2. SafetyGate enforces BLOCK
    safe = SafetyGate.evaluate(ctx_revoked, dec)
    assert safe.decision == InterventionType.BLOCK
    assert safe.eligibility == "BLOCKED"
