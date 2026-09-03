import hashlib
import pytest
from typing import Dict, Any

from backend.app.models.case import RecoveryCase, MandateState, PaymentState
from backend.app.services.pii_redact import redact_for_llm
from backend.app.services.llm import gemini_classify


# ===========================================================================
# 1. AMOUNT BUCKETING BOUNDARY TESTS
# ===========================================================================

@pytest.mark.parametrize(
    "amt, expected_bucket",
    [
        (0.0, "<5k"),
        (0, "<5k"),
        (-1.0, "<5k"),
        (-5000.0, "<5k"),
        (0.01, "<5k"),
        (100.0, "<5k"),
        (4999.0, "<5k"),
        (4999.99, "<5k"),
        (4999.999, "<5k"),
        (5000.0, "5k-15k"),
        (5000, "5k-15k"),
        (5000.01, "5k-15k"),
        (10000.0, "5k-15k"),
        (14999.99, "5k-15k"),
        (15000.0, "5k-15k"),
        (15000, "5k-15k"),
        (15000.01, "15k-100k"),
        (50000.0, "15k-100k"),
        (99999.99, "15k-100k"),
        (100000.0, "15k-100k"),
        (100000, "15k-100k"),
        (100000.01, ">100k"),
        (100001.0, ">100k"),
        (500000.0, ">100k"),
        (10000000.0, ">100k"),
    ]
)
def test_amount_bucketing_dict_amount_inr(amt, expected_bucket):
    result = redact_for_llm({"amount_inr": amt})
    assert result["amount_bucket"] == expected_bucket


@pytest.mark.parametrize(
    "amt_paise, expected_bucket",
    [
        (0, "<5k"),
        (499999, "<5k"),        # 4999.99 INR
        (500000, "5k-15k"),      # 5000.00 INR
        (1500000, "5k-15k"),     # 15000.00 INR
        (1500001, "15k-100k"),   # 15000.01 INR
        (10000000, "15k-100k"),  # 100000.00 INR
        (10000001, ">100k"),     # 100000.01 INR
    ]
)
def test_amount_bucketing_dict_paise(amt_paise, expected_bucket):
    # Test via 'amount' key
    result_amt = redact_for_llm({"amount": amt_paise})
    assert result_amt["amount_bucket"] == expected_bucket

    # Test via 'amount_paise' key
    result_paise = redact_for_llm({"amount_paise": amt_paise})
    assert result_paise["amount_bucket"] == expected_bucket


@pytest.mark.parametrize(
    "amt_inr, expected_bucket",
    [
        (0.0, "<5k"),
        (4999.99, "<5k"),
        (5000.0, "5k-15k"),
        (15000.0, "5k-15k"),
        (15000.01, "15k-100k"),
        (100000.0, "15k-100k"),
        (100000.01, ">100k"),
    ]
)
def test_amount_bucketing_payment_context(amt_inr, expected_bucket):
    ctx = RecoveryCase(
        payment_id="pay_test_bucketing",
        customer_id="cust_test_bucketing",
        amount_inr=amt_inr,
        error_code="insufficient_funds",
    )
    result = redact_for_llm(ctx)
    assert result["amount_bucket"] == expected_bucket


# ===========================================================================
# 2. PRIVACY LEAK STRESS TESTING
# ===========================================================================

