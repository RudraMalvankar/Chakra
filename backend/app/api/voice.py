"""
Voice Recovery API — start calls, poll status/transcript/intents.

Uses the existing VoiceProvider abstraction (Twilio/Mock/Unavailable)
and the Communication table for transcript persistence.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.app.services.voice import get_voice_provider
from backend.app.services.db_service import DBService
from backend.app.config import settings

router = APIRouter(tags=["Voice"])


class StartVoiceRequest(BaseModel):
    case_id: str
    to_number: str
    amount: float
    customer_name: Optional[str] = None


@router.post("/api/voice/recovery/start")
async def start_voice_recovery(req: StartVoiceRequest):
    provider = get_voice_provider()
    context = {
        "case_id": req.case_id,
        "amount": req.amount,
        "customer_name": req.customer_name,
    }

    result = await provider.start_call(req.to_number, context)

    if result.get("status") == "error":
        raise HTTPException(
            status_code=400,
            detail={
                "status": "error",
                "code": "TWILIO_NOT_CONFIGURED",
                "message": result.get("message"),
            },
        )

    call_sid = result.get("call_sid")

    DBService.record_audit_event(
        req.case_id,
        "voice_call_started",
        {
            "call_sid": call_sid,
            "to_number": "REDACTED",
            "provider": "twilio" if settings.is_twilio_configured else "mock",
            "amount": req.amount,
        },
    )

    # Store initial call status
    DBService.record_communication(
        case_id=req.case_id,
        customer_id=None,
        channel="VOICE",
        communication_type="OUTBOUND_CALL",
        provider="twilio" if settings.is_twilio_configured else "mock",
        provider_message_id=call_sid,
        status="initiated",
        metadata={"amount": req.amount, "call_sid": call_sid},
    )

    return {
        "status": "success",
        "call_sid": call_sid,
        "provider": "twilio" if settings.is_twilio_configured else "mock",
        "mode": "live" if settings.is_twilio_configured else "simulation",
    }


@router.get("/api/voice/recovery/{call_sid}")
async def get_voice_recovery_status(call_sid: str):
    """Poll endpoint: returns call status, transcript, intents, promise for a call_sid."""
    from backend.app.db.session import get_session_factory
    from backend.app.db.models import Communication, AuditEvent
    from sqlalchemy import select

    factory = get_session_factory()
    with factory() as session:
        # Find the latest communication status for this call_sid
        comms = (
            session.execute(
                select(Communication)
                .where(Communication.provider_message_id == call_sid)
                .order_by(Communication.created_at.asc())
            )
            .scalars()
            .all()
        )

        # Determine call status from the most recent CALL_STATUS_UPDATE or OUTBOUND_CALL
        call_status = "unknown"
        transcript = []
        for comm in comms:
            if comm.communication_type in ("CALL_STATUS_UPDATE", "OUTBOUND_CALL"):
                call_status = comm.status
            if comm.communication_type == "VOICE_TRANSCRIPT":
                meta = comm.body_metadata or {}
                transcript.append(
                    {
                        "speaker": meta.get("speaker", "UNKNOWN"),
                        "text": meta.get("text", ""),
                        "timestamp": comm.created_at.isoformat() if comm.created_at else None,
                    }
                )

        # Find AI intent audit events for this call_sid
        intent_audits = (
            session.execute(
                select(AuditEvent)
                .where(AuditEvent.event_type == "AI_VOICE_INTENT_COMPLETED")
                .order_by(AuditEvent.created_at.asc())
            )
            .scalars()
            .all()
        )

        intents = []
        for audit in intent_audits:
            meta = audit.metadata_json or {}
            if meta.get("session_id") == call_sid:
                intents.append(
                    {
                        "intent": meta.get("intent"),
                        "confidence": meta.get("confidence"),
                        "language": meta.get("language"),
                        "model_used": meta.get("model"),
                    }
                )

        # Find promise events for this call_sid
        promise = None
        promise_audits = (
            session.execute(
                select(AuditEvent)
                .where(AuditEvent.event_type == "PROMISE_CREATED")
                .order_by(AuditEvent.created_at.desc())
            )
            .scalars()
            .all()
        )
        for audit in promise_audits:
            meta = audit.metadata_json or {}
            if meta.get("call_sid") == call_sid:
                promise = {
                    "amount_inr": meta.get("amount_inr"),
                    "promised_date": meta.get("promised_date"),
                    "source": "voice",
                }
                break

    return {
        "call_sid": call_sid,
        "status": call_status,
        "transcript": transcript,
        "intents": intents,
        "promise": promise,
        "actions": [],
    }
