import pytest
from unittest.mock import patch, MagicMock
from backend.app.models.payment import PaymentContext, TriageResult, InterventionType
from backend.app.models.mandate import MandateState
from backend.app.services.triage import TriageEngine, triage, triage_payment
from backend.app.services.llm import gemini_classify, classify_ambiguous_error, TriageDecision


def test_deterministic_insufficient_funds():
    ctx = PaymentContext(payment_id="p1", amount_inr=1000.0, error_code="insufficient_funds")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is False
    assert res.recommended_action == InterventionType.RETRY_LATER
    assert res.reason == "insufficient_funds"
    assert res.confidence == 0.98
    assert res.delay_hours == 24
    assert res.requires_human is False
    assert res.action == "retry"


def test_deterministic_timeout():
    ctx = PaymentContext(payment_id="p2", amount_inr=500.0, error_code="payment_timed_out")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is False
    assert res.recommended_action == InterventionType.RETRY_LATER
    assert res.reason == "transient_timeout"
    assert res.confidence == 0.95
    assert res.delay_hours == 1
    assert res.requires_human is False
    assert res.action == "retry"

    # Variations
    for code in ["timed_out", "timeout"]:
        ctx2 = PaymentContext(payment_id="p2_var", amount_inr=500.0, error_code=code)
        res2 = TriageEngine.triage(ctx2)
        assert res2.recommended_action == InterventionType.RETRY_LATER
        assert res2.delay_hours == 1


def test_deterministic_expired_card():
    ctx = PaymentContext(payment_id="p3", amount_inr=999.0, error_code="expired_card")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is False
    assert res.recommended_action == InterventionType.PAYMENT_LINK
    assert res.reason == "expired_card"
    assert res.confidence == 0.99
    assert res.template_id == "dlt_card_update_v1"
    assert res.requires_human is False
    assert res.action == "send_payment_link"


def test_deterministic_card_declined():
    ctx = PaymentContext(payment_id="p4", amount_inr=1200.0, error_code="card_declined")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is False
    assert res.recommended_action == InterventionType.PAYMENT_LINK
    assert res.reason == "card_declined"
    assert res.confidence == 0.90
    assert res.template_id == "dlt_upi_alternate_v1"
    assert res.requires_human is False
    assert res.action == "send_payment_link"


def test_deterministic_fraud_and_revoked():
    ctx_fraud = PaymentContext(payment_id="p5", amount_inr=2000.0, error_code="fraud_flag", fraud_flag=True)
    res_fraud = TriageEngine.triage(ctx_fraud)
    assert res_fraud.recommended_action == InterventionType.BLOCK
    assert res_fraud.reason == "fraud_flag"
    assert res_fraud.confidence == 1.0
    assert res_fraud.action == "block"

    ctx_revoked = PaymentContext(
        payment_id="p6",
        amount_inr=2000.0,
        error_code="mandate_revoked",
        mandate_state=MandateState.REVOKED,
    )
    res_revoked = TriageEngine.triage(ctx_revoked)
    assert res_revoked.recommended_action == InterventionType.BLOCK
    assert res_revoked.reason == "mandate_revoked"
    assert res_revoked.confidence == 1.0


@patch("backend.app.services.triage.gemini_classify")
def test_ambiguous_llm_fallback_retry(mock_classify):
    mock_classify.return_value = TriageDecision(
        action="retry",
        reason="temporary_bank_network_spike",
        delay_hours=2,
        confidence=0.92,
    )
    ctx = PaymentContext(payment_id="p7", amount_inr=1500.0, error_code="bank_technical_error_503")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is True
    assert res.recommended_action == InterventionType.RETRY_LATER
    assert res.reason == "temporary_bank_network_spike"
    assert res.delay_hours == 2
    assert res.confidence == 0.92
    assert res.requires_human is False


@patch("backend.app.services.triage.gemini_classify")
def test_ambiguous_llm_fallback_payment_link(mock_classify):
    mock_classify.return_value = TriageDecision(
        action="send_payment_link",
        reason="instrument_unavailable",
        template="dlt_upi_alternate_v1",
        confidence=0.95,
    )
    ctx = PaymentContext(payment_id="p8", amount_inr=1500.0, error_code="instrument_error")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is True
    assert res.recommended_action == InterventionType.PAYMENT_LINK
    assert res.template_id == "dlt_upi_alternate_v1"
    assert res.requires_human is False