def test_privacy_leak_resistance_on_dict():
    sensitive_dict = {
        "payment_id": "pay_super_secret_9999",
        "customer_id": "cust_john_doe_8888",
        "customer_name": "John Doe",
        "customer_email": "john.doe@example.com",
        "customer_phone": "+919999999999",
        "card_number": "4111222233334444",
        "card_cvv": "123",
        "amount_inr": 12345.67,
        "amount": 1234567,
        "error_code": "expired_card",
        "bank_name": "HDFC",
        "network": "Visa",
        "is_first_transaction": True,
        "metadata": {
            "customer_ssn": "987-65-4321",
            "ip_address": "192.168.1.1",
            "pre_debit_alerts_ignored": 3,
        },
        "raw_metadata": {
            "user_note": "Confidential account details",
        }
    }

    redacted = redact_for_llm(sensitive_dict)

    # Allowed keys ONLY
    allowed_keys = {
        "amount_bucket",
        "error_code",
        "is_first_transaction",
        "bank_hash",
        "network",
        "alerts_ignored",
        "pii_redacted",
    }
    assert set(redacted.keys()) == allowed_keys

    # Invariant: pii_redacted is True
    assert redacted["pii_redacted"] is True

    # Check that none of the sensitive values leaked
    sensitive_values = [
        "pay_super_secret_9999",
        "cust_john_doe_8888",
        "John Doe",
        "john.doe@example.com",
        "+919999999999",
        "4111222233334444",
        "123",
        "12345.67",
        "1234567",
        "HDFC",  # Raw bank name must NOT appear in any field (only hashed)
        "987-65-4321",
        "192.168.1.1",
        "Confidential account details",
    ]

    for val in sensitive_values:
        for k, v in redacted.items():
            assert str(val) not in str(v), f"PII Leak detected! Key '{k}' contains sensitive value '{val}'"


def test_privacy_leak_resistance_on_payment_context():
    ctx = RecoveryCase(
        payment_id="pay_secret_context_111",
        customer_id="cust_secret_context_222",
        amount_inr=75000.50,
        error_code="card_declined",
        bank_name="State Bank of India",
        network="Mastercard",
        alerts_ignored=2,
        is_first_transaction=False,
        metadata={"user_phone": "9876543210", "bank_account": "1234567890"},
        raw_metadata={"raw_key": "raw_sensitive_value"},
    )

    redacted = redact_for_llm(ctx)

    allowed_keys = {
        "amount_bucket",
        "error_code",
        "is_first_transaction",
        "bank_hash",
        "network",
        "alerts_ignored",
        "pii_redacted",
    }
    assert set(redacted.keys()) == allowed_keys
    assert redacted["pii_redacted"] is True
    assert redacted["amount_bucket"] == "15k-100k"
    assert redacted["network"] == "mastercard"
    assert redacted["alerts_ignored"] == 2
    assert redacted["is_first_transaction"] is False
    assert redacted["error_code"] == "card_declined"

    sensitive_values = [
        "pay_secret_context_111",
        "cust_secret_context_222",
        "75000.50",
        "State Bank of India",
        "9876543210",
        "1234567890",
        "raw_sensitive_value",
    ]
    for val in sensitive_values:
        for k, v in redacted.items():
            assert str(val) not in str(v), f"PII Leak detected in RecoveryCase! Key '{k}' contains '{val}'"


# ===========================================================================
# 3. HASH DETERMINISM AND ROBUSTNESS TESTS
# ===========================================================================

def test_bank_hash_determinism():
    banks = [
        "State Bank of India",
        "HDFC",
        "ICICI",
        "Axis Bank",
        "Kotak Mahindra",
        "Punjab National Bank",
        "Bank of Baroda",
        "Canara Bank",
        "Union Bank",
        "IndusInd Bank",
        "YES Bank",
    ]

    for bank in banks:
        expected_hash = hashlib.sha256(bank.encode("utf-8")).hexdigest()[:8]
        assert len(expected_hash) == 8

        # Test repeatability (10 iterations)
        for _ in range(10):
            res_dict = redact_for_llm({"bank_name": bank})
            assert res_dict["bank_hash"] == expected_hash

            ctx = RecoveryCase(
                payment_id="pay_h",
                customer_id="cust_h",
                amount_inr=100.0,
                error_code="err",
                bank_name=bank,
            )
            res_ctx = redact_for_llm(ctx)
            assert res_ctx["bank_hash"] == expected_hash


