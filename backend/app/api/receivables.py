"""
B2B Receivables & Promise-to-Pay API.
Persisted in Neon Postgres via SQLAlchemy 2.x models.
Integrated into Chakra recovery pipeline.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid

from sqlalchemy import select, func, desc
from backend.app.config import settings
from backend.app.db.session import get_session_factory
from backend.app.db.models import Receivable, PromiseToPay, VoiceInteraction, Customer, utcnow
from backend.app.services.recovery_executor import execute_recovery_pipeline

router = APIRouter()

SEED_RECEIVABLES = [
    {
        "id": "inv_1001",
        "customer_id": "cust_techcorp",
        "customer_name": "TechCorp India",
        "invoice_number": "INV-2026-001",
        "amount": 250000.0,
        "due_date": "2026-08-15",
        "days_overdue": 20,
        "risk_level": "HIGH",
        "status": "OVERDUE",
        "previous_promises": 1,
        "payment_behavior": "SOMETIMES_LATE",
    },
    {
        "id": "inv_1002",
        "customer_id": "cust_alpharetail",
        "customer_name": "Alpha Retail Co.",
        "invoice_number": "INV-2026-002",
        "amount": 85000.0,
        "due_date": "2026-09-01",
        "days_overdue": 3,
        "risk_level": "MEDIUM",
        "status": "OVERDUE",
        "previous_promises": 0,
        "payment_behavior": "USUALLY_ONTIME",
    },
    {
        "id": "inv_1003",
        "customer_id": "cust_betatech",
        "customer_name": "BetaTech Solutions",
        "invoice_number": "INV-2026-003",
        "amount": 45000.0,
        "due_date": "2026-09-10",
        "days_overdue": 0,
        "risk_level": "LOW",
        "status": "UPCOMING",
        "previous_promises": 0,
        "payment_behavior": "ALWAYS_ONTIME",
    },
]


def _ensure_seeded(session):
    """Seed initial invoices if DB table is empty."""
    existing = session.execute(select(func.count(Receivable.id))).scalar() or 0
    if existing == 0:
        for item in SEED_RECEIVABLES:
            rec = Receivable(**item)
            session.add(rec)
        session.commit()


# ─── Models ───────────────────────────────────────────────────────────────────

class PromiseCreateRequest(BaseModel):
    receivable_id: str
    customer: str
    amount: float
    promised_date: str  # ISO date YYYY-MM-DD
    notes: Optional[str] = None

class VoiceRecoveryRequest(BaseModel):
    receivable_id: str
    phone_number: str


# ─── Receivables endpoints ─────────────────────────────────────────────────────

@router.get("/")
def list_receivables():
    factory = get_session_factory()
    with factory() as session:
        _ensure_seeded(session)
        stmt = select(Receivable).order_by(desc(Receivable.days_overdue))
        items = session.execute(stmt).scalars().all()
        results = []
        for r in items:
            latest_p = None
            if r.promises:
                latest = sorted(r.promises, key=lambda p: p.created_at or datetime.min, reverse=True)[0]
                latest_p = latest.id
            results.append({
                "id": r.id,
                "customer": r.customer_name,
                "invoice_id": r.invoice_number,
                "amount": r.amount,
                "due_date": r.due_date,
                "days_overdue": r.days_overdue,
                "risk": r.risk_level,
                "status": r.status,
                "previous_promises": r.previous_promises,
                "payment_behavior": r.payment_behavior,
                "promise": latest_p,
            })
        return results


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
        promises_due = [p for p in promises if p.status in ("UPCOMING", "DUE_TODAY")]

        return {
            "total_outstanding": total,
            "at_risk": at_risk,
            "overdue_count": len(overdue),
            "overdue_amount": sum(r.amount for r in overdue),
            "promises_due_count": len(promises_due),
            "promises_due_amount": sum(p.promised_amount for p in promises_due),
        }


@router.get("/promises")
def list_promises():
    factory = get_session_factory()
    with factory() as session:
        stmt = select(PromiseToPay).order_by(desc(PromiseToPay.created_at))
        items = session.execute(stmt).scalars().all()
        return [
            {
                "id": p.id,
                "receivable_id": p.receivable_id,
                "customer": p.customer_name,
                "amount": p.promised_amount,
                "promised_date": p.promise_date,
                "status": p.status,
                "source": p.source,
                "notes": p.notes or "",
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in items
        ]


@router.post("/promises")
async def create_promise(req: PromiseCreateRequest):
    factory = get_session_factory()
    with factory() as session:
        _ensure_seeded(session)
        # Idempotency check: don't create duplicate active promise for same receivable
        stmt = select(PromiseToPay).where(
            PromiseToPay.receivable_id == req.receivable_id,
            PromiseToPay.status.in_(["UPCOMING", "DUE_TODAY"])
        )
        existing = session.execute(stmt).scalar_one_or_none()
        if existing:
            return {
                "id": existing.id,
                "receivable_id": existing.receivable_id,
                "customer": existing.customer_name,
                "amount": existing.promised_amount,
                "promised_date": existing.promise_date,
                "status": existing.status,
            }

        promise_id = f"ptp_{uuid.uuid4().hex[:8]}"
        promise = PromiseToPay(
            id=promise_id,
            receivable_id=req.receivable_id,
            customer_name=req.customer,
            promised_amount=req.amount,
            promise_date=req.promised_date,
            status="UPCOMING",
            source="manual",
            notes=req.notes or "",
        )
        session.add(promise)

        # Update receivable
        rec = session.execute(select(Receivable).where(Receivable.id == req.receivable_id)).scalar_one_or_none()
        if rec:
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
    except Exception:
        pass

    return {
        "id": promise_id,
        "receivable_id": req.receivable_id,
        "customer": req.customer,
        "amount": req.amount,
        "promised_date": req.promised_date,
        "status": "UPCOMING",
        "notes": req.notes or "",
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
    except Exception:
        pass

    return {
        "id": promise_id,
        "status": "BROKEN",
        "receivable_id": rec_id,
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

    call_sid = res.get("call_sid") or f"CA_mock_{uuid.uuid4().hex[:8]}"

    # Persist voice interaction in DB
    with factory() as session:
        vi = VoiceInteraction(
            id=f"vi_{uuid.uuid4().hex[:8]}",
            customer_id=cust,
            receivable_id=req.receivable_id,
            call_sid=call_sid,
            status="INITIATED",
        )
        session.add(vi)
        session.commit()

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
    except Exception:
        pass

    return res


@router.get("/{id}")
def get_receivable(id: str):
    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == id)).scalar_one_or_none()
        if not rec:
            raise HTTPException(status_code=404, detail="Receivable not found")
        return {
            "id": rec.id,
            "customer": rec.customer_name,
            "invoice_id": rec.invoice_number,
            "amount": rec.amount,
            "due_date": rec.due_date,
            "days_overdue": rec.days_overdue,
            "risk": rec.risk_level,
            "status": rec.status,
            "previous_promises": rec.previous_promises,
            "payment_behavior": rec.payment_behavior,
        }
