
from pathlib import Path
import yaml
from backend.app.config import settings

def _load_threshold():
    try:
        policy_path = Path(settings.recovery_policy_path)
        if policy_path.exists():
            with open(policy_path, 'r') as f:
                data = yaml.safe_load(f)
                return data.get('policy', {}).get('regulatory', {}).get('afa_free_threshold_standard_inr', 15000)
    except:
        pass
    return 15000

REGULATORY_THRESHOLD = _load_threshold()

from backend.app.models.case import RecoveryCase
"""
Enforcer Safety Gate: Non-Overridable Deterministic Policy Enforcer.
Evaluates proposed RecoveryDecisions against RBI regulations, card network rules,
churn risk, SHA-256 idempotency locks, and customer monthly intervention budgets.
"""
from typing import Dict, Any, Optional, Union, Set
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import yaml

from backend.app.config import settings
from backend.app.models.payment import (
    
    RecoveryDecision,
    SafetyEvaluation,
    InterventionType,
)
from backend.app.models.mandate import MandateState
from backend.app.services.context_builder import ContextBuilder


def _load_safety_policies():
    reg = {}
    rec = {}
    reg_path = Path(settings.regulatory_policy_path)
    if reg_path.exists():
        with open(reg_path, "r") as f:
            data = yaml.safe_load(f)
            if data and "policy" in data:
                reg = data["policy"].get("rules", {})
    rec_path = Path(settings.recovery_policy_path)
    if rec_path.exists():
        with open(rec_path, "r") as f:
            data = yaml.safe_load(f)
            if data and "policy" in data:
                rec = data["policy"].get("rules", {})
    return reg, rec


REGULATORY_POLICY, RECOVERY_POLICY = _load_safety_policies()

# In-Memory Safety Gate State (In production: Redis / DynamoDB)
IDEMPOTENCY_STORE: Set[str] = set()
CUSTOMER_INTERVENTION_COUNTS: Dict[str, int] = {}


def generate_idempotency_key(payment_id: str, intervention: str, day: str) -> str:
    """Computes SHA256(payment_id + intervention + day)."""
    return hashlib.sha256(f"{payment_id}_{intervention}_{day}".encode("utf-8")).hexdigest()


def reset_safety_state() -> None:
    """Clears all in-memory idempotency locks and customer intervention counts."""
    IDEMPOTENCY_STORE.clear()
    CUSTOMER_INTERVENTION_COUNTS.clear()


