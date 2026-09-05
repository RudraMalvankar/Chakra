"""
Mandate-Aware Recovery Router: Decision Orchestration Layer.
Evaluates MandateState, case types, and triage recommendations to produce a structured RecoveryDecision.
"""
from typing import Dict, Any, Optional, Union
from pathlib import Path
import yaml

from backend.app.config import settings
from backend.app.models.case import RecoveryCase, CaseType, TriageResult, RecoveryDecision, InterventionType
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
    @classmethod
    def route(
        cls,
        ctx: Union[RecoveryCase, Dict[str, Any]],
        triage: Optional[TriageResult] = None,
    ) -> RecoveryDecision:
        if not isinstance(ctx, RecoveryCase):
            ctx = ContextBuilder.build_context(ctx)

        if triage is None:
            triage = TriageEngine.triage(ctx)

        if ctx.case_type == CaseType.SUBSCRIPTION:
            return cls._route_subscription(ctx, triage)
        elif ctx.case_type == CaseType.CHECKOUT_ABANDONMENT:
            return cls._route_checkout(ctx, triage)
        elif ctx.case_type == CaseType.RECEIVABLE:
            return cls._route_receivable(ctx, triage)
        elif ctx.case_type == CaseType.PROMISE_TO_PAY:
            return cls._route_promise_to_pay(ctx, triage)
        
        return cls._route_payment(ctx, triage)

    @staticmethod
    def _route_payment(ctx: RecoveryCase, triage: TriageResult) -> RecoveryDecision:
        mandate_state = ctx.mandate_state or MandateState.UNKNOWN
        afa_threshold = float(REGULATORY_RULES.get("afa_free_threshold_standard_inr", 15000.0))

        # 1. MANDATE REVOKED: STOP automatic retry -> BLOCK -> ESCALATE / customer remediation
        if mandate_state == MandateState.REVOKED or ctx.error_code in ["mandate_revoked", "mandate_cancelled"]:
            return RecoveryDecision(
                decision=InterventionType.BLOCK,
                eligibility="PENDING_SAFETY",
                reason_code="MANDATE_REVOKED_NO_RETRY",
                policy_id="mandate_lifecycle_v1",
                confidence=1.0,
                requires_human=False,
            )

        # 2. FRAUD: STOP -> BLOCK -> ESCALATE
        if ctx.fraud_flag or ctx.error_code in ["fraud_flag", "fraud_suspected", "stolen_card"] or triage.diagnosis == "FRAUD_SIGNAL":
            return RecoveryDecision(
                decision=InterventionType.BLOCK,
                eligibility="PENDING_SAFETY",
                reason_code="FRAUD_STOP_BLOCK_ESCALATE",
                policy_id="fraud_risk_policy_v1",
                confidence=1.0,
                requires_human=True,
            )

        # 3. Regulatory AFA for New Mandate / First Transaction
        if mandate_state == MandateState.NEW or ctx.is_first_transaction:
            return RecoveryDecision(
                decision=InterventionType.AFA_PAYMENT_LINK,
                eligibility="PENDING_SAFETY",
                reason_code="NEW_MANDATE_AFA_REQUIRED",
                policy_id="mandate_lifecycle_v1",
                confidence=1.0,
                template_id="dlt_first_txn_v1",
            )

        # 4. EXPIRED CARD: payment link / update payment method -> avoid blind retrying the same instrument
        if ctx.error_code in ["expired_card", "card_expired"] or triage.diagnosis == "EXPIRED_CARD":
            return RecoveryDecision(
                decision=InterventionType.PAYMENT_LINK,
                eligibility="PENDING_SAFETY",
                reason_code="ALTERNATIVE_PAYMENT_LINK_EXPIRED_CARD",
                policy_id="mandate_link_v1",
                confidence=triage.confidence or 0.99,
                requires_human=False,
                template_id="dlt_card_update_v1",
            )

        # 5. BANK TIMEOUT / TRANSIENT NETWORK: retry later -> respect retry/cooldown limits
        if ctx.error_code in ["payment_timed_out", "timed_out", "timeout", "bank_technical_error_503"] or "timeout" in triage.reason.lower() or triage.diagnosis == "TRANSIENT_NETWORK_FAILURE":
            if ctx.retry_count >= 3:
                return RecoveryDecision(
                    decision=InterventionType.ESCALATE,
                    eligibility="PENDING_SAFETY",
                    reason_code="TRANSIENT_RETRY_LIMIT_EXCEEDED",
                    policy_id="mandate_active_retry_v1",
                    confidence=triage.confidence,
                    requires_human=True,
                )
            cooldown = triage.delay_hours or RECOVERY_RULES.get("transient_failure_retry_delay_hours", 1)
            return RecoveryDecision(
                decision=InterventionType.RETRY_LATER,
                eligibility="PENDING_SAFETY",
                reason_code="TRANSIENT_TIMEOUT",
                policy_id="mandate_active_retry_v1",
                confidence=triage.confidence,
                requires_human=False,
                delay_hours=cooldown,
            )

        # 6. INSUFFICIENT FUNDS: wait / retry later -> payment reminder -> payment link if appropriate
        if ctx.error_code in ["insufficient_funds", "nsf", "low_balance"] or triage.diagnosis == "INSUFFICIENT_FUNDS":
            if ctx.amount_inr > afa_threshold:
                return RecoveryDecision(
                    decision=InterventionType.AFA_PAYMENT_LINK,
                    eligibility="PENDING_SAFETY",
                    reason_code="AFA_THRESHOLD_EXCEEDED",
                    policy_id="regulatory_afa_v1",
                    confidence=triage.confidence,
                    template_id="dlt_afa_threshold_v1",
                )
            if ctx.retry_count == 0:
                # Stage 1: wait / retry later
                delay = triage.delay_hours or RECOVERY_RULES.get("standard_retry_delay_hours", 24)
                return RecoveryDecision(
                    decision=InterventionType.RETRY_LATER,
                    eligibility="PENDING_SAFETY",
                    reason_code="TRANSIENT_FAILURE",
                    policy_id="mandate_active_retry_v1",
                    confidence=triage.confidence,
                    requires_human=False,
                    delay_hours=delay,
                )
            elif ctx.retry_count == 1:
                # Stage 2: payment reminder
                return RecoveryDecision(
                    decision=InterventionType.REMINDER,
                    eligibility="PENDING_SAFETY",
                    reason_code="INSUFFICIENT_FUNDS_REMINDER",
                    policy_id="mandate_active_retry_v1",
                    confidence=triage.confidence,
                    requires_human=False,
                    template_id="dlt_afa_threshold_v1",
                )
            else:
                # Stage 3: payment link if appropriate
                return RecoveryDecision(
                    decision=InterventionType.PAYMENT_LINK,
                    eligibility="PENDING_SAFETY",
                    reason_code="ALTERNATIVE_PAYMENT_LINK_INSUFFICIENT_FUNDS",
                    policy_id="mandate_link_v1",
                    confidence=triage.confidence,
                    requires_human=False,
                    template_id="dlt_upi_alternate_v1",
                )

        # General Action Dispatch from Triage
        action = triage.recommended_action

        if action in [InterventionType.RETRY_LATER, InterventionType.RETRY_NOW]:
            if ctx.amount_inr > afa_threshold:
                return RecoveryDecision(decision=InterventionType.AFA_PAYMENT_LINK, eligibility="PENDING_SAFETY", reason_code="AFA_THRESHOLD_EXCEEDED", policy_id="regulatory_afa_v1", confidence=triage.confidence, template_id="dlt_afa_threshold_v1")
            delay = triage.delay_hours or RECOVERY_RULES.get("standard_retry_delay_hours", 24)
            reason_code = "TRANSIENT_TIMEOUT" if ("timeout" in triage.reason.lower() or "timed_out" in (ctx.error_code or "").lower()) else "TRANSIENT_FAILURE"
            return RecoveryDecision(decision=action, eligibility="PENDING_SAFETY", reason_code=reason_code, policy_id="mandate_active_retry_v1", confidence=triage.confidence, requires_human=triage.requires_human, delay_hours=delay)

        if action == InterventionType.PAYMENT_LINK:
            template = triage.template_id or ("dlt_card_update_v1" if triage.reason == "expired_card" else "dlt_upi_alternate_v1")
            return RecoveryDecision(decision=action, eligibility="PENDING_SAFETY", reason_code=f"ALTERNATIVE_PAYMENT_LINK_{triage.reason.upper()}", policy_id="mandate_link_v1", confidence=triage.confidence, requires_human=triage.requires_human, template_id=template)

        if action == InterventionType.AFA_PAYMENT_LINK:
            return RecoveryDecision(decision=action, eligibility="PENDING_SAFETY", reason_code="AFA_PAYMENT_LINK_PROPOSED", policy_id="mandate_afa_v1", confidence=triage.confidence, requires_human=triage.requires_human, template_id=triage.template_id or "dlt_afa_threshold_v1")

        if action == InterventionType.BLOCK:
            return RecoveryDecision(decision=action, eligibility="PENDING_SAFETY", reason_code=triage.reason.upper() if triage.reason else "TRIAGE_BLOCK", policy_id="mandate_triage_block_v1", confidence=triage.confidence)

        return RecoveryDecision(decision=InterventionType.ESCALATE, eligibility="PENDING_SAFETY", reason_code=triage.reason if triage.reason else "TRIAGE_ESCALATE", policy_id="mandate_triage_escalate_v1", confidence=triage.confidence, requires_human=True)

    @staticmethod
    def _extract_nested_value(ctx: RecoveryCase, key: str, default: Any = None) -> Any:
        if key in ctx.context:
            return ctx.context[key]
        if key in ctx.metadata:
            return ctx.metadata[key]
        notes = ctx.context.get("notes") or ctx.metadata.get("notes") or {}
        if isinstance(notes, dict) and key in notes:
            return notes[key]
        return default

    @staticmethod
    def _route_subscription(ctx: RecoveryCase, triage: TriageResult) -> RecoveryDecision:
        try:
            days = int(MandateRouter._extract_nested_value(ctx, "days_overdue", 0))
        except (ValueError, TypeError):
            days = 0
        if days == 0:
            return RecoveryDecision(decision=InterventionType.RETRY_LATER, reason_code="SUB_DAY_0_RETRY", policy_id="sub_policy_v1")
        if days < 7:
            return RecoveryDecision(decision=InterventionType.PAYMENT_LINK, reason_code="SUB_DAY_3_LINK", policy_id="sub_policy_v1", template_id="sub_recovery_link")
        if days < 14:
            return RecoveryDecision(decision=InterventionType.VOICE_RECOVERY, reason_code="SUB_DAY_7_VOICE", policy_id="sub_policy_v1")
        if days < 30:
            return RecoveryDecision(decision=InterventionType.ESCALATE, reason_code="SUB_DAY_14_ESCALATE", policy_id="sub_policy_v1", requires_human=True)
        return RecoveryDecision(decision=InterventionType.BLOCK, reason_code="SUB_DAY_30_STOP", policy_id="sub_policy_v1")

    @staticmethod
    def _route_checkout(ctx: RecoveryCase, triage: TriageResult) -> RecoveryDecision:
        return RecoveryDecision(decision=InterventionType.PAYMENT_LINK, reason_code="CHECKOUT_ABANDONED_LINK", policy_id="checkout_policy_v1", template_id="checkout_recovery")

    @staticmethod
    def _route_receivable(ctx: RecoveryCase, triage: TriageResult) -> RecoveryDecision:
        try:
            days = int(MandateRouter._extract_nested_value(ctx, "days_overdue", 0))
        except (ValueError, TypeError):
            days = 0
        if days < 31:
            return RecoveryDecision(decision=InterventionType.REMINDER, reason_code="INVOICE_REMINDER", policy_id="recv_policy_v1", template_id="invoice_reminder")
        if days < 61:
            return RecoveryDecision(decision=InterventionType.PAYMENT_LINK, reason_code="INVOICE_LINK", policy_id="recv_policy_v1", template_id="invoice_link")
        return RecoveryDecision(decision=InterventionType.ESCALATE, reason_code="INVOICE_ESCALATE", policy_id="recv_policy_v1", requires_human=True)

    @staticmethod
    def _route_promise_to_pay(ctx: RecoveryCase, triage: TriageResult) -> RecoveryDecision:
        status = MandateRouter._extract_nested_value(ctx, "promise_status", "ACTIVE")
        if status == "BROKEN" or ctx.error_code == "broken":
            return RecoveryDecision(decision=InterventionType.ESCALATE, reason_code="PROMISE_BROKEN_NO_RETRY", policy_id="ptp_policy_v1", requires_human=True)
        return RecoveryDecision(decision=InterventionType.REMINDER, reason_code="PROMISE_REMINDER", policy_id="ptp_policy_v1")


route = MandateRouter.route
route_payment = MandateRouter.route
