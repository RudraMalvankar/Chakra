from typing import Dict, Any, Union
from backend.app.models.payment import PaymentContext, PaymentState
from backend.app.models.mandate import MandateState


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


def _safe_float(val: Any, fallback: float = 0.0) -> float:
    if val is None or val == "":
        return fallback
    try:
        return float(val)
    except (ValueError, TypeError):
        return fallback


class ContextBuilder:
    @staticmethod
    def build_context(payload: Union[Dict[str, Any], Any]) -> PaymentContext:
        """
        Normalizes heterogeneous raw webhook events, mock seed records, eval cases,
        and flat dictionaries into a typed, validated PaymentContext.
        """
        if isinstance(payload, PaymentContext):
            return payload

        if not isinstance(payload, dict):
            # If an arbitrary object with dict attributes is passed
            if hasattr(payload, "model_dump"):
                payload = payload.model_dump()
            elif hasattr(payload, "__dict__"):
                payload = payload.__dict__
            else:
                raise TypeError(f"Expected dict or PaymentContext, got {type(payload)}")

        # Unpack nested webhook structure if present
        # Pattern 1: {"payload": {"payment": {"entity": {...}}}}
        # Pattern 2: {"payload": {"payment": {...}}}
        # Pattern 3: {"payload": {...}}
        # Pattern 4: {"payment": {"entity": {...}}}
        # Pattern 5: {"payment": {...}}
        # Pattern 6: Flat dict {...}
        data = payload
        if "payload" in data and isinstance(data["payload"], dict):
            p_wrap = data["payload"]
            if "payment" in p_wrap and isinstance(p_wrap["payment"], dict):
                ent = p_wrap["payment"].get("entity")
                data = ent if isinstance(ent, dict) else p_wrap["payment"]
            else:
                data = p_wrap
        elif "payment" in data and isinstance(data["payment"], dict):
            p_wrap = data["payment"]
            ent = p_wrap.get("entity")
            data = ent if isinstance(ent, dict) else p_wrap

        if not isinstance(data, dict):
            data = {}

        # Extract metadata
        metadata = data.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}

        # 1. Payment ID
        payment_id = str(data.get("payment_id") or data.get("id") or "unknown")

        # 2. Customer ID with fallback
        customer_id_val = (
            data.get("customer_id")
            or (data.get("customer", {}).get("id") if isinstance(data.get("customer"), dict) else None)
            or metadata.get("customer_id")
        )
        if customer_id_val:
            customer_id = str(customer_id_val)
        elif payment_id != "unknown":
            customer_id = f"cust_{payment_id}"
        else:
            customer_id = "unknown"

        # 3. Amount conversion (paise -> INR)
        if "amount_inr" in data and data["amount_inr"] is not None:
            amount_inr = _safe_float(data["amount_inr"], 0.0)
        elif "amount_inr" in metadata and metadata["amount_inr"] is not None:
            amount_inr = _safe_float(metadata["amount_inr"], 0.0)
        elif "amount" in data and data["amount"] is not None:
            amount_inr = round(_safe_float(data["amount"], 0.0) / 100.0, 2)
        elif "amount_paise" in data and data["amount_paise"] is not None:
            amount_inr = round(_safe_float(data["amount_paise"], 0.0) / 100.0, 2)
        elif "amount" in metadata and metadata["amount"] is not None:
            amount_inr = round(_safe_float(metadata["amount"], 0.0) / 100.0, 2)
        else:
            amount_inr = 0.0

        # 4. Error code
        error_code = str(
            data.get("error_code")
            or (data.get("error", {}).get("code") if isinstance(data.get("error"), dict) else None)
            or metadata.get("error_code")
            or "unknown"
        )

        # 5. Mandate State inference
        raw_mandate_state = (
            data.get("mandate_state")
            or metadata.get("mandate_state")
            or (data.get("mandate", {}).get("state") if isinstance(data.get("mandate"), dict) else None)
        )
        if isinstance(raw_mandate_state, MandateState):
            mandate_state = raw_mandate_state
        elif isinstance(raw_mandate_state, str):
            clean_state = raw_mandate_state.strip().upper()
            if clean_state in MandateState.__members__:
                mandate_state = MandateState[clean_state]
            else:
                mandate_state = MandateState.UNKNOWN
        elif error_code == "mandate_revoked":
            mandate_state = MandateState.REVOKED
        else:
            mandate_state = MandateState.UNKNOWN

        # 6. Network normalization
        raw_network = (
            data.get("network")
            or metadata.get("network")
            or (data.get("card", {}).get("network") if isinstance(data.get("card"), dict) else None)
            or "unknown"
        )
        network = str(raw_network).strip().lower()

        # 7. Retry count & Alerts ignored
        raw_retry = data.get("retry_count")
        if raw_retry is None and isinstance(metadata, dict):
            raw_retry = metadata.get("retries_this_month")
            if raw_retry is None:
                raw_retry = metadata.get("retry_count")
        retry_count = _safe_int(raw_retry, 0)

        raw_alerts = data.get("alerts_ignored")
        if raw_alerts is None and isinstance(metadata, dict):
            raw_alerts = metadata.get("pre_debit_alerts_ignored")
            if raw_alerts is None:
                raw_alerts = metadata.get("alerts_ignored")
        alerts_ignored = _safe_int(raw_alerts, 0)

        # 8. Fraud flag & First transaction inference
        fraud_flag = bool(
            data.get("fraud_flag")
            or metadata.get("fraud_flag")
            or (error_code == "fraud_flag")
        )
        is_first_transaction = bool(
            data.get("is_first_transaction")
            or metadata.get("is_first_transaction")
            or False
        )

        # 9. Bank name & Mandate ID
        bank_name = str(
            metadata.get("bank_name")
            or data.get("bank_name")
            or data.get("bank")
            or "unknown"
        )
        mandate_id_val = (
            data.get("mandate_id")
            or metadata.get("mandate_id")
            or data.get("subscription_id")
            or (data.get("mandate", {}).get("id") if isinstance(data.get("mandate"), dict) else None)
        )
        mandate_id = str(mandate_id_val) if mandate_id_val is not None else None
        currency = str(data.get("currency") or metadata.get("currency") or "INR")

        return PaymentContext(
            payment_id=payment_id,
            customer_id=customer_id,
            amount_inr=amount_inr,
            error_code=error_code,
            mandate_id=mandate_id,
            mandate_state=mandate_state,
            network=network,
            is_first_transaction=is_first_transaction,
            retry_count=retry_count,
            alerts_ignored=alerts_ignored,
            fraud_flag=fraud_flag,
            currency=currency,
            bank_name=bank_name,
            current_state=PaymentState.RECEIVED,
            metadata=metadata,
            raw_metadata=metadata,
        )


# Module-level convenience function
build_context = ContextBuilder.build_context
