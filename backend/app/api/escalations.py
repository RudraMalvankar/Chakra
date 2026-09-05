"""Human queue for recovery cases that deterministic automation stopped."""
import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.config import settings
from backend.app.services.db_service import DBService
from backend.app.services.notify import (
    send_sms,
    send_email,
    build_receivable_email_content,
    TWILIO_EMAIL_RECIPIENT,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["escalations"])


# ─── Request Schemas ─────────────────────────────────────────────────────────

class EscalationTransitionRequest(BaseModel):
    status: str = Field(description="Valid next escalation status")
    actor: str = "operator"
    notes: Optional[str] = None
    assigned_to: Optional[str] = None
    resolution: Optional[str] = None


class CreateEscalationRequest(BaseModel):
    case_id: str = Field(description="Receivable ID, Payment ID, or Case ID")
    reason: str = Field(default="MANUAL_OPERATOR_ESCALATION")
    priority: str = Field(default="HIGH")
    severity: str = Field(default="HIGH")
    actor: str = Field(default="operator")
    notes: Optional[str] = None


class AssignRequest(BaseModel):
    assigned_to: str
    priority: Optional[str] = None
    sla_hours: Optional[int] = None
    notes: Optional[str] = None
    actor: str = "operator"


class AddNoteRequest(BaseModel):
    notes: str
    actor: str = "operator"


class SendEscalationSmsRequest(BaseModel):
    to_number: Optional[str] = None
    message: Optional[str] = None
    actor: str = "operator"


class SendEscalationEmailRequest(BaseModel):
    to_email: Optional[str] = None
    subject: Optional[str] = None
    html_content: Optional[str] = None
    actor: str = "operator"


class CreateEscalationPaymentLinkRequest(BaseModel):
    amount: Optional[float] = None
    description: Optional[str] = None
    actor: str = "operator"


class RecordEscalationPromiseRequest(BaseModel):
    promised_amount: float
    promise_date: str
    notes: Optional[str] = None
    actor: str = "operator"


class ResolveEscalationRequest(BaseModel):
    resolution: str = Field(description="E.g. PAYMENT_COLLECTED, PROMISE_SCHEDULED, DISPUTE_ACCEPTED, WRITE_OFF")
    resolution_notes: str
    actor: str = "operator"


# ─── Read Endpoints ──────────────────────────────────────────────────────────

@router.get("/")
def list_escalations(limit: int = 200):
    return DBService.list_escalations(limit=limit)


@router.get("/summary")
def escalation_summary():
    return DBService.get_escalation_summary()


@router.get("/{escalation_id}")
def get_escalation(escalation_id: str):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return escalation


# ─── Mutation Endpoints ──────────────────────────────────────────────────────

@router.post("/create")
def create_manual_escalation(req: CreateEscalationRequest):
    escalation = DBService.create_escalation(
        case_id=req.case_id,
        reason=req.reason,
        priority=req.priority.upper(),
        severity=req.severity.upper(),
        actor=req.actor,
        notes=req.notes,
    )
    if not escalation:
        raise HTTPException(status_code=500, detail="Could not create escalation")
    return escalation


