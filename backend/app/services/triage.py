"""
Triage Engine: Pure diagnostic classification of payment failures.
Answers 'What happened?' by mapping error codes to diagnostic assessments.
Uses deterministic heuristics for known failure modes and PII-redacted Gemini fallback for ambiguous errors.
"""
from typing import Dict, Any, Union, Optional
from pathlib import Path
import yaml

from backend.app.config import settings
from backend.app.models.case import RecoveryCase, TriageResult, InterventionType
from backend.app.models.mandate import MandateState
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.pii_redact import redact_for_llm
from backend.app.services.llm import gemini_classify, TriageDecision


def _load_recovery_policy() -> Dict[str, Any]:
    policy_path = Path(settings.recovery_policy_path)
    if policy_path.exists():
        with open(policy_path, "r") as f:
            data = yaml.safe_load(f)
            return data.get("policy", {}).get("rules", {})
    return {
        "transient_failure_retry_delay_hours": 1,
        "standard_retry_delay_hours": 24,
        "llm_confidence_threshold": 0.90,
    }


RECOVERY_POLICY = _load_recovery_policy()


class TriageEngine:
    @staticmethod
    def triage(payment: Union[RecoveryCase, Dict[str, Any]]) -> TriageResult:
        """
        Pure diagnostic triage: Evaluates error_code deterministically, falling back
        to PII-redacted Gemini classification for ambiguous cases.
        """
        ctx: RecoveryCase = ContextBuilder.build_context(payment)
        error_code = (ctx.error_code or "unknown").strip().lower()

        # 1. Deterministic Fast Paths
        if error_code == "insufficient_funds":
            return TriageResult(
                error_code="insufficient_funds",
                diagnosis="INSUFFICIENT_FUNDS",
                is_ambiguous=False,
                recommended_action=InterventionType.RETRY_LATER,
                reason="insufficient_funds",
                confidence=0.98,
                delay_hours=RECOVERY_POLICY.get("standard_retry_delay_hours", 24),
                requires_human=False,
            )

        if error_code in ["payment_timed_out", "timed_out", "timeout"]:
            return TriageResult(
                error_code=ctx.error_code,
                diagnosis="TRANSIENT_NETWORK_FAILURE",
                is_ambiguous=False,
                recommended_action=InterventionType.RETRY_LATER,
                reason="transient_timeout",
                confidence=0.95,
                delay_hours=RECOVERY_POLICY.get("transient_failure_retry_delay_hours", 1),
                requires_human=False,
            )

        if error_code == "expired_card":
            return TriageResult(
                error_code="expired_card",
                diagnosis="EXPIRED_CARD",
                is_ambiguous=False,
                recommended_action=InterventionType.PAYMENT_LINK,
                reason="expired_card",
                confidence=0.99,
                template_id="dlt_card_update_v1",
                requires_human=False,
            )

        if error_code == "card_declined":
            return TriageResult(
                error_code="card_declined",
                diagnosis="ISSUER_DECLINE",
                is_ambiguous=False,
                recommended_action=InterventionType.PAYMENT_LINK,
                reason="card_declined",
                confidence=0.90,
                template_id="dlt_upi_alternate_v1",
                requires_human=False,
            )

        if error_code == "fraud_flag" or error_code == "fraud_suspected" or ctx.fraud_flag:
            return TriageResult(
                error_code="fraud_flag",
                diagnosis="FRAUD_SIGNAL",
                is_ambiguous=False,
                recommended_action=InterventionType.BLOCK,
                reason="fraud_flag",
                confidence=1.0,
                requires_human=False,
            )

        if error_code == "mandate_revoked" or ctx.mandate_state == MandateState.REVOKED:
            return TriageResult(
                error_code="mandate_revoked",
                diagnosis="MANDATE_REVOKED",
                is_ambiguous=False,
                recommended_action=InterventionType.BLOCK,
                reason="mandate_revoked",
                confidence=1.0,
                requires_human=False,
            )

        # Explicitly ambiguous / unknown provider states → Gemini (diagnostic only).
        AMBIGUOUS_CODES = {
            "bank_server_error",
            "processor_route_mismatch",
            "unknown_gateway_state",
            "risk_review_pending",
            "network_authorization_anomaly",
            "unknown",
            "unknown_gateway_failure",
        }

        # Fast path for non-payment cases to avoid LLM latency (unless explicitly ambiguous)
        from backend.app.models.case import CaseType
        if ctx.case_type == CaseType.SUBSCRIPTION and error_code not in AMBIGUOUS_CODES:
            error_lower = (ctx.error_code or "").lower()
            if "halted" in error_lower:
                return TriageResult(
                    error_code=ctx.error_code or "subscription_halted",
                    diagnosis="SUBSCRIPTION_HALTED",
                    is_ambiguous=False,
                    recommended_action=InterventionType.ESCALATE,
                    reason="subscription_halted",
                    confidence=0.95,
                    requires_human=True,
                    ai_used=False,
                )
            return TriageResult(
                error_code=ctx.error_code or "subscription_failed",
                diagnosis="SUBSCRIPTION_PAYMENT_FAILED",
                is_ambiguous=False,
                recommended_action=InterventionType.RETRY_LATER,
                reason="subscription_payment_failed",
                confidence=0.90,
                delay_hours=RECOVERY_POLICY.get("transient_failure_retry_delay_hours", 1),
                requires_human=False,
                ai_used=False,
            )
        if ctx.case_type != CaseType.PAYMENT_FAILURE and error_code not in AMBIGUOUS_CODES:
            return TriageResult(
                error_code=ctx.error_code or "unknown",
                diagnosis=f"{ctx.case_type.value}_DIAGNOSIS",
                is_ambiguous=False,
                recommended_action=InterventionType.ESCALATE,  # compatibility hint only; RecoveryAgent decides
                reason=f"{ctx.case_type.value}_triage",
                confidence=1.0,
                requires_human=False,
            )

        # 2. Ambiguous Fallback via Gemini (PII-Redacted)
        # Triage answers WHAT HAPPENED — recommended_action is a legacy hint only.
        redacted = redact_for_llm(ctx)
        llm_decision: TriageDecision = gemini_classify(redacted)

        # Map action string to InterventionType (compatibility for callers that still read it)
        action_str = (llm_decision.action or "").strip().lower()
        if action_str == "retry":
            decision_type = InterventionType.RETRY_LATER
        elif action_str in ["send_payment_link", "payment_link"]:
            decision_type = InterventionType.PAYMENT_LINK
        elif action_str == "block":
            decision_type = InterventionType.BLOCK
        else:
            decision_type = InterventionType.ESCALATE

        confidence = float(llm_decision.confidence) if llm_decision.confidence is not None else 0.5
        min_conf = RECOVERY_POLICY.get("llm_confidence_threshold", 0.90)

        requires_human = False
        if confidence < min_conf:
            requires_human = True
            decision_type = InterventionType.ESCALATE

        diagnosis = (llm_decision.reason or "").upper().replace(" ", "_")[:64] if llm_decision.reason else "AMBIGUOUS_PROVIDER_FAILURE"
        if error_code in AMBIGUOUS_CODES:
            diagnosis = error_code.upper()

        return TriageResult(
            error_code=ctx.error_code,
            diagnosis=diagnosis or "AMBIGUOUS_PROVIDER_FAILURE",
            is_ambiguous=True,
            recommended_action=decision_type,
            reason=llm_decision.reason or "llm_classified",
            confidence=confidence,
            template_id=llm_decision.template,
            delay_hours=llm_decision.delay_hours,
            requires_human=requires_human,
            ai_used=getattr(llm_decision, "ai_used", True),
            model_used=getattr(llm_decision, "model_used", None),
            fallback_used=getattr(llm_decision, "fallback_used", False),
        )


# Module-level convenience functions
triage = TriageEngine.triage
triage_payment = TriageEngine.triage
