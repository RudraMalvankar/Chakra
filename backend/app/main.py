from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
import json
import os
import uuid
import razorpay

from backend.app.config import settings
from backend.app.api.webhooks import router as webhook_router
from backend.app.api.receivables import router as receivables_router
from backend.app.api.batches import router as batches_router
from backend.app.api.escalations import router as escalations_router
from backend.app.api.voice import router as voice_router
from backend.app.api.subscriptions import router as subscriptions_router
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.lib.audit import AUDIT_FILE, log_audit_event
from backend.app.lib.config_utils import get_recovery_policy, get_regulatory_policy
from backend.app.models.case import RecoveryCase, CaseType
from backend.app.models.payment import PaymentState
from backend.app.services.recovery_executor import execute_recovery_pipeline
from backend.app.services.razorpay_client import get_payment_provider
from backend.app.services.db_service import DBService
from backend.app.db.session import init_db, ensure_schema

app = FastAPI(title="Chakra Recovery Engine")

# Verify database schema on startup (production uses Alembic, not create_all)
@app.on_event("startup")
def startup_event():
    if settings.is_database_configured:
        try:
            ensure_schema()
        except Exception as e:
            print(f"WARNING: Database schema check failed: {e}")
            print("Run 'alembic upgrade head' to initialize the schema.")
    else:
        print("NOTICE: DATABASE_URL not configured. Running without database persistence.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router, prefix="/webhooks")
app.include_router(receivables_router, prefix="/api/receivables")
app.include_router(batches_router, prefix="/api/batches")
app.include_router(escalations_router, prefix="/api/escalations")
app.include_router(voice_router)
app.include_router(subscriptions_router, prefix="/api/subscriptions")

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "database": "connected" if settings.is_database_configured else "not_configured",
        "razorpay": "test_mode" if settings.is_razorpay_configured else "synthetic",
        "twilio": "configured" if settings.is_twilio_configured else "not_configured",
        "gemini": "configured" if settings.is_gemini_configured else "fallback_only",
    }

@app.get("/api/policy")
def get_policy():
    """Public, non-secret recovery + regulatory policy for the Safety UI."""
    recovery = get_recovery_policy() or {}
    regulatory = get_regulatory_policy() or {}

    retry_limit = recovery.get("max_interventions_per_customer_per_month")
    network_caps = regulatory.get("network_retry_caps") or {}
    afa_threshold = regulatory.get("afa_free_threshold_standard_inr")
    alerts_threshold = recovery.get("high_alerts_ignored_threshold")

    return {
        "recovery": recovery,
        "regulatory": regulatory,
        "retry_limit": retry_limit,
        "fraud_policy": "Hard block when fraud_flag or error_code=fraud_flag",
        "mandate_policy": {
            "revoked": "Hard block / stop recovery when mandate is REVOKED",
            "first_transaction_requires_afa": regulatory.get(
                "first_mandate_transaction_requires_afa", True
            ),
        },
        "afa_threshold_inr": afa_threshold,
        "budget": {
            "max_interventions_per_customer_per_month": retry_limit,
            "description": f"{retry_limit} interventions per customer per month"
            if retry_limit is not None
            else "Not configured",
        },
        "stopping_rules": [
            "HARD_COMPLIANCE_BLOCK on fraud_flag",
            "HARD_COMPLIANCE_BLOCK on mandate_revoked",
            "NETWORK_RETRY_CAP_REACHED when network retry cap exceeded",
            "CUSTOMER_BUDGET_EXCEEDED when monthly intervention budget exceeded",
            "IDEMPOTENCY_DUPLICATE_EVENT on duplicate same-day intervention",
        ],
        "escalation_rules": [
            f"Escalate when pre-debit alerts ignored >= {alerts_threshold}"
            if alerts_threshold is not None
            else "Escalate on high churn / alerts-ignored signal",
            "Escalate when triage/agent requires_human",
        ],
        "network_retry_caps": network_caps,
        "retry_delays": {
            "transient_failure_hours": recovery.get("transient_failure_retry_delay_hours"),
            "standard_hours": recovery.get("standard_retry_delay_hours"),
        },
        "llm_confidence_threshold": recovery.get("llm_confidence_threshold"),
        "default_treatment_strategy": recovery.get("default_treatment_strategy") or {
            "INSUFFICIENT_FUNDS": {
                "strategy_flow": "wait / retry later -> payment reminder -> payment link if appropriate",
                "actions": ["RETRY_LATER", "REMINDER", "PAYMENT_LINK"],
                "cooldown_hours": 24,
            },
            "BANK_TIMEOUT_TRANSIENT_NETWORK": {
                "strategy_flow": "retry later -> respect retry/cooldown limits",
                "actions": ["RETRY_LATER"],
                "cooldown_hours": 1,
                "max_retries": 3,
            },
            "EXPIRED_CARD": {
                "strategy_flow": "payment link / update payment method -> avoid blind retrying the same instrument",
                "actions": ["PAYMENT_LINK"],
                "template_id": "dlt_card_update_v1",
                "avoid_blind_retry": True,
            },
            "FRAUD": {
                "strategy_flow": "STOP -> BLOCK -> ESCALATE",
                "actions": ["STOP", "BLOCK", "ESCALATE"],
                "is_hard_stop": True,
            },
            "MANDATE_REVOKED": {
                "strategy_flow": "STOP automatic retry -> BLOCK -> ESCALATE / customer remediation",
                "actions": ["STOP", "BLOCK", "ESCALATE"],
                "is_hard_stop": True,
                "customer_remediation_required": True,
            },
        },
    }

