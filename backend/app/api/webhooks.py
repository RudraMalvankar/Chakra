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


@router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(None),
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

    payload = await request.json()
    event_type = payload.get("event")

    # Ingest failure events
    if event_type in ["payment.failed", "payment_failed", "order.failed"]:
        ctx = ContextBuilder.build_context(payload)
        final_ctx = await execute_recovery_pipeline(ctx, dry_run=settings.dry_run)
        return {
            "status": "ok",
            "payment_id": final_ctx.payment_id,
            "state": final_ctx.current_state.value,
        }

    return {"status": "ignored", "event": event_type}
