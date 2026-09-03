from fastapi import FastAPI, HTTPException
from typing import List, Dict, Any
from fastapi.middleware.cors import CORSMiddleware
from .seed import MOCK_PAYMENTS
import random

app = FastAPI(title="Mock Razorpay API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PAYMENTS_DB = {p["payment_id"]: {**p, "amount_inr": p["amount"] / 100} for p in MOCK_PAYMENTS if "payment_id" in p}

@app.get("/v1/payments")
async def list_payments():
    return {"items": list(PAYMENTS_DB.values())}

@app.get("/v1/payments/{payment_id}")
async def get_payment(payment_id: str):
    if payment_id not in PAYMENTS_DB:
        raise HTTPException(status_code=404, detail="Payment not found")
    return PAYMENTS_DB[payment_id]

rng = random.Random(42)
def simulate_outcome(payment: Dict[str, Any], is_link: bool = False) -> str:
    err = payment.get("error_code")
    prob = 0.8 if is_link else 0.4
    if err == "payment_timed_out": prob = 0.9
    elif err == "card_declined": prob = 0.7 if is_link else 0.1
    return "captured" if rng.random() < prob else "failed"

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
    payment_id = payload.get("notes", {}).get("payment_id")
    if payment_id and payment_id in PAYMENTS_DB:
        outcome = simulate_outcome(PAYMENTS_DB[payment_id], is_link=True)
        PAYMENTS_DB[payment_id]["status"] = outcome
        return {"status": "created", "outcome": outcome}
    return {"status": "created", "outcome": "pending"}

