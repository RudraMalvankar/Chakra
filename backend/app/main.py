from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional

from backend.app.api.webhooks import router as webhook_router
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.lib.audit import AUDIT_FILE
from backend.app.models.case import RecoveryCase, CaseType
from backend.app.models.payment import PaymentState
from backend.app.services.recovery_executor import execute_recovery_pipeline
import json
import os
import uuid

app = FastAPI(title="Chakra Recovery Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router, prefix="/webhooks")

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/metrics")
def get_metrics():
    return generate_metrics_report()

@app.get("/api/audit")
def get_audit_trail(limit: int = 100):
    if not os.path.exists(AUDIT_FILE):
        return {"events": []}
    events = []
    with open(AUDIT_FILE, "r") as f:
        for line in f:
            if line.strip():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    # Return newest first, limited
    return {"events": events[::-1][:limit]}

@app.get("/api/cases/{case_id}/trace")
def get_case_trace(case_id: str):
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
                    # Chain of thought is already stripped by audit.py
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

@app.post("/api/demo/simulate")
async def simulate_event(req: SimulateEventRequest):
    case_id = f"demo_{uuid.uuid4().hex[:8]}"
    
    # Construct input payload mapping to real pipeline expectations
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
            "network": "Visa"
        }
    }
    
    # Call real backend pipeline
    final_case = await execute_recovery_pipeline(payload, dry_run=False)
    
    # Return the trace for the UI to animate
    return get_case_trace(case_id)

