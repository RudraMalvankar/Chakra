
from backend.app.config import settings
from backend.app.lib.config_utils import get_regulatory_threshold, get_recovery_policy, get_regulatory_policy

REGULATORY_THRESHOLD = get_regulatory_threshold()

from backend.app.models.case import RecoveryCase
"""
Enforcer Safety Gate: Non-Overridable Deterministic Policy Enforcer.
Evaluates proposed RecoveryDecisions against RBI regulations, card network rules,
churn risk, idempotency locks, and customer monthly intervention budgets.

Safety state is persisted in Neon Postgres (safety_state table).
In-memory caches provide fast reads; writes go to DB first.
"""
from typing import Dict, Any, Optional, Union, Set
from datetime import datetime, timezone
import hashlib
import logging

from backend.app.config import settings
from backend.app.models.payment import (

    RecoveryDecision,
    SafetyEvaluation,
    InterventionType,
)
from backend.app.models.mandate import MandateState
from backend.app.services.context_builder import ContextBuilder

logger = logging.getLogger("chakra.safety_gate")

REGULATORY_POLICY = get_regulatory_policy()
RECOVERY_POLICY = get_recovery_policy()

# In-memory caches backed by Neon Postgres
# These are performance caches, NOT authoritative — DB is authoritative
IDEMPOTENCY_CACHE: Set[str] = set()
CUSTOMER_INTERVENTION_CACHE: Dict[str, int] = {}
_safety_state_loaded = False
_skip_db_state = False  # Set True by conftest to prevent DB state leakage in tests


def _get_db_session():
    """Get a DB session, returns None if DB not configured."""
    if not settings.is_database_configured:
        return None
    try:
        from backend.app.db.session import get_session_factory
        factory = get_session_factory()
        return factory()
    except Exception as e:
        logger.warning(f"Could not get DB session for safety state: {e}")
        return None


def _load_safety_state_from_db():
    """Loads safety state from DB into memory caches. Called once on first evaluate()."""
    global _safety_state_loaded
    if _safety_state_loaded or _skip_db_state:
        return

    session = _get_db_session()
    if not session:
        _safety_state_loaded = True
        return

    try:
        from sqlalchemy import select
        from backend.app.db.models import SafetyState

        # Load idempotency keys (not expired)
        now = datetime.now(timezone.utc)
        stmt = select(SafetyState).where(
            SafetyState.state_type == "idempotency"
        )
        rows = session.execute(stmt).scalars().all()
        for row in rows:
            if row.expires_at and row.expires_at.replace(tzinfo=timezone.utc) < now:
                continue  # Skip expired
            IDEMPOTENCY_CACHE.add(row.state_key)

        # Load intervention counts
        stmt = select(SafetyState).where(
            SafetyState.state_type == "intervention_budget"
        )
        rows = session.execute(stmt).scalars().all()
        for row in rows:
            try:
                CUSTOMER_INTERVENTION_CACHE[row.state_key] = int(row.state_value or "0")
            except (ValueError, TypeError):
                pass

        logger.info(f"Loaded safety state: {len(IDEMPOTENCY_CACHE)} idempotency keys, {len(CUSTOMER_INTERVENTION_CACHE)} budget entries")
    except Exception as e:
        logger.warning(f"Could not load safety state from DB: {e}")
    finally:
        session.close()
        _safety_state_loaded = True


def _persist_idempotency_key(key: str, day: str) -> str:
    """Persist idempotency key.

    Returns: 'ok' | 'duplicate' | 'persist_failed'
    Fail-closed on DB errors when database is configured.
    Unit tests set _skip_db_state to use in-memory caches only.
    """
    if _skip_db_state:
        return "ok"

    session = _get_db_session()
    if not session:
        if settings.is_database_configured:
            return "persist_failed"
        return "ok"

    try:
        from backend.app.db.models import SafetyState
        from sqlalchemy import select

        stmt = select(SafetyState).where(
            SafetyState.state_type == "idempotency",
            SafetyState.state_key == key
        )
        existing = session.execute(stmt).scalar_one_or_none()
        if existing:
            return "duplicate"

        from datetime import timedelta
        expires = datetime.now(timezone.utc) + timedelta(days=7)

        state = SafetyState(
            state_type="idempotency",
            state_key=key,
            state_value="1",
            expires_at=expires,
        )
        session.add(state)
        session.commit()
        return "ok"
    except Exception as e:
        session.rollback()
        logger.warning(f"Could not persist idempotency key: {e}")
        return "persist_failed"
    finally:
        session.close()


