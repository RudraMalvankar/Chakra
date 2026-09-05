"""Human queue for recovery cases that deterministic automation stopped."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.db_service import DBService

router = APIRouter(tags=["escalations"])


class EscalationTransitionRequest(BaseModel):
    status: str = Field(description="Valid next escalation status")
    actor: str = "operator"
    notes: Optional[str] = None
    assigned_to: Optional[str] = None
    resolution: Optional[str] = None


@router.get("/")
def list_escalations(limit: int = 200):
    return DBService.list_escalations(limit=limit)


@router.get("/summary")
def escalation_summary():
    rows = DBService.list_escalations(limit=1000)
    active = [row for row in rows if row["status"] not in {"RESOLVED", "CLOSED"}]
    high = [row for row in active if row["priority"] == "HIGH"]
    return {
        "open_count": len(active),
        "high_priority_count": len(high),
        "unresolved_count": len(active),
        "revenue_escalated_inr": sum(
            (DBService.get_case_detail(row["case_id"]) or {}).get("amount_at_risk", 0.0)
            for row in active
        ),
    }


@router.get("/{escalation_id}")
def get_escalation(escalation_id: str):
    escalation = DBService.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return escalation


@router.post("/{escalation_id}/transition")
def transition_escalation(escalation_id: str, request: EscalationTransitionRequest):
    try:
        escalation = DBService.transition_escalation(
            escalation_id=escalation_id,
            status=request.status.upper(),
            actor=request.actor,
            notes=request.notes,
            assigned_to=request.assigned_to,
            resolution=request.resolution,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return escalation