class SafetyGate:
    @staticmethod
    def evaluate(
        ctx: Union[RecoveryCase, Dict[str, Any]],
        proposed: RecoveryDecision,
        day: Optional[str] = None,
    ) -> RecoveryDecision:
        """
        Evaluates proposed decision against hard compliance and safety rules.
        Returns the finalized, safe RecoveryDecision.
        """
        if not isinstance(ctx, RecoveryCase):
            ctx = ContextBuilder.build_context(ctx)

        if day is None:
            day = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        network = (ctx.network or "unknown").strip().lower()
        network_caps = REGULATORY_POLICY.get("network_retry_caps", {"visa": 15, "mastercard": 10, "rupay": 15})
        max_budget = RECOVERY_POLICY.get("max_interventions_per_customer_per_month", 3)
        churn_threshold = RECOVERY_POLICY.get("high_alerts_ignored_threshold", 2)
        afa_threshold = float(REGULATORY_POLICY.get("afa_free_threshold_standard_inr", float(REGULATORY_THRESHOLD)))

        # Clone decision to prevent unexpected in-place side effects
        final_dec = proposed.model_copy()

        # 1. HARD BLOCK: Fraud
        if ctx.fraud_flag or ctx.error_code == "fraud_flag":
            final_dec.decision = InterventionType.BLOCK
            final_dec.eligibility = "BLOCKED"
            final_dec.reason_code = "HARD_COMPLIANCE_BLOCK"
            final_dec.requires_human = False
            return final_dec

        # 2. HARD BLOCK: Mandate Revoked
        if ctx.mandate_state == MandateState.REVOKED or ctx.error_code == "mandate_revoked":
            final_dec.decision = InterventionType.BLOCK
            final_dec.eligibility = "BLOCKED"
            final_dec.reason_code = "HARD_COMPLIANCE_BLOCK"
            final_dec.requires_human = False
            return final_dec

        # 3. AFA REGULATORY: First Mandate Transaction
        if final_dec.decision not in [InterventionType.BLOCK, InterventionType.ESCALATE]:
            if ctx.is_first_transaction and REGULATORY_POLICY.get("first_mandate_transaction_requires_afa", True):
                final_dec.decision = InterventionType.AFA_PAYMENT_LINK
                final_dec.reason_code = "SAFETY_MODIFIED_FIRST_TXN_AFA"
                final_dec.template_id = "dlt_first_txn_v1"

            # 4. AFA REGULATORY: Amount Threshold (> ₹15,000)
            elif ctx.amount_inr > afa_threshold:
                final_dec.decision = InterventionType.AFA_PAYMENT_LINK
                final_dec.reason_code = "SAFETY_MODIFIED_AFA_LIMIT"
                final_dec.template_id = "dlt_afa_threshold_v1"

        # 5. CHURN RISK ENFORCER: Pre-Debit Alerts Ignored (>= 2)
        if ctx.alerts_ignored >= churn_threshold:
            final_dec.decision = InterventionType.ESCALATE
            final_dec.eligibility = "ESCALATED"
            final_dec.reason_code = "HIGH_ALERTS_IGNORED_CHURN_RISK"
            final_dec.requires_human = True
            return final_dec

        # 6. NETWORK RETRY CAPS (Visa: 15, Mastercard: 10, Rupay: 15)
        if network in network_caps:
            cap = network_caps[network]
            if ctx.retry_count >= cap:
                final_dec.decision = InterventionType.BLOCK
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "NETWORK_RETRY_CAP_REACHED"
                final_dec.requires_human = False
                return final_dec

        # 7. IDEMPOTENCY & CUSTOMER MONTHLY BUDGET GOVERNOR
        if final_dec.decision not in [InterventionType.BLOCK, InterventionType.ESCALATE]:
            idem_key = generate_idempotency_key(ctx.payment_id, final_dec.decision.value, day)
            if idem_key in IDEMPOTENCY_STORE:
                final_dec.decision = InterventionType.BLOCK
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "IDEMPOTENCY_DUPLICATE_EVENT"
                return final_dec

            # Extract current month for budget
            current_month = datetime.now(timezone.utc).strftime("%Y-%m")
            budget_key = f"{ctx.customer_id}_{current_month}"

            current_count = CUSTOMER_INTERVENTION_COUNTS.get(budget_key, 0)
            if current_count >= max_budget:
                final_dec.decision = InterventionType.BLOCK
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "CUSTOMER_BUDGET_EXCEEDED"
                return final_dec

            # Lock idempotency and increment budget
            IDEMPOTENCY_STORE.add(idem_key)
            CUSTOMER_INTERVENTION_COUNTS[budget_key] = current_count + 1

        final_dec.eligibility = "ALLOWED"
        return final_dec

    @staticmethod
    def evaluate_detailed(
        ctx: Union[RecoveryCase, Dict[str, Any]],
        proposed: RecoveryDecision,
        day: Optional[str] = None,
    ) -> SafetyEvaluation:
        """Detailed evaluation returning typed SafetyEvaluation model."""
        final_dec = SafetyGate.evaluate(ctx, proposed, day)
        allowed = final_dec.eligibility == "ALLOWED"
        modified = (final_dec.decision != proposed.decision)
        cust_id = ctx.customer_id if isinstance(ctx, RecoveryCase) else ctx.get("customer_id", "unknown")
        day_str = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        current_month = datetime.strptime(day_str, "%Y-%m-%d").strftime("%Y-%m") if day else datetime.now(timezone.utc).strftime("%Y-%m")
        budget_key = f"{cust_id}_{current_month}"

        current_budget = CUSTOMER_INTERVENTION_COUNTS.get(budget_key, 0)
        pid = ctx.payment_id if isinstance(ctx, RecoveryCase) else ctx.get("payment_id", "unknown")
        idem_key = generate_idempotency_key(pid, final_dec.decision.value, day_str)

        return SafetyEvaluation(
            allowed=allowed,
            final_decision=final_dec.decision,
            decision=final_dec.decision,
            eligibility=final_dec.eligibility,
            reason_code=final_dec.reason_code,
            idempotency_key=idem_key,
            budget_count=current_budget,
            policy_id="safety_gate_v1",
            modified_from_proposed=modified,
            original_decision=proposed.decision,
            enforced_rules=[final_dec.reason_code] if modified or not allowed else [],
        )


# Backward compatibility convenience functions
enforce_safety = SafetyGate.evaluate
