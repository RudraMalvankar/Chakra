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
from backend.app.services.voice import generate_hinglish_voice_note

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
                "effective_action": decision.decision.value
            })
            return ctx

        # 2. Handle Escalated Decisions
        if decision.decision == InterventionType.ESCALATE:
            ctx.current_state = PaymentState.ESCALATED
            log_audit_event(ctx.payment_id, "execution_escalated", {
                "reason_code": decision.reason_code,
                "policy_id": decision.policy_id,
                "requires_human": decision.requires_human,
                "effective_action": decision.decision.value
            })
            return ctx

        # 3. Attempting Intervention
        ctx.current_state = PaymentState.INTERVENTION_ATTEMPTED

        # 4. Handle Dry-Run Mode
        if dry_run:
            ctx.current_state = PaymentState.RECOVERY_PENDING
            log_audit_event(ctx.payment_id, "dry_run_execution", {
                "simulated_action": decision.decision.value,
                "reason_code": decision.reason_code,
                "delay_hours": decision.delay_hours,
                "template_id": decision.template_id,
                "status": "DRY_RUN",
                "note": "SIMULATED — no real provider action taken",
            })
            return ctx

        # 5. Live Execution
        try:
            if decision.decision == InterventionType.RETRY_LATER:
                delay = decision.delay_hours or 24
                # Do NOT call Razorpay client for deferred retries.
                log_audit_event(ctx.payment_id, "retry_scheduled", {
                    "delay_hours": delay,
                    "note": f"Retry deferred/scheduled for {delay} hours. Awaiting execution.",
                    "effective_action": decision.decision.value
                })
                ctx.current_state = PaymentState.RECOVERY_PENDING

            elif decision.decision == InterventionType.RETRY_NOW:
                res = await razorpay_client.retry_payment(ctx.payment_id, 0)
                outcome = OutcomeEvaluator.evaluate(res, ctx)
                outcome_data = outcome.model_dump()
                outcome_data["effective_action"] = decision.decision.value
                log_audit_event(ctx.payment_id, "execution_outcome", outcome_data)

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
                outcome_data = outcome.model_dump()
                outcome_data["effective_action"] = decision.decision.value
                outcome_data["template_id"] = template
                log_audit_event(ctx.payment_id, "execution_outcome", outcome_data)

            elif decision.decision == InterventionType.VOICE_RECOVERY:
                customer_name = f"customer_{ctx.customer_id[-4:]}" if ctx.customer_id and len(ctx.customer_id) >= 4 else "customer"
                amount_inr = int(ctx.amount_inr)
                payment_link = f"https://rzp.io/l/{ctx.case_id[:8]}"
                audio_path = generate_hinglish_voice_note(customer_name, amount_inr, payment_link)
                
                if audio_path:
                    log_audit_event(ctx.payment_id, "voice_artifact_generated", {
                        "template_id": decision.template_id, 
                        "note": "Voice recovery artifact generated.",
                        "audio_path": audio_path,
                        "effective_action": decision.decision.value
                    })
                else:
                    log_audit_event(ctx.payment_id, "voice_generation_unavailable", {
                        "note": "Local TTS dependency missing; fallback invoked cleanly.",
                        "effective_action": decision.decision.value
                    })
                ctx.current_state = PaymentState.RECOVERY_PENDING

            elif decision.decision == InterventionType.REMINDER:
                log_audit_event(ctx.payment_id, "reminder_artifact_generated", {
                    "template_id": decision.template_id, 
                    "note": "Reminder artifact generated.",
                    "effective_action": decision.decision.value
                })
                ctx.current_state = PaymentState.RECOVERY_PENDING

        except Exception as e:
            log_audit_event(ctx.payment_id, "execution_error", {"error": str(e), "effective_action": decision.decision.value})
            ctx.current_state = PaymentState.RECOVERY_FAILED

        return ctx


