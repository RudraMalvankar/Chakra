import hashlib
import json
import pytest
from pathlib import Path

from backend.app.models.mandate import MandateState, Mandate
from backend.app.models.payment import (
    PaymentState,
    InterventionType,
    PaymentContext,
    TriageResult,
    RecoveryDecision,
    SafetyEvaluation,
    OutcomeResult,
)
import backend.app.schemas.state as compat_schemas
from backend.app.services.context_builder import ContextBuilder, build_context
from backend.app.services.pii_redact import redact_for_llm
from backend.app.services.llm import gemini_classify


# ---------------------------------------------------------------------------
# 1. Models and Enums Verification
# ---------------------------------------------------------------------------

def test_mandate_state_enum():
    assert MandateState.NEW == "NEW"
    assert MandateState.ACTIVE == "ACTIVE"
    assert MandateState.REISSUED == "REISSUED"
    assert MandateState.REVOKED == "REVOKED"
    assert MandateState.UNKNOWN == "UNKNOWN"


def test_mandate_model_instantiation():
    m = Mandate(
        mandate_id="mandate_123",
        customer_id="cust_456",
        state=MandateState.ACTIVE,
        network="visa",
        max_amount_inr=15000.0,
        created_at="2026-01-01T00:00:00Z",
    )
    assert m.mandate_id == "mandate_123"
    assert m.customer_id == "cust_456"
    assert m.state == MandateState.ACTIVE
    assert m.network == "visa"
    assert m.max_amount_inr == 15000.0
    assert m.revoked_at is None

    # Test serialization and deserialization
    data = m.model_dump()
    assert data["state"] == "ACTIVE"
    m_reconstructed = Mandate(**data)
    assert m_reconstructed == m


def test_payment_state_and_intervention_enums():
    assert PaymentState.RECEIVED == "RECEIVED"
    assert PaymentState.FAILED == "FAILED"
    assert PaymentState.TRIAGED == "TRIAGED"
    assert PaymentState.SAFETY_CHECK == "SAFETY_CHECK"
    assert PaymentState.ELIGIBLE == "ELIGIBLE"
    assert PaymentState.BLOCKED == "BLOCKED"
    assert PaymentState.INTERVENTION_SELECTED == "INTERVENTION_SELECTED"
    assert PaymentState.INTERVENTION_ATTEMPTED == "INTERVENTION_ATTEMPTED"
    assert PaymentState.RECOVERY_PENDING == "RECOVERY_PENDING"
    assert PaymentState.RECOVERED == "RECOVERED"
    assert PaymentState.RECOVERY_FAILED == "RECOVERY_FAILED"
    assert PaymentState.ESCALATED == "ESCALATED"

    assert InterventionType.RETRY_NOW == "RETRY_NOW"
    assert InterventionType.RETRY_LATER == "RETRY_LATER"
    assert InterventionType.PAYMENT_LINK == "PAYMENT_LINK"
    assert InterventionType.AFA_PAYMENT_LINK == "AFA_PAYMENT_LINK"
    assert InterventionType.ESCALATE == "ESCALATE"
    assert InterventionType.BLOCK == "BLOCK"


def test_triage_result_action_property():
    t_retry_now = TriageResult(error_code="test", recommended_action=InterventionType.RETRY_NOW)
    assert t_retry_now.action == "retry"

    t_retry_later = TriageResult(error_code="test", recommended_action=InterventionType.RETRY_LATER)
    assert t_retry_later.action == "retry"

    t_link = TriageResult(error_code="test", recommended_action=InterventionType.PAYMENT_LINK)
    assert t_link.action == "send_payment_link"

    t_afa_link = TriageResult(error_code="test", recommended_action=InterventionType.AFA_PAYMENT_LINK)
    assert t_afa_link.action == "send_payment_link"

    t_block = TriageResult(error_code="test", recommended_action=InterventionType.BLOCK)
    assert t_block.action == "block"

    t_esc = TriageResult(error_code="test", recommended_action=InterventionType.ESCALATE)
    assert t_esc.action == "escalate"


def test_recovery_decision_and_safety_evaluation_models():
    rd = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="PENDING_SAFETY",
        reason_code="TRANSIENT_FAILURE",
        policy_id="test_pol_1",
        confidence=0.95,
        requires_human=False,
        delay_hours=24,
        template_id="dlt_upi_alternate_v1",
    )
    assert rd.decision == InterventionType.RETRY_LATER
    assert rd.delay_hours == 24

    se = SafetyEvaluation(
        allowed=True,
        final_decision=InterventionType.RETRY_LATER,
        decision=InterventionType.RETRY_LATER,
        eligibility="ALLOWED",
        reason_code="SAFETY_PASSED",
        idempotency_key="abc123hash",
        budget_count=1,
    )
    assert se.allowed is True
    assert se.eligibility == "ALLOWED"
    assert se.idempotency_key == "abc123hash"


def test_outcome_result_model():
    out = OutcomeResult(
        payment_id="pay_999",
        status="captured",
        recovered=True,
        amount_recovered_inr=1500.0,
        raw_response={"id": "pay_999", "status": "captured"},
    )
    assert out.payment_id == "pay_999"
    assert out.recovered is True
    assert out.amount_recovered_inr == 1500.0


