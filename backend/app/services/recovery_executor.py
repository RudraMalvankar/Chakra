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
from backend.app.lib.audit import log_audit_event as _log_audit_event
from backend.app.services.voice import generate_hinglish_voice_note


def log_audit_event(payment_id, event_type, details, case_id=None, **kwargs):
    """Prefer explicit recovery case_id so audit UI can navigate correctly."""
    resolved = case_id or (details.get("case_id") if isinstance(details, dict) else None)
    return _log_audit_event(payment_id, event_type, details, case_id=resolved, **kwargs)

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
            from backend.app.services.db_service import DBService
            DBService.create_escalation(
                ctx.case_id or ctx.payment_id,
                reason=decision.reason_code or "COMPLIANCE_BLOCK",
                priority="HIGH" if decision.reason_code == "HARD_COMPLIANCE_BLOCK" else "MEDIUM",
                severity="HIGH" if decision.reason_code == "HARD_COMPLIANCE_BLOCK" else "MEDIUM",
                notes="Automation stopped by the deterministic SafetyGate.",
            )
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
            from backend.app.services.db_service import DBService
            DBService.create_escalation(
                ctx.case_id or ctx.payment_id,
                reason=decision.reason_code or "MANUAL_REVIEW_REQUIRED",
                priority="HIGH" if decision.requires_human else "MEDIUM",
                notes="Automation requires a human recovery decision.",
            )
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
                from backend.app.services.db_service import DBService
                provider_name = "razorpay_test" if settings.is_razorpay_configured else "synthetic"
                DBService.record_payment_link(
                    case_id=ctx.case_id or ctx.payment_id,
                    customer_id=ctx.customer_id,
                    provider=provider_name,
                    amount=ctx.amount_inr,
                    url=res.get("short_url") or res.get("recovery_url") or res.get("url"),
                    provider_link_id=res.get("id") or res.get("link_id"),
                    status="CAPTURED" if outcome.recovered else ("AWAITING_PAYMENT" if outcome.status in {"created", "pending", "queued"} else "FAILED"),
                )

                link_url = res.get("short_url") or res.get("recovery_url") or res.get("url")
                phone = getattr(ctx, "phone_number", None) or getattr(ctx, "phone", None)
                if not phone and isinstance(getattr(ctx, "context", None), dict):
                    phone = ctx.context.get("phone_number") or ctx.context.get("phone")
                if phone and link_url and settings.is_twilio_configured:
                    from backend.app.services.notify import send_payment_failed_sms
                    cust_name = getattr(ctx, "customer_name", None) or (f"Customer {ctx.customer_id[-4:]}" if ctx.customer_id else "Customer")
                    try:
                        sms_res = await send_payment_failed_sms(
                            to_number=phone,
                            customer_name=cust_name,
                            amount_inr=ctx.amount_inr,
                            payment_link=link_url,
                        )
                        log_audit_event(ctx.payment_id, "payment_link_sms_dispatched", {
                            "to_number": phone,
                            "sms_status": sms_res.get("status"),
                            "provider_message_id": sms_res.get("provider_message_id"),
                            "effective_action": decision.decision.value,
                        })
                    except Exception as _sms_err:
                        logger.warning("Failed to dispatch payment link SMS: %s", _sms_err)

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

            elif decision.decision.value == "SUBSCRIPTION_PAUSE":
                sub_id = ctx.context.get("subscription_id") or ctx.mandate_id or ctx.payment_id
                res = await razorpay_client.pause_subscription(sub_id)
                log_audit_event(ctx.payment_id, "subscription_paused", {
                    "subscription_id": sub_id,
                    "provider_response": res,
                    "effective_action": decision.decision.value
                })
                from backend.app.services.db_service import DBService
                DBService.update_subscription_status(sub_id, "PAUSED")
                ctx.current_state = PaymentState.BLOCKED

            elif decision.decision.value == "SUBSCRIPTION_RESUME":
                sub_id = ctx.context.get("subscription_id") or ctx.mandate_id or ctx.payment_id
                res = await razorpay_client.resume_subscription(sub_id)
                log_audit_event(ctx.payment_id, "subscription_resumed", {
                    "subscription_id": sub_id,
                    "provider_response": res,
                    "effective_action": decision.decision.value
                })
                from backend.app.services.db_service import DBService
                DBService.update_subscription_status(sub_id, "ACTIVE")
                ctx.current_state = PaymentState.RECOVERED

            elif decision.decision.value == "SUBSCRIPTION_CANCEL":
                sub_id = ctx.context.get("subscription_id") or ctx.mandate_id or ctx.payment_id
                res = await razorpay_client.cancel_subscription(sub_id)
                log_audit_event(ctx.payment_id, "subscription_cancelled", {
                    "subscription_id": sub_id,
                    "provider_response": res,
                    "effective_action": decision.decision.value
                })
                from backend.app.services.db_service import DBService
                DBService.update_subscription_status(sub_id, "CANCELLED")
                ctx.current_state = PaymentState.BLOCKED

            elif decision.decision.value == "SUBSCRIPTION_RETRY":
                sub_id = ctx.context.get("subscription_id") or ctx.mandate_id or ctx.payment_id
                res = await razorpay_client.retry_subscription_payment(sub_id)
                log_audit_event(ctx.payment_id, "subscription_retry_attempted", {
                    "subscription_id": sub_id,
                    "provider_response": res,
                    "effective_action": decision.decision.value
                })
                ctx.current_state = PaymentState.RECOVERY_PENDING

        except Exception as e:
            log_audit_event(ctx.payment_id, "execution_error", {"error": str(e), "effective_action": decision.decision.value})
            ctx.current_state = PaymentState.RECOVERY_FAILED
            from backend.app.services.db_service import DBService
            DBService.create_escalation(
                ctx.case_id or ctx.payment_id,
                reason="PROVIDER_UNAVAILABLE",
                priority="HIGH",
                notes="Provider execution failed; no recovery was claimed.",
            )

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
    triage_result = TriageEngine.triage(ctx)
    case_key = ctx.case_id or ctx.payment_id
    if triage_result.is_ambiguous:
        log_audit_event(ctx.payment_id, "ai_triage_requested", {"error_code": ctx.error_code, "case_id": case_key}, case_id=case_key)
        action_val = triage_result.diagnosis
        
        log_audit_event(ctx.payment_id, "ai_triage_completed", {
            "error_code": ctx.error_code,
            "classification": action_val,
            "confidence": triage_result.confidence,
            "ai_used": getattr(triage_result, "ai_used", True),
            "model_used": getattr(triage_result, "model_used", None),
            "fallback_used": getattr(triage_result, "fallback_used", False),
            "reason": triage_result.reason,
            "case_id": case_key,
        }, case_id=case_key)
        
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

        # Triage diagnoses only. RecoveryAgent below selects the final action.

    # 1. Detect & Assess Revenue Risk
    risk_assessment = RevenueRiskEngine.assess(ctx)
    log_audit_event(ctx.payment_id, "revenue_risk_assessed", {**risk_assessment.model_dump(), "case_id": case_key}, case_id=case_key)
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
    log_data["case_id"] = case_key
    log_audit_event(ctx.payment_id, "agent_decision_proposed", log_data, case_id=case_key)
    
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
    log_audit_event(ctx.payment_id, "safety_check_completed", {**approved_decision.model_dump(), "case_id": case_key}, case_id=case_key)
    DBService.record_recovery_event(
        case_id=ctx.case_id or ctx.payment_id,
        event_type="safety_check_completed",
        action=approved_decision.decision.value,
        status=approved_decision.eligibility if hasattr(approved_decision, "eligibility") else approved_decision.decision.value,
        metadata=approved_decision.model_dump(),
    )

    # 4. Execution
    final_ctx = await RecoveryExecutor.execute(ctx, approved_decision, dry_run=dry_run)
    DBService.record_recovery_event(
        case_id=ctx.case_id or ctx.payment_id,
        event_type="execution_completed",
        action=approved_decision.decision.value,
        status=final_ctx.current_state.value,
        amount=ctx.amount_inr if final_ctx.current_state == PaymentState.RECOVERED else 0.0,
    )
    
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

