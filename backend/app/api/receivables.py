"""
B2B Receivables & Promise-to-Pay API.
Persisted in Neon Postgres via SQLAlchemy 2.x models.
Integrated into Chakra recovery pipeline.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, date, timezone
import uuid
import logging

from sqlalchemy import select, desc
from backend.app.config import settings
from backend.app.db.session import get_session_factory
from backend.app.db.models import Receivable, PromiseToPay, VoiceInteraction, Customer, AuditEvent, utcnow
from backend.app.services.recovery_executor import execute_recovery_pipeline
from backend.app.services.db_service import DBService
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.revenue_risk_engine import RevenueRiskEngine
from backend.app.services.recovery_agent import RecoveryAgent

logger = logging.getLogger("chakra.receivables")

router = APIRouter()

ACTIVE_PROMISE_STATUSES = ("PROMISE_CREATED", "UPCOMING", "DUE_TODAY")
TERMINAL_PROMISE_STATUSES = ("FULFILLED", "BROKEN", "ESCALATED")


def _ensure_seeded(session):
    """Compatibility hook; operational receivables must come from ingestion."""
    return None


def _effective_promise_status(status: str, promised_date: str) -> str:
    """Return operational promise state; terminal statuses are never rewritten."""
    if status in TERMINAL_PROMISE_STATUSES:
        return status
    today = date.today().isoformat()
    if promised_date == today:
        return "DUE_TODAY"
    if promised_date > today:
        return status if status == "PROMISE_CREATED" else "UPCOMING"
    return "DUE_TODAY"


def _serialize_promise(p: PromiseToPay) -> Dict[str, Any]:
    status = _effective_promise_status(p.status, p.promise_date)
    return {
        "id": p.id,
        "receivable_id": p.receivable_id,
        "customer": p.customer_name,
        "customer_name": p.customer_name,
        "amount": p.promised_amount,
        "promised_amount": p.promised_amount,
        "promised_date": p.promise_date,
        "promise_date": p.promise_date,
        "status": status,
        "source": p.source,
        "notes": p.notes or "",
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _payment_history_for(session, receivable_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    if not receivable_ids:
        return {}
    stmt = (
        select(AuditEvent)
        .where(
            AuditEvent.payment_id.in_(receivable_ids),
            AuditEvent.event_type.in_(
                (
                    "receivable_payment_confirmed",
                    "promise_fulfilled",
                    "receivable_ingested",
                )
            ),
        )
        .order_by(desc(AuditEvent.created_at))
    )
    events = session.execute(stmt).scalars().all()
    out: Dict[str, List[Dict[str, Any]]] = {rid: [] for rid in receivable_ids}
    for e in events:
        pid = e.payment_id
        if not pid or pid not in out:
            continue
        meta = e.metadata_json or {}
        out[pid].append({
            "event_type": e.event_type,
            "amount": meta.get("amount") or meta.get("recovered_amount") or meta.get("amount_inr"),
            "provider": meta.get("provider"),
            "reference": meta.get("reference"),
            "status": e.status or meta.get("status") or e.event_type,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    return out


def _receivable_payload(r: Receivable, payment_history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    recovery_context = ContextBuilder.build_context({
        "payment_id": r.id,
        "amount_inr": max(0.0, r.amount - (r.recovered_amount or 0.0)),
        "case_type": "RECEIVABLE",
        "customer_id": r.customer_id,
        "error_code": "receivable_overdue",
        "context": {"days_overdue": r.days_overdue, "risk": r.risk_level, "payment_behavior": r.payment_behavior},
    })
    risk_assessment = RevenueRiskEngine.assess(recovery_context)
    agent_decision = RecoveryAgent.decide(recovery_context)
    promises = [_serialize_promise(p) for p in (r.promises or [])]
    broken = [p for p in promises if p["status"] == "BROKEN"]
    latest_p = None
    if promises:
        active = [p for p in promises if p["status"] in ACTIVE_PROMISE_STATUSES]
        latest_p = (active[0] if active else promises[0])["id"]
    recovered = r.recovered_amount or 0.0
    return {
        "id": r.id,
        "customer": r.customer_name,
        "customer_id": r.customer_id,
        "invoice_id": r.invoice_number,
        "amount": r.amount,
        "recovered_amount": recovered,
        "remaining_amount": max(0.0, r.amount - recovered),
        "due_date": r.due_date,
        "days_overdue": r.days_overdue,
        "risk": r.risk_level,
        "status": r.status,
        "previous_promises": r.previous_promises,
        "payment_behavior": r.payment_behavior,
        "promise": latest_p,
        "promises": promises,
        "broken_promises": broken,
        "broken_promises_count": len(broken),
        "payment_history": payment_history or [],
        "risk_probability": risk_assessment.recovery_probability,
        "recommended_action": agent_decision.selected_action,
        "recommendation_reason": agent_decision.decision_factors[0] if agent_decision.decision_factors else "Not available",
        "candidate_actions": [candidate.model_dump() for candidate in agent_decision.candidate_actions],
    }


# ─── Models ───────────────────────────────────────────────────────────────────

class PromiseCreateRequest(BaseModel):
    receivable_id: str
    customer: str
    amount: float
    promised_date: str  # ISO date YYYY-MM-DD
    notes: Optional[str] = None
    source: Optional[str] = "manual"  # manual | voice | link


class ReceivableIngestRequest(BaseModel):
    id: Optional[str] = None
    customer_id: str
    customer_name: str
    invoice_number: str
    amount: float
    due_date: str
    days_overdue: int = 0
    risk_level: str = "MEDIUM"
    payment_behavior: str = "UNKNOWN"

class VoiceRecoveryRequest(BaseModel):
    receivable_id: str
    phone_number: str


class VoiceIntentRequest(BaseModel):
    transcript: str
    session_id: Optional[str] = None


class ReceivablePaymentRequest(BaseModel):
    amount: float
    provider: str
    reference: str


class DisputeRequest(BaseModel):
    reason: str
    actor: str = "customer"


class PromiseFulfillmentRequest(BaseModel):
    amount: Optional[float] = None
    provider: str
    reference: str


class SmsRequest(BaseModel):
    phone_number: str
    message: Optional[str] = None


# ─── Receivables endpoints ─────────────────────────────────────────────────────

@router.post("/")
def ingest_receivable(req: ReceivableIngestRequest):
    """Persist an invoice supplied by an upstream receivables system."""
    if req.amount <= 0:
        raise HTTPException(status_code=422, detail="amount must be positive")
    if req.days_overdue < 0:
        raise HTTPException(status_code=422, detail="days_overdue cannot be negative")
    factory = get_session_factory()
    with factory() as session:
        existing = session.execute(
            select(Receivable).where(Receivable.invoice_number == req.invoice_number)
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="invoice already exists")
        item = Receivable(
            id=req.id or f"inv_{uuid.uuid4().hex[:12]}",
            customer_id=req.customer_id,
            customer_name=req.customer_name,
            invoice_number=req.invoice_number,
            amount=req.amount,
            due_date=req.due_date,
            days_overdue=req.days_overdue,
            risk_level=req.risk_level,
            status="OVERDUE" if req.days_overdue > 0 else "UPCOMING",
            payment_behavior=req.payment_behavior,
        )
        session.add(item)
        session.commit()
        result = {"id": item.id, "invoice_number": item.invoice_number, "status": item.status}
    DBService.record_audit_event(
        item.id,
        "receivable_ingested",
        {
            "invoice_number": item.invoice_number,
            "customer_id": item.customer_id,
            "amount_inr": item.amount,
            "due_date": item.due_date,
            "status": item.status,
            "actor": "upstream_receivables",
        },
    )
    return result

@router.get("/")
def list_receivables():
    factory = get_session_factory()
    with factory() as session:
        _ensure_seeded(session)
        stmt = select(Receivable).order_by(desc(Receivable.days_overdue))
        items = session.execute(stmt).scalars().all()
        history_by_id = _payment_history_for(session, [r.id for r in items])
        return [_receivable_payload(r, history_by_id.get(r.id, [])) for r in items]


@router.get("/summary")
def get_summary():
    factory = get_session_factory()
    with factory() as session:
        _ensure_seeded(session)
        items = session.execute(select(Receivable)).scalars().all()
        promises = session.execute(select(PromiseToPay)).scalars().all()

        total = sum(r.amount for r in items)
        at_risk = sum(r.amount for r in items if r.risk_level in ("HIGH", "CRITICAL"))
        overdue = [r for r in items if r.days_overdue > 0]
        promises_due = [
            p for p in promises
            if _effective_promise_status(p.status, p.promise_date) in ("UPCOMING", "DUE_TODAY", "PROMISE_CREATED")
        ]

        return {
            "total_outstanding": total,
            "at_risk": at_risk,
            "overdue_count": len(overdue),
            "overdue_amount": sum(r.amount for r in overdue),
            "promises_due_count": len(promises_due),
            "promises_due_amount": sum(p.promised_amount for p in promises_due),
            "recovered_amount": sum(r.recovered_amount or 0.0 for r in items),
            "broken_promises_count": len([p for p in promises if p.status == "BROKEN"]),
        }


@router.get("/promises")
def list_promises():
    factory = get_session_factory()
    with factory() as session:
        stmt = select(PromiseToPay).order_by(desc(PromiseToPay.created_at))
        items = session.execute(stmt).scalars().all()
        return [_serialize_promise(p) for p in items]


@router.post("/promises")
async def create_promise(req: PromiseCreateRequest):
    factory = get_session_factory()
    with factory() as session:
        _ensure_seeded(session)
        rec = session.execute(
            select(Receivable).where(Receivable.id == req.receivable_id)
        ).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        if req.amount <= 0:
            raise HTTPException(status_code=422, detail="Promise amount must be positive")
        remaining = max(0.0, rec.amount - (rec.recovered_amount or 0.0))
        if req.amount > remaining:
            raise HTTPException(status_code=422, detail="Promise exceeds remaining receivable balance")
        # Idempotency check: don't create duplicate active promise for same receivable
        stmt = select(PromiseToPay).where(
            PromiseToPay.receivable_id == req.receivable_id,
            PromiseToPay.status.in_(list(ACTIVE_PROMISE_STATUSES)),
        )
        existing = session.execute(stmt).scalar_one_or_none()
        if existing:
            return _serialize_promise(existing)

        promise_id = f"ptp_{uuid.uuid4().hex[:8]}"
        source = (req.source or "manual").strip().lower() or "manual"
        if source not in {"manual", "voice", "link"}:
            source = "manual"
        promise = PromiseToPay(
            id=promise_id,
            receivable_id=req.receivable_id,
            customer_name=req.customer,
            promised_amount=req.amount,
            promise_date=req.promised_date,
            status="PROMISE_CREATED",
            source=source,
            notes=req.notes or "",
        )
        session.add(promise)

        # Update receivable
        rec.status = "PROMISE_TO_PAY"
        rec.updated_at = utcnow()
        session.commit()

    # Feed into Chakra pipeline (dry-run)
    payload = {
        "payment_id": promise_id,
        "amount_inr": req.amount,
        "error_code": "promise_created",
        "case_type": "PROMISE_TO_PAY",
        "customer_id": req.customer,
        "context": {
            "promise_status": "ACTIVE",
            "invoice_id": req.receivable_id,
            "promised_date": req.promised_date
        }
    }
    try:
        await execute_recovery_pipeline(payload, dry_run=True)
    except Exception as e:
        logger.warning(f"Pipeline error after promise creation: {e}")

    audit_details = {
        "receivable_id": req.receivable_id,
        "amount_inr": req.amount,
        "promised_date": req.promised_date,
        "source": source,
    }
    DBService.record_audit_event(promise_id, "PROMISE_CREATED", audit_details)
    audit_events = [{"event_type": "PROMISE_CREATED", "payment_id": promise_id, "details": audit_details}]

    return {
        "id": promise_id,
        "receivable_id": req.receivable_id,
        "customer": req.customer,
        "customer_name": req.customer,
        "amount": req.amount,
        "promised_amount": req.amount,
        "promised_date": req.promised_date,
        "promise_date": req.promised_date,
        "status": _effective_promise_status("PROMISE_CREATED", req.promised_date),
        "notes": req.notes or "",
        "source": source,
        "audit_events": audit_events,
    }


@router.post("/promises/{promise_id}/break")
async def break_promise(promise_id: str):
    """Mark a promise as BROKEN and feed BROKEN_PROMISE event into the pipeline."""
    factory = get_session_factory()
    with factory() as session:
        stmt = select(PromiseToPay).where(PromiseToPay.id == promise_id)
        promise = session.execute(stmt).scalar_one_or_none()
        if not promise:
            raise HTTPException(status_code=404, detail="Promise not found")
        if promise.status in TERMINAL_PROMISE_STATUSES:
            raise HTTPException(status_code=409, detail=f"Promise is already {promise.status}")

        promise.status = "BROKEN"
        promise.updated_at = utcnow()

        rec = session.execute(select(Receivable).where(Receivable.id == promise.receivable_id)).scalar_one_or_none()
        rec_id = promise.receivable_id
        cust_name = promise.customer_name
        amount = promise.promised_amount
        p_date = promise.promise_date

        if rec:
            rec.status = "OVERDUE"
            rec.previous_promises = (rec.previous_promises or 0) + 1
            rec.updated_at = utcnow()

        session.commit()

    # Feed broken promise event into pipeline
    payload = {
        "payment_id": promise_id,
        "amount_inr": amount,
        "error_code": "promise_broken",
        "case_type": "PROMISE_TO_PAY",
        "customer_id": cust_name,
        "context": {
            "promise_status": "BROKEN",
            "invoice_id": rec_id,
            "promised_date": p_date
        }
    }
    try:
        await execute_recovery_pipeline(payload, dry_run=True)
    except Exception as e:
        logger.warning(f"Pipeline error after promise break: {e}")

    DBService.record_audit_event(
        promise_id,
        "promise_broken",
        {
            "receivable_id": rec_id,
            "amount_inr": amount,
            "promised_date": p_date,
            "automation_stopped": True,
        },
    )

    return {
        "id": promise_id,
        "status": "BROKEN",
        "receivable_id": rec_id,
    }


@router.post("/promises/{promise_id}/fulfill")
def fulfill_promise(promise_id: str, req: PromiseFulfillmentRequest):
    """Apply a provider-confirmed promise payment and stop its recovery case."""
    if req.provider.strip().lower() in {"synthetic", "mock", "unknown"} or not req.reference.strip():
        raise HTTPException(status_code=422, detail="A real provider and confirmation reference are required")
    factory = get_session_factory()
    with factory() as session:
        promise = session.execute(select(PromiseToPay).where(PromiseToPay.id == promise_id)).scalar_one_or_none()
        if not promise:
            raise HTTPException(status_code=404, detail="Promise not found")
        if promise.status in TERMINAL_PROMISE_STATUSES:
            raise HTTPException(status_code=409, detail=f"Promise is already {promise.status}")
        rec = session.execute(select(Receivable).where(Receivable.id == promise.receivable_id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        amount = req.amount if req.amount is not None else promise.promised_amount
        if amount <= 0 or amount > promise.promised_amount:
            raise HTTPException(status_code=422, detail="Fulfillment amount must be within the promise amount")
        remaining = max(0.0, rec.amount - (rec.recovered_amount or 0.0))
        if amount > remaining:
            raise HTTPException(status_code=422, detail="Fulfillment exceeds remaining receivable balance")
        rec.recovered_amount = (rec.recovered_amount or 0.0) + amount
        promise.status = "FULFILLED"
        promise.updated_at = utcnow()
        rec.status = "PAID" if rec.recovered_amount >= rec.amount else "IN_RECOVERY"
        rec.updated_at = utcnow()
        session.commit()
        result = {"id": promise.id, "receivable_id": rec.id, "status": "FULFILLED", "amount": amount, "remaining_amount": max(0.0, rec.amount - rec.recovered_amount), "recovery_stopped": True}
    DBService.record_audit_event(promise_id, "promise_fulfilled", {**result, "provider": req.provider, "reference": req.reference})
    return result


@router.post("/promises/{promise_id}/escalate")
async def escalate_promise(promise_id: str):
    """Mark a promise ESCALATED and stop automated follow-up for that promise."""
    factory = get_session_factory()
    with factory() as session:
        promise = session.execute(select(PromiseToPay).where(PromiseToPay.id == promise_id)).scalar_one_or_none()
        if not promise:
            raise HTTPException(status_code=404, detail="Promise not found")
        if promise.status in TERMINAL_PROMISE_STATUSES:
            raise HTTPException(status_code=409, detail=f"Promise is already {promise.status}")
        promise.status = "ESCALATED"
        promise.updated_at = utcnow()
        rec = session.execute(select(Receivable).where(Receivable.id == promise.receivable_id)).scalar_one_or_none()
        rec_id = promise.receivable_id
        cust_name = promise.customer_name
        amount = promise.promised_amount
        p_date = promise.promise_date
        if rec:
            rec.status = "ESCALATED"
            rec.updated_at = utcnow()
        session.commit()

    escalation = DBService.create_escalation(
        case_id=rec_id,
        reason="BROKEN_OR_AT_RISK_PROMISE",
        priority="HIGH",
        severity="HIGH",
        actor="operator",
        notes=f"Promise {promise_id} escalated",
    )
    payload = {
        "payment_id": promise_id,
        "amount_inr": amount,
        "error_code": "promise_escalated",
        "case_type": "PROMISE_TO_PAY",
        "customer_id": cust_name,
        "context": {"promise_status": "ESCALATED", "invoice_id": rec_id, "promised_date": p_date},
    }
    try:
        await execute_recovery_pipeline(payload, dry_run=True)
    except Exception as e:
        logger.warning(f"Pipeline error after promise escalate: {e}")
    DBService.record_audit_event(
        promise_id,
        "promise_escalated",
        {"receivable_id": rec_id, "amount_inr": amount, "promised_date": p_date, "automation_stopped": True},
    )
    return {
        "id": promise_id,
        "status": "ESCALATED",
        "receivable_id": rec_id,
        "escalation": escalation,
        "escalation_persisted": escalation is not None,
    }


class PromiseRemindRequest(BaseModel):
    phone_number: str
    timing: Optional[str] = "auto"  # "auto", "before", "due", "after"
    payment_link: Optional[str] = None
    custom_message: Optional[str] = None


@router.post("/promises/{promise_id}/remind")
async def remind_promise(promise_id: str, req: PromiseRemindRequest):
    """Send an automated or custom Twilio SMS reminder for a Promise-to-Pay.

    Supports:
    - 1 day before due date ('before')
    - Due today ('due')
    - 1 day after / overdue ('after')
    - Auto-detection based on promise_date vs today
    """
    from backend.app.services.notify import send_promise_reminder_sms, send_sms
    from datetime import date, datetime

    factory = get_session_factory()
    with factory() as session:
        promise = session.execute(select(PromiseToPay).where(PromiseToPay.id == promise_id)).scalar_one_or_none()
        if not promise:
            raise HTTPException(status_code=404, detail="Promise not found")

        customer_name = promise.customer_name or "Valued Customer"
        amount = promise.promised_amount or 0.0
        p_date = promise.promise_date or ""
        receivable_id = promise.receivable_id
        customer_id = None

        if receivable_id:
            rec = session.execute(select(Receivable).where(Receivable.id == receivable_id)).scalar_one_or_none()
            if rec:
                customer_id = rec.customer_id

    # Determine timing
    timing = req.timing or "auto"
    if timing == "auto":
        today = date.today()
        try:
            p_dt = datetime.strptime(p_date, "%Y-%m-%d").date()
            diff = (p_dt - today).days
            if diff > 0:
                timing = "before"
            elif diff == 0:
                timing = "due"
            else:
                timing = "after"
        except Exception:
            timing = "due"

    payment_link = req.payment_link or f"https://rzp.io/l/p_{promise_id[:8]}"

    if req.custom_message:
        result = await send_sms(req.phone_number, req.custom_message)
    else:
        result = await send_promise_reminder_sms(
            to_number=req.phone_number,
            customer_name=customer_name,
            amount_inr=amount,
            promise_date=p_date,
            timing=timing,
            payment_link=payment_link,
        )

    provider_status = (result.get("status") or "").lower()
    persist_status = "SENT" if provider_status == "sent" else "FAILED"

    # Persist communication
    DBService.record_communication(
        case_id=receivable_id,
        customer_id=customer_id,
        channel="SMS",
        communication_type="PROMISE_REMINDER",
        provider=result.get("provider") or "twilio",
        provider_message_id=result.get("provider_message_id"),
        status=persist_status,
        metadata={
            "promise_id": promise_id,
            "timing": timing,
            "phone_number": req.phone_number,
            "amount": amount,
            "provider_result": result,
        },
    )

    # Audit event
    DBService.record_audit_event(
        promise_id,
        "promise_reminder_sent",
        {
            "promise_id": promise_id,
            "timing": timing,
            "to_phone": req.phone_number,
            "amount_inr": amount,
            "status": persist_status,
            "provider_message_id": result.get("provider_message_id"),
        },
    )

    return {
        "status": "success" if persist_status == "SENT" else "failed",
        "promise_id": promise_id,
        "timing": timing,
        "provider_result": result,
        "message": result.get("body"),
    }


class DispatchRemindersRequest(BaseModel):
    default_phone: Optional[str] = "+919930832015"


@router.post("/promises/dispatch-reminders")
async def dispatch_promise_reminders(req: DispatchRemindersRequest):
    """Scans all upcoming, due today, and recently broken promises and sends SMS reminders."""
    from backend.app.services.notify import send_promise_reminder_sms
    from datetime import date, datetime, timedelta

    today = date.today()
    tomorrow = today + timedelta(days=1)
    yesterday = today - timedelta(days=1)

    factory = get_session_factory()
    results = []

    with factory() as session:
        promises = session.execute(
            select(PromiseToPay).where(
                PromiseToPay.status.in_(("UPCOMING", "DUE_TODAY", "BROKEN"))
            )
        ).scalars().all()

        for p in promises:
            try:
                p_dt = datetime.strptime(p.promise_date, "%Y-%m-%d").date()
            except Exception:
                continue

            timing = None
            if p_dt == tomorrow:
                timing = "before"
            elif p_dt == today:
                timing = "due"
            elif p_dt <= yesterday or p.status == "BROKEN":
                timing = "after"

            if timing and req.default_phone:
                payment_link = f"https://rzp.io/l/p_{p.id[:8]}"
                res = await send_promise_reminder_sms(
                    to_number=req.default_phone,
                    customer_name=p.customer_name or "Valued Customer",
                    amount_inr=p.promised_amount or 0.0,
                    promise_date=p.promise_date or "",
                    timing=timing,
                    payment_link=payment_link,
                )
                results.append({
                    "promise_id": p.id,
                    "customer": p.customer_name,
                    "amount": p.promised_amount,
                    "timing": timing,
                    "status": res.get("status"),
                    "provider_message_id": res.get("provider_message_id"),
                })

    return {
        "total_scanned": len(promises),
        "reminders_dispatched": len(results),
        "results": results,
    }



@router.post("/{id}/recover")
async def recover_receivable(id: str, action: str = "PAYMENT_LINK"):
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")

        amount = rec.amount
        cust = rec.customer_name
        days = rec.days_overdue
        risk = rec.risk_level

        rec.status = "IN_RECOVERY"
        rec.updated_at = utcnow()
        session.commit()

    payload = {
        "payment_id": id,
        "amount_inr": amount,
        "error_code": f"receivable_{action.lower()}",
        "case_type": "RECEIVABLE",
        "customer_id": cust,
        "context": {
            "days_overdue": days,
            "risk": risk,
            "requested_action": action
        }
    }
    result = await execute_recovery_pipeline(payload, dry_run=False)
    return result


@router.post("/{id}/payment")
def record_receivable_payment(id: str, req: ReceivablePaymentRequest):
    """Record a provider-confirmed partial or full receivable payment."""
    if req.provider.strip().lower() in {"synthetic", "mock", "unknown"} or not req.reference.strip():
        raise HTTPException(status_code=422, detail="A real provider and confirmation reference are required")
    if req.amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be positive")
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        remaining = max(0.0, rec.amount - (rec.recovered_amount or 0.0))
        if req.amount > remaining:
            raise HTTPException(status_code=422, detail="Payment exceeds remaining balance")
        rec.recovered_amount = (rec.recovered_amount or 0.0) + req.amount
        rec.status = "PAID" if rec.recovered_amount >= rec.amount else "IN_RECOVERY"
        rec.updated_at = utcnow()
        session.commit()
        result = {"id": rec.id, "original_amount": rec.amount, "recovered_amount": rec.recovered_amount, "remaining_amount": max(0.0, rec.amount - rec.recovered_amount), "status": rec.status}
    DBService.record_audit_event(id, "receivable_payment_confirmed", {**result, "provider": req.provider, "reference": req.reference})
    return result


@router.post("/{id}/dispute")
def dispute_receivable(id: str, req: DisputeRequest):
    """Stop automated collection and create a human customer-dispute escalation."""
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        rec.status = "DISPUTED"
        rec.updated_at = utcnow()
        session.commit()
    escalation = DBService.create_escalation(case_id=id, reason="CUSTOMER_DISPUTE", priority="HIGH", severity="HIGH", actor=req.actor, notes=req.reason)
    DBService.record_audit_event(id, "automated_collection_stopped", {"reason": "CUSTOMER_DISPUTE", "notes": req.reason})
    return {"receivable_id": id, "status": "DISPUTED", "automation_stopped": True, "escalation": escalation}


@router.post("/{id}/sms")
async def send_receivable_sms(id: str, req: SmsRequest):
    """Send and persist a real Twilio SMS attempt; never claim delivery locally."""
    from backend.app.services.notify import build_notification, send_sms
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        customer_id = rec.customer_id
        customer_name = rec.customer_name
        amount = rec.amount
        message = req.message
        if not message:
            notification = build_notification(
                "send_payment_link",
                {"name": customer_name, "merchant_name": "Chakra"},
                {"amount": int(amount * 100), "error_code": "receivable_overdue"},
            )
            message = notification.get("message")
        result = await send_sms(req.phone_number, message or "")

    provider_status = (result.get("status") or "").lower()
    # Provider acceptance only — never claim DELIVERED without a delivery webhook.
    if provider_status == "sent":
        persist_status = "SENT"
    elif provider_status == "unavailable":
        persist_status = "FAILED"
    else:
        persist_status = "FAILED"

    DBService.record_communication(
        # Receivable IDs are not recovery_cases FKs; persist under customer + metadata.
        case_id=None,
        customer_id=customer_id,
        channel="SMS",
        communication_type="RECEIVABLE_REMINDER",
        provider=result.get("provider") or "twilio",
        provider_message_id=result.get("provider_message_id"),
        status=persist_status,
        metadata={"provider_result": result, "receivable_id": id, "delivery_claimed": False},
    )
    return {**result, "persisted_status": persist_status, "delivery_claimed": False}


class EmailRequest(BaseModel):
    to_email: Optional[str] = "rudracmalvankar@gmail.com"
    subject: Optional[str] = None
    html_content: Optional[str] = None


@router.post("/{id}/email")
async def send_receivable_email(id: str, req: EmailRequest):
    """Send an email via Twilio Comms API with constant recipient and approved template."""
    from backend.app.services.notify import send_email
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        customer_id = rec.customer_id

    result = await send_email(to_email=req.to_email, subject=req.subject, html_content=req.html_content)
    provider_status = (result.get("status") or "").lower()
    persist_status = "SENT" if provider_status == "sent" else "FAILED"

    DBService.record_communication(
        case_id=None,
        customer_id=customer_id,
        channel="EMAIL",
        communication_type="RECEIVABLE_EMAIL",
        provider="twilio_email",
        provider_message_id=result.get("provider_message_id"),
        status=persist_status,
        metadata={"provider_result": result, "receivable_id": id},
    )
    DBService.record_audit_event(
        id,
        "receivable_email_sent",
        {
            "receivable_id": id,
            "to_email": result.get("to"),
            "status": persist_status,
            "operation_id": result.get("provider_message_id"),
        },
    )
    return {**result, "persisted_status": persist_status}


@router.post("/promises/{promise_id}/email")
async def send_promise_email(promise_id: str, req: EmailRequest):
    """Send a promise reminder email via Twilio Comms API."""
    from backend.app.services.notify import send_email
    factory = get_session_factory()
    with factory() as session:
        promise = session.execute(select(PromiseToPay).where(PromiseToPay.id == promise_id)).scalar_one_or_none()
        if not promise:
            raise HTTPException(status_code=404, detail="Promise not found")
        receivable_id = promise.receivable_id

    result = await send_email(to_email=req.to_email, subject=req.subject, html_content=req.html_content)
    provider_status = (result.get("status") or "").lower()
    persist_status = "SENT" if provider_status == "sent" else "FAILED"

    DBService.record_communication(
        case_id=receivable_id,
        customer_id=None,
        channel="EMAIL",
        communication_type="PROMISE_EMAIL",
        provider="twilio_email",
        provider_message_id=result.get("provider_message_id"),
        status=persist_status,
        metadata={"promise_id": promise_id, "provider_result": result},
    )
    DBService.record_audit_event(
        promise_id,
        "promise_email_sent",
        {
            "promise_id": promise_id,
            "to_email": result.get("to"),
            "status": persist_status,
            "operation_id": result.get("provider_message_id"),
        },
    )
    return {**result, "persisted_status": persist_status}



@router.post("/voice/start")
async def start_voice_recovery(req: VoiceRecoveryRequest):
    from backend.app.services.voice import get_voice_provider
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == req.receivable_id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        amount = rec.amount
        cust = rec.customer_name

    provider = get_voice_provider()
    res = await provider.start_call(
        to_number=req.phone_number,
        context={"case_id": req.receivable_id, "amount": amount}
    )

    call_sid = res.get("call_sid") or f"unavailable_{uuid.uuid4().hex[:8]}"
    interaction_status = "INITIATED" if res.get("status") == "success" else "FAILED"

    # Persist voice interaction in DB
    with factory() as session:
        vi = VoiceInteraction(
            id=f"vi_{uuid.uuid4().hex[:8]}",
            customer_id=cust,
            receivable_id=req.receivable_id,
            call_sid=call_sid,
            status=interaction_status,
        )
        session.add(vi)
        session.commit()

    DBService.record_communication(
        case_id=req.receivable_id,
        customer_id=cust,
        channel="VOICE",
        communication_type="RECEIVABLE_RECOVERY",
        provider="twilio" if settings.is_twilio_configured else "unavailable",
        provider_message_id=res.get("call_sid"),
        status="SENT" if res.get("status") == "success" else "FAILED",
        metadata={"provider_response": res},
    )

    payload = {
        "payment_id": req.receivable_id,
        "amount_inr": amount,
        "error_code": "voice_recovery_initiated",
        "case_type": "RECEIVABLE",
        "customer_id": cust,
        "context": {
            "voice_call_sid": call_sid,
            "mocked": res.get("mocked", False)
        }
    }
    try:
        await execute_recovery_pipeline(payload, dry_run=True)
    except Exception as e:
        logger.warning(f"Pipeline error after voice start: {e}")

    return res


@router.post("/voice/intent")
async def analyze_voice_intent(req: VoiceIntentRequest):
    """Interpret a browser/operator transcript through the dedicated voice AI path."""
    from backend.app.services.voice import extract_voice_intent
    session_id = req.session_id or f"voice_{uuid.uuid4().hex[:10]}"
    DBService.record_audit_event(
        session_id,
        "AI_VOICE_INTENT_REQUESTED",
        {"request_type": "voice_intent", "session_id": session_id, "transcript_length": len(req.transcript)},
    )
    intent = await extract_voice_intent(req.transcript)
    result = intent.model_dump()
    result["session_id"] = session_id
    DBService.record_audit_event(session_id, "AI_VOICE_INTENT_COMPLETED", result)

    # Automatically persist a Promise to Pay if a case_id is provided and the intent is promise_to_pay
    if intent.intent == "promise_to_pay" and req.case_id:
        try:
            promise_id = DBService.create_promise(
                receivable_id=req.case_id,
                amount_inr=float(intent.amount) if intent.amount else 0.0,
                promise_date=intent.promised_date,
                source="voice",
                notes=f"Created via browser voice simulation. Transcript: '{req.transcript[:50]}...'"
            )
            result["promise_id"] = promise_id
            DBService.record_audit_event(
                promise_id,
                "PROMISE_CREATED",
                {"receivable_id": req.case_id, "amount_inr": intent.amount, "source": "voice"}
            )
        except Exception as e:
            result["promise_creation_error"] = str(e)

    return result


@router.get("/{id}")
def get_receivable(id: str):
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        history = _payment_history_for(session, [rec.id]).get(rec.id, [])
        return _receivable_payload(rec, history)
