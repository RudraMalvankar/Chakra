import hashlib
import pytest
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
from backend.app.services.context_builder import ContextBuilder, build_context
from backend.app.services.pii_redact import redact_for_llm


class TestAdversarialBugsAndVulnerabilities:
    """Tests verifying remediation of empirical failure modes found during adversarial stress testing."""

    # --- FIX 1: None or non-dict entity unwrapping safe handling in ContextBuilder ---
    def test_entity_none_attribute_error(self):
        payload = {"payload": {"payment": {"entity": None}}}
        ctx = ContextBuilder.build_context(payload)
        assert isinstance(ctx, PaymentContext)
        assert ctx.payment_id == "unknown"
        assert ctx.amount_inr == 0.0
        assert ctx.retry_count == 0
        assert ctx.alerts_ignored == 0

    def test_entity_string_attribute_error(self):
        payload = {"payload": {"payment": {"entity": "corrupted_payload"}}}
        ctx = ContextBuilder.build_context(payload)
        assert isinstance(ctx, PaymentContext)
        assert ctx.payment_id == "unknown"

    def test_payment_entity_int_attribute_error(self):
        payload = {"payment": {"entity": 12345}}
        ctx = ContextBuilder.build_context(payload)
        assert isinstance(ctx, PaymentContext)
        assert ctx.payment_id == "unknown"

    # --- FIX 2: pii_redact safe handling on metadata pre_debit_alerts_ignored = None / non-int ---
    def test_pii_redact_metadata_none_alerts_type_error(self):
        payload = {
            "amount": 5000,
            "metadata": {
                "pre_debit_alerts_ignored": None,
            },
        }
        redacted = redact_for_llm(payload)
        assert redacted["alerts_ignored"] == 0
        assert redacted["pii_redacted"] is True

    def test_pii_redact_metadata_non_numeric_alerts(self):
        payload = {
            "amount": 5000,
            "metadata": {
                "pre_debit_alerts_ignored": "corrupted_val",
            },
        }
        redacted = redact_for_llm(payload)
        assert redacted["alerts_ignored"] == 0
        assert redacted["pii_redacted"] is True

    # --- FIX 3: ContextBuilder retry_count / alerts_ignored non-numeric safe fallback ---
    def test_context_builder_non_numeric_retry_value_error(self):
        payload = {"retry_count": "invalid_number", "alerts_ignored": "invalid_alerts"}
        ctx = ContextBuilder.build_context(payload)
        assert ctx.retry_count == 0
        assert ctx.alerts_ignored == 0

    # --- FIX 4: Explicit 0 preservation (not overridden by falsy fallback) ---
    def test_context_builder_zero_falsy_override_bug(self):
        payload = {
            "retry_count": 0,
            "metadata": {
                "retries_this_month": 5,
            },
        }
        ctx = ContextBuilder.build_context(payload)
        # Explicit 0 must NOT be overridden by fallback in metadata
        assert ctx.retry_count == 0

    def test_context_builder_alerts_zero_falsy_override(self):
        payload = {
            "alerts_ignored": 0,
            "metadata": {
                "pre_debit_alerts_ignored": 3,
            },
        }
        ctx = ContextBuilder.build_context(payload)
        assert ctx.alerts_ignored == 0


class TestAdversarialStressAndNormalizations:
    """Stress testing normalization, boundaries, and schema integrity."""

    def test_empty_payload_safe_fallback(self):
        ctx = ContextBuilder.build_context({})
        assert isinstance(ctx, PaymentContext)
        assert ctx.payment_id == "unknown"
        assert ctx.customer_id == "unknown"
        assert ctx.amount_inr == 0.0
        assert ctx.error_code == "unknown"
        assert ctx.mandate_state == MandateState.UNKNOWN
        assert ctx.network == "unknown"
        assert ctx.retry_count == 0
        assert ctx.alerts_ignored == 0
        assert ctx.fraud_flag is False
        assert ctx.current_state == PaymentState.RECEIVED

    def test_amount_bucketing_and_extreme_amounts(self):
        # Negative amount
        ctx_neg = build_context({"amount_inr": -100.0})
        assert ctx_neg.amount_inr == -100.0
        assert redact_for_llm(ctx_neg)["amount_bucket"] == "<5k"

        # Exact boundary values for 4-tier bucketing
        assert redact_for_llm({"amount_inr": 0.0})["amount_bucket"] == "<5k"
        assert redact_for_llm({"amount_inr": 4999.99})["amount_bucket"] == "<5k"
        assert redact_for_llm({"amount_inr": 5000.00})["amount_bucket"] == "5k-15k"
        assert redact_for_llm({"amount_inr": 15000.00})["amount_bucket"] == "5k-15k"
        assert redact_for_llm({"amount_inr": 15000.01})["amount_bucket"] == "15k-100k"
        assert redact_for_llm({"amount_inr": 100000.00})["amount_bucket"] == "15k-100k"
        assert redact_for_llm({"amount_inr": 100000.01})["amount_bucket"] == ">100k"
        assert redact_for_llm({"amount_inr": 1e9})["amount_bucket"] == ">100k"

    def test_string_numbers_coercion(self):
        ctx = build_context({
            "payment_id": "pay_str_1",
            "amount_inr": "5432.10",
            "retry_count": "3",
            "alerts_ignored": "2",
        })
        assert ctx.amount_inr == 5432.10
        assert ctx.retry_count == 3
        assert ctx.alerts_ignored == 2

    def test_mandate_state_resilience(self):
        assert build_context({"mandate_state": "ACTIVE"}).mandate_state == MandateState.ACTIVE
        assert build_context({"mandate_state": " active "}).mandate_state == MandateState.ACTIVE
        assert build_context({"mandate_state": "reissued"}).mandate_state == MandateState.REISSUED
        assert build_context({"mandate_state": "REVOKED"}).mandate_state == MandateState.REVOKED
        assert build_context({"mandate_state": "NEW"}).mandate_state == MandateState.NEW
        assert build_context({"mandate_state": "INVALID_STATE"}).mandate_state == MandateState.UNKNOWN
        assert build_context({"error_code": "mandate_revoked"}).mandate_state == MandateState.REVOKED

    def test_pii_complete_redaction(self):
        raw_sensitive = {
            "payment_id": "pay_leak_check",
            "customer_id": "cust_leak_check",
            "customer_name": "Test User",
            "card_number": "4111-2222-3333-4444",
            "email": "user@test.com",
            "amount": 250000,
            "bank_name": "State Bank of India",
            "error_code": "insufficient_funds",
        }
        redacted = redact_for_llm(raw_sensitive)
        assert redacted["pii_redacted"] is True
        assert redacted["bank_hash"] == hashlib.sha256("State Bank of India".encode("utf-8")).hexdigest()[:8]
        assert "Test User" not in str(redacted)
        assert "4111-2222" not in str(redacted)
        assert "user@test.com" not in str(redacted)
        assert "cust_leak_check" not in str(redacted)
        assert "pay_leak_check" not in str(redacted)
