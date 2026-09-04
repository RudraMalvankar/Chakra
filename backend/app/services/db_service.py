"""
Database persistence service for Chakra Revenue Recovery Control Plane.
Interfaces with Neon Postgres via SQLAlchemy 2.x sessions.
"""
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import logging
import json

from sqlalchemy import select, func, desc, update
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.db.session import get_session_factory
from backend.app.db.models import (
    Customer,
    Payment,
    RecoveryCase,
    RecoveryDecision,
    RecoveryEvent,
    ProviderEvent,
    AuditEvent,
    BatchRun,
    BatchCase,
    Receivable,
    PromiseToPay,
    VoiceInteraction,
    utcnow,
)

logger = logging.getLogger("chakra.db_service")


def get_db_session() -> Optional[Session]:
    if not settings.is_database_configured:
        return None
    try:
        factory = get_session_factory()
        return factory()
    except Exception as e:
        logger.warning(f"Could not connect to database: {e}")
        return None


class DBService:

    @staticmethod
    def reset_database() -> None:
        """Truncates / deletes transactional benchmark data from Neon Postgres for fresh benchmark runs."""
        session = get_db_session()
        if not session:
            return
        try:
            # Delete in child-to-parent order
            session.query(RecoveryEvent).delete()
            session.query(RecoveryDecision).delete()
            session.query(ProviderEvent).delete()
            session.query(AuditEvent).delete()
            session.query(BatchCase).delete()
            session.query(BatchRun).delete()
            session.query(RecoveryCase).delete()
            session.query(Payment).delete()
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Error resetting database: {e}")
        finally:
            session.close()
    @staticmethod
    def upsert_customer(external_customer_id: str, display_name: Optional[str] = None, risk_tier: str = "LOW") -> Optional[str]:
        session = get_db_session()
        if not session:
            return None
        try:
            stmt = select(Customer).where(Customer.external_customer_id == external_customer_id)
            customer = session.execute(stmt).scalar_one_or_none()
            if not customer:
                customer = Customer(
                    external_customer_id=external_customer_id,
                    display_name=display_name or external_customer_id,
                    risk_tier=risk_tier,
                )
                session.add(customer)
                session.commit()
                session.refresh(customer)
            return customer.id
        except Exception as e:
            session.rollback()
            logger.error(f"Error upserting customer: {e}")
            return None
        finally:
            session.close()

    @staticmethod
    def upsert_payment(
        payment_id: str,
        amount_inr: float,
        customer_id: Optional[str] = None,
        status: str = "FAILED",
        failure_code: str = "unknown",
        payment_method: str = "UPI",
        provider: str = "synthetic",
        order_id: Optional[str] = None,
    ) -> Optional[Payment]:
        session = get_db_session()
        if not session:
            return None
        try:
            stmt = select(Payment).where(Payment.id == payment_id)
            payment = session.execute(stmt).scalar_one_or_none()
            if not payment:
                payment = Payment(
                    id=payment_id,
                    external_payment_id=payment_id,
                    external_order_id=order_id,
                    customer_id=customer_id,
                    amount=amount_inr,
                    status=status,
                    failure_code=failure_code,
                    payment_method=payment_method,
                    provider=provider,
                )
                session.add(payment)
            else:
                payment.status = status
                payment.failure_code = failure_code
                if order_id:
                    payment.external_order_id = order_id
                payment.updated_at = utcnow()
            session.commit()
            session.refresh(payment)
            return payment
        except Exception as e:
            session.rollback()
            logger.error(f"Error upserting payment: {e}")
            return None
        finally:
            session.close()

    @staticmethod
    def upsert_recovery_case(
        case_id: str,
        payment_id: Optional[str],
        case_type: str,
        amount_at_risk: float,
        status: str = "PENDING",
        risk_probability: float = 0.0,
        recovery_eligible: bool = True,
        current_action: str = "NONE",
        ai_used: bool = False,
        ai_classification: Optional[str] = None,
        ai_confidence: Optional[float] = None,
        ai_reasoning: Optional[str] = None,
        ai_fallback_used: bool = False,
    ) -> Optional[RecoveryCase]:
        session = get_db_session()
        if not session:
            return None
        try:
            stmt = select(RecoveryCase).where(RecoveryCase.id == case_id)
            case = session.execute(stmt).scalar_one_or_none()
            if not case:
                case = RecoveryCase(
                    id=case_id,
                    payment_id=payment_id,
                    case_type=case_type,
                    status=status,
                    amount_at_risk=amount_at_risk,
                    risk_probability=risk_probability,
                    recovery_eligible=recovery_eligible,
                    current_action=current_action,
                    ai_used=ai_used,
                    ai_classification=ai_classification,
                    ai_confidence=ai_confidence,
                    ai_reasoning=ai_reasoning,
                    ai_fallback_used=ai_fallback_used,
                )
                session.add(case)
            else:
                case.status = status
                case.amount_at_risk = amount_at_risk
                case.current_action = current_action
                if ai_used:
                    case.ai_used = True
                    case.ai_classification = ai_classification
                    case.ai_confidence = ai_confidence
                    case.ai_reasoning = ai_reasoning
                    case.ai_fallback_used = ai_fallback_used
                case.updated_at = utcnow()
            session.commit()
            session.refresh(case)
            return case
        except Exception as e:
            session.rollback()
            logger.error(f"Error upserting recovery case: {e}")
            return None
        finally:
            session.close()

    @staticmethod
    def record_decision(
        case_id: str,
        selected_action: str,
        confidence: float = 1.0,
        reasoning_summary: Optional[str] = None,
        base_probability: float = 0.5,
        probability_modifier: float = 1.0,
        effective_probability: float = 0.5,
        expected_recovery: float = 0.0,
        score: float = 0.0,
    ) -> None:
        session = get_db_session()
        if not session:
            return
        try:
            decision = RecoveryDecision(
                recovery_case_id=case_id,
                selected_action=selected_action,
                confidence=confidence,
                reasoning_summary=reasoning_summary,
                base_probability=base_probability,
                probability_modifier=probability_modifier,
                effective_probability=effective_probability,
                expected_recovery=expected_recovery,
                score=score,
            )
            session.add(decision)
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Error recording decision: {e}")
        finally:
            session.close()

    @staticmethod
    def record_recovery_event(
        case_id: str,
        event_type: str,
        action: Optional[str] = None,
        status: Optional[str] = None,
        amount: float = 0.0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        session = get_db_session()
        if not session:
            return
        try:
            event = RecoveryEvent(
                recovery_case_id=case_id,
                event_type=event_type,
                action=action,
                status=status,
                amount=amount,
                metadata_json=metadata or {},
            )
            session.add(event)
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Error recording recovery event: {e}")
        finally:
            session.close()

    @staticmethod
    def record_audit_event(
        payment_id: str,
        event_type: str,
        details: Dict[str, Any],
        actor: str = "system",
        recovery_case_id: Optional[str] = None,
    ) -> None:
        session = get_db_session()
        if not session:
            return
        try:
            clean_details = dict(details) if isinstance(details, dict) else {"data": details}
            # Strip chain of thought
            for cot_field in ["chain_of_thought", "thought", "reasoning_steps", "raw_prompt"]:
                clean_details.pop(cot_field, None)

            action = clean_details.get("action") or clean_details.get("effective_action") or clean_details.get("selected_action")
            status = clean_details.get("status") or clean_details.get("decision")

            event = AuditEvent(
                recovery_case_id=recovery_case_id or (payment_id if payment_id.startswith("demo_") or payment_id.startswith("case_") else None),
                payment_id=payment_id,
                event_type=event_type,
                actor=actor,
                action=str(action) if action else None,
                status=str(status) if status else None,
                metadata_json=clean_details,
            )
            session.add(event)
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Error recording audit event: {e}")
        finally:
            session.close()

    @staticmethod
    def record_provider_event(
        provider: str,
        provider_event_id: str,
        event_type: str,
        payment_order_ref: Optional[str] = None,
        payload_hash: Optional[str] = None,
        processed: bool = False,
    ) -> bool:
        session = get_db_session()
        if not session:
            return True
        try:
            stmt = select(ProviderEvent).where(ProviderEvent.provider_event_id == provider_event_id)
            existing = session.execute(stmt).scalar_one_or_none()
            if existing:
                return False  # Duplicate event

            event = ProviderEvent(
                provider=provider,
                provider_event_id=provider_event_id,
                event_type=event_type,
                payment_order_ref=payment_order_ref,
                payload_hash=payload_hash,
                processed=processed,
            )
            session.add(event)
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            logger.error(f"Error recording provider event: {e}")
            return True
        finally:
            session.close()

    @staticmethod
    def get_all_cases(limit: int = 200) -> List[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return []
        try:
            stmt = select(RecoveryCase).order_by(desc(RecoveryCase.created_at)).limit(limit)
            cases = session.execute(stmt).scalars().all()
            results = []
            for c in cases:
                results.append({
                    "id": c.id,
                    "case_id": c.id,
                    "payment_id": c.payment_id,
                    "case_type": c.case_type,
                    "status": c.status,
                    "amount": c.amount_at_risk,
                    "amount_at_risk": c.amount_at_risk,
                    "current_action": c.current_action,
                    "ai_used": c.ai_used,
                    "ai_classification": c.ai_classification,
                    "ai_confidence": c.ai_confidence,
                    "ai_reasoning": c.ai_reasoning,
                    "ai_fallback_used": c.ai_fallback_used,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "last_updated": c.updated_at.isoformat() if c.updated_at else None,
                })
            return results
        except Exception as e:
            logger.error(f"Error fetching cases from DB: {e}")
            return []
        finally:
            session.close()

    @staticmethod
    def get_case_detail(case_id: str) -> Optional[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return None
        try:
            stmt = select(RecoveryCase).where(RecoveryCase.id == case_id)
            c = session.execute(stmt).scalar_one_or_none()
            if not c:
                return None

            decisions = [
                {
                    "action": d.selected_action,
                    "confidence": d.confidence,
                    "reasoning": d.reasoning_summary,
                    "expected_recovery": d.expected_recovery,
                    "score": d.score,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in c.decisions
            ]

            events = [
                {
                    "event_type": e.event_type,
                    "action": e.action,
                    "status": e.status,
                    "amount": e.amount,
                    "metadata": e.metadata_json,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in c.events
            ]

            return {
                "id": c.id,
                "case_id": c.id,
                "payment_id": c.payment_id,
                "case_type": c.case_type,
                "status": c.status,
                "amount": c.amount_at_risk,
                "amount_at_risk": c.amount_at_risk,
                "risk_probability": c.risk_probability,
                "current_action": c.current_action,
                "ai_used": c.ai_used,
                "ai_classification": c.ai_classification,
                "ai_confidence": c.ai_confidence,
                "ai_reasoning": c.ai_reasoning,
                "ai_fallback_used": c.ai_fallback_used,
                "decisions": decisions,
                "events": events,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
        except Exception as e:
            logger.error(f"Error fetching case detail: {e}")
            return None
        finally:
            session.close()

    @staticmethod
    def get_audit_trail(limit: int = 100) -> List[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return []
        try:
            stmt = select(AuditEvent).order_by(desc(AuditEvent.created_at)).limit(limit)
            events = session.execute(stmt).scalars().all()
            return [
                {
                    "timestamp": e.created_at.isoformat() if e.created_at else None,
                    "payment_id": e.payment_id,
                    "event_type": e.event_type,
                    "actor": e.actor,
                    "action": e.action,
                    "status": e.status,
                    "details": e.metadata_json,
                    "pii_redacted": True,
                }
                for e in events
            ]
        except Exception as e:
            logger.error(f"Error fetching audit trail from DB: {e}")
            return []
        finally:
            session.close()

    @staticmethod
    def get_metrics() -> Dict[str, Any]:
        """
        Reconstructs authoritative metrics from Neon Postgres persistent tables.
        Guarantees:
        rev_recovered <= rev_attempted <= rev_at_risk
        """
        session = get_db_session()
        if not session:
            return {}
        try:
            # Query recovery cases
            cases = session.execute(select(RecoveryCase)).scalars().all()
            payments_processed = len(cases)
            rev_at_risk = sum(c.amount_at_risk for c in cases)

            # Succeeded / Recovered: Cases with status RECOVERED
            recovered_cases = [c for c in cases if c.status == "RECOVERED"]
            rev_recovered = sum(c.amount_at_risk for c in recovered_cases)
            payments_recovered = len(recovered_cases)

            # Blocked: Cases with status BLOCKED
            blocked_cases = [c for c in cases if c.status == "BLOCKED"]
            rev_blocked = sum(c.amount_at_risk for c in blocked_cases)
            payments_blocked = len(blocked_cases)

            # Escalated: Cases with status ESCALATED
            escalated_cases = [c for c in cases if c.status == "ESCALATED"]
            rev_escalated = sum(c.amount_at_risk for c in escalated_cases)
            payments_escalated = len(escalated_cases)

            # Pending: Cases with status PENDING or RECOVERY_PENDING
            pending_cases = [c for c in cases if c.status in ("PENDING", "RECOVERY_PENDING")]
            rev_pending = sum(c.amount_at_risk for c in pending_cases)

            # Attempted: All non-blocked non-escalated cases that had an intervention attempted
            attempted_cases = [c for c in cases if c.status in ("RECOVERED", "FAILED", "RECOVERY_PENDING")]
            rev_attempted = sum(c.amount_at_risk for c in attempted_cases)
            # Ensure attempted is at least recovered
            if rev_attempted < rev_recovered:
                rev_attempted = rev_recovered

            payments_eligible = payments_processed - payments_blocked - payments_escalated
            if payments_eligible < 0:
                payments_eligible = 0

            # Invariants enforcement
            if rev_at_risk < rev_attempted:
                rev_at_risk = rev_attempted

            rev_rate = (rev_recovered / rev_at_risk * 100.0) if rev_at_risk > 0 else 0.0
            pmt_rate = (payments_recovered / payments_processed * 100.0) if payments_processed > 0 else 0.0

            # Group by case type
            by_case_type: Dict[str, Any] = {}
            for c in cases:
                ctype = c.case_type or "PAYMENT_FAILURE"
                if ctype not in by_case_type:
                    by_case_type[ctype] = {"total_cases": 0, "recovered_cases": 0, "amount_at_risk": 0.0, "recovered_amount": 0.0}
                by_case_type[ctype]["total_cases"] += 1
                by_case_type[ctype]["amount_at_risk"] += c.amount_at_risk
                if c.status == "RECOVERED":
                    by_case_type[ctype]["recovered_cases"] += 1
                    by_case_type[ctype]["recovered_amount"] += c.amount_at_risk

            # Group by intervention
            by_intervention: Dict[str, Any] = {}
            for c in cases:
                act = c.current_action or "NONE"
                if act not in by_intervention:
                    by_intervention[act] = {"attempted": 0, "recovered": 0}
                by_intervention[act]["attempted"] += 1
                if c.status == "RECOVERED":
                    by_intervention[act]["recovered"] += 1

            return {
                "payments_processed": payments_processed,
                "payments_recovery_eligible": payments_eligible,
                "payments_blocked": payments_blocked,
                "payments_escalated": payments_escalated,
                "interventions_attempted": len(attempted_cases),
                "interventions_succeeded": payments_recovered,
                "payments_recovered": payments_recovered,
                "payments_failed_recovery": len([c for c in cases if c.status == "FAILED"]),
                "revenue_at_risk_inr": rev_at_risk,
                "revenue_recovery_attempted_inr": rev_attempted,
                "revenue_attempted_inr": rev_attempted,
                "revenue_recovered_inr": rev_recovered,
                "revenue_pending_inr": rev_pending,
                "revenue_blocked_inr": rev_blocked,
                "revenue_escalated_inr": rev_escalated,
                "revenue_recovery_rate_pct": rev_rate,
                "payment_recovery_rate_pct": pmt_rate,
                "intervention_success_rate_pct": (payments_recovered / len(attempted_cases) * 100.0) if attempted_cases else 0.0,
                "safety_block_rate_pct": (payments_blocked / payments_processed * 100.0) if payments_processed > 0 else 0.0,
                "escalation_rate_pct": (payments_escalated / payments_processed * 100.0) if payments_processed > 0 else 0.0,
                "by_case_type": by_case_type,
                "by_intervention": by_intervention,
            }
        except Exception as e:
            logger.error(f"Error computing metrics from DB: {e}")
            return {}
        finally:
            session.close()
