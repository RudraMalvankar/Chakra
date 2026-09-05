"""
Webhook Ingestion API: Verifies HMAC SHA-256 signatures and dispatches failed payment
events into the 6-stage recovery pipeline.
"""
from fastapi import APIRouter, Request, HTTPException, Header
import hmac
import hashlib
from typing import Dict, Any, Optional
from datetime import datetime, timezone, timedelta

from backend.app.config import settings
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.recovery_executor import execute_recovery_pipeline
from backend.app.services.db_service import DBService
from backend.app.db.session import get_session_factory
from backend.app.db.models import Receivable, PromiseToPay
from sqlalchemy import select

router = APIRouter()


from backend.app.services.razorpay_client import get_payment_provider

def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    if not signature or not secret:
        return False
    provider = get_payment_provider()
    return provider.verify_webhook_signature(body, signature, secret)


import json
from collections import OrderedDict

# In-memory LRU cache for fast duplicate detection (performance cache, NOT authoritative)
_processed_events = OrderedDict()
_MAX_PROCESSED = 10000


def _is_duplicate_webhook(event_id: str) -> bool:
    """Check idempotency using in-memory cache first, then DB."""
    # Fast path: in-memory cache
    status = _processed_events.get(event_id)
    if status == "COMPLETED":
        return True
    if status == "PROCESSING":
        return True

    # Slow path: check DB for events processed in previous server sessions
    if settings.is_database_configured:
        try:
            from backend.app.services.db_service import DBService
            if not DBService.record_provider_event(
                provider="razorpay",
                provider_event_id=event_id,
                event_type="webhook",
                processed=False,
            ):
                return True  # Duplicate in DB
        except Exception:
            pass  # Fall through to process if DB check fails

    return False


def _mark_webhook_completed(event_id: str) -> None:
    """Mark webhook as completed in both cache and DB."""
    _processed_events[event_id] = "COMPLETED"
    if settings.is_database_configured:
        try:
            from backend.app.services.db_service import DBService
            DBService.record_provider_event(
                provider="razorpay",
                provider_event_id=event_id,
                event_type="webhook",
                processed=True,
            )
        except Exception:
            pass

