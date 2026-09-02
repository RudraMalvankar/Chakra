# mock-razorpay/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from .seed import SEED_DATA

app = FastAPI(title="Mock Razorpay API")

@app.get("/v1/payments")
async def list_payments():
    """Returns the list of 100 seeded failed payments."""
    return {"items": SEED_DATA}

@app.get("/v1/payments/{payment_id}")
async def get_payment(payment_id: str):
    """Retrieve a specific mocked payment."""
    for p in SEED_DATA:
        if p["payment_id"] == payment_id:
            return p
    raise HTTPException(status_code=404, detail="Payment not found")

@app.post("/webhooks/simulate")
async def simulate_webhook():
    """
    Simulates sending webhooks to the Chakra backend.
    In the real demo, scripts/run_demo.py will fetch from /v1/payments directly to simplify execution.
    """
    return {"status": "ok", "message": "Simulated webhooks"}
