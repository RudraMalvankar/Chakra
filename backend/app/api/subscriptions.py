"""
Subscription Recovery API.
Manages subscription lifecycle, dunning, pause/resume, and recovery.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from backend.app.services.db_service import DBService
from backend.app.services.recovery_executor import execute_recovery_pipeline
from backend.app.lib.audit import log_audit_event

router = APIRouter()


class SubscriptionCreateRequest(BaseModel):
    subscription_id: str
    customer_id: str
    amount: float
    plan_id: str = ""
    frequency: str = "monthly"
    mandate_id: str = ""
    grace_period_days: int = 7
    max_retries: int = 3
    current_cycle_start: str = ""
    current_cycle_end: str = ""
    next_charge_date: str = ""
    churn_risk: str = "LOW"


class SubscriptionActionRequest(BaseModel):
    reason: str = ""


@router.get("/summary")
def get_subscription_summary():
    metrics = DBService.get_subscription_metrics()
    return metrics


@router.get("/")
def list_subscriptions(status: str = ""):
    return DBService.list_subscriptions(status_filter=status)


@router.get("/{subscription_id}")
def get_subscription(subscription_id: str):
    sub = DBService.get_subscription(subscription_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    history = DBService.get_subscription_payment_history(subscription_id)
    sub["payment_history"] = history
    return sub


@router.post("/")
async def create_subscription(req: SubscriptionCreateRequest):
    sub_id = DBService.upsert_subscription(
        external_subscription_id=req.subscription_id,
        customer_id=req.customer_id,
        amount=req.amount,
        plan_id=req.plan_id,
        frequency=req.frequency,
        mandate_id=req.mandate_id,
        grace_period_days=req.grace_period_days,
        max_retries=req.max_retries,
        current_cycle_start=req.current_cycle_start,
        current_cycle_end=req.current_cycle_end,
        next_charge_date=req.next_charge_date,
        churn_risk=req.churn_risk,
    )
    if not sub_id:
        raise HTTPException(status_code=500, detail="Failed to create subscription")
    return {"id": sub_id, "subscription_id": req.subscription_id, "status": "ACTIVE"}


@router.post("/{subscription_id}/recover")
async def recover_subscription(subscription_id: str):
    sub = DBService.get_subscription(subscription_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    payload = {
        "payment_id": subscription_id,
        "amount_inr": sub["amount"],
        "error_code": "subscription_failed",
        "case_type": "SUBSCRIPTION",
        "customer_id": sub["customer_id"],
        "context": {
            "subscription_id": subscription_id,
            "subscription_status": sub["status"],
            "churn_risk": sub["churn_risk"],
            "past_failed_payments_count": sub["retry_count"],
            "grace_period_remaining": max(0, sub["grace_period_days"] - sub["retry_count"]),
        }
    }
    result = await execute_recovery_pipeline(payload, dry_run=False)
    return {
        "subscription_id": subscription_id,
        "status": getattr(getattr(result, "current_state", None), "value", None) or "PROCESSED",
    }


@router.post("/{subscription_id}/pause")
async def pause_subscription(subscription_id: str, req: Optional[SubscriptionActionRequest] = None):
    sub = DBService.get_subscription(subscription_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    from backend.app.services.razorpay_client import get_payment_provider
    provider = get_payment_provider()
    res = await provider.pause_subscription(subscription_id)
    DBService.update_subscription_status(subscription_id, "PAUSED")
    log_audit_event(subscription_id, "subscription_paused", {
        "subscription_id": subscription_id,
        "reason": req.reason if req else "manual_pause",
        "provider_response": res,
    })
    return {"subscription_id": subscription_id, "status": "PAUSED"}


@router.post("/{subscription_id}/resume")
async def resume_subscription(subscription_id: str):
    sub = DBService.get_subscription(subscription_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    from backend.app.services.razorpay_client import get_payment_provider
    provider = get_payment_provider()
    res = await provider.resume_subscription(subscription_id)
    DBService.update_subscription_status(subscription_id, "ACTIVE")
    log_audit_event(subscription_id, "subscription_resumed", {
        "subscription_id": subscription_id,
        "provider_response": res,
    })
    return {"subscription_id": subscription_id, "status": "ACTIVE"}


@router.post("/{subscription_id}/cancel")
async def cancel_subscription(subscription_id: str, req: Optional[SubscriptionActionRequest] = None):
    sub = DBService.get_subscription(subscription_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    from backend.app.services.razorpay_client import get_payment_provider
    provider = get_payment_provider()
    res = await provider.cancel_subscription(subscription_id)
    DBService.update_subscription_status(subscription_id, "CANCELLED")
    log_audit_event(subscription_id, "subscription_cancelled", {
        "subscription_id": subscription_id,
        "reason": req.reason if req else "manual_cancel",
        "provider_response": res,
    })
    return {"subscription_id": subscription_id, "status": "CANCELLED"}


@router.get("/{subscription_id}/cycles")
def get_subscription_cycles(subscription_id: str):
    history = DBService.get_subscription_payment_history(subscription_id)
    return history
