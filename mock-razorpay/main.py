from fastapi import FastAPI, HTTPException
from typing import List, Dict, Any
from .seed import SEED_DATA
import random
import time

app = FastAPI(title="Mock Razorpay API")

# In-memory DB for demo
PAYMENTS_DB = {p["payment_id"]: p for p in SEED_DATA}

@app.get("/v1/payments")
async def list_payments():
    return {"items": list(PAYMENTS_DB.values())}

@app.get("/v1/payments/{payment_id}")
async def get_payment(payment_id: str):
    if payment_id not in PAYMENTS_DB:
        raise HTTPException(status_code=404, detail="Payment not found")
    return PAYMENTS_DB[payment_id]

def simulate_outcome(payment: Dict[str, Any], is_link: bool = False) -> str:
    """Probabilistic outcome simulation"""
    err = payment.get("error_code")
    
    if err == "insufficient_funds":
        # Usually recoverable via link, maybe 40% via retry
        prob = 0.8 if is_link else 0.4
    elif err == "payment_timed_out":
        prob = 0.9
    elif err == "card_declined":
        prob = 0.7 if is_link else 0.1
    else:
        prob = 0.3
        
    return "captured" if random.random() < prob else "failed"

@app.post("/v1/payments/{payment_id}/retry")
async def retry_payment(payment_id: str):
    if payment_id not in PAYMENTS_DB:
        raise HTTPException(status_code=404, detail="Payment not found")
        
    payment = PAYMENTS_DB[payment_id]
    outcome = simulate_outcome(payment)
    payment["status"] = outcome
    return {"status": outcome, "id": payment_id}

@app.post("/v1/payment_links")
async def create_payment_link(payload: dict):
    # Simulate link payment
    payment_id = payload.get("notes", {}).get("payment_id")
    if payment_id and payment_id in PAYMENTS_DB:
        outcome = simulate_outcome(PAYMENTS_DB[payment_id], is_link=True)
        PAYMENTS_DB[payment_id]["status"] = outcome
        return {"status": "created", "outcome": outcome}
    return {"status": "created", "outcome": "pending"}