@patch("backend.app.services.triage.gemini_classify")
def test_ambiguous_llm_fallback_block(mock_classify):
    mock_classify.return_value = TriageDecision(
        action="block",
        reason="stolen_instrument_signal",
        confidence=0.99,
    )
    ctx = PaymentContext(payment_id="p8_block", amount_inr=1500.0, error_code="stolen_signal")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is True
    assert res.recommended_action == InterventionType.BLOCK
    assert res.reason == "stolen_instrument_signal"
    assert res.action == "block"


@patch("backend.app.services.triage.gemini_classify")
def test_ambiguous_llm_fallback_escalate(mock_classify):
    mock_classify.return_value = TriageDecision(
        action="escalate",
        reason="high_risk_flag",
        confidence=0.95,
    )
    ctx = PaymentContext(payment_id="p8_esc", amount_inr=1500.0, error_code="unknown_risk")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is True
    assert res.recommended_action == InterventionType.ESCALATE
    assert res.action == "escalate"


@patch("backend.app.services.triage.gemini_classify")
def test_ambiguous_llm_low_confidence_forces_escalate(mock_classify):
    mock_classify.return_value = TriageDecision(
        action="retry",
        reason="uncertain_error",
        confidence=0.75,
    )
    ctx = PaymentContext(payment_id="p9", amount_inr=1500.0, error_code="unrecognized_error_xyz")
    res = TriageEngine.triage(ctx)
    assert res.is_ambiguous is True
    assert res.recommended_action == InterventionType.ESCALATE
    assert res.requires_human is True
    assert res.confidence == 0.75


def test_unredacted_pii_raises_fatal_error():
    with pytest.raises(ValueError, match="FATAL: Unredacted PII"):
        gemini_classify({"error_code": "test", "pii_redacted": False})

    with pytest.raises(ValueError, match="FATAL: Unredacted PII"):
        gemini_classify({"error_code": "test"})


def test_llm_graceful_degradation_on_api_error():
    from backend.app.services.llm import GEMINI_AVAILABLE
    if not GEMINI_AVAILABLE:
        # Just test the fallback when it's missing
        res = gemini_classify({"error_code": "unknown_err", "pii_redacted": True})
        assert res.action == "escalate"
        assert res.reason == "llm_dependency_missing"
        assert res.confidence == 1.0
        return

    with patch("backend.app.services.llm.genai.Client") as mock_client:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = Exception("429 RESOURCE_EXHAUSTED: Rate limit exceeded")
        mock_client.return_value = mock_instance

        with patch("backend.app.config.settings.gemini_api_key", "test_key"):
            res = gemini_classify({"error_code": "unknown_err", "pii_redacted": True})
            assert res.action == "escalate"
            assert res.reason == "llm_api_failure_fallback"
            assert res.confidence == 1.0


def test_triage_convenience_functions():
    raw_payload = {
        "payment_id": "p_dict_test",
        "error_code": "insufficient_funds",
        "amount": 50000,
    }
    res = triage_payment(raw_payload)
    assert res.recommended_action == InterventionType.RETRY_LATER
    assert res.reason == "insufficient_funds"


def test_classify_ambiguous_error_alias():
    assert classify_ambiguous_error == gemini_classify


def test_triage_result_action_mapping():
    r1 = TriageResult(error_code="e1", recommended_action=InterventionType.RETRY_NOW)
    assert r1.action == "retry"
    r2 = TriageResult(error_code="e2", recommended_action=InterventionType.RETRY_LATER)
    assert r2.action == "retry"
    r3 = TriageResult(error_code="e3", recommended_action=InterventionType.PAYMENT_LINK)
    assert r3.action == "send_payment_link"
    r4 = TriageResult(error_code="e4", recommended_action=InterventionType.AFA_PAYMENT_LINK)
    assert r4.action == "send_payment_link"
    r5 = TriageResult(error_code="e5", recommended_action=InterventionType.BLOCK)
    assert r5.action == "block"
    r6 = TriageResult(error_code="e6", recommended_action=InterventionType.ESCALATE)
    assert r6.action == "escalate"