@router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(None),
    x_razorpay_event_id: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """
    Ingests Razorpay webhook events, validates HMAC signature,
    and runs failed payments through the 6-stage recovery pipeline.
    """
    if not x_razorpay_signature:
        raise HTTPException(status_code=400, detail="Missing signature")

    body = await request.body()
    if not verify_signature(body, x_razorpay_signature, settings.webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid signature")
        
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON payload")

    # Idempotency check: use event ID or payload hash if not present
    event_id = x_razorpay_event_id or hashlib.sha256(body).hexdigest()
    
    if _is_duplicate_webhook(event_id):
        return {"status": "ignored", "reason": "duplicate_webhook"}

    _processed_events[event_id] = "PROCESSING"
    if len(_processed_events) > _MAX_PROCESSED:
        _processed_events.popitem(last=False)

    event_type = payload.get("event")

    # Supported event types for revenue recovery
    supported_events = [
        "payment.failed", "payment_failed", "order.failed",
        "subscription.failed", "subscription.halted",
        "checkout.abandoned",
        "invoice.overdue", "receivable.overdue",
        "promise.updated", "promise.broken"
    ]

    try:
        # Ingest failure events
        if event_type in supported_events:
            ctx = ContextBuilder.build_context(payload)
            
            # If case_id is missing/unknown, it's not a valid case for recovery
            if ctx.case_id == "unknown" and not ctx.payment_id:
                _mark_webhook_completed(event_id)
                return {"status": "ignored", "reason": "insufficient_data"}
                
            final_ctx = await execute_recovery_pipeline(ctx, dry_run=settings.dry_run)
            _mark_webhook_completed(event_id)
            return {
                "status": "ok",
                "case_id": final_ctx.case_id,
                "state": final_ctx.current_state.value if hasattr(final_ctx.current_state, "value") else final_ctx.current_state,
            }

        _mark_webhook_completed(event_id)
        return {"status": "ignored", "event": event_type}
    except Exception:
        _processed_events[event_id] = "FAILED"
        raise

from fastapi import Request, Form
from fastapi.responses import HTMLResponse
from backend.app.services.voice import extract_voice_intent

def verify_twilio_signature(request: Request, params: dict, signature: Optional[str]) -> bool:
    """Verifies incoming Twilio webhooks using twilio.request_validator.RequestValidator."""
    if not settings.twilio_auth_token:
        # In mock / synthetic mode, allow requests through without signature
        return True
    if not signature:
        return False
    try:
        from twilio.request_validator import RequestValidator
        validator = RequestValidator(settings.twilio_auth_token)
        # Reconstruct effective URL
        url = str(request.url)
        if settings.twilio_webhook_base_url:
            base = settings.twilio_webhook_base_url.rstrip("/")
            url = f"{base}{request.url.path}"
            if request.url.query:
                url = f"{url}?{request.url.query}"
        return validator.validate(url, params, signature)
    except Exception:
        return False

@router.post("/twilio/twiml")
async def twilio_twiml(
    request: Request,
    case_id: str = "",
    amount: str = "",
    x_twilio_signature: Optional[str] = Header(None),
):
    # Verify Twilio signature if configured
    if settings.twilio_auth_token:
        form_params = dict(await request.form()) if request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded") else {}
        if not verify_twilio_signature(request, form_params, x_twilio_signature):
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    # Hinglish MVP Prompt
    twiml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="/webhooks/twilio/gather?case_id={case_id}&amp;amount={amount}" language="hi-IN" timeout="5">
        <Say language="hi-IN">Namaste. Chakra se call hai. Aapka {amount} rupaye ka payment bacha hai. Kya aap abhi pay karenge ya kal?</Say>
    </Gather>
</Response>'''
    return HTMLResponse(content=twiml, media_type="text/xml")

@router.post("/twilio/gather")
async def twilio_gather(
    request: Request,
    case_id: str = "",
    amount: str = "",
    x_twilio_signature: Optional[str] = Header(None),
):
    form = await request.form()
    form_params = dict(form)
    
    if settings.twilio_auth_token:
        if not verify_twilio_signature(request, form_params, x_twilio_signature):
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    speech = form.get("SpeechResult", "")
    call_sid = form.get("CallSid")
    DBService.record_audit_event(
        case_id or call_sid or "voice_session",
        "AI_VOICE_INTENT_REQUESTED",
        {"request_type": "voice_intent", "session_id": call_sid, "transcript_length": len(speech or "")},
    )
    intent = await extract_voice_intent(speech)
    DBService.record_audit_event(
        case_id or call_sid or "voice_session",
        "AI_VOICE_INTENT_COMPLETED",
        {
            "request_type": "voice_intent",
            "session_id": call_sid,
            "intent": intent.intent,
            "confidence": intent.confidence,
            "model": intent.model_used,
            "ai_used": intent.ai_used,
            "fallback_used": intent.fallback_used,
        },
    )

    # A voice promise is only confirmed after it is persisted against a real
    # receivable.  The TwiML response must never claim a promise was recorded
    # when the invoice, amount, or database write is invalid.
    promise_recorded = False
    promise_id = None
    receivable_customer = None
    if intent.intent == "promise_to_pay" and case_id:
        try:
            promised_amount = float(amount)
        except (TypeError, ValueError):
            promised_amount = 0.0
        factory = get_session_factory()
        with factory() as session:
            receivable = session.execute(
                select(Receivable).where(Receivable.id == case_id)
            ).scalar_one_or_none()
            if receivable and promised_amount > 0:
                remaining = max(0.0, receivable.amount - (receivable.recovered_amount or 0.0))
                if promised_amount <= remaining:
                    existing = session.execute(
                        select(PromiseToPay).where(
                            PromiseToPay.receivable_id == case_id,
                            PromiseToPay.status.in_(("UPCOMING", "DUE_TODAY")),
                        )
                    ).scalar_one_or_none()
                    if not existing:
                        promise = PromiseToPay(
                            receivable_id=case_id,
                            customer_name=receivable.customer_name,
                            promised_amount=promised_amount,
                            promise_date=(datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat(),
                            status="UPCOMING",
                            source="voice",
                            notes=speech[:1000] if speech else None,
                        )
                        session.add(promise)
                        receivable.status = "PROMISE_TO_PAY"
                        receivable.previous_promises = (receivable.previous_promises or 0) + 1
                        session.commit()
                        promise_id = promise.id
                        promise_recorded = True
                    else:
                        promise_id = existing.id
                        promise_recorded = True
                receivable_customer = receivable.customer_id

    DBService.record_communication(
        case_id=case_id or None,
        customer_id=receivable_customer,
        channel="VOICE",
        communication_type="VOICE_RESPONSE",
        provider="twilio" if settings.twilio_auth_token else "unavailable",
        provider_message_id=call_sid,
        status="RECEIVED",
        metadata={"intent": intent.intent, "confidence": intent.confidence, "promise_id": promise_id},
    )
    
    twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>'
    
    if intent.intent == "promise_to_pay" and promise_recorded:
        DBService.record_audit_event(
            promise_id,
            "promise_created",
            {
                "receivable_id": case_id,
                "amount_inr": float(amount),
                "source": "voice",
                "call_sid": call_sid,
                "transcript": speech,
            },
        )
        twiml += '<Say language="hi-IN">Dhanyavaad. Humne aapka promise record kar liya hai. Kal reminder bhejenge.</Say>'
        
        payload = {
            "payment_id": f"ptp_voice_{case_id}",
            "amount_inr": float(amount) if amount else 0.0,
            "error_code": "promise_created_via_voice",
            "case_type": "PROMISE_TO_PAY",
            "customer_id": "unknown",
            "context": {
                "promise_status": "UPCOMING",
                "invoice_id": case_id,
                "transcript": speech,
                "promise_id": promise_id,
            }
        }
        await execute_recovery_pipeline(payload, dry_run=True)

    elif intent.intent == "promise_to_pay":
        twiml += '<Say language="hi-IN">Maaf kijiye, promise record nahi ho saka. Humari team aapse sampark karegi.</Say>'
        
    elif intent.intent == "pay_now":
        twiml += '<Say language="hi-IN">Dhanyavaad. Payment link process kiya jayega.</Say>'
    else:
        twiml += '<Say language="hi-IN">Theek hai. Hum baad me sampark karenge.</Say>'
        
    twiml += '</Response>'
    return HTMLResponse(content=twiml, media_type="text/xml")
