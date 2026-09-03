"""
Clean Recovery Executor: Strict Action Execution Dispatcher.
Executes approved recovery decisions (retries, payment links, DLT, voice, dry-run)
without performing safety checks or modifying policy decisions.
"""
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Union

from backend.app.config import settings
from backend.app.models.case import RecoveryCase, RecoveryDecision, InterventionType, PaymentState
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.triage import TriageEngine
from backend.app.services.mandate_router import MandateRouter
from backend.app.services.safety_gate import SafetyGate
from backend.app.services.razorpay_client import razorpay_client
from backend.app.services.outcome_evaluator import OutcomeEvaluator
from backend.app.lib.audit import log_audit_event


class RecoveryExecutor:
    @staticmethod
    async def execute(
        ctx: Union[RecoveryCase, Dict[str, Any]],
        decision: RecoveryDecision,
        dry_run: bool = False,
    ) -> RecoveryCase:
        """
        Strictly executes an approved RecoveryDecision.
        Does not perform safety evaluations.
        """
        if not isinstance(ctx, RecoveryCase):
            ctx = ContextBuilder.build_context(ctx)

        # 1. Handle Blocked Decisions
        if decision.decision == InterventionType.BLOCK:
            ctx.current_state = PaymentState.BLOCKED
            log_audit_event(ctx.payment_id, "execution_blocked", {
                "reason_code": decision.reason_code,
                "policy_id": decision.policy_id,
            })
            return ctx

        # 2. Handle Escalated Decisions
        if decision.decision == InterventionType.ESCALATE:
            ctx.current_state = PaymentState.ESCALATED
            log_audit_event(ctx.payment_id, "execution_escalated", {
                "reason_code": decision.reason_code,
                "policy_id": decision.policy_id,
                "requires_human": decision.requires_human,
            })
            return ctx

        # 3. Attempting Intervention
        ctx.current_state = PaymentState.INTERVENTION_ATTEMPTED

        # 4. Handle Dry-Run Mode
        if dry_run:
            log_audit_event(ctx.payment_id, "dry_run_execution", {
                "simulated_action": decision.decision.value,
                "reason_code": decision.reason_code,
                "delay_hours": decision.delay_hours,
                "template_id": decision.template_id,
            })
            return ctx

        # 5. Live Execution via Razorpay Client
        try:
            if decision.decision in [InterventionType.RETRY_LATER, InterventionType.RETRY_NOW]:
                delay = decision.delay_hours or 0
                res = await razorpay_client.retry_payment(ctx.payment_id, delay)
                outcome = OutcomeEvaluator.evaluate(res, ctx)
                log_audit_event(ctx.payment_id, "execution_outcome", outcome.model_dump())

            elif decision.decision in [InterventionType.PAYMENT_LINK, InterventionType.AFA_PAYMENT_LINK]:
                amount_paise = int(round(ctx.amount_inr * 100))
                template = decision.template_id or "default"
                res = await razorpay_client.create_payment_link(
                    customer_id=ctx.customer_id,
                    amount=amount_paise,
                    template=template,
                    payment_id=ctx.payment_id,
                )
                outcome = OutcomeEvaluator.evaluate(res, ctx)
                log_audit_event(ctx.payment_id, "execution_outcome", outcome.model_dump())

            elif decision.decision == InterventionType.VOICE_RECOVERY:
                log_audit_event(ctx.payment_id, "voice_artifact_generated", {"template_id": decision.template_id, "note": "Voice recovery artifact generated."})
                # Simulated pending outcome for voice delivery
                ctx.current_state = PaymentState.RECOVERY_PENDING

            elif decision.decision == InterventionType.REMINDER:
                log_audit_event(ctx.payment_id, "reminder_artifact_generated", {"template_id": decision.template_id, "note": "Reminder artifact generated."})
                ctx.current_state = PaymentState.RECOVERY_PENDING

        except Exception as e:
            log_audit_event(ctx.payment_id, "execution_error", {"error": str(e)})
            ctx.current_state = PaymentState.RECOVERY_FAILED

        return ctx


async def execute_recovery_pipeline(
    payload: Union[RecoveryCase, Dict[str, Any]],
    dry_run: bool = False,
) -> RecoveryCase:
    """
    6-Stage Pipeline Orchestrator:
    Context Builder -> Triage Engine -> Mandate Router -> Safety Gate -> Clean Executor
    """
    # 1. Context Builder
    ctx: RecoveryCase = ContextBuilder.build_context(payload)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 2. Triage Engine
    ctx.current_state = PaymentState.TRIAGED
    triage_result = TriageEngine.triage(ctx)

    # 3. Mandate Router
    proposed_decision = MandateRouter.route(ctx, triage_result)
    log_audit_event(ctx.payment_id, "triage_decision_proposed", {
        "amount_inr": ctx.amount_inr,
        "case_type": getattr(ctx, "case_type", "PAYMENT_FAILURE").value if hasattr(getattr(ctx, "case_type", None), "value") else str(getattr(ctx, "case_type", "PAYMENT_FAILURE")),
        "triage": triage_result.model_dump(),
        "decision": proposed_decision.model_dump(),
    })

    # 4. Safety Gate
    ctx.current_state = PaymentState.SAFETY_CHECK
    approved_decision = SafetyGate.evaluate(ctx, proposed_decision, today)
    log_audit_event(ctx.payment_id, "safety_check_completed", approved_decision.model_dump())

    # 5. Clean Executor
    final_ctx = await RecoveryExecutor.execute(ctx, approved_decision, dry_run=dry_run)
    return final_ctx