async def execute_recovery_pipeline(
    payload: Union[RecoveryCase, Dict[str, Any]],
    dry_run: bool = False,
) -> RecoveryCase:
    """
    6-Stage Pipeline Orchestrator:
    Context Builder -> Revenue Risk Engine -> Recovery Agent -> Safety Gate -> Clean Executor -> Outcome Evaluator
    """
    from backend.app.services.revenue_risk_engine import RevenueRiskEngine
    from backend.app.services.recovery_agent import RecoveryAgent
    from backend.app.services.db_service import DBService
    
    ctx: RecoveryCase = ContextBuilder.build_context(payload)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # DB Persistence: Register Customer, Payment & Case initial state
    cust_ext_id = ctx.customer_id or "cust_unknown"
    cust_db_id = DBService.upsert_customer(cust_ext_id)
    case_type_str = ctx.case_type.value if hasattr(ctx.case_type, "value") else str(ctx.case_type)
    
    DBService.upsert_payment(
        payment_id=ctx.payment_id,
        amount_inr=ctx.amount_inr,
        customer_id=cust_db_id,
        status="FAILED",
        failure_code=ctx.error_code or "unknown",
    )
    DBService.upsert_recovery_case(
        case_id=ctx.case_id or ctx.payment_id,
        payment_id=ctx.payment_id,
        case_type=case_type_str,
        amount_at_risk=ctx.amount_inr,
        status="PENDING",
    )

    # 0. Triage (AI/Diagnostic classification)
    from backend.app.services.triage import TriageEngine
    from backend.app.lib.audit import log_audit_event
    triage_result = TriageEngine.triage(ctx)
    if triage_result.is_ambiguous:
        log_audit_event(ctx.payment_id, "ai_triage_requested", {"error_code": ctx.error_code})
        action_val = triage_result.recommended_action.value if hasattr(triage_result.recommended_action, 'value') else str(triage_result.recommended_action)
        
        log_audit_event(ctx.payment_id, "ai_triage_completed", {
            "error_code": ctx.error_code,
            "classification": action_val,
            "confidence": triage_result.confidence,
            "ai_used": getattr(triage_result, "ai_used", True),
            "model_used": getattr(triage_result, "model_used", None),
            "fallback_used": getattr(triage_result, "fallback_used", False),
            "reason": triage_result.reason
        })
        
        # Persist AI triage in DB
        DBService.upsert_recovery_case(
            case_id=ctx.case_id or ctx.payment_id,
            payment_id=ctx.payment_id,
            case_type=case_type_str,
            amount_at_risk=ctx.amount_inr,
            ai_used=getattr(triage_result, "ai_used", True),
            ai_classification=action_val,
            ai_confidence=triage_result.confidence,
            ai_reasoning=triage_result.reason,
            ai_fallback_used=getattr(triage_result, "fallback_used", False),
        )

        # Map LLM output to standard error codes for RecoveryAgent
        if action_val == "RETRY_LATER":
            ctx.failure_reason = "payment_timed_out"
        elif action_val == "PAYMENT_LINK":
            ctx.failure_reason = "card_declined"
        elif action_val == "BLOCK":
            ctx.failure_reason = "fraud_flag"
        else:
            ctx.failure_reason = "escalated_by_triage"

    # 1. Detect & Assess Revenue Risk
    risk_assessment = RevenueRiskEngine.assess(ctx)
    log_audit_event(ctx.payment_id, "revenue_risk_assessed", risk_assessment.model_dump())
    DBService.record_recovery_event(
        case_id=ctx.case_id or ctx.payment_id,
        event_type="revenue_risk_assessed",
        amount=risk_assessment.revenue_at_risk_inr,
        metadata=risk_assessment.model_dump(),
    )
    DBService.upsert_recovery_case(
        case_id=ctx.case_id or ctx.payment_id,
        payment_id=ctx.payment_id,
        case_type=case_type_str,
        amount_at_risk=risk_assessment.revenue_at_risk_inr,
        risk_probability=risk_assessment.recovery_probability,
        recovery_eligible=getattr(risk_assessment, "recovery_eligible", True),
    )

    # 2. Agent Decision
    agent_decision = RecoveryAgent.decide(ctx)
    log_data = agent_decision.model_dump()
    log_data["amount_inr"] = ctx.amount_inr
    log_data["case_type"] = case_type_str
    log_audit_event(ctx.payment_id, "agent_decision_proposed", log_data)
    
    # Persist decision in DB
    selected_act = agent_decision.selected_action
    cand = next((c for c in agent_decision.candidate_actions if c.action == selected_act), None)
    DBService.record_decision(
        case_id=ctx.case_id or ctx.payment_id,
        selected_action=selected_act,
        confidence=agent_decision.confidence,
        reasoning_summary=f"Selected {selected_act} with expected recovery INR {agent_decision.expected_recovery_inr:.2f}",
        base_probability=cand.base_probability if cand else 0.5,
        probability_modifier=cand.probability_modifier if cand else 1.0,
        effective_probability=cand.effective_probability if cand else 0.5,
        expected_recovery=agent_decision.expected_recovery_inr,
        score=cand.score if cand else 0.0,
    )

    # Map AgentDecision to RecoveryDecision for SafetyGate compatibility
    from backend.app.models.case import RecoveryDecision
    proposed_decision = RecoveryDecision(
        decision=InterventionType(agent_decision.selected_action),
        reason_code="agent_decision",
        policy_id="agent_policy",
        delay_hours=24 if agent_decision.selected_action == "RETRY_LATER" else 0
    )

    # 3. Safety Check
    ctx.current_state = PaymentState.SAFETY_CHECK
    approved_decision = SafetyGate.evaluate(ctx, proposed_decision, today)
    log_audit_event(ctx.payment_id, "safety_check_completed", approved_decision.model_dump())
    DBService.record_recovery_event(
        case_id=ctx.case_id or ctx.payment_id,
        event_type="safety_check_completed",
        action=approved_decision.decision.value,
        status=approved_decision.eligibility if hasattr(approved_decision, "eligibility") else approved_decision.decision.value,
        metadata=approved_decision.model_dump(),
    )

    # 4. Execution
    final_ctx = await RecoveryExecutor.execute(ctx, approved_decision, dry_run=dry_run)
    
    # DB Persistence: Final Case & Payment State
    final_status = final_ctx.current_state.value
    DBService.upsert_recovery_case(
        case_id=ctx.case_id or ctx.payment_id,
        payment_id=ctx.payment_id,
        case_type=case_type_str,
        amount_at_risk=ctx.amount_inr,
        status=final_status,
        current_action=approved_decision.decision.value,
    )
    if final_ctx.current_state == PaymentState.RECOVERED:
        DBService.upsert_payment(
            payment_id=ctx.payment_id,
            amount_inr=ctx.amount_inr,
            status="CAPTURED",
        )
    elif final_ctx.current_state in (PaymentState.RECOVERY_PENDING, PaymentState.INTERVENTION_ATTEMPTED):
        DBService.upsert_payment(
            payment_id=ctx.payment_id,
            amount_inr=ctx.amount_inr,
            status="PENDING",
        )

    return final_ctx