@app.get("/api/metrics")
def get_metrics():
    return generate_metrics_report()

@app.get("/api/audit")
def get_audit_trail(limit: int = 100):
    db_events = DBService.get_audit_trail(limit=limit)
    if db_events:
        return {"events": db_events}
    if not os.path.exists(AUDIT_FILE):
        return {"events": []}
    events = []
    with open(AUDIT_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return {"events": events[::-1][:limit]}

@app.get("/api/cases")
def list_cases(limit: int = 200):
    cases = DBService.get_all_cases(limit=limit)
    return cases

@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    detail = DBService.get_case_detail(case_id)
    if detail:
        return detail
    # Case detail is an operational resource, so it must come from the
    # database-backed case aggregate. Audit logs remain available through the
    # explicit /trace endpoint and are not used to reconstruct UI state.
    raise HTTPException(status_code=404, detail="Case not found in operational database")

@app.get("/api/cases/{case_id}/trace")
def get_case_trace(case_id: str):
    detail = DBService.get_case_detail(case_id)
    if detail:
        return {"case_id": case_id, "trace": detail.get("events", [])}
        
    if not os.path.exists(AUDIT_FILE):
        raise HTTPException(status_code=404, detail="Audit log not found")
        
    case_events = []
    with open(AUDIT_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                if str(event.get("payment_id")) == case_id:
                    case_events.append(event)
            except json.JSONDecodeError:
                continue

    if not case_events:
        raise HTTPException(status_code=404, detail="Case not found in audit trail")
        
    return {"case_id": case_id, "trace": case_events}

class SimulateEventRequest(BaseModel):
    case_type: str = "PAYMENT_FAILURE"
    amount_inr: float
    failure_reason: str = "insufficient_funds"
    mandate_state: str = "ACTIVE"
    customer_id: str = "cust_demo123"
    churn_risk: str = "LOW"
    fraud_risk: str = "LOW"

@app.post("/api/demo/simulate")
async def simulate_event(req: SimulateEventRequest):
    case_id = f"demo_{uuid.uuid4().hex[:8]}"
    
    payload = {
        "payment_id": case_id,
        "amount_inr": req.amount_inr,
        "error_code": req.failure_reason,
        "case_type": req.case_type,
        "customer_id": req.customer_id,
        "context": {
            "mandate_state": req.mandate_state,
            "bank_name": "Demo Bank",
            "is_first_transaction": False,
            "network": "Visa",
            "churn_risk": req.churn_risk,
            "fraud_risk": req.fraud_risk
        }
    }
    
    final_case = await execute_recovery_pipeline(payload, dry_run=False)
    return get_case_trace(case_id)

@app.get("/api/config")
def get_config():
    if settings.is_razorpay_configured:
        return {
            "provider": "razorpay_test",
            "mode": "test",
            "razorpay_key_id": settings.razorpay_key_id
        }
    if settings.use_mock_razorpay:
        return {
            "provider": "synthetic",
            "mode": "synthetic",
            "razorpay_key_id": None,
        }
    return {
        "provider": "unavailable",
        "mode": "unavailable",
        "razorpay_key_id": None,
    }

class CreateOrderRequest(BaseModel):
    amount_inr: float
    customer_id: str
    item_type: Optional[str] = "order"  # "order" or "subscription"
    frequency: Optional[str] = "monthly"
    plan_name: Optional[str] = None

@app.post("/api/payments/orders")
@app.post("/api/payments/create_order")
def create_order(req: CreateOrderRequest):
    if req.amount_inr <= 0:
        raise HTTPException(status_code=422, detail="amount_inr must be positive")
    provider = get_payment_provider()
    result = provider.create_order(req.amount_inr, "INR", req.customer_id)
    if result.get("status") == "unavailable" or not result.get("order_id"):
        raise HTTPException(status_code=503, detail="Razorpay is not configured; checkout order unavailable")

    order_id = result["order_id"]
    amount = float(result.get("amount_inr", req.amount_inr))

    # Ensure customer exists for FK integrity when DB is configured.
    customer_db_id = DBService.upsert_customer(external_customer_id=req.customer_id)

    # Persist order as an internal payment row keyed by Razorpay order id until capture.
    # external_order_id mirrors the provider order; capture later stores razorpay payment id.
    DBService.upsert_payment(
        payment_id=order_id,
        amount_inr=amount,
        customer_id=customer_db_id,
        status="ORDER_CREATED",
        order_id=order_id,
        failure_code="",
        provider="razorpay_test" if result["provider"] == "razorpay_test" else "synthetic",
    )

    return {
        "order_id": order_id,
        "amount_inr": amount,
        "customer_id": req.customer_id,
        "item_type": req.item_type or "order",
        "frequency": req.frequency or "monthly",
        "plan_name": req.plan_name or "Pro Recurring Plan",
        "mode": "razorpay" if result["provider"] == "razorpay_test" else "synthetic",
    }

class VerifyPaymentRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str
    # Client amount is ignored for authoritative persistence when a server order exists.
    amount_inr: Optional[float] = None
    customer_id: Optional[str] = None
    item_type: Optional[str] = "order"
    frequency: Optional[str] = "monthly"
    plan_name: Optional[str] = None

@app.post("/api/payments/verify")
def verify_payment(req: VerifyPaymentRequest):
    """
    Authoritative server-side verification of Razorpay Test Mode checkout success.
    Successful capture is a PAYMENT COMPLETED outcome — not a recovery case.
    Amount/customer come from the server-created order when available.
    If item_type is 'subscription', provisions or updates the subscription in DBService
    so it immediately reflects in the Subscriptions page.
    """
    if not settings.is_razorpay_configured:
        raise HTTPException(
            status_code=503,
            detail="Razorpay is not configured; payment capture cannot be verified in this environment.",
        )

    try:
        client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
        client.utility.verify_payment_signature({
            "razorpay_order_id": req.razorpay_order_id,
            "razorpay_payment_id": req.razorpay_payment_id,
            "razorpay_signature": req.razorpay_signature,
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payment signature: {e}")

    order_row = DBService.get_payment_by_order_id(req.razorpay_order_id)
    if not order_row:
        raise HTTPException(
            status_code=400,
            detail="Unknown order. Create the order via /api/payments/orders before verifying.",
        )

    amount = float(order_row["amount"])
    customer_id = order_row.get("customer_id") or req.customer_id

    # Capture row: provider payment id is the permanent payment identity.
    DBService.upsert_payment(
        payment_id=req.razorpay_payment_id,
        amount_inr=amount,
        customer_id=customer_id,
        order_id=req.razorpay_order_id,
        status="CAPTURED",
        failure_code="",
        provider="razorpay_test",
    )
    # Mark the order placeholder captured as well for order-id lookups.
    DBService.upsert_payment(
        payment_id=req.razorpay_order_id,
        amount_inr=amount,
        customer_id=customer_id,
        order_id=req.razorpay_order_id,
        status="CAPTURED",
        failure_code="",
        provider="razorpay_test",
    )

    subscription_id = None
    if req.item_type == "subscription":
        # Provision recurring subscription in database so it reflects in Subscriptions dashboard
        ext_sub_id = f"sub_rzp_{req.razorpay_payment_id[-8:]}"
        plan_id = req.plan_name or "SaaS Pro Monthly"
        now_dt = datetime.now(timezone.utc)
        start_str = now_dt.strftime("%Y-%m-%d")
        next_dt = now_dt.strftime("%Y-%m-%d")
        sub_uuid = DBService.upsert_subscription(
            external_subscription_id=ext_sub_id,
            customer_id=customer_id,
            amount=amount,
            plan_id=plan_id,
            frequency=req.frequency or "monthly",
            status="ACTIVE",
            mandate_id=f"man_rzp_{req.razorpay_payment_id[-6:]}",
            grace_period_days=7,
            max_retries=3,
            current_cycle_start=start_str,
            current_cycle_end=next_dt,
            next_charge_date=next_dt,
            churn_risk="LOW",
            notes=f"Auto-provisioned via Razorpay Checkout payment {req.razorpay_payment_id}",
        )
        if sub_uuid:
            DBService.record_subscription_cycle(
                subscription_id=sub_uuid,
                cycle_number=1,
                amount=amount,
                status="CHARGED",
            )
            subscription_id = ext_sub_id

    log_audit_event(req.razorpay_payment_id, "payment_captured", {
        "order_id": req.razorpay_order_id,
        "amount_inr": amount,
        "customer_id": customer_id,
        "provider": "razorpay_test",
        "status": "CAPTURED",
        "verified": True,
        "recovered": False,
        "workflow": "CHECKOUT_SUCCESS",
        "item_type": req.item_type or "order",
        "subscription_id": subscription_id,
    })

    return {
        "status": "CAPTURED",
        "workflow": "CHECKOUT_SUCCESS",
        "recovered": False,
        "payment_completed": True,
        "amount_inr": amount,
        "payment_id": req.razorpay_payment_id,
        "order_id": req.razorpay_order_id,
        "customer_id": customer_id,
        "provider": "razorpay_test",
        "provider_verified": True,
        "case_id": None,
        "subscription_id": subscription_id,
        "item_type": req.item_type or "order",
    }


@app.post("/api/payments/{payment_id}/retry")
async def retry_payment(payment_id: str, delay_hours: int = 0):
    """Request a provider-managed retry; never imply capture from acceptance."""
    if delay_hours < 0:
        raise HTTPException(status_code=422, detail="delay_hours cannot be negative")
    provider = get_payment_provider()
    result = await provider.retry_payment(payment_id, delay_hours)
    status = str(result.get("status", "failed")).lower()
    DBService.record_audit_event(
        payment_id,
        "provider_retry_requested",
        {
            "delay_hours": delay_hours,
            "provider": "razorpay_test" if settings.is_razorpay_configured else "synthetic",
            "provider_status": status,
            "provider_error": result.get("error"),
            "recovered": False,
        },
    )
    return {"payment_id": payment_id, "status": status, "recovered": False, "provider_result": result}

class AbandonPaymentRequest(BaseModel):
    order_id: str
    amount_inr: Optional[float] = None
    customer_id: Optional[str] = None

@app.post("/api/payments/abandon")
async def abandon_payment(req: AbandonPaymentRequest):
    """
    Handles checkout dismissal: creates CHECKOUT_ABANDONMENT case, routes through
    Chakra pipeline, generates payment link, and sets status to RECOVERY_PENDING.
    Does NOT count as recovered until actual payment capture occurs.
    Amount is taken from the server-created order when available.
    """
    order_row = DBService.get_payment_by_order_id(req.order_id)
    amount = float(order_row["amount"]) if order_row else float(req.amount_inr or 0)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Unable to determine order amount for abandonment")
    customer_id = (order_row or {}).get("customer_id") or req.customer_id or "cust_checkout_001"

    case_id = f"case_abn_{req.order_id[-8:]}" if len(req.order_id) >= 8 else f"case_abn_{uuid.uuid4().hex[:8]}"
    
    payload = {
        "payment_id": case_id,
        "case_id": case_id,
        "amount_inr": amount,
        "error_code": "checkout_abandoned",
        "case_type": "CHECKOUT_ABANDONMENT",
        "customer_id": customer_id,
        "context": {
            "order_id": req.order_id,
            "abandonment_reason": "modal_closed_by_user",
        }
    }
    
    final_case = await execute_recovery_pipeline(payload, dry_run=settings.dry_run)
    final_status = getattr(getattr(final_case, "current_state", None), "value", None) or "RECOVERY_PENDING"
    
    log_audit_event(case_id, "checkout_abandoned", {
        "order_id": req.order_id,
        "amount_inr": amount,
        "status": final_status,
        "case_id": case_id,
    }, case_id=case_id)

    return {
        "case_id": case_id,
        "status": final_status,
        "amount_inr": amount,
        "recovered": False,
        "workflow": "CHECKOUT_ABANDONMENT",
    }

@app.get("/api/payments")
async def get_payments():
    provider = get_payment_provider()
    return await provider.get_payments()
