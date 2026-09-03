from typing import Dict, Any, Union
from backend.app.models.payment import PaymentState, InterventionType, MandateState
from backend.app.models.case import RecoveryCase, CaseType

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
    def build_context(payload: Union[Dict[str, Any], Any]) -> RecoveryCase:
        """
        Normalizes heterogeneous raw webhook events, mock seed records, eval cases,
        and flat dictionaries into a typed, validated RecoveryCase.
        """
        # Backwards compatibility check
        if isinstance(payload, RecoveryCase):
            return payload
        # If it was an old RecoveryCase, it'll have __dict__
        if not isinstance(payload, dict):
            if hasattr(payload, "model_dump"):
                payload = payload.model_dump()
            elif hasattr(payload, "__dict__"):
                payload = payload.__dict__
            else:
                raise TypeError(f"Expected dict, got {type(payload)}")

        data = payload
        # Flatten payload wrapper
        if "payload" in data and isinstance(data["payload"], dict):
            data = data["payload"]
            
        # Unwrap entity (payment, subscription, checkout, invoice, promise)
        for key in ["payment", "order", "subscription", "checkout", "invoice", "promise"]:
            if key in data and isinstance(data[key], dict):
                inner = data[key]
                entity = inner.get("entity")
                if isinstance(entity, dict):
                    data = entity
                else:
                    data = inner
                break

        if not isinstance(data, dict):
            data = {}

        metadata = data.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}

        # 1. ID Extraction
        found_id = data.get("case_id") or data.get("payment_id") or data.get("id")
        if not found_id and payload:
            for k in ["subscription", "checkout", "invoice", "promise"]:
                if k in payload and isinstance(payload[k], dict) and "id" in payload[k]:
                    found_id = payload[k]["id"]
                    break
        case_id = str(found_id or "unknown")
        
        customer_id_val = (
            data.get("customer_id")
            or (data.get("customer", {}).get("id") if isinstance(data.get("customer"), dict) else data.get("customer"))
            or metadata.get("customer_id")
        )
        if customer_id_val:
            customer_id = str(customer_id_val)
        elif case_id != "unknown":
            customer_id = f"cust_{case_id}"
        else:
            customer_id = "unknown"

        # 2. Case Type inference
        event_str = payload.get("event", "")
        if isinstance(event_str, str):
            event_str = event_str.lower()
            if "subscription" in event_str:
                case_type = CaseType.SUBSCRIPTION
            elif "checkout" in event_str:
                case_type = CaseType.CHECKOUT_ABANDONMENT
            elif "invoice" in event_str or "receivable" in event_str:
                case_type = CaseType.RECEIVABLE
            elif "promise" in event_str:
                case_type = CaseType.PROMISE_TO_PAY
            else:
                case_type = CaseType.PAYMENT_FAILURE
        else:
            case_type = CaseType.PAYMENT_FAILURE

        # Ensure explicit case_type in payload overrides event inference
        explicit_type = payload.get("case_type") or data.get("case_type")
        if explicit_type and explicit_type in CaseType.__members__:
            case_type = CaseType[explicit_type]

        # 3. Amount conversion (paise -> INR)
        if "amount_inr" in data and data["amount_inr"] is not None:
            amount_inr = _safe_float(data["amount_inr"], 0.0)
        elif "amount_inr" in metadata and metadata["amount_inr"] is not None:
            amount_inr = _safe_float(metadata["amount_inr"], 0.0)
        elif "amount" in data and data["amount"] is not None:
            amount_inr = round(_safe_float(data["amount"], 0.0) / 100.0, 2)
        elif "amount_paise" in data and data["amount_paise"] is not None:
            amount_inr = round(_safe_float(data["amount_paise"], 0.0) / 100.0, 2)
        elif "amount_at_risk" in data and data["amount_at_risk"] is not None:
            amount_inr = _safe_float(data["amount_at_risk"], 0.0)
        else:
            amount_inr = 0.0

        # 4. Error code / Failure reason
        failure_reason = str(
            data.get("failure_reason")
            or data.get("error_code")
            or (data.get("error", {}).get("code") if isinstance(data.get("error"), dict) else None)
            or metadata.get("error_code")
            or "unknown"
        )

        # 5. Core context fields needed by router (mandate, network, bank)
        raw_mandate_state = data.get("mandate_state")
        if raw_mandate_state is None:
            raw_mandate_state = metadata.get("mandate_state")
        if raw_mandate_state is None and isinstance(data.get("mandate"), dict):
            raw_mandate_state = data.get("mandate").get("state")
            
        if isinstance(raw_mandate_state, MandateState):
            mandate_state = raw_mandate_state
        elif isinstance(raw_mandate_state, str) and raw_mandate_state.strip().upper() in MandateState.__members__:
            mandate_state = MandateState[raw_mandate_state.strip().upper()]
        elif failure_reason == "mandate_revoked":
            mandate_state = MandateState.REVOKED
        else:
            mandate_state = MandateState.UNKNOWN

        network = str(data.get("network") or metadata.get("network") or (data.get("card", {}).get("network") if isinstance(data.get("card"), dict) else None) or "unknown").strip().lower()
        bank_name = str(metadata.get("bank_name") or data.get("bank_name") or data.get("bank") or "unknown")
        mandate_id_val = (data.get("mandate_id") or metadata.get("mandate_id") or data.get("subscription_id") or (data.get("mandate", {}).get("id") if isinstance(data.get("mandate"), dict) else None))
        mandate_id = str(mandate_id_val) if mandate_id_val is not None else None

        # 6. Retry & Fraud
        raw_retry = data.get("retry_count")
        if raw_retry is None:
            raw_retry = metadata.get("retries_this_month")
        if raw_retry is None:
            raw_retry = metadata.get("retry_count")
        retry_count = _safe_int(raw_retry, 0)
        
        raw_alerts = data.get("alerts_ignored")
        if raw_alerts is None:
            raw_alerts = metadata.get("pre_debit_alerts_ignored")
        alerts_ignored = _safe_int(raw_alerts, 0)

        fraud_flag = bool(data.get("fraud_flag") or metadata.get("fraud_flag") or (failure_reason == "fraud_flag"))
        is_first_transaction = bool(data.get("is_first_transaction") or metadata.get("is_first_transaction") or False)
        currency = str(data.get("currency") or metadata.get("currency") or "INR")

        context_dict = {
            "mandate_id": mandate_id,
            "mandate_state": mandate_state,
            "network": network,
            "bank_name": bank_name,
            "is_first_transaction": is_first_transaction,
            "raw_metadata": metadata
        }
        
        # Merge all additional fields from data into context
        reserved_keys = [
            "payment_id", "id", "case_id", "customer_id", "amount", "amount_inr", 
            "amount_paise", "error_code", "failure_reason", "metadata", 
            "mandate_state", "network", "bank_name", "mandate_id", "is_first_transaction", "currency"
        ]
        for k, v in data.items():
            if k not in reserved_keys:
                context_dict[k] = v

        return RecoveryCase(
            case_id=case_id,
            case_type=case_type,
            customer_id=customer_id,
            amount_at_risk=amount_inr,
            currency=currency,
            status=PaymentState.RECEIVED,
            failure_reason=failure_reason,
            context=context_dict,
            metadata=metadata,
            retry_count=retry_count,
            alerts_ignored=alerts_ignored,
            fraud_flag=fraud_flag
        )

# Module-level convenience function
build_context = ContextBuilder.build_context