def _persist_intervention_budget(budget_key: str, count: int) -> bool:
    """Persists intervention count to DB. Returns False on persistence failure when DB configured."""
    if _skip_db_state:
        return True

    session = _get_db_session()
    if not session:
        if settings.is_database_configured:
            return False
        return True

    try:
        from backend.app.db.models import SafetyState
        from sqlalchemy import select

        stmt = select(SafetyState).where(
            SafetyState.state_type == "intervention_budget",
            SafetyState.state_key == budget_key
        )
        existing = session.execute(stmt).scalar_one_or_none()
        if existing:
            existing.state_value = str(count)
            existing.updated_at = datetime.now(timezone.utc)
        else:
            state = SafetyState(
                state_type="intervention_budget",
                state_key=budget_key,
                state_value=str(count),
            )
            session.add(state)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        logger.warning(f"Could not persist intervention budget: {e}")
        return False
    finally:
        session.close()


def generate_idempotency_key(payment_id: str, intervention: str, day: str) -> str:
    """Computes SHA256(payment_id + intervention + day)."""
    return hashlib.sha256(f"{payment_id}_{intervention}_{day}".encode("utf-8")).hexdigest()


def reset_safety_state() -> None:
    """Clears all in-memory idempotency locks and customer intervention counts.
    For test isolation only — does NOT clear DB state.
    Sets _safety_state_loaded=True so DB does not re-pollute cleared caches."""
    global _safety_state_loaded
    IDEMPOTENCY_CACHE.clear()
    CUSTOMER_INTERVENTION_CACHE.clear()
    _safety_state_loaded = True


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

        # Load safety state from DB on first call
        _load_safety_state_from_db()

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
                final_dec.eligibility = "ALLOWED"
                return final_dec

            # 4. AFA REGULATORY: Amount Threshold (> ₹15,000)
            elif ctx.amount_inr > afa_threshold:
                final_dec.decision = InterventionType.AFA_PAYMENT_LINK
                final_dec.reason_code = "SAFETY_MODIFIED_AFA_LIMIT"
                final_dec.template_id = "dlt_afa_threshold_v1"
                final_dec.eligibility = "ALLOWED"
                return final_dec

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
            if idem_key in IDEMPOTENCY_CACHE:
                final_dec.decision = InterventionType.BLOCK
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "IDEMPOTENCY_DUPLICATE_EVENT"
                return final_dec

            # Extract current month for budget
            current_month = datetime.now(timezone.utc).strftime("%Y-%m")
            budget_key = f"{ctx.customer_id}_{current_month}"

            current_count = CUSTOMER_INTERVENTION_CACHE.get(budget_key, 0)
            if current_count >= max_budget:
                final_dec.decision = InterventionType.BLOCK
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "CUSTOMER_BUDGET_EXCEEDED"
                return final_dec

            # Persist to DB and update cache — fail closed on persistence errors
            persist_status = _persist_idempotency_key(idem_key, day)
            if persist_status == "duplicate":
                final_dec.decision = InterventionType.ESCALATE
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "IDEMPOTENCY_DUPLICATE"
                return final_dec
            if persist_status == "persist_failed":
                final_dec.decision = InterventionType.ESCALATE
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "SAFETY_STATE_PERSISTENCE_FAILED"
                return final_dec
            IDEMPOTENCY_CACHE.add(idem_key)

            new_count = current_count + 1
            if not _persist_intervention_budget(budget_key, new_count):
                final_dec.decision = InterventionType.ESCALATE
                final_dec.eligibility = "BLOCKED"
                final_dec.reason_code = "SAFETY_BUDGET_PERSISTENCE_FAILED"
                return final_dec
            CUSTOMER_INTERVENTION_CACHE[budget_key] = new_count

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

        current_budget = CUSTOMER_INTERVENTION_CACHE.get(budget_key, 0)
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