def test_bank_hash_uniqueness_across_major_banks():
    banks = [
        "State Bank of India",
        "HDFC",
        "ICICI",
        "Axis Bank",
        "Kotak Mahindra",
        "Punjab National Bank",
        "Bank of Baroda",
        "Canara Bank",
        "Union Bank",
        "IndusInd Bank",
        "YES Bank",
    ]
    hashes = set()
    for bank in banks:
        h = redact_for_llm({"bank_name": bank})["bank_hash"]
        assert len(h) == 8
        hashes.add(h)
    assert len(hashes) == len(banks), "Collision detected in 8-char SHA-256 bank hashes!"


def test_bank_hash_fallback_for_none_and_empty():
    unknown_hash = hashlib.sha256(b"unknown").hexdigest()[:8]

    # None bank_name in dict
    r1 = redact_for_llm({"bank_name": None})
    assert r1["bank_hash"] == unknown_hash

    # Missing bank_name in dict
    r2 = redact_for_llm({})
    assert r2["bank_hash"] == unknown_hash

    # None bank_name in RecoveryCase
    ctx_none = RecoveryCase(
        payment_id="pay_n",
        customer_id="cust_n",
        amount_inr=10.0,
        error_code="err",
        bank_name=None,
    )
    r3 = redact_for_llm(ctx_none)
    assert r3["bank_hash"] == unknown_hash


# ===========================================================================
# 4. DEFENSIVE GUARDS AND EXCEPTION TESTING
# ===========================================================================

def test_defensive_exception_on_unredacted_data():
    unredacted_cases = [
        {"pii_redacted": False, "amount": 1000},
        {"pii_redacted": None, "amount": 1000},
        {"pii_redacted": 0, "amount": 1000},
        {"pii_redacted": "", "amount": 1000},
        {"amount": 1000},
        {},
    ]
    for case in unredacted_cases:
        with pytest.raises(ValueError, match="FATAL: Unredacted PII sent to LLM. Execution blocked."):
            gemini_classify(case)


def test_type_error_on_invalid_input_types():
    invalid_inputs = [
        None,
        12345,
        "string_payload",
        [{"payment_id": "pay_1"}],
        ("tuple", 123),
        True,
    ]
    for inp in invalid_inputs:
        with pytest.raises(TypeError, match="Expected dict or RecoveryCase"):
            redact_for_llm(inp)


# ===========================================================================
# 5. SCHEMA CONFORMANCE ACROSS DICT AND PAYMENTCONTEXT
# ===========================================================================

def test_schema_conformance_between_dict_and_model():
    dict_input = {
        "amount_inr": 25000.0,
        "error_code": "mandate_revoked",
        "is_first_transaction": True,
        "bank_name": "ICICI",
        "network": "Visa",
        "alerts_ignored": 2,
    }

    ctx_input = RecoveryCase(
        payment_id="pay_conformance",
        customer_id="cust_conformance",
        amount_inr=25000.0,
        error_code="mandate_revoked",
        is_first_transaction=True,
        bank_name="ICICI",
        network="Visa",
        alerts_ignored=2,
    )

    redacted_dict = redact_for_llm(dict_input)
    redacted_ctx = redact_for_llm(ctx_input)

    assert redacted_dict == redacted_ctx
    assert redacted_dict == {
        "amount_bucket": "15k-100k",
        "error_code": "mandate_revoked",
        "is_first_transaction": True,
        "bank_hash": hashlib.sha256(b"ICICI").hexdigest()[:8],
        "network": "visa",
        "alerts_ignored": 2,
        "pii_redacted": True,
    }


def test_pii_redact_with_non_dict_metadata():
    # When metadata is a non-dict (e.g. string or None)
    res = redact_for_llm({"amount_inr": 1000.0, "metadata": "not_a_dict", "bank_name": "Axis Bank"})
    assert res["bank_hash"] == hashlib.sha256(b"Axis Bank").hexdigest()[:8]
    assert res["amount_bucket"] == "<5k"



