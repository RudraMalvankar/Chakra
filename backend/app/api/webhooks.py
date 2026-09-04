"""
Webhook Ingestion API: Verifies HMAC SHA-256 signatures and dispatches failed payment
events into the 6-stage recovery pipeline.
"""
from fastapi import APIRouter, Request, HTTPException, Header
import hmac
import hashlib
from typing import Dict, Any, Optional

from backend.app.config import settings
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.recovery_executor import execute_recovery_pipeline

router = APIRouter()


from backend.app.services.razorpay_client import get_payment_provider

def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    if not signature or not secret:
        return False
    provider = get_payment_provider()
    return provider.verify_webhook_signature(body, signature, secret)


import json
from collections import OrderedDict

# Simple OrderedDict as an LRU cache for webhook idempotency
_processed_events = OrderedDict()
_MAX_PROCESSED = 10000

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
    
    status = _processed_events.get(event_id)
    if status == "COMPLETED":
        return {"status": "ignored", "reason": "duplicate_webhook"}
    if status == "PROCESSING":
        return {"status": "ignored", "reason": "concurrent_processing"}
        
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
                _processed_events[event_id] = "COMPLETED"
                return {"status": "ignored", "reason": "insufficient_data"}
                
            final_ctx = await execute_recovery_pipeline(ctx, dry_run=settings.dry_run)
            _processed_events[event_id] = "COMPLETED"
            return {
                "status": "ok",
                "case_id": final_ctx.case_id,
                "state": final_ctx.current_state.value if hasattr(final_ctx.current_state, "value") else final_ctx.current_state,
            }

        _processed_events[event_id] = "COMPLETED"
        return {"status": "ignored", "event": event_type}
    except Exception:
        _processed_events[event_id] = "FAILED"
        raise

from fastapi import Request, Form
from fastapi.responses import HTMLResponse
from backend.app.services.voice import extract_voice_intent

@router.post("/twilio/twiml")
async def twilio_twiml(request: Request, case_id: str = "", amount: str = ""):
    # Hinglish MVP Prompt
    twiml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="/webhooks/twilio/gather?case_id={case_id}&amp;amount={amount}" language="hi-IN" timeout="5">
        <Say language="hi-IN">Namaste. Chakra se call hai. Aapka {amount} rupaye ka payment bacha hai. Kya aap abhi pay karenge ya kal?</Say>
    </Gather>
</Response>'''
    return HTMLResponse(content=twiml, media_type="text/xml")

@router.post("/twilio/gather")
async def twilio_gather(request: Request, case_id: str = "", amount: str = ""):
    form = await request.form()
    speech = form.get("SpeechResult", "")
    
    intent = await extract_voice_intent(speech)
    
    twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>'
    
    if intent.intent == "promise_to_pay":
        twiml += '<Say language="hi-IN">Dhanyavaad. Humne aapka promise record kar liya hai. Kal reminder bhejenge.</Say>'
        
        # We should simulate the promise creation here
        payload = {
            "payment_id": f"ptp_voice_{case_id}",
            "amount_inr": float(amount) if amount else 0.0,
            "error_code": "promise_created_via_voice",
            "case_type": "PROMISE_TO_PAY",
            "customer_id": "unknown",
            "context": {
                "promise_status": "ACTIVE",
                "invoice_id": case_id,
                "transcript": speech
            }
        }
        await execute_recovery_pipeline(payload, dry_run=True)
        
    elif intent.intent == "pay_now":
        twiml += '<Say language="hi-IN">Dhanyavaad. Aapko payment link SMS kar diya gaya hai.</Say>'
    else:
        twiml += '<Say language="hi-IN">Theek hai. Hum baad me sampark karenge.</Say>'
        
    twiml += '</Response>'
    return HTMLResponse(content=twiml, media_type="text/xml")
