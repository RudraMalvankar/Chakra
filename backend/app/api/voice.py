"""
Voice Recovery API — start calls, poll status/transcript/intents.

Uses the existing VoiceProvider abstraction (Twilio/Mock/Unavailable)
and the Communication table for transcript persistence.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
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


class SimulateVoiceStartRequest(BaseModel):
    case_id: str
    amount: float
    customer_name: Optional[str] = None
    voice_preference: Optional[str] = None


@router.post("/api/voice/simulate/start")
async def start_simulated_voice_call(req: SimulateVoiceStartRequest):
    import uuid
    from backend.app.services.voice import synthesize_neural_speech

    session_id = f"CA_sim_{uuid.uuid4().hex[:12]}"
    cust_name = req.customer_name or "Sir"
    amount_str = f"₹{int(req.amount):,}" if req.amount else "pending amount"
    greeting = f"Namaste {cust_name}! Main Chakra se Priya bol rahi hoon. Aapke {amount_str} ke overdue payment ke silsile mein call kiya tha. Aap bataiye, payment kab tak arrange ho payega?"

    DBService.record_audit_event(
        req.case_id,
        "voice_call_started",
        {
            "call_sid": session_id,
            "to_number": "IN_BROWSER_SIMULATION",
            "provider": "gemini_2.5_flash_native",
            "amount": req.amount,
            "caller_persona": "Priya (Voice Recovery Specialist)",
        },
    )

    DBService.record_communication(
        case_id=req.case_id,
        customer_id=None,
        channel="VOICE",
        communication_type="VOICE_TRANSCRIPT",
        provider="gemini_2.5_flash_native",
        provider_message_id=session_id,
        status="SENT",
        metadata={"speaker": "CHAKRA", "text": greeting, "call_sid": session_id},
    )

    # Synthesize realistic neural audio
    audio_res = await synthesize_neural_speech(greeting, req.voice_preference)

    return {
        "status": "success",
        "call_sid": session_id,
        "mode": "browser_simulation",
        "provider": "gemini_2.5_flash_native",
        "greeting": greeting,
        "audio_base64": audio_res.get("audio_base64") if audio_res else None,
        "audio_format": audio_res.get("audio_format") if audio_res else None,
        "voice_engine": audio_res.get("engine") if audio_res else None,
        "voice_name": audio_res.get("voice") if audio_res else None,
    }


class SimulateVoiceTurnRequest(BaseModel):
    case_id: str
    call_sid: str
    user_speech: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    amount: float
    customer_name: Optional[str] = None
    voice_preference: Optional[str] = None


@router.post("/api/voice/simulate/turn")
async def simulate_voice_turn(req: SimulateVoiceTurnRequest):
    import base64
    import uuid
    from backend.app.services.voice import extract_voice_intent, synthesize_neural_speech, transcribe_user_audio

    spoken_text = (req.user_speech or "").strip()
    logger = logging.getLogger("chakra.voice_api")

    # If we already have browser STT text, use it directly to save latency and API quota.
    # Otherwise, try to transcribe the raw audio with Gemini.
    if not spoken_text and req.audio_base64:
        try:
            raw_audio = base64.b64decode(req.audio_base64)
            logger.info("Received audio blob: %d bytes, mime=%s, browser_stt=(empty)",
                        len(raw_audio), req.audio_mime)
            transcribed = await transcribe_user_audio(raw_audio, req.audio_mime or "audio/webm")
            if transcribed:
                logger.info("Gemini audio STT succeeded: %s", transcribed)
                spoken_text = transcribed
            else:
                logger.warning("Gemini audio STT returned empty.")
        except Exception as exc:
            logger.warning("Gemini audio transcription exception: %s", exc, exc_info=True)

    # If no speech was detected from audio or text, ask customer politely to repeat
    if not spoken_text:
        ai_reply = "Aapki aawaz theek se sunayi nahi di. Kripya dobara bataiye, payment kab tak arrange ho payega?"
        audio_res = await synthesize_neural_speech(ai_reply, req.voice_preference)
        return {
            "status": "success",
            "intent": "unknown",
            "confidence": 0.0,
            "user_speech": "[Aawaz sunayi nahi di]",
            "ai_response": ai_reply,
            "promise": None,
            "payment_link": None,
            "audio_base64": audio_res.get("audio_base64") if audio_res else None,
            "audio_format": audio_res.get("audio_format") if audio_res else None,
            "voice_engine": audio_res.get("engine") if audio_res else None,
            "voice_name": audio_res.get("voice") if audio_res else None,
        }

    intent_result = await extract_voice_intent(spoken_text)
    intent = intent_result.intent

    ai_reply = ""
    promise = None
    payment_link = None

    if intent == "pay_now":
        payment_link = f"https://rzp.io/i/{req.case_id[:8]}"
        ai_reply = f"Bahut accha! Maine aapko turant SMS aur WhatsApp par payment link bhej diya hai: {payment_link}. Aap link par click karke payment complete kar lijiye, main verify kar lungi. Shukriya!"
    elif intent == "promise_to_pay":
        promised_date = intent_result.promised_date or "kal"
        amount = intent_result.promised_amount or req.amount
        promise = {
            "amount_inr": amount,
            "promised_date": promised_date,
            "source": "voice",
        }
        ai_reply = f"Ji bilkul, maine aapka promise note kar liya hai ki aap {promised_date} tak payment kar dengi. Main team ko update kar deti hoon. Have a wonderful day!"
        DBService.record_audit_event(
            req.case_id,
            "PROMISE_CREATED",
            {
                "call_sid": req.call_sid,
                "amount_inr": amount,
                "promised_date": promised_date,
                "source": "voice",
            },
        )
    elif intent == "dispute":
        ai_reply = "Aapki pareshani main samajh sakti hoon. Maine ye case turant hamari senior dispute management team ko escalate kar diya hai. Wo aapse personally connect karenge."
        DBService.record_audit_event(
            req.case_id,
            "VOICE_DISPUTE_ESCALATED",
            {"case_id": req.case_id, "reason": "Dispute registered over voice call"},
        )
    elif intent == "needs_more_time":
        ai_reply = "Main aapki situation samajh rahi hoon. Kya aap aane wale somwar ya shukrawar tak ye clear kar payenge? Mujhe confirm kar dijiye."
    elif intent == "unwilling":
        ai_reply = "Ji main samajh sakti hoon, lekin payment pending rehne par mandate cancel ho sakta hai aur service interrupt ho sakti hai. Kya main aapke liye koi flexible installment plan check karun?"
    else:
        ai_reply = "Ji sun rahi hoon. Kripya bataiye aap payment kab tak schedule karna chahenge?"

    turn_id = uuid.uuid4().hex[:8]
    DBService.record_communication(
        case_id=req.case_id,
        customer_id=None,
        channel="VOICE",
        communication_type="VOICE_TRANSCRIPT",
        provider="gemini_2.5_flash_native",
        provider_message_id=f"{req.call_sid}_user_{turn_id}",
        status="PROCESSED",
        metadata={"speaker": "CUSTOMER", "text": spoken_text, "call_sid": req.call_sid},
    )
    DBService.record_communication(
        case_id=req.case_id,
        customer_id=None,
        channel="VOICE",
        communication_type="VOICE_TRANSCRIPT",
        provider="gemini_2.5_flash_native",
        provider_message_id=f"{req.call_sid}_ai_{turn_id}",
        status="SENT",
        metadata={"speaker": "CHAKRA", "text": ai_reply, "call_sid": req.call_sid},
    )

    DBService.record_audit_event(
        req.case_id,
        "AI_VOICE_INTENT_COMPLETED",
        {
            "session_id": req.call_sid,
            "intent": intent,
            "confidence": intent_result.confidence,
            "language": intent_result.language or "hi-IN",
            "model": intent_result.model_used or "gemini-2.5-flash",
        },
    )

    # Synthesize realistic neural audio response
    audio_res = await synthesize_neural_speech(ai_reply, req.voice_preference)

    return {
        "status": "success",
        "intent": intent,
        "confidence": intent_result.confidence,
        "user_speech": spoken_text,
        "ai_response": ai_reply,
        "promise": promise,
        "payment_link": payment_link,
        "audio_base64": audio_res.get("audio_base64") if audio_res else None,
        "audio_format": audio_res.get("audio_format") if audio_res else None,
        "voice_engine": audio_res.get("engine") if audio_res else None,
        "voice_name": audio_res.get("voice") if audio_res else None,
    }
