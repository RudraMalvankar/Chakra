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


def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    """Verifies HMAC SHA-256 signature against webhook payload bytes."""
    if not signature or not secret:
        return False
    expected_mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected_mac, signature.strip())


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
