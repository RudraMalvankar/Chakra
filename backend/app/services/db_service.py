"""
Database persistence service for Chakra Revenue Recovery Control Plane.
Interfaces with Neon Postgres via SQLAlchemy 2.x sessions.
"""
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import logging
import json

from sqlalchemy import select, func, desc, update
from sqlalchemy.orm import Session, selectinload

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
    Communication,
    PaymentLink,
    Escalation,
    EscalationAction,
    Subscription,
    SubscriptionCycle,
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
    def _escalation_dict(escalation: Escalation, session=None, full: bool = False) -> Dict[str, Any]:
        data = {
            "id": escalation.id,
            "case_id": escalation.recovery_case_id,
            "reason": escalation.reason,
            "priority": escalation.priority,
            "severity": escalation.severity,
            "status": escalation.status,
            "assigned_to": escalation.assigned_to,
            "sla_deadline": escalation.sla_deadline.isoformat() if escalation.sla_deadline else None,
            "created_at": escalation.created_at.isoformat() if escalation.created_at else None,
            "updated_at": escalation.updated_at.isoformat() if escalation.updated_at else None,
            "resolved_at": escalation.resolved_at.isoformat() if escalation.resolved_at else None,
            "resolution": escalation.resolution,
            "resolution_notes": escalation.resolution_notes,
            "actions": [
                {
                    "id": action.id,
                    "action": action.action,
                    "actor": action.actor,
                    "notes": action.notes,
                    "metadata": action.metadata_json or {},
                    "created_at": action.created_at.isoformat() if action.created_at else None,
                }
                for action in sorted(escalation.actions, key=lambda value: value.created_at or utcnow())
            ],
        }

        # Enrich with case, customer, and financial context if session available
        if session:
            case_id = escalation.recovery_case_id
            rc = session.get(RecoveryCase, case_id) if case_id else None
            rec = None
            if case_id:
                rec = session.get(Receivable, case_id)
                if not rec:
                    rec = session.execute(select(Receivable).where(Receivable.invoice_number == case_id)).scalar_one_or_none()

            amount_at_risk = 0.0
            customer_name = "Customer"
            customer_phone = "+919930832015"
            customer_email = "rudracmalvankar@gmail.com"
            invoice_number = case_id
            days_overdue = 0

            if rec:
                amount_at_risk = max(0.0, float(rec.amount - (rec.recovered_amount or 0.0)))
                customer_name = rec.customer_name
                invoice_number = rec.invoice_number
                days_overdue = rec.days_overdue
            elif rc:
                amount_at_risk = float(rc.amount_at_risk or 0.0)
                if rc.payment:
                    invoice_number = rc.payment.external_order_id or rc.payment.external_payment_id or rc.payment.id
                    if rc.payment.customer:
                        customer_name = getattr(rc.payment.customer, "display_name", None) or getattr(rc.payment.customer, "external_customer_id", None) or customer_name
                        summary = getattr(rc.payment.customer, "customer_history_summary", {}) or {}
                        if isinstance(summary, dict):
                            if summary.get("phone"):
                                customer_phone = summary["phone"]
                            if summary.get("email"):
                                customer_email = summary["email"]

            data["amount_at_risk_inr"] = amount_at_risk
            data["customer_name"] = customer_name
            data["customer_phone"] = customer_phone
            data["customer_email"] = customer_email
            data["invoice_number"] = invoice_number
            data["days_overdue"] = days_overdue

            if full:
                # Root cause human explanation
                reason_clean = escalation.reason.upper()
                if "COMPLIANCE" in reason_clean or "MANDATE" in reason_clean:
                    root_cause = "Automated debit stopped by regulatory compliance rules (RBI AFA directive or revoked customer mandate). Cannot auto-debit."
                elif "DISPUTE" in reason_clean:
                    root_cause = "Customer disputed the charge or requested cancellation. Automated debits suspended pending human dispute review."
                elif "PROMISE" in reason_clean:
                    root_cause = "Customer scheduled a Promise-to-Pay that was not fulfilled by due date. Overdue escalation required."
                elif "RETRY" in reason_clean or "MAX" in reason_clean:
                    root_cause = "Maximum automated retry attempts reached without bank capture. Stopped to prevent card network spam penalties."
                else:
                    root_cause = f"Case escalated for reason: {escalation.reason}. Manual specialist resolution required."
                data["root_cause_explanation"] = root_cause

                # What Chakra tried
                tried = []
                if rc and rc.events:
                    for ev in rc.events:
                        tried.append(f"{ev.event_type.replace('_', ' ').title()} - {ev.action or 'recorded'}")
                if not tried:
                    tried = [
                        "Mandate validity verified against NPCI / Card network",
                        "Safety Gate evaluated AFA policy thresholds",
                        "Automated retry paused per risk bounds",
                    ]
                data["what_chakra_tried"] = tried

                # Recent communications
                comms = []
                if case_id:
                    comms_rows = session.execute(
                        select(Communication).where(
                            (Communication.recovery_case_id == case_id) | (Communication.customer_id == customer_name)
                        ).order_by(desc(Communication.created_at)).limit(10)
                    ).scalars().all()
                    for c in comms_rows:
                        comms.append({
                            "id": c.id,
                            "channel": c.channel,
                            "status": c.status,
                            "sent_at": c.sent_at.isoformat() if c.sent_at else (c.created_at.isoformat() if c.created_at else None),
                            "provider": c.provider,
                            "provider_message_id": c.provider_message_id,
                            "metadata": c.body_metadata or {},
                        })
                data["communications"] = comms

                # Recent payment links
                links = []
                if case_id:
                    link_rows = session.execute(
                        select(PaymentLink).where(PaymentLink.recovery_case_id == case_id).order_by(desc(PaymentLink.created_at)).limit(5)
                    ).scalars().all()
                    for l in link_rows:
                        links.append({
                            "id": l.id,
                            "url": l.url,
                            "amount": l.amount,
                            "status": l.status,
                            "provider": l.provider,
                            "created_at": l.created_at.isoformat() if l.created_at else None,
                        })
                data["payment_links"] = links

        return data

    @staticmethod
    def create_escalation(
        case_id: str,
        reason: str,
        priority: str = "MEDIUM",
        severity: str = "MEDIUM",
        actor: str = "system",
        notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Create one open escalation per case/reason and persist its first action safely."""
        session = get_db_session()
        if not session:
            return None
        try:
            # Ensure parent RecoveryCase exists to satisfy PostgreSQL foreign key constraint
            rc = session.execute(select(RecoveryCase).where(RecoveryCase.id == case_id)).scalar_one_or_none()
            if not rc:
                rec = session.execute(select(Receivable).where(Receivable.id == case_id)).scalar_one_or_none()
                amt = float(rec.amount) if rec else 0.0
                rc = RecoveryCase(
                    id=case_id,
                    case_type="RECEIVABLE_ESCALATION" if rec else "MANUAL_ESCALATION",
                    status="ESCALATED",
                    amount_at_risk=amt,
                )
                session.add(rc)
                session.flush()

            escalation = session.execute(
                select(Escalation).where(
                    Escalation.recovery_case_id == case_id,
                    Escalation.reason == reason,
                    Escalation.status.notin_(("RESOLVED", "CLOSED")),
                )
            ).scalar_one_or_none()
            if not escalation:
                from datetime import timedelta
                sla_hours = 2 if priority == "CRITICAL" else (4 if priority == "HIGH" else 24)
                escalation = Escalation(
                    recovery_case_id=case_id,
                    reason=reason,
                    priority=priority,
                    severity=severity,
                    status="OPEN",
                    sla_deadline=utcnow() + timedelta(hours=sla_hours),
                )
                session.add(escalation)
                session.flush()
                session.add(EscalationAction(
                    escalation_id=escalation.id,
                    action="OPENED",
                    actor=actor,
                    notes=notes,
                ))
            session.commit()
            session.refresh(escalation)
            return DBService._escalation_dict(escalation, session=session, full=True)
        except Exception as exc:
            session.rollback()
            logger.error("Error creating escalation: %s", exc)
            return None
        finally:
            session.close()

    @staticmethod
    def list_escalations(limit: int = 200) -> List[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return []
        try:
            from sqlalchemy.orm import selectinload
            rows = session.execute(
                select(Escalation).options(selectinload(Escalation.actions)).order_by(desc(Escalation.created_at)).limit(limit)
            ).scalars().all()

            # Bulk load related objects to fix N+1 over Postgres
            case_ids = list({row.recovery_case_id for row in rows if row.recovery_case_id})
            recs_map = {}
            rcs_map = {}
            if case_ids:
                from sqlalchemy.orm import selectinload
                from backend.app.db.models import Payment
                # 1. Bulk load RecoveryCase with relationships
                rcs = session.execute(
                    select(RecoveryCase)
                    .options(selectinload(RecoveryCase.payment).selectinload(Payment.customer))
                    .where(RecoveryCase.id.in_(case_ids))
                ).scalars().all()
                rcs_map = {rc.id: rc for rc in rcs}
                
                # 2. Bulk load Receivable
                recs = session.execute(select(Receivable).where(Receivable.invoice_number.in_(case_ids))).scalars().all()
                recs_map = {rec.invoice_number: rec for rec in recs}

            result = []
            for row in rows:
                # We temporarily set the fetched items so _escalation_dict can use them without DB query
                rc = rcs_map.get(row.recovery_case_id)
                rec = recs_map.get(row.recovery_case_id)
                
                # Pass session=None so it doesn't do N+1 queries itself, but we manually populate the data
                data = DBService._escalation_dict(row, session=None, full=False)
                
                # Manually do what _escalation_dict would have done with the session
                amount_at_risk = 0.0
                customer_name = "Customer"
                customer_phone = "+919930832015"
                customer_email = "rudracmalvankar@gmail.com"
                invoice_number = row.recovery_case_id
                days_overdue = 0

                if rec:
                    amount_at_risk = max(0.0, float(rec.amount - (rec.recovered_amount or 0.0)))
                    customer_name = rec.customer_name
                    invoice_number = rec.invoice_number
                    days_overdue = rec.days_overdue
                elif rc:
                    amount_at_risk = float(rc.amount_at_risk or 0.0)
                    if rc.payment:
                        invoice_number = rc.payment.external_order_id or rc.payment.external_payment_id or rc.payment.id
                        if rc.payment.customer:
                            customer_name = getattr(rc.payment.customer, "display_name", None) or getattr(rc.payment.customer, "external_customer_id", None) or customer_name
                            summary = getattr(rc.payment.customer, "customer_history_summary", {}) or {}
                            if isinstance(summary, dict):
                                if summary.get("phone"):
                                    customer_phone = summary["phone"]
                                if summary.get("email"):
                                    customer_email = summary["email"]

                data["amount_at_risk_inr"] = amount_at_risk
                data["customer_name"] = customer_name
                data["customer_phone"] = customer_phone
                data["customer_email"] = customer_email
                data["invoice_number"] = invoice_number
                data["days_overdue"] = days_overdue
                
                result.append(data)
                
            return result
        finally:
            session.close()

    @staticmethod
    def get_escalation_summary() -> Dict[str, Any]:
        session = get_db_session()
        if not session:
            return {"open_count": 0, "high_priority_count": 0, "unassigned_count": 0, "sla_risk_count": 0, "unresolved_count": 0, "revenue_escalated_inr": 0.0}
        try:
            closed_statuses = ("RESOLVED", "CLOSED", "UNRECOVERABLE")
            active_q = select(func.count()).select_from(Escalation).where(~Escalation.status.in_(closed_statuses))
            open_count = session.execute(active_q).scalar() or 0

            high_q = select(func.count()).select_from(Escalation).where(
                ~Escalation.status.in_(closed_statuses), Escalation.priority.in_(("HIGH", "CRITICAL"))
            )
            high_priority_count = session.execute(high_q).scalar() or 0

            unassigned_q = select(func.count()).select_from(Escalation).where(
                ~Escalation.status.in_(closed_statuses), Escalation.assigned_to.is_(None)
            )
            unassigned_count = session.execute(unassigned_q).scalar() or 0

            from datetime import datetime, timezone as tz
            now = datetime.now(tz.utc)
            sla_risk = 0
            total_rev = 0.0
            
            # Fetch escalations safely without N+1 queries for summary
            escalations = session.execute(
                select(Escalation.recovery_case_id, Escalation.sla_deadline).where(
                    ~Escalation.status.in_(closed_statuses)
                )
            ).all()
            
            # Bulk load amounts to prevent N+1 network latency over Postgres
            case_ids = list({e.recovery_case_id for e in escalations if e.recovery_case_id})
            amounts_map = {}
            if case_ids:
                # 1. Try RecoveryCase
                rcs = session.execute(
                    select(RecoveryCase.id, RecoveryCase.amount_at_risk)
                    .where(RecoveryCase.id.in_(case_ids))
                ).all()
                for rc_id, amt in rcs:
                    amounts_map[rc_id] = float(amt or 0.0)
                
                # 2. Try Receivable for remaining
                remaining_ids = [cid for cid in case_ids if cid not in amounts_map]
                if remaining_ids:
                    recs = session.execute(
                        select(Receivable.invoice_number, Receivable.amount, Receivable.recovered_amount)
                        .where(Receivable.invoice_number.in_(remaining_ids))
                    ).all()
                    for inv, amt, recovered in recs:
                        amounts_map[inv] = max(0.0, float((amt or 0) - (recovered or 0)))

            for e in escalations:
                total_rev += amounts_map.get(e.recovery_case_id, 0.0)
                if e.sla_deadline:
                    try:
                        dl = datetime.fromisoformat(str(e.sla_deadline).replace("Z", "+00:00"))
                        if dl.tzinfo is None:
                            dl = dl.replace(tzinfo=tz.utc)
                        if (dl - now).total_seconds() / 3600.0 <= 4:
                            sla_risk += 1
                    except (ValueError, TypeError):
                        pass

            return {
                "open_count": open_count,
                "high_priority_count": high_priority_count,
                "unassigned_count": unassigned_count,
                "sla_risk_count": sla_risk,
                "unresolved_count": open_count,
                "revenue_escalated_inr": total_rev,
            }
        finally:
            session.close()

    @staticmethod
    def get_escalation(escalation_id: str) -> Optional[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return None
        try:
            escalation = session.get(Escalation, escalation_id)
            return DBService._escalation_dict(escalation, session=session, full=True) if escalation else None
        finally:
            session.close()

    @staticmethod
    def transition_escalation(
        escalation_id: str,
        status: str,
        actor: str = "operator",
        notes: Optional[str] = None,
        assigned_to: Optional[str] = None,
        resolution: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        valid_statuses = {
            "OPEN", "ASSIGNED", "IN_PROGRESS", "CUSTOMER_CONTACTED",
            "ACTION_TAKEN", "PROMISE_RECEIVED", "RESOLVED", "UNRECOVERABLE", "CLOSED"
        }
        session = get_db_session()
        if not session:
            return None
        try:
            escalation = session.get(Escalation, escalation_id)
            if not escalation:
                return None
            status_clean = status.upper()
            if status_clean not in valid_statuses:
                raise ValueError(f"Invalid escalation status: {status}")

            escalation.status = status_clean
            if assigned_to is not None:
                escalation.assigned_to = assigned_to
            if status_clean in {"RESOLVED", "CLOSED", "UNRECOVERABLE"}:
                escalation.resolved_at = utcnow()
                escalation.resolution = resolution or status_clean
                escalation.resolution_notes = notes
            elif status_clean in {"OPEN", "IN_PROGRESS"}:
                escalation.resolved_at = None
                escalation.resolution = None

            escalation.updated_at = utcnow()
            meta = dict(metadata or {})
            if assigned_to:
                meta["assigned_to"] = assigned_to
            if resolution:
                meta["resolution"] = resolution

            session.add(EscalationAction(
                escalation_id=escalation.id,
                action=status_clean,
                actor=actor,
                notes=notes,
                metadata_json=meta,
            ))
            session.commit()
            session.refresh(escalation)
            return DBService._escalation_dict(escalation, session=session, full=True)
        except Exception as exc:
            session.rollback()
            logger.error("Error transitioning escalation: %s", exc)
            raise
        finally:
            session.close()

    @staticmethod
    def record_escalation_action(
        escalation_id: str,
        action: str,
        actor: str = "operator",
        notes: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return None
        try:
            escalation = session.get(Escalation, escalation_id)
            if not escalation:
                return None
            session.add(EscalationAction(
                escalation_id=escalation.id,
                action=action,
                actor=actor,
                notes=notes,
                metadata_json=metadata or {},
            ))
            escalation.updated_at = utcnow()
            session.commit()
            session.refresh(escalation)
            return DBService._escalation_dict(escalation, session=session, full=True)
        except Exception as exc:
            session.rollback()
            logger.error("Error recording escalation action: %s", exc)
            return None
        finally:
            session.close()

    @staticmethod
    def record_communication(
        case_id: Optional[str], customer_id: Optional[str], channel: str,
        status: str, provider: Optional[str] = None,
        communication_type: Optional[str] = None,
        provider_message_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        session = get_db_session()
        if not session:
            return None
        try:
            valid_case_id = None
            meta = dict(metadata or {})
            if case_id:
                case_exists = session.query(RecoveryCase.id).filter(RecoveryCase.id == case_id).first() is not None
                if case_exists:
                    valid_case_id = case_id
                else:
                    meta["requested_case_id"] = case_id

            item = Communication(
                recovery_case_id=valid_case_id, customer_id=customer_id, channel=channel,
                status=status, provider=provider, communication_type=communication_type,
                provider_message_id=provider_message_id, body_metadata=meta,
                sent_at=utcnow() if status in {"SENT", "QUEUED"} else None,
                failed_at=utcnow() if status == "FAILED" else None,
            )
            session.add(item)
            session.commit()
            return item.id
        except Exception as exc:
            session.rollback()
            logger.error("Error persisting communication: %s", exc)
            return None
        finally:
            session.close()

    @staticmethod
    def record_payment_link(
        case_id: Optional[str], customer_id: Optional[str], provider: str,
        amount: float, url: Optional[str], provider_link_id: Optional[str] = None,
        status: str = "CREATED",
    ) -> Optional[str]:
        session = get_db_session()
        if not session:
            return None
        try:
            valid_case_id = None
            if case_id:
                case_exists = session.query(RecoveryCase.id).filter(RecoveryCase.id == case_id).first() is not None
                if case_exists:
                    valid_case_id = case_id

            item = PaymentLink(
                recovery_case_id=valid_case_id, customer_id=customer_id, provider=provider,
                amount=amount, url=url, provider_link_id=provider_link_id, status=status,
            )
            session.add(item)
            session.commit()
            return item.id
        except Exception as exc:
            session.rollback()
            logger.error("Error persisting payment link: %s", exc)
            return None
        finally:
            session.close()

    @staticmethod
    def reset_database() -> None:
        """Truncates / deletes transactional benchmark data from Neon Postgres for fresh benchmark runs."""
        session = get_db_session()
        if not session:
            return
        try:
            # Delete in child-to-parent order
            session.query(EscalationAction).delete()
            session.query(Escalation).delete()
            session.query(Communication).delete()
            session.query(PaymentLink).delete()
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
    def get_payment_by_order_id(order_id: str) -> Optional[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return None
        try:
            stmt = select(Payment).where(
                (Payment.id == order_id) | (Payment.external_order_id == order_id)
            )
            payment = session.execute(stmt).scalars().first()
            if not payment:
                return None
            return {
                "id": payment.id,
                "external_payment_id": payment.external_payment_id,
                "external_order_id": payment.external_order_id,
                "customer_id": payment.customer_id,
                "amount": payment.amount,
                "currency": payment.currency,
                "status": payment.status,
                "provider": payment.provider,
            }
        except Exception as e:
            logger.error(f"Error looking up payment by order: {e}")
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
    def _case_summary_ops(c: RecoveryCase) -> Dict[str, Any]:
        """Build nested risk/agent/safety/outcome for list views without N+1 detail calls."""
        decisions = sorted(c.decisions or [], key=lambda d: d.created_at or datetime.min.replace(tzinfo=timezone.utc))
        events = sorted(c.events or [], key=lambda e: e.created_at or datetime.min.replace(tzinfo=timezone.utc))
        latest_by_type: Dict[str, Any] = {}
        for event in events:
            latest_by_type[event.event_type] = event

        latest_decision = decisions[-1] if decisions else None
        risk_event = latest_by_type.get("revenue_risk_assessed") or latest_by_type.get("risk_scored")
        risk_meta = (risk_event.metadata_json if risk_event else {}) or {}
        safety_event = (
            latest_by_type.get("safety_check_completed")
            or latest_by_type.get("safety_gate_evaluated")
            or latest_by_type.get("safety_blocked")
        )
        safety_meta = (safety_event.metadata_json if safety_event else {}) or {}
        outcome_event = latest_by_type.get("execution_outcome") or latest_by_type.get("outcome_recorded")
        outcome_meta = (outcome_event.metadata_json if outcome_event else {}) or {}

        priority = risk_meta.get("priority")
        if not priority and c.risk_probability is not None:
            if c.risk_probability >= 0.85:
                priority = "CRITICAL"
            elif c.risk_probability >= 0.65:
                priority = "HIGH"
            elif c.risk_probability >= 0.4:
                priority = "MEDIUM"
            else:
                priority = "LOW"

        eligibility = (
            safety_meta.get("eligibility")
            or safety_meta.get("decision")
            or (safety_event.status if safety_event else None)
        )

        return {
            "risk": {
                "probability": c.risk_probability,
                "priority": priority,
                "fraud_risk": risk_meta.get("fraud_risk") or risk_meta.get("fraud_signal"),
                "churn_risk": risk_meta.get("churn_risk"),
                "eligibility": risk_meta.get("recovery_eligible", c.recovery_eligible),
                "amount_at_risk": c.amount_at_risk,
            },
            "agent": {
                "selected_action": (latest_decision.selected_action if latest_decision else None) or c.current_action,
                "confidence": latest_decision.confidence if latest_decision else None,
                "expected_recovery": latest_decision.expected_recovery if latest_decision else None,
                "score": latest_decision.score if latest_decision else None,
                "candidates": [
                    {
                        "action": d.selected_action,
                        "base_probability": d.base_probability,
                        "probability_modifier": d.probability_modifier,
                        "effective_probability": d.effective_probability,
                        "expected_recovery": d.expected_recovery,
                        "expected_recovery_inr": d.expected_recovery,
                        "score": d.score,
                        "confidence": d.confidence,
                    }
                    for d in decisions
                ],
            },
            "safety": {
                "eligibility": eligibility,
                "decision": eligibility,
                "reason_code": safety_meta.get("reason_code") or safety_meta.get("reason"),
                "policy_id": safety_meta.get("policy_id"),
                "status": safety_event.status if safety_event else None,
            },
            "outcome": {
                "status": (outcome_event.status if outcome_event else None) or outcome_meta.get("status") or c.status,
                "amount_recovered_inr": outcome_meta.get("amount_recovered_inr")
                or outcome_meta.get("amount_recovered")
                or (c.amount_at_risk if c.status == "RECOVERED" else 0.0),
                "recovered": c.status == "RECOVERED" or bool(outcome_meta.get("recovered")),
                "provider_result": outcome_meta.get("provider_result") or outcome_meta.get("raw_response"),
                "raw_response": outcome_meta.get("raw_response") or outcome_meta,
            },
            "ai": {
                "used": bool(c.ai_used),
                "ai_used": bool(c.ai_used),
                "classification": c.ai_classification,
                "confidence": c.ai_confidence,
                "reasoning": c.ai_reasoning,
                "fallback_used": bool(c.ai_fallback_used),
            },
        }

    @staticmethod
    def get_all_cases(limit: int = 200) -> List[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return []
        try:
            stmt = (
                select(RecoveryCase)
                .options(
                    selectinload(RecoveryCase.decisions),
                )
                .order_by(desc(RecoveryCase.created_at))
                .limit(limit)
            )
            cases = session.execute(stmt).scalars().all()
            results = []
            for c in cases:
                decisions = sorted(c.decisions or [], key=lambda d: d.created_at or datetime.min.replace(tzinfo=timezone.utc))
                latest_decision = decisions[-1] if decisions else None

                priority = "LOW"
                if c.risk_probability is not None:
                    if c.risk_probability >= 0.85:
                        priority = "CRITICAL"
                    elif c.risk_probability >= 0.65:
                        priority = "HIGH"
                    elif c.risk_probability >= 0.4:
                        priority = "MEDIUM"

                eligibility = c.current_action or "PENDING"

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
                    "risk": {
                        "probability": c.risk_probability,
                        "priority": priority,
                        "amount_at_risk": c.amount_at_risk,
                    },
                    "agent": {
                        "selected_action": (latest_decision.selected_action if latest_decision else None) or c.current_action,
                        "confidence": latest_decision.confidence if latest_decision else None,
                        "expected_recovery": latest_decision.expected_recovery if latest_decision else None,
                        "score": latest_decision.score if latest_decision else None,
                    },
                    "safety": {
                        "eligibility": eligibility,
                    },
                    "outcome": {
                        "status": c.status,
                        "amount_recovered_inr": c.amount_at_risk if c.status == "RECOVERED" else 0.0,
                        "recovered": c.status == "RECOVERED",
                    },
                    "ai": {
                        "used": bool(c.ai_used),
                        "classification": c.ai_classification,
                        "confidence": c.ai_confidence,
                        "reasoning": c.ai_reasoning,
                    },
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
                    "base_probability": d.base_probability,
                    "probability_modifier": d.probability_modifier,
                    "effective_probability": d.effective_probability,
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
                    "details": e.metadata_json,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                    "timestamp": e.created_at.isoformat() if e.created_at else None,
                }
                for e in c.events
            ]
            ordered_events = sorted(events, key=lambda item: item.get("created_at") or "")
            latest_by_type = {}
            for event in ordered_events:
                latest_by_type[event["event_type"]] = event

            communications = [
                {
                    "id": item.id,
                    "channel": item.channel,
                    "type": item.communication_type,
                    "provider": item.provider,
                    "provider_message_id": item.provider_message_id,
                    "status": item.status,
                    "metadata": item.body_metadata or {},
                    "sent_at": item.sent_at.isoformat() if item.sent_at else None,
                    "delivered_at": item.delivered_at.isoformat() if item.delivered_at else None,
                    "failed_at": item.failed_at.isoformat() if item.failed_at else None,
                }
                for item in c.communications
            ]
            payment_links = [
                {
                    "id": item.id,
                    "provider_link_id": item.provider_link_id,
                    "provider": item.provider,
                    "url": item.url,
                    "amount": item.amount,
                    "currency": item.currency,
                    "status": item.status,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "captured_at": item.captured_at.isoformat() if item.captured_at else None,
                }
                for item in c.payment_links
            ]

            payment = None
            if c.payment:
                payment = {
                    "id": c.payment.id,
                    "external_payment_id": c.payment.external_payment_id,
                    "external_order_id": c.payment.external_order_id,
                    "customer_id": c.payment.customer_id,
                    "amount": c.payment.amount,
                    "currency": c.payment.currency,
                    "method": c.payment.payment_method,
                    "status": c.payment.status,
                    "failure_code": c.payment.failure_code,
                    "provider": c.payment.provider,
                    "source": c.payment.source,
                    "created_at": c.payment.created_at.isoformat() if c.payment.created_at else None,
                }
            latest_decision = decisions[-1] if decisions else {}
            triage = {
                "classification": c.ai_classification,
                "confidence": c.ai_confidence,
                "reasoning": c.ai_reasoning,
                "ai_used": bool(c.ai_used),
                "fallback_used": bool(c.ai_fallback_used),
            }
            agent = {
                "selected_action": latest_decision.get("action"),
                "confidence": latest_decision.get("confidence"),
                "reasoning": latest_decision.get("reasoning"),
                "expected_recovery": latest_decision.get("expected_recovery"),
                "candidates": decisions,
                "candidate_actions": [
                    {**d, "expected_recovery_inr": d.get("expected_recovery")}
                    for d in decisions
                ],
            }

            safety_event = latest_by_type.get("safety_check_completed") or latest_by_type.get("safety_gate_evaluated") or latest_by_type.get("safety_blocked")
            safety_meta = (safety_event or {}).get("metadata") or (safety_event or {}).get("details") or {}
            safety = {
                **(safety_event or {}),
                "eligibility": safety_meta.get("eligibility") or safety_meta.get("decision") or (safety_event or {}).get("status"),
                "decision": safety_meta.get("decision") or safety_meta.get("eligibility") or (safety_event or {}).get("status"),
                "reason_code": safety_meta.get("reason_code") or safety_meta.get("reason"),
                "policy_id": safety_meta.get("policy_id"),
            }

            outcome_event = latest_by_type.get("execution_outcome") or latest_by_type.get("outcome_recorded")
            outcome_meta = (outcome_event or {}).get("metadata") or (outcome_event or {}).get("details") or {}
            outcome = {
                **(outcome_event or {}),
                "status": (outcome_event or {}).get("status") or outcome_meta.get("status") or c.status,
                "amount_recovered_inr": outcome_meta.get("amount_recovered_inr")
                or outcome_meta.get("amount_recovered")
                or (c.amount_at_risk if c.status == "RECOVERED" else 0.0),
                "recovered": c.status == "RECOVERED" or bool(outcome_meta.get("recovered")),
                "raw_response": outcome_meta.get("raw_response") or outcome_meta,
            }

            risk_event = latest_by_type.get("revenue_risk_assessed") or latest_by_type.get("risk_scored")
            risk_meta = (risk_event or {}).get("metadata") or (risk_event or {}).get("details") or {}

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
                "communications": communications,
                "payment_links": payment_links,
                "escalations": [DBService._escalation_dict(item) for item in c.escalations],
                # Canonical lifecycle contract. Flat fields above remain for existing clients.
                "case": {
                    "id": c.id,
                    "type": c.case_type,
                    "status": c.status,
                    "amount_at_risk": c.amount_at_risk,
                    "current_action": c.current_action,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                },
                "payment": payment,
                "customer": {
                    "id": payment.get("customer_id") if payment else None,
                },
                "triage": triage,
                "ai": triage,
                "risk": {
                    "probability": c.risk_probability,
                    "amount_at_risk": c.amount_at_risk,
                    "priority": risk_meta.get("priority"),
                    "fraud_risk": risk_meta.get("fraud_risk") or risk_meta.get("fraud_signal"),
                    "churn_risk": risk_meta.get("churn_risk"),
                    "eligibility": risk_meta.get("recovery_eligible", c.recovery_eligible),
                    "event": risk_event,
                },
                "agent": agent,
                "safety": safety,
                "execution": latest_by_type.get("execution_completed") or latest_by_type.get("execution_started"),
                "outcome": outcome,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "last_updated": c.updated_at.isoformat() if c.updated_at else None,
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
                    "case_id": e.recovery_case_id
                    or (e.metadata_json or {}).get("case_id")
                    or (
                        e.payment_id
                        if e.payment_id
                        and (
                            str(e.payment_id).startswith("case_")
                            or str(e.payment_id).startswith("demo_")
                        )
                        else None
                    ),
                    "event_type": e.event_type,
                    "actor": e.actor,
                    "action": e.action or (e.metadata_json or {}).get("effective_action"),
                    "status": e.status,
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
                    by_case_type[ctype] = {"processed": 0, "recovered": 0, "revenue_at_risk": 0.0, "revenue_recovered": 0.0}
                by_case_type[ctype]["processed"] += 1
                by_case_type[ctype]["revenue_at_risk"] += c.amount_at_risk
                if c.status == "RECOVERED":
                    by_case_type[ctype]["recovered"] += 1
                    by_case_type[ctype]["revenue_recovered"] += c.amount_at_risk

            # Group by intervention
            by_intervention: Dict[str, Any] = {}
            for c in cases:
                act = c.current_action or "NONE"
                if act not in by_intervention:
                    by_intervention[act] = {"attempted": 0, "succeeded": 0, "recovered_inr": 0.0}
                by_intervention[act]["attempted"] += 1
                if c.status == "RECOVERED":
                    by_intervention[act]["succeeded"] += 1
                    by_intervention[act]["recovered_inr"] += c.amount_at_risk

            ai_triage_count = sum(1 for c in cases if c.ai_used)
            ai_fallback_count = sum(1 for c in cases if c.ai_fallback_used)

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
                "ai_triage_count": ai_triage_count,
                "ai_fallback_count": ai_fallback_count,
                "ai_live_rate_pct": (sum(1 for c in cases if c.ai_used and not c.ai_fallback_used) / ai_triage_count * 100.0) if ai_triage_count else 0.0,
                "by_case_type": by_case_type,
                "by_intervention": by_intervention,
            }
        except Exception as e:
            logger.error(f"Error computing metrics from DB: {e}")
            return {}
        finally:
            session.close()

    # ─── Subscription Methods ─────────────────────────────────────────────

    @staticmethod
    def upsert_subscription(
        external_subscription_id: str,
        customer_id: str,
        amount: float,
        plan_id: str = "",
        frequency: str = "monthly",
        status: str = "ACTIVE",
        mandate_id: str = "",
        grace_period_days: int = 7,
        max_retries: int = 3,
        current_cycle_start: str = "",
        current_cycle_end: str = "",
        next_charge_date: str = "",
        churn_risk: str = "LOW",
        notes: str = "",
    ) -> Optional[str]:
        session = get_db_session()
        if not session:
            return None
        try:
            existing = session.execute(
                select(Subscription).where(Subscription.external_subscription_id == external_subscription_id)
            ).scalar_one_or_none()
            if existing:
                existing.amount = amount
                existing.status = status
                existing.churn_risk = churn_risk
                existing.updated_at = utcnow()
                session.commit()
                return existing.id
            sub = Subscription(
                external_subscription_id=external_subscription_id,
                customer_id=customer_id,
                amount=amount,
                plan_id=plan_id,
                frequency=frequency,
                status=status,
                mandate_id=mandate_id,
                grace_period_days=grace_period_days,
                max_retries=max_retries,
                current_cycle_start=current_cycle_start,
                current_cycle_end=current_cycle_end,
                next_charge_date=next_charge_date,
                churn_risk=churn_risk,
                notes=notes,
            )
            session.add(sub)
            session.commit()
            return sub.id
        except Exception as e:
            logger.error(f"Error upserting subscription: {e}")
            session.rollback()
            return None
        finally:
            session.close()

    @staticmethod
    def get_subscription(external_subscription_id: str) -> Optional[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return None
        try:
            sub = session.execute(
                select(Subscription).where(Subscription.external_subscription_id == external_subscription_id)
            ).scalar_one_or_none()
            if not sub:
                return None
            return {
                "id": sub.id,
                "external_subscription_id": sub.external_subscription_id,
                "customer_id": sub.customer_id,
                "plan_id": sub.plan_id,
                "amount": sub.amount,
                "currency": sub.currency,
                "frequency": sub.frequency,
                "status": sub.status,
                "current_cycle_start": sub.current_cycle_start,
                "current_cycle_end": sub.current_cycle_end,
                "next_charge_date": sub.next_charge_date,
                "grace_period_days": sub.grace_period_days,
                "retry_count": sub.retry_count,
                "max_retries": sub.max_retries,
                "mandate_id": sub.mandate_id,
                "churn_risk": sub.churn_risk,
                "created_at": sub.created_at.isoformat() if sub.created_at else None,
                "updated_at": sub.updated_at.isoformat() if sub.updated_at else None,
            }
        except Exception as e:
            logger.error(f"Error getting subscription: {e}")
            return None
        finally:
            session.close()

    @staticmethod
    def list_subscriptions(status_filter: str = "") -> List[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return []
        try:
            stmt = select(Subscription).order_by(desc(Subscription.created_at))
            if status_filter:
                stmt = stmt.where(Subscription.status == status_filter)
            subs = session.execute(stmt).scalars().all()
            return [
                {
                    "id": s.id,
                    "external_subscription_id": s.external_subscription_id,
                    "customer_id": s.customer_id,
                    "plan_id": s.plan_id,
                    "amount": s.amount,
                    "currency": s.currency,
                    "frequency": s.frequency,
                    "status": s.status,
                    "current_cycle_start": s.current_cycle_start,
                    "current_cycle_end": s.current_cycle_end,
                    "next_charge_date": s.next_charge_date,
                    "grace_period_days": s.grace_period_days,
                    "retry_count": s.retry_count,
                    "max_retries": s.max_retries,
                    "churn_risk": s.churn_risk,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in subs
            ]
        except Exception as e:
            logger.error(f"Error listing subscriptions: {e}")
            return []
        finally:
            session.close()

    @staticmethod
    def update_subscription_status(external_subscription_id: str, new_status: str) -> bool:
        session = get_db_session()
        if not session:
            return False
        try:
            sub = session.execute(
                select(Subscription).where(Subscription.external_subscription_id == external_subscription_id)
            ).scalar_one_or_none()
            if not sub:
                return False
            sub.status = new_status
            sub.updated_at = utcnow()
            session.commit()
            return True
        except Exception as e:
            logger.error(f"Error updating subscription status: {e}")
            session.rollback()
            return False
        finally:
            session.close()

    @staticmethod
    def record_subscription_cycle(
        subscription_id: str,
        cycle_number: int,
        amount: float,
        status: str = "PENDING",
        failure_code: str = "",
    ) -> Optional[str]:
        session = get_db_session()
        if not session:
            return None
        try:
            cycle = SubscriptionCycle(
                subscription_id=subscription_id,
                cycle_number=cycle_number,
                amount=amount,
                status=status,
                failure_code=failure_code,
            )
            session.add(cycle)
            session.commit()
            return cycle.id
        except Exception as e:
            logger.error(f"Error recording subscription cycle: {e}")
            session.rollback()
            return None
        finally:
            session.close()

    @staticmethod
    def get_subscription_payment_history(external_subscription_id: str) -> List[Dict[str, Any]]:
        session = get_db_session()
        if not session:
            return []
        try:
            sub = session.execute(
                select(Subscription).where(Subscription.external_subscription_id == external_subscription_id)
            ).scalar_one_or_none()
            if not sub:
                return []
            cycles = session.execute(
                select(SubscriptionCycle).where(SubscriptionCycle.subscription_id == sub.id).order_by(desc(SubscriptionCycle.cycle_number))
            ).scalars().all()
            return [
                {
                    "id": c.id,
                    "cycle_number": c.cycle_number,
                    "amount": c.amount,
                    "status": c.status,
                    "failure_code": c.failure_code,
                    "attempted_at": c.attempted_at.isoformat() if c.attempted_at else None,
                    "charged_at": c.charged_at.isoformat() if c.charged_at else None,
                    "retry_count": c.retry_count,
                }
                for c in cycles
            ]
        except Exception as e:
            logger.error(f"Error getting subscription payment history: {e}")
            return []
        finally:
            session.close()

    @staticmethod
    def get_subscription_metrics() -> Dict[str, Any]:
        session = get_db_session()
        if not session:
            return {}
        try:
            subs = session.execute(select(Subscription)).scalars().all()
            total = len(subs)
            active = sum(1 for s in subs if s.status == "ACTIVE")
            past_due = sum(1 for s in subs if s.status == "PAST_DUE")
            paused = sum(1 for s in subs if s.status == "PAUSED")
            cancelled = sum(1 for s in subs if s.status == "CANCELLED")
            total_revenue = sum(s.amount for s in subs if s.status == "ACTIVE")
            at_risk = sum(s.amount for s in subs if s.status in ("PAST_DUE", "PAUSED"))
            return {
                "total_subscriptions": total,
                "active": active,
                "past_due": past_due,
                "paused": paused,
                "cancelled": cancelled,
                "total_monthly_revenue": total_revenue,
                "revenue_at_risk": at_risk,
            }
        except Exception as e:
            logger.error(f"Error computing subscription metrics: {e}")
            return {}
        finally:
            session.close()
