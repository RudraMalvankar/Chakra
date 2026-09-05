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
        "customer_name": req.customer_name
    }
    
    result = await provider.start_call(req.to_number, context)
    
    if result.get("status") == "error":
        raise HTTPException(
            status_code=400, 
            detail={"status": "error", "code": "TWILIO_NOT_CONFIGURED", "message": result.get("message")}
        )
    
    call_sid = result.get("call_sid")
    
    DBService.record_audit_event(
        req.case_id,
        "voice_call_started",
        {
            "call_sid": call_sid,
            "to_number": "REDACTED",
            "provider": "twilio" if settings.is_twilio_configured else "mock",
            "amount": req.amount
        }
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
        metadata={"amount": req.amount, "call_sid": call_sid}
    )
    
    return {
        "status": "success",
        "call_sid": call_sid,
        "provider": "twilio" if settings.is_twilio_configured else "mock",
        "mode": "live" if settings.is_twilio_configured else "simulation"
    }

@router.get("/api/voice/recovery/{call_sid}")
async def get_voice_recovery_status(call_sid: str):
    from backend.app.db.database import get_session_factory
    from backend.app.db.models import CommunicationHistory, AuditEvent
    from sqlalchemy import select
    
    factory = get_session_factory()
    with factory() as session:
        # Find the latest communication event for this call_sid
        comm = session.execute(
            select(CommunicationHistory)
            .where(CommunicationHistory.provider_message_id == call_sid)
            .order_by(CommunicationHistory.created_at.desc())
        ).scalars().first()
        
        # Find audit events related to this call_sid to reconstruct transcript
        audits = session.execute(
            select(AuditEvent)
            .where(
                (AuditEvent.entity_id == call_sid) | 
                (AuditEvent.metadata_json.like(f'%"{call_sid}"%'))
            )
            .order_by(AuditEvent.timestamp.asc())
        ).scalars().all()
        
        status = comm.status if comm else "unknown"
        transcript = []
        intents = []
        promise = None
        
        for audit in audits:
            meta = audit.metadata_json or {}
            
            if audit.event_type == "voice_transcript_received" or "transcript" in meta:
                # Add transcript if available
                # Wait, Twilio Gather creates AI_VOICE_INTENT_COMPLETED
                pass
            
            if audit.event_type == "AI_VOICE_INTENT_COMPLETED":
                intents.append({
                    "intent": meta.get("intent"),
                    "confidence": meta.get("confidence"),
                    "language": meta.get("language"),
                    "model_used": meta.get("model")
                })
                if "transcript" in meta:
                    transcript.append({"speaker": "CUSTOMER", "text": meta["transcript"]})
                    
            if audit.event_type == "PROMISE_CREATED":
                promise = {
                    "amount_inr": meta.get("amount_inr"),
                    "source": "voice"
                }

    return {
        "call_sid": call_sid,
        "status": status,
        "transcript": transcript,
        "intents": intents,
        "promise": promise,
        "actions": []
    }
