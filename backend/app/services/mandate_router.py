"""
Mandate-Aware Recovery Router: Decision Orchestration Layer.
Evaluates MandateState (NEW, ACTIVE, REISSUED, REVOKED, UNKNOWN), RBI AFA thresholds,
and triage recommendations to produce a structured RecoveryDecision (PENDING_SAFETY).
"""
from typing import Dict, Any, Optional, Union
from pathlib import Path
import yaml

from backend.app.config import settings
from backend.app.models.payment import PaymentContext, TriageResult, RecoveryDecision, InterventionType
from backend.app.models.mandate import MandateState
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.triage import TriageEngine


def _load_policies():
    reg_rules = {}
    rec_rules = {}
    reg_path = Path(settings.regulatory_policy_path)
    if reg_path.exists():
        with open(reg_path, "r") as f:
            data = yaml.safe_load(f)
            if data and "policy" in data:
                reg_rules = data["policy"].get("rules", {})
    rec_path = Path(settings.recovery_policy_path)
    if rec_path.exists():
        with open(rec_path, "r") as f:
            data = yaml.safe_load(f)
            if data and "policy" in data:
                rec_rules = data["policy"].get("rules", {})
    return reg_rules, rec_rules


REGULATORY_RULES, RECOVERY_RULES = _load_policies()


class MandateRouter:
    @staticmethod
    def route(
        ctx: Union[PaymentContext, Dict[str, Any]],
        triage: Optional[TriageResult] = None,
    ) -> RecoveryDecision:
        """
        Orchestrates recovery decision based on MandateState and TriageResult.
        Output eligibility is always PENDING_SAFETY for subsequent evaluation by Safety Gate.
        """
        if not isinstance(ctx, PaymentContext):
            ctx = ContextBuilder.build_context(ctx)

        if triage is None:
            triage = TriageEngine.triage(ctx)

        mandate_state = ctx.mandate_state or MandateState.UNKNOWN
        afa_threshold = float(REGULATORY_RULES.get("afa_free_threshold_standard_inr", 15000.0))

        # 1. State: REVOKED -> Absolute Block
        if mandate_state == MandateState.REVOKED or ctx.error_code == "mandate_revoked":
            return RecoveryDecision(
                decision=InterventionType.BLOCK,
                eligibility="PENDING_SAFETY",
                reason_code="MANDATE_REVOKED_NO_RETRY",
                policy_id="mandate_lifecycle_v1",
                confidence=1.0,
                requires_human=False,
            )

        # 2. State: NEW or First Transaction -> AFA Payment Link Required
        if mandate_state == MandateState.NEW or ctx.is_first_transaction:
            return RecoveryDecision(
                decision=InterventionType.AFA_PAYMENT_LINK,
                eligibility="PENDING_SAFETY",
                reason_code="NEW_MANDATE_AFA_REQUIRED",
                policy_id="mandate_lifecycle_v1",
                confidence=1.0,
                requires_human=False,
                template_id="dlt_first_txn_v1",
            )

        # 3. State: ACTIVE, REISSUED, or UNKNOWN
        action = triage.recommended_action

        # Case A: Retry requested
        if action in [InterventionType.RETRY_LATER, InterventionType.RETRY_NOW]:
            # Check AFA threshold (> 15k INR)
            if ctx.amount_inr > afa_threshold:
                return RecoveryDecision(
                    decision=InterventionType.AFA_PAYMENT_LINK,
                    eligibility="PENDING_SAFETY",
                    reason_code="AFA_THRESHOLD_EXCEEDED",
                    policy_id="regulatory_afa_v1",
                    confidence=triage.confidence,
                    requires_human=False,
                    template_id="dlt_afa_threshold_v1",
                )
            # Standard or Transient Retry
            delay = triage.delay_hours or RECOVERY_RULES.get("standard_retry_delay_hours", 24)
            reason_code = "TRANSIENT_TIMEOUT" if ("timeout" in triage.reason.lower() or "timed_out" in (ctx.error_code or "").lower()) else "TRANSIENT_FAILURE"
            return RecoveryDecision(
                decision=action,
                eligibility="PENDING_SAFETY",
                reason_code=reason_code,
                policy_id="mandate_active_retry_v1",
                confidence=triage.confidence,
                requires_human=triage.requires_human,
                delay_hours=delay,
            )

        # Case B: Payment Link requested
        if action == InterventionType.PAYMENT_LINK:
            template = triage.template_id
            if not template:
                template = "dlt_card_update_v1" if triage.reason == "expired_card" else "dlt_upi_alternate_v1"
            return RecoveryDecision(
                decision=InterventionType.PAYMENT_LINK,
                eligibility="PENDING_SAFETY",
                reason_code=f"ALTERNATIVE_PAYMENT_LINK_{triage.reason.upper()}",
                policy_id="mandate_link_v1",
                confidence=triage.confidence,
                requires_human=triage.requires_human,
                template_id=template,
            )

        # Case C: AFA Payment Link requested
        if action == InterventionType.AFA_PAYMENT_LINK:
            return RecoveryDecision(
                decision=InterventionType.AFA_PAYMENT_LINK,
                eligibility="PENDING_SAFETY",
                reason_code="AFA_PAYMENT_LINK_PROPOSED",
                policy_id="mandate_afa_v1",
                confidence=triage.confidence,
                requires_human=triage.requires_human,
                template_id=triage.template_id or "dlt_afa_threshold_v1",
            )

        # Case D: Block requested
        if action == InterventionType.BLOCK:
            return RecoveryDecision(
                decision=InterventionType.BLOCK,
                eligibility="PENDING_SAFETY",
                reason_code=triage.reason.upper() if triage.reason else "TRIAGE_BLOCK",
                policy_id="mandate_triage_block_v1",
                confidence=triage.confidence,
                requires_human=False,
            )

        # Case E: Escalate requested
        return RecoveryDecision(
            decision=InterventionType.ESCALATE,
            eligibility="PENDING_SAFETY",
            reason_code=triage.reason if triage.reason else "TRIAGE_ESCALATE",
            policy_id="mandate_triage_escalate_v1",
            confidence=triage.confidence,
            requires_human=True,
        )


# Backward compatibility convenience functions
route = MandateRouter.route
route_payment = MandateRouter.route
