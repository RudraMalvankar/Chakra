"""
PII redaction for LLM-bound payloads (DPDP-oriented allowlist).

Only these coarse signals may leave redact_for_llm():
  amount_bucket, error_code, is_first_transaction, bank_hash, network,
  alerts_ignored, pii_redacted, plus optional allowlisted keys when present:
  churn_risk, fraud_risk, payment_method, retry_count, mandate_state, mandate_status.

Never forwarded: names, customer/payment IDs, phones, emails, exact amounts,
URLs, tokens, raw metadata blobs, or other identifiers/secrets.
"""
import hashlib
from typing import Dict, Any, Union
from pydantic import BaseModel
from backend.app.models.case import RecoveryCase


def _safe_int(val: Any, fallback: int = 0) -> int:
    if val is None or val == "":
        return fallback
    try:
        if isinstance(val, (int, float)):
            return int(val)
        return int(str(val).strip())
    except (ValueError, TypeError):
        try:
            return int(float(str(val).strip()))
        except (ValueError, TypeError):
            return fallback


def redact_for_llm(payment: Union[Dict[str, Any], RecoveryCase]) -> Dict[str, Any]:
    """
    Strips PII (exact amounts, names, phone numbers, customer IDs) before sending to Gemini.
    Accepts both RecoveryCase Pydantic instances and raw/seed dictionaries seamlessly.
    Guarantees DPDP Act compliance by returning `pii_redacted: True`.
    """
    # Explicit allowlist: only coarse, non-identifying decision signals leave
    # this function. Names, IDs, contact details, exact amounts, URLs, tokens,
    # and arbitrary metadata are never forwarded to the model.
    safe_context: Dict[str, Any] = {}
    if isinstance(payment, BaseModel):
        amt_inr_raw = getattr(payment, "amount_inr", 0.0)
        try:
            amt_inr = float(amt_inr_raw) if amt_inr_raw is not None else 0.0
        except (ValueError, TypeError):
            amt_inr = 0.0
        error_code = getattr(payment, "error_code", "unknown")
        is_first_transaction = bool(getattr(payment, "is_first_transaction", False))
        bank = getattr(payment, "bank_name", "unknown") or "unknown"
        network = getattr(payment, "network", "unknown") or "unknown"
        raw_alerts = getattr(payment, "alerts_ignored", 0)
        alerts_ignored = _safe_int(raw_alerts, 0)
        safe_context = {
            key: getattr(payment, key, None)
            for key in ("churn_risk", "fraud_risk", "payment_method", "retry_count", "mandate_state", "mandate_status")
        }
    elif isinstance(payment, dict):
        if "amount_inr" in payment and payment["amount_inr"] is not None:
            try:
                amt_inr = float(payment["amount_inr"])
            except (ValueError, TypeError):
                amt_inr = 0.0
        elif "amount" in payment and payment["amount"] is not None:
            try:
                amt_inr = float(payment["amount"]) / 100.0
            except (ValueError, TypeError):
                amt_inr = 0.0
        elif "amount_paise" in payment and payment["amount_paise"] is not None:
            try:
                amt_inr = float(payment["amount_paise"]) / 100.0
            except (ValueError, TypeError):
                amt_inr = 0.0
        else:
            amt_inr = 0.0

        error_code = payment.get("error_code", "unknown")
        is_first_transaction = bool(payment.get("is_first_transaction", False))
        metadata = payment.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
        bank = metadata.get("bank_name") or payment.get("bank_name", "unknown") or "unknown"
        network = metadata.get("network") or payment.get("network", "unknown") or "unknown"

        raw_alerts = None
        if "pre_debit_alerts_ignored" in metadata:
            raw_alerts = metadata.get("pre_debit_alerts_ignored")
        elif "alerts_ignored" in metadata:
            raw_alerts = metadata.get("alerts_ignored")

        if raw_alerts is None:
            raw_alerts = payment.get("alerts_ignored", 0)

        alerts_ignored = _safe_int(raw_alerts, 0)
        # Read safe signals from the top level or metadata only; metadata is
        # not copied wholesale because it may contain identifiers/secrets.
        safe_context = {
            key: payment.get(key, metadata.get(key))
            for key in ("churn_risk", "fraud_risk", "payment_method", "retry_count", "mandate_state", "mandate_status")
        }
    else:
        raise TypeError(f"Expected dict or RecoveryCase, got {type(payment)}")

    # 1. Bucket Amount (exact RBI/Chakra thresholds)
    if amt_inr < 5000:
        amt_bucket = "<5k"
    elif amt_inr <= 15000:
        amt_bucket = "5k-15k"
    elif amt_inr <= 100000:
        amt_bucket = "15k-100k"
    else:
        amt_bucket = ">100k"

    # 2. Hash Bank Name with SHA256[:8]
    bank_str = str(bank)
    bank_hash = hashlib.sha256(bank_str.encode("utf-8")).hexdigest()[:8]

    # 3. Build Safe Output Dictionary
    result = {
        "amount_bucket": amt_bucket,
        "error_code": str(error_code) if error_code is not None else "unknown",
        "is_first_transaction": is_first_transaction,
        "bank_hash": bank_hash,
        "network": str(network).lower() if network else "unknown",
        "alerts_ignored": alerts_ignored,
        "pii_redacted": True,
    }
    for key, value in safe_context.items():
        if value is not None and value != "":
            if key == "retry_count":
                value = _safe_int(value)
                if value == 0:
                    continue
            elif key in {"mandate_state", "mandate_status"}:
                value = str(value).upper()
                if value.endswith("UNKNOWN"):
                    continue
            elif key in {"churn_risk", "fraud_risk"}:
                value = str(value).upper()
            else:
                value = str(value)
            result[key] = value
    return result