def test_schemas_compatibility_reexport():
    assert compat_schemas.MandateState is MandateState
    assert compat_schemas.Mandate is Mandate
    assert compat_schemas.PaymentState is PaymentState
    assert compat_schemas.InterventionType is InterventionType
    assert compat_schemas.PaymentContext is PaymentContext
    assert compat_schemas.TriageResult is TriageResult
    assert compat_schemas.RecoveryDecision is RecoveryDecision
    assert compat_schemas.SafetyEvaluation is SafetyEvaluation
    assert compat_schemas.OutcomeResult is OutcomeResult


# ---------------------------------------------------------------------------
# 2. ContextBuilder Tests
# ---------------------------------------------------------------------------

def test_context_builder_nested_razorpay_webhook():
    webhook_payload = {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_nested_001",
                    "customer_id": "cust_nested_001",
                    "amount": 1600000,
                    "currency": "INR",
                    "error_code": "insufficient_funds",
                    "is_first_transaction": False,
                    "metadata": {
                        "bank_name": "HDFC",
                        "network": "Visa",
                        "retries_this_month": 2,
                        "pre_debit_alerts_ignored": 1,
                        "mandate_state": "ACTIVE",
                        "mandate_id": "mand_001",
                    },
                }
            }
        },
    }

    ctx = ContextBuilder.build_context(webhook_payload)
    assert isinstance(ctx, PaymentContext)
    assert ctx.payment_id == "pay_nested_001"
    assert ctx.customer_id == "cust_nested_001"
    assert ctx.amount_inr == 16000.0  # 1600000 / 100
    assert ctx.error_code == "insufficient_funds"
    assert ctx.mandate_state == MandateState.ACTIVE
    assert ctx.mandate_id == "mand_001"
    assert ctx.network == "visa"
    assert ctx.retry_count == 2
    assert ctx.alerts_ignored == 1
    assert ctx.bank_name == "HDFC"
    assert ctx.fraud_flag is False
    assert ctx.current_state == PaymentState.RECEIVED


def test_context_builder_mock_seed_format():
    seed_item = {
        "payment_id": "pay_Mck_002",
        "subscription_id": "sub_Mck_002",
        "amount": 1600000,
        "currency": "INR",
        "customer_id": "cust_002",
        "error_code": "insufficient_funds",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "SBI",
            "network": "mastercard",
            "retries_this_month": 1,
        },
    }

    ctx = build_context(seed_item)
    assert ctx.payment_id == "pay_Mck_002"
    assert ctx.mandate_id == "sub_Mck_002"
    assert ctx.customer_id == "cust_002"
    assert ctx.amount_inr == 16000.0
    assert ctx.network == "mastercard"
    assert ctx.retry_count == 1
    assert ctx.bank_name == "SBI"


def test_context_builder_customer_id_fallback():
    # When customer_id is missing, it falls back to cust_<payment_id>
    payload = {
        "payment_id": "pay_eval_no_cust",
        "amount": 50000,
        "error_code": "card_declined",
    }
    ctx = ContextBuilder.build_context(payload)
    assert ctx.customer_id == "cust_pay_eval_no_cust"
    assert ctx.amount_inr == 500.0


def test_context_builder_fraud_flag_and_revocation_inference():
    # Inferred fraud
    fraud_payload = {
        "id": "pay_fraud_1",
        "amount": 10000,
        "error_code": "fraud_flag",
    }
    ctx_fraud = ContextBuilder.build_context(fraud_payload)
    assert ctx_fraud.fraud_flag is True
    assert ctx_fraud.error_code == "fraud_flag"

    # Inferred mandate revoked
    revoked_payload = {
        "id": "pay_revoked_1",
        "amount": 20000,
        "error_code": "mandate_revoked",
    }
    ctx_revoked = ContextBuilder.build_context(revoked_payload)
    assert ctx_revoked.mandate_state == MandateState.REVOKED
    assert ctx_revoked.error_code == "mandate_revoked"


def test_context_builder_idempotence():
    ctx_orig = PaymentContext(
        payment_id="pay_direct",
        customer_id="cust_direct",
        amount_inr=150.0,
        error_code="test_err",
    )
    ctx_built = ContextBuilder.build_context(ctx_orig)
    assert ctx_built is ctx_orig


def test_context_builder_all_eval_cases():
    eval_file = Path(__file__).parent.parent / "eval" / "labeled_cases.json"
    if eval_file.exists():
        with open(eval_file, "r") as f:
            data = json.load(f)
        for case in data.get("cases", []):
            ctx = ContextBuilder.build_context(case["payment"])
            assert isinstance(ctx, PaymentContext)
            assert ctx.payment_id != ""
            assert ctx.amount_inr >= 0.0
            assert ctx.customer_id != ""


