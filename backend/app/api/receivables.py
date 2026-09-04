"""
B2B Receivables & Promise-to-Pay API.
In-memory persistence (no DB required). Normalized into Chakra pipeline.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import date, datetime
import uuid

from backend.app.services.recovery_executor import execute_recovery_pipeline

router = APIRouter()

# ─── In-memory stores ────────────────────────────────────────────────────────

_receivables: List[Dict[str, Any]] = [
    {
        "id": "inv_1001",
        "customer": "TechCorp India",
        "invoice_id": "INV-2026-001",
        "amount": 250000,
        "due_date": "2026-08-15",
        "days_overdue": 20,
        "risk": "HIGH",
        "status": "OVERDUE",
        "previous_promises": 1,
        "payment_behavior": "SOMETIMES_LATE",
        "promise": None
    },
    {
        "id": "inv_1002",
        "customer": "Alpha Retail Co.",
        "invoice_id": "INV-2026-002",
        "amount": 85000,
        "due_date": "2026-09-01",
        "days_overdue": 3,
        "risk": "MEDIUM",
        "status": "OVERDUE",
        "previous_promises": 0,
        "payment_behavior": "USUALLY_ONTIME",
        "promise": None
    },
    {
        "id": "inv_1003",
        "customer": "BetaTech Solutions",
        "invoice_id": "INV-2026-003",
        "amount": 45000,
        "due_date": "2026-09-10",
        "days_overdue": 0,
        "risk": "LOW",
        "status": "UPCOMING",
        "previous_promises": 0,
        "payment_behavior": "ALWAYS_ONTIME",
        "promise": None
    },
]

_promises: List[Dict[str, Any]] = []


# ─── Models ───────────────────────────────────────────────────────────────────

class PromiseCreateRequest(BaseModel):
    receivable_id: str
    customer: str
    amount: float
    promised_date: str  # ISO date YYYY-MM-DD
    notes: Optional[str] = None

class VoiceRecoveryRequest(BaseModel):
    receivable_id: str
    phone_number: str


# ─── Receivables endpoints ─────────────────────────────────────────────────────

@router.get("/")
def list_receivables():
    return _receivables


@router.get("/summary")
def get_summary():
    total = sum(r["amount"] for r in _receivables)
    at_risk = sum(r["amount"] for r in _receivables if r["risk"] in ("HIGH", "CRITICAL"))
    overdue = [r for r in _receivables if r["days_overdue"] > 0]
    promises_due = [p for p in _promises if p["status"] in ("UPCOMING", "DUE_TODAY")]
    return {
        "total_outstanding": total,
        "at_risk": at_risk,
        "overdue_count": len(overdue),
        "overdue_amount": sum(r["amount"] for r in overdue),
        "promises_due_count": len(promises_due),
        "promises_due_amount": sum(p["amount"] for p in promises_due),
    }


@router.get("/promises")
def list_promises():
    return _promises


@router.post("/promises")
async def create_promise(req: PromiseCreateRequest):
    # Check idempotency — don't create duplicate promise for same receivable
    existing = next((p for p in _promises if p["receivable_id"] == req.receivable_id and p["status"] not in ("BROKEN", "PAYMENT_RECEIVED")), None)
    if existing:
        return existing

    promise_id = f"ptp_{uuid.uuid4().hex[:8]}"
    promise = {
        "id": promise_id,
        "receivable_id": req.receivable_id,
        "customer": req.customer,
        "amount": req.amount,
        "promised_date": req.promised_date,
        "status": "UPCOMING",
        "created_at": datetime.utcnow().isoformat(),
        "notes": req.notes or ""
    }
    _promises.append(promise)

    # Mark receivable as having a promise
    receivable = next((r for r in _receivables if r["id"] == req.receivable_id), None)
    if receivable:
        receivable["promise"] = promise_id
        receivable["status"] = "PROMISE_TO_PAY"

    # Feed into Chakra pipeline (dry-run)
    payload = {
        "payment_id": promise_id,
        "amount_inr": req.amount,
        "error_code": "promise_created",
        "case_type": "PROMISE_TO_PAY",
        "customer_id": req.customer,
        "context": {
            "promise_status": "ACTIVE",
            "invoice_id": req.receivable_id,
            "promised_date": req.promised_date
        }
    }
    try:
        await execute_recovery_pipeline(payload, dry_run=True)
    except Exception:
        pass  # Non-fatal - promise is persisted regardless

    return promise


@router.post("/{id}/recover")
async def recover_receivable(id: str, action: str = "PAYMENT_LINK"):
    receivable = next((r for r in _receivables if r["id"] == id), None)
    if not receivable:
        raise HTTPException(status_code=404, detail="Receivable not found")

    payload = {
        "payment_id": id,
        "amount_inr": receivable["amount"],
        "error_code": f"receivable_{action.lower()}",
        "case_type": "RECEIVABLE",
        "customer_id": receivable["customer"],
        "context": {
            "days_overdue": receivable["days_overdue"],
            "risk": receivable["risk"],
            "requested_action": action
        }
    }
    result = await execute_recovery_pipeline(payload, dry_run=False)
    receivable["status"] = "IN_RECOVERY"
    return result


@router.post("/voice/start")
async def start_voice_recovery(req: VoiceRecoveryRequest):
    from backend.app.services.voice import get_voice_provider
    receivable = next((r for r in _receivables if r["id"] == req.receivable_id), None)
    if not receivable:
        raise HTTPException(status_code=404, detail="Receivable not found")

    provider = get_voice_provider()
    res = await provider.start_call(
        to_number=req.phone_number,
        context={"case_id": req.receivable_id, "amount": receivable["amount"]}
    )

    payload = {
        "payment_id": req.receivable_id,
        "amount_inr": receivable["amount"],
        "error_code": "voice_recovery_initiated",
        "case_type": "RECEIVABLE",
        "customer_id": receivable["customer"],
        "context": {
            "voice_call_sid": res.get("call_sid"),
            "mocked": res.get("mocked", False)
        }
    }
    try:
        await execute_recovery_pipeline(payload, dry_run=True)
    except Exception:
        pass

    return res


@router.get("/{id}")
def get_receivable(id: str):
    receivable = next((r for r in _receivables if r["id"] == id), None)
    if not receivable:
        raise HTTPException(status_code=404, detail="Receivable not found")
    return receivable