@router.post("/{escalation_id}/transition")
def transition_escalation(escalation_id: str, request: EscalationTransitionRequest):
    try:
        escalation = DBService.transition_escalation(
            escalation_id=escalation_id,
            status=request.status.upper(),
            actor=request.actor,
            notes=request.notes,
            assigned_to=request.assigned_to,
            resolution=request.resolution,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return escalation


@router.post("/{escalation_id}/assign")
def assign_specialist(escalation_id: str, req: AssignRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    new_status = "ASSIGNED" if escalation["status"] == "OPEN" else escalation["status"]
    meta: Dict[str, Any] = {"assigned_to": req.assigned_to}
    if req.priority:
        meta["priority"] = req.priority.upper()

    notes = req.notes or f"Assigned to {req.assigned_to}"
    updated = DBService.transition_escalation(
        escalation_id=escalation_id,
        status=new_status,
        actor=req.actor,
        notes=notes,
        assigned_to=req.assigned_to,
        metadata=meta,
    )
    return updated


@router.post("/{escalation_id}/note")
def add_case_note(escalation_id: str, req: AddNoteRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    updated = DBService.record_escalation_action(
        escalation_id=escalation_id,
        action="NOTE_ADDED",
        actor=req.actor,
        notes=req.notes,
    )
    return updated


@router.post("/{escalation_id}/sms")
async def send_escalation_sms(escalation_id: str, req: SendEscalationSmsRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    case_id = escalation["case_id"]
    customer_name = escalation.get("customer_name") or "Customer"
    amount = escalation.get("amount_at_risk_inr") or 0.0

    recipient = req.to_number or escalation.get("customer_phone") or settings.twilio_verified_recipient or "+919930832015"
    message = req.message
    if not message:
        message = f"Namaste {customer_name}, notice from Chakra Recovery regarding invoice #{escalation.get('invoice_number', case_id)} for Rs. {int(amount)}. Please contact our representative or pay securely."

    res = await send_sms(to_number=recipient, message=message)

    # Persist communication
    DBService.record_communication(
        case_id=case_id,
        customer_id=customer_name,
        channel="SMS",
        status="SENT" if res.get("status") == "sent" else "FAILED",
        provider="twilio",
        communication_type="ESCALATION_NOTICE",
        provider_message_id=res.get("provider_message_id"),
        metadata={"to": recipient, "message": message, "trial_fallback": res.get("trial_fallback")},
    )

    # Record action in escalation timeline
    action_note = f"Sent SMS to {recipient}: {message[:60]}..."
    if res.get("trial_fallback"):
        action_note += " (Twilio Trial Template sent to Gmail/phone)"

    DBService.record_escalation_action(
        escalation_id=escalation_id,
        action="SMS_DISPATCHED",
        actor=req.actor,
        notes=action_note,
        metadata={"recipient": recipient, "sid": res.get("provider_message_id")},
    )

    # Advance status if open or assigned
    if escalation["status"] in {"OPEN", "ASSIGNED"}:
        DBService.transition_escalation(
            escalation_id=escalation_id,
            status="CUSTOMER_CONTACTED",
            actor=req.actor,
            notes="Status progressed after outbound customer contact",
        )

    return {"status": res.get("status"), "result": res, "escalation": DBService.get_escalation(escalation_id)}


@router.post("/{escalation_id}/email")
async def send_escalation_email(escalation_id: str, req: SendEscalationEmailRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    case_id = escalation["case_id"]
    customer_name = escalation.get("customer_name") or "Valued Customer"
    amount = escalation.get("amount_at_risk_inr") or 0.0
    invoice_num = escalation.get("invoice_number") or case_id

    recipient = req.to_email or escalation.get("customer_email") or TWILIO_EMAIL_RECIPIENT

    subject = req.subject
    html_content = req.html_content

    if not subject or not html_content:
        auto_sub, auto_html = build_receivable_email_content(
            customer_name=customer_name,
            amount_inr=amount,
            invoice_number=invoice_num,
            payment_link="https://rzp.io/l/recovery",
            days_overdue=escalation.get("days_overdue", 0),
        )
        subject = subject or auto_sub
        html_content = html_content or auto_html

    res = await send_email(to_email=recipient, subject=subject, html_content=html_content)

    DBService.record_communication(
        case_id=case_id,
        customer_id=customer_name,
        channel="EMAIL",
        status="SENT" if res.get("status") == "sent" else "FAILED",
        provider="twilio_email",
        communication_type="ESCALATION_EMAIL_NOTICE",
        provider_message_id=res.get("provider_message_id"),
        metadata={"to": recipient, "subject": subject, "trial_fallback": res.get("trial_fallback")},
    )

    action_note = f"Sent recovery email to {recipient} [{subject}]"
    if res.get("trial_fallback"):
        action_note += " (Delivered via Twilio sandbox)"

    DBService.record_escalation_action(
        escalation_id=escalation_id,
        action="EMAIL_DISPATCHED",
        actor=req.actor,
        notes=action_note,
        metadata={"recipient": recipient, "op_id": res.get("provider_message_id")},
    )

    if escalation["status"] in {"OPEN", "ASSIGNED"}:
        DBService.transition_escalation(
            escalation_id=escalation_id,
            status="CUSTOMER_CONTACTED",
            actor=req.actor,
            notes="Status progressed after outbound email communication",
        )

    return {"status": res.get("status"), "result": res, "escalation": DBService.get_escalation(escalation_id)}


@router.post("/{escalation_id}/link")
def create_escalation_payment_link(escalation_id: str, req: CreateEscalationPaymentLinkRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    case_id = escalation["case_id"]
    customer_name = escalation.get("customer_name") or "Customer"
    amount = req.amount or escalation.get("amount_at_risk_inr") or 1000.0

    # Try creating a real Razorpay payment link
    link_url = None
    provider_link_id = None
    provider = "synthetic"

    if settings.is_razorpay_configured:
        try:
            import razorpay
            client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
            rzp_payload = {
                "amount": int(amount * 100),
                "currency": "INR",
                "accept_partial": False,
                "description": req.description or f"Payment for Case {case_id}",
                "customer": {
                    "name": customer_name,
                    "contact": escalation.get("customer_phone", "+919930832015"),
                    "email": escalation.get("customer_email", "rudracmalvankar@gmail.com"),
                },
                "notify": {"sms": False, "email": False},
                "reminder_enable": True,
            }
            rzp_link = client.payment_link.create(rzp_payload)
            link_url = rzp_link.get("short_url")
            provider_link_id = rzp_link.get("id")
            provider = "razorpay"
        except Exception as exc:
            logger.warning(f"Failed to generate live Razorpay link, fallback to mock: {exc}")

    if not link_url:
        import uuid
        short_id = uuid.uuid4().hex[:8]
        link_url = f"https://rzp.io/l/chakra_{short_id}"
        provider_link_id = f"plink_{short_id}"

    # Persist in PaymentLink
    link_db_id = DBService.record_payment_link(
        case_id=case_id,
        customer_id=customer_name,
        provider=provider,
        amount=amount,
        url=link_url,
        provider_link_id=provider_link_id,
        status="ACTIVE",
    )

    # Record action
    DBService.record_escalation_action(
        escalation_id=escalation_id,
        action="PAYMENT_LINK_CREATED",
        actor=req.actor,
        notes=f"Generated {provider.upper()} link for Rs. {int(amount)}: {link_url}",
        metadata={"url": link_url, "amount": amount, "provider": provider},
    )

    # Progress status to ACTION_TAKEN if in contact or in progress
    if escalation["status"] in {"OPEN", "ASSIGNED", "IN_PROGRESS", "CUSTOMER_CONTACTED"}:
        DBService.transition_escalation(
            escalation_id=escalation_id,
            status="ACTION_TAKEN",
            actor=req.actor,
            notes="Status moved to ACTION_TAKEN upon link dispatch",
        )

    return {
        "id": link_db_id,
        "url": link_url,
        "amount": amount,
        "provider": provider,
        "escalation": DBService.get_escalation(escalation_id),
    }


@router.post("/{escalation_id}/promise")
def record_escalation_promise(escalation_id: str, req: RecordEscalationPromiseRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    case_id = escalation["case_id"]
    customer_name = escalation.get("customer_name") or "Customer"

    # If linked to a receivable, record directly in PromiseToPay table
    from backend.app.db.session import get_session_factory
    from backend.app.db.models import Receivable, PromiseToPay
    from sqlalchemy import select
    from backend.app.services.db_service import utcnow

    factory = get_session_factory()
    with factory() as session:
        rec = session.execute(select(Receivable).where(Receivable.id == case_id)).scalar_one_or_none()
        if rec:
            promise = PromiseToPay(
                receivable_id=rec.id,
                customer_name=customer_name,
                promised_amount=req.promised_amount,
                promise_date=req.promise_date,
                status="UPCOMING",
                source="escalation_operator",
                notes=req.notes,
            )
            session.add(promise)
            rec.previous_promises = (rec.previous_promises or 0) + 1
            session.commit()

    # Log escalation action
    DBService.record_escalation_action(
        escalation_id=escalation_id,
        action="PROMISE_RECEIVED",
        actor=req.actor,
        notes=f"Customer promised to pay Rs. {int(req.promised_amount)} by {req.promise_date}. Notes: {req.notes or 'None'}",
        metadata={"amount": req.promised_amount, "date": req.promise_date},
    )

    # Update status to PROMISE_RECEIVED
    updated = DBService.transition_escalation(
        escalation_id=escalation_id,
        status="PROMISE_RECEIVED",
        actor=req.actor,
        notes=f"Formally recorded Promise-to-Pay for {req.promise_date}",
    )
    return updated


@router.post("/{escalation_id}/resolve")
def resolve_escalation(escalation_id: str, req: ResolveEscalationRequest):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")

    status_target = "UNRECOVERABLE" if "WRITE" in req.resolution.upper() or "UNREC" in req.resolution.upper() else "RESOLVED"
    updated = DBService.transition_escalation(
        escalation_id=escalation_id,
        status=status_target,
        actor=req.actor,
        notes=req.resolution_notes,
        resolution=req.resolution,
    )
    return updated