def test_context_builder_corrupted_entity_payloads():
    # Defensively handle None entity or non-dict entity
    res_none = ContextBuilder.build_context({"payload": {"payment": {"entity": None}}})
    assert isinstance(res_none, PaymentContext)
    assert res_none.payment_id == "unknown"

    res_str = ContextBuilder.build_context({"payload": {"payment": {"entity": "corrupted"}}})
    assert isinstance(res_str, PaymentContext)

    res_int = ContextBuilder.build_context({"payment": {"entity": 99999}})
    assert isinstance(res_int, PaymentContext)


def test_context_builder_safe_numeric_and_zero_preservation():
    # Explicit 0 should not be overridden by metadata
    ctx_zero = ContextBuilder.build_context({
        "retry_count": 0,
        "alerts_ignored": 0,
        "metadata": {
            "retries_this_month": 5,
            "pre_debit_alerts_ignored": 3,
        }
    })
    assert ctx_zero.retry_count == 0
    assert ctx_zero.alerts_ignored == 0

    # Non-numeric string should safely fallback to 0
    ctx_invalid = ContextBuilder.build_context({
        "retry_count": "invalid",
        "alerts_ignored": "n/a",
    })
    assert ctx_invalid.retry_count == 0
    assert ctx_invalid.alerts_ignored == 0


# ---------------------------------------------------------------------------
# 3. PII Redaction Tests
# ---------------------------------------------------------------------------

def test_pii_redact_with_payment_context():
    ctx = PaymentContext(
        payment_id="pay_secret_123",
        customer_id="cust_secret_456",
        amount_inr=16000.0,
        error_code="insufficient_funds",
        bank_name="SBI",
        network="visa",
        alerts_ignored=1,
        is_first_transaction=False,
    )

    redacted = redact_for_llm(ctx)
    assert redacted["pii_redacted"] is True
    assert redacted["amount_bucket"] == "15k-100k"
    assert redacted["error_code"] == "insufficient_funds"
    assert redacted["network"] == "visa"
    assert redacted["alerts_ignored"] == 1
    assert redacted["is_first_transaction"] is False
    assert redacted["bank_hash"] == hashlib.sha256(b"SBI").hexdigest()[:8]

    # Confirm PII fields are stripped
    assert "payment_id" not in redacted
    assert "customer_id" not in redacted
    assert "amount_inr" not in redacted
    assert "amount" not in redacted
    assert "bank_name" not in redacted


def test_pii_redact_with_dict():
    payment_dict = {
        "payment_id": "pay_dict_123",
        "customer_id": "cust_dict_456",
        "amount": 49900,  # 499 INR
        "error_code": "card_declined",
        "is_first_transaction": True,
        "metadata": {
            "bank_name": "HDFC",
            "network": "mastercard",
            "pre_debit_alerts_ignored": 2,
        },
    }

    redacted = redact_for_llm(payment_dict)
    assert redacted["pii_redacted"] is True
    assert redacted["amount_bucket"] == "<5k"
    assert redacted["error_code"] == "card_declined"
    assert redacted["network"] == "mastercard"
    assert redacted["alerts_ignored"] == 2
    assert redacted["is_first_transaction"] is True
    assert redacted["bank_hash"] == hashlib.sha256(b"HDFC").hexdigest()[:8]
    assert "payment_id" not in redacted
    assert "customer_id" not in redacted


def test_pii_redact_safe_handling_none_and_corrupted_alerts():
    # None alerts in metadata
    redacted_none = redact_for_llm({
        "amount": 5000,
        "metadata": {
            "pre_debit_alerts_ignored": None,
        }
    })
    assert redacted_none["alerts_ignored"] == 0
    assert redacted_none["pii_redacted"] is True

    # Corrupted string alerts
    redacted_str = redact_for_llm({
        "amount_inr": 200.0,
        "alerts_ignored": "none",
    })
    assert redacted_str["alerts_ignored"] == 0
    assert redacted_str["pii_redacted"] is True


def test_pii_redact_amount_bucketing_ranges():
    # < 5k
    r1 = redact_for_llm({"amount_inr": 4999.99})
    assert r1["amount_bucket"] == "<5k"

    # 5k - 15k
    r2 = redact_for_llm({"amount_inr": 5000.0})
    assert r2["amount_bucket"] == "5k-15k"
    r3 = redact_for_llm({"amount_inr": 15000.0})
    assert r3["amount_bucket"] == "5k-15k"

    # 15k - 100k
    r4 = redact_for_llm({"amount_inr": 15000.01})
    assert r4["amount_bucket"] == "15k-100k"
    r5 = redact_for_llm({"amount_inr": 100000.0})
    assert r5["amount_bucket"] == "15k-100k"

    # > 100k
    r6 = redact_for_llm({"amount_inr": 100000.01})
    assert r6["amount_bucket"] == ">100k"


def test_llm_guard_raises_on_unredacted_data():
    raw_unredacted = {
        "payment_id": "pay_123",
        "amount": 50000,
        "pii_redacted": False,
    }
    with pytest.raises(ValueError, match="FATAL: Unredacted PII sent to LLM"):
        gemini_classify(raw_unredacted)

    missing_flag = {
        "payment_id": "pay_123",
        "amount": 50000,
    }
    with pytest.raises(ValueError, match="FATAL: Unredacted PII sent to LLM"):
        gemini_classify(missing_flag)
