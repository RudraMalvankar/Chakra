"""
Outcome Evaluator: Normalizes gateway responses and determines payment recovery outcomes.
Only a genuine 'captured' status (or 'outcome == "success"') triggers PAYMENT_SUCCEEDED / RECOVERED.
Updates RecoveryCase state and produces a typed OutcomeResult.
"""
from typing import Dict, Any, Optional, Union
from datetime import datetime, timezone

from backend.app.models.case import RecoveryCase, PaymentState, OutcomeResult
from backend.app.services.context_builder import ContextBuilder


class OutcomeEvaluator:
    @staticmethod
    def evaluate(
        raw_response: Optional[Dict[str, Any]],
        ctx: Union[RecoveryCase, Dict[str, Any]],
    ) -> OutcomeResult:
        """
        Evaluates raw response from payment gateway / mock Razorpay.
        Normalizes status and updates ctx.current_state.
        """
        if not isinstance(ctx, RecoveryCase):
            ctx = ContextBuilder.build_context(ctx)

        if raw_response is None or not isinstance(raw_response, dict):
            raw_response = {}

        now_iso = datetime.now(timezone.utc).isoformat()

        # Check for gateway errors
        if "error" in raw_response:
            ctx.current_state = PaymentState.RECOVERY_FAILED
            return OutcomeResult(
                payment_id=ctx.payment_id,
                status="error",
                recovered=False,
                amount_recovered_inr=0.0,
                raw_response=raw_response,
                evaluated_at=now_iso,
            )

        # Extract status and outcome fields
        status_raw = str(raw_response.get("status") or "").strip().lower()
        outcome_raw = str(raw_response.get("outcome") or "").strip().lower()

        # Normalization: Only genuine 'captured' or 'success' outcome triggers recovered = True
        is_recovered = False
        if status_raw == "captured" or outcome_raw in ["captured", "success"]:
            is_recovered = True
            normalized_status = "captured"
        elif status_raw in ["created", "pending"] and outcome_raw in ["captured", "success"]:
            is_recovered = True
            normalized_status = "captured"
        elif status_raw:
            normalized_status = status_raw
        elif outcome_raw:
            normalized_status = outcome_raw
        else:
            normalized_status = "failed"

        if is_recovered:
            ctx.current_state = PaymentState.RECOVERED
            amount_recovered = ctx.amount_inr
        else:
            ctx.current_state = PaymentState.RECOVERY_FAILED
            amount_recovered = 0.0

        return OutcomeResult(
            payment_id=ctx.payment_id,
            status=normalized_status,
            recovered=is_recovered,
            amount_recovered_inr=amount_recovered,
            raw_response=raw_response,
            evaluated_at=now_iso,
        )


# Convenience aliases
evaluate_outcome = OutcomeEvaluator.evaluate
