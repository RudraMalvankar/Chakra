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
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.lib.audit import AUDIT_FILE, log_audit_event
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

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "database": "connected" if settings.is_database_configured else "not_configured",
        "razorpay": "test_mode" if settings.is_razorpay_configured else "synthetic",
        "twilio": "configured" if settings.is_twilio_configured else "not_configured",
        "gemini": "configured" if settings.is_gemini_configured else "fallback_only",
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

@app.post("/api/payments/orders")
@app.post("/api/payments/create_order")
def create_order(req: CreateOrderRequest):
    if req.amount_inr <= 0:
        raise HTTPException(status_code=422, detail="amount_inr must be positive")
    provider = get_payment_provider()
    result = provider.create_order(req.amount_inr, "INR", req.customer_id)
    if result.get("status") == "unavailable" or not result.get("order_id"):
        raise HTTPException(status_code=503, detail="Razorpay is not configured; checkout order unavailable")
    
    # Pre-register order in DB
    DBService.upsert_payment(
        payment_id=result["order_id"],
        amount_inr=req.amount_inr,
        status="ORDER_CREATED",
        order_id=result["order_id"],
        provider="razorpay_test" if result["provider"] == "razorpay_test" else "synthetic",
    )
    
    return {
        "order_id": result["order_id"],
        "amount_inr": result["amount_inr"],
        "mode": "razorpay" if result["provider"] == "razorpay_test" else "synthetic"
    }

class VerifyPaymentRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str
    amount_inr: float = 5000.0
    customer_id: Optional[str] = "cust_checkout_001"

@app.post("/api/payments/verify")
def verify_payment(req: VerifyPaymentRequest):
    """
    Authoritative server-side verification of Razorpay Test Mode checkout success.
    Verifies signature, updates Payment to CAPTURED, RecoveryCase to RECOVERED,
    records audit and recovery events. Never marks recovered without signature verification.
    """
    provider = get_payment_provider()

    if not settings.is_razorpay_configured:
        raise HTTPException(
            status_code=503,
            detail="Razorpay is not configured; payment capture cannot be verified in this environment.",
        )
    
    # Signature verification
    is_valid = False
    if settings.is_razorpay_configured:
        try:
            client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
            client.utility.verify_payment_signature({
                "razorpay_order_id": req.razorpay_order_id,
                "razorpay_payment_id": req.razorpay_payment_id,
                "razorpay_signature": req.razorpay_signature,
            })
            is_valid = True
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid payment signature: {e}")
    if not is_valid:
        raise HTTPException(status_code=400, detail="Payment signature verification failed.")

    # Record verified success in DB
    DBService.upsert_payment(
        payment_id=req.razorpay_payment_id,
        amount_inr=req.amount_inr,
        order_id=req.razorpay_order_id,
        status="CAPTURED",
        provider="razorpay_test" if settings.is_razorpay_configured else "synthetic",
    )
    
    case_id = f"case_rzp_{req.razorpay_order_id[-8:]}"
    DBService.upsert_recovery_case(
        case_id=case_id,
        payment_id=req.razorpay_payment_id,
        case_type="CHECKOUT_ABANDONMENT",
        amount_at_risk=req.amount_inr,
        status="RECOVERED",
        current_action="CHECKOUT_COMPLETED",
    )
    
    DBService.record_recovery_event(
        case_id=case_id,
        event_type="payment_captured",
        action="CHECKOUT_COMPLETED",
        status="CAPTURED",
        amount=req.amount_inr,
        metadata={
            "razorpay_payment_id": req.razorpay_payment_id,
            "razorpay_order_id": req.razorpay_order_id,
            "verified": True,
        }
    )
    
    log_audit_event(req.razorpay_payment_id, "payment_captured", {
        "order_id": req.razorpay_order_id,
        "amount_inr": req.amount_inr,
        "provider": "razorpay_test" if settings.is_razorpay_configured else "synthetic",
        "status": "CAPTURED",
        "recovered": True,
    })

    return {
        "status": "captured",
        "recovered": True,
        "amount_inr": req.amount_inr,
        "payment_id": req.razorpay_payment_id,
        "order_id": req.razorpay_order_id,
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
    amount_inr: float = 5000.0
    customer_id: str = "cust_checkout_001"

@app.post("/api/payments/abandon")
async def abandon_payment(req: AbandonPaymentRequest):
    """
    Handles checkout dismissal: creates CHECKOUT_ABANDONMENT case, routes through
    Chakra pipeline, generates payment link, and sets status to RECOVERY_PENDING.
    Does NOT count as recovered until actual payment capture occurs.
    """
    case_id = f"case_abn_{req.order_id[-8:]}" if len(req.order_id) >= 8 else f"case_abn_{uuid.uuid4().hex[:8]}"
    
    payload = {
        "payment_id": case_id,
        "amount_inr": req.amount_inr,
        "error_code": "checkout_abandoned",
        "case_type": "CHECKOUT_ABANDONMENT",
        "customer_id": req.customer_id,
        "context": {
            "order_id": req.order_id,
            "abandonment_reason": "modal_closed_by_user",
        }
    }
    
    final_case = await execute_recovery_pipeline(payload, dry_run=False)
    
    log_audit_event(case_id, "checkout_abandoned", {
        "order_id": req.order_id,
        "amount_inr": req.amount_inr,
        "status": "RECOVERY_PENDING",
    })

    return {
        "case_id": case_id,
        "status": "RECOVERY_PENDING",
        "amount_inr": req.amount_inr,
        "recovered": False,
    }

@app.get("/api/payments")
async def get_payments():
    provider = get_payment_provider()
    return await provider.get_payments()
