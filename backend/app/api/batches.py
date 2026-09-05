"""
Backend-Controlled Batch Simulator API.
Processes batches asynchronously without requiring client-side request loops.
Resilient: single-case errors do not crash the batch.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
import uuid
import random
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, desc
from backend.app.db.session import get_session_factory
from backend.app.db.models import BatchRun, BatchCase, RecoveryCase, utcnow
from backend.app.services.recovery_executor import execute_recovery_pipeline

logger = logging.getLogger("chakra.batches")
router = APIRouter()

SCENARIOS = [
    "insufficient_funds",
    "payment_timed_out",
    "expired_card",
    "card_declined",
    "mandate_revoked",
    "fraud_suspected",
    "network_authorization_anomaly",
]


class BatchStartRequest(BaseModel):
    count: int = Field(100, ge=1, le=1000, description="Number of payments to simulate (1-1000)")
    scenario: str = Field("mixed", description="Scenario type: mixed, timeout, insufficient_funds, etc.")


async def process_batch_background(batch_id: str, count: int, scenario_type: str):
    """Executes batch processing in the background, updating progress in DB."""
    factory = get_session_factory()
    
    # Update status to PROCESSING
    with factory() as session:
        run = session.execute(select(BatchRun).where(BatchRun.id == batch_id)).scalar_one_or_none()
        if run:
            run.status = "PROCESSING"
            session.commit()

    processed = 0
    recovered = 0
    rev_at_risk = 0.0
    rev_attempted = 0.0
    rev_recovered = 0.0
    rev_blocked = 0.0
    rev_escalated = 0.0
    pending = 0
    rev_pending = 0.0

    for i in range(count):
        if scenario_type == "mixed":
            failure_reason = random.choice(SCENARIOS)
        else:
            failure_reason = scenario_type

        amount_inr = float(random.randint(500, 15000))
        cust_id = f"batch_cust_{batch_id[:6]}_{i:03d}"
        case_id = f"case_b_{batch_id[:6]}_{i:03d}"

        payload = {
            "payment_id": case_id,
            "amount_inr": amount_inr,
            "error_code": failure_reason,
            "case_type": "PAYMENT_FAILURE",
            "customer_id": cust_id,
            "context": {
                "mandate_state": "REVOKED" if failure_reason == "mandate_revoked" else "ACTIVE",
                "churn_risk": "HIGH" if random.random() > 0.8 else "LOW",
                "fraud_risk": "HIGH" if failure_reason == "fraud_suspected" else "LOW",
                "batch_id": batch_id,
            }
        }

        case_status = "PROCESSED"
        err_msg = None
        # Every accepted item is at risk, even when processing itself fails.
        # Otherwise the batch can silently under-report exposure.
        rev_at_risk += amount_inr

        try:
            res_case = await execute_recovery_pipeline(payload, dry_run=False)
            res_status = res_case.current_state.value

            if res_status == "RECOVERED":
                recovered += 1
                rev_recovered += amount_inr
                rev_attempted += amount_inr
            elif res_status in ("RECOVERY_PENDING", "INTERVENTION_ATTEMPTED"):
                pending += 1
                rev_pending += amount_inr
                rev_attempted += amount_inr
            elif res_status == "BLOCKED":
                rev_blocked += amount_inr
            elif res_status == "ESCALATED":
                rev_escalated += amount_inr
            case_status = res_status

        except Exception as e:
            logger.error(f"Error in batch {batch_id} case {i}: {e}")
            case_status = "FAILED"
            err_msg = str(e)

        processed += 1

        # Persist individual case and update batch run every 5 cases or on completion
        with factory() as session:
            try:
                b_case = BatchCase(
                    batch_id=batch_id,
                    recovery_case_id=case_id,
                    sequence=i + 1,
                    status=case_status,
                    error_message=err_msg,
                )
                session.add(b_case)

                if (i % 5 == 0) or (i == count - 1):
                    run = session.execute(select(BatchRun).where(BatchRun.id == batch_id)).scalar_one_or_none()
                    if run:
                        run.processed_count = processed
                        run.recovered_count = recovered
                        run.revenue_at_risk = rev_at_risk
                        run.revenue_attempted = rev_attempted
                        run.revenue_recovered = rev_recovered
                        run.revenue_blocked = rev_blocked
                        run.revenue_escalated = rev_escalated
                        run.pending_count = pending
                        run.revenue_pending = rev_pending
                session.commit()
            except Exception as commit_err:
                logger.error(f"Error committing batch progress: {commit_err}")
                session.rollback()

        # Brief yield to keep event loop responsive
        await asyncio.sleep(0.01)

    # Mark completed
    with factory() as session:
        try:
            run = session.execute(select(BatchRun).where(BatchRun.id == batch_id)).scalar_one_or_none()
            if run:
                run.status = "COMPLETED"
                run.completed_at = utcnow()
                run.processed_count = processed
                run.recovered_count = recovered
                run.revenue_at_risk = rev_at_risk
                run.revenue_attempted = rev_attempted
                run.revenue_recovered = rev_recovered
                run.revenue_blocked = rev_blocked
                run.revenue_escalated = rev_escalated
                run.pending_count = pending
                run.revenue_pending = rev_pending
                session.commit()
        except Exception as e:
            logger.error(f"Error finalizing batch: {e}")
            session.rollback()


@router.post("/")
async def start_batch(req: BatchStartRequest, background_tasks: BackgroundTasks):
    """
    Creates and initiates a backend-controlled batch run.
    Accepts count (e.g. 100) and scenario.
    """
    if req.scenario != "mixed" and req.scenario not in SCENARIOS:
        raise HTTPException(
            status_code=422,
            detail={"scenario": f"unsupported scenario; choose mixed or one of {SCENARIOS}"},
        )
    batch_id = f"batch_{uuid.uuid4().hex[:8]}"
    factory = get_session_factory()
    
    with factory() as session:
        run = BatchRun(
            id=batch_id,
            status="QUEUED",
            scenario=req.scenario,
            requested_count=req.count,
            processed_count=0,
            revenue_at_risk=0.0,
            revenue_attempted=0.0,
            revenue_recovered=0.0,
        )
        session.add(run)
        session.commit()

    background_tasks.add_task(process_batch_background, batch_id, req.count, req.scenario)

    return {
        "batch_id": batch_id,
        "status": "QUEUED",
        "requested_count": req.count,
        "message": f"Batch simulation of {req.count} payments initiated.",
    }


@router.get("/")
def list_batches():
    """Lists previous batch simulation runs."""
    factory = get_session_factory()
    with factory() as session:
        stmt = select(BatchRun).order_by(desc(BatchRun.created_at)).limit(20)
        runs = session.execute(stmt).scalars().all()
        return [
            {
                "id": r.id,
                "status": r.status,
                "scenario": r.scenario,
                "requested_count": r.requested_count,
                "processed_count": r.processed_count,
                "recovered_count": r.recovered_count,
                "revenue_at_risk_inr": r.revenue_at_risk,
                "revenue_attempted_inr": r.revenue_attempted,
                "revenue_recovered_inr": r.revenue_recovered,
                "revenue_blocked_inr": r.revenue_blocked,
                "revenue_escalated_inr": r.revenue_escalated,
                "pending_count": r.pending_count,
                "revenue_pending_inr": r.revenue_pending,
                "recovery_rate_pct": round((r.revenue_recovered / r.revenue_at_risk * 100.0) if r.revenue_at_risk > 0 else 0.0, 2),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in runs
        ]


@router.get("/{batch_id}")
def get_batch(batch_id: str):
    """Returns real-time progress and metrics for a batch run."""
    factory = get_session_factory()
    with factory() as session:
        stmt = select(BatchRun).where(BatchRun.id == batch_id)
        r = session.execute(stmt).scalar_one_or_none()
        if not r:
            raise HTTPException(status_code=404, detail="Batch run not found")

        recovery_rate = (r.revenue_recovered / r.revenue_at_risk * 100.0) if r.revenue_at_risk > 0 else 0.0
        return {
            "batch_id": r.id,
            "status": r.status,
            "scenario": r.scenario,
            "requested_count": r.requested_count,
            "processed_count": r.processed_count,
            "recovered_count": r.recovered_count,
            "revenue_at_risk_inr": r.revenue_at_risk,
            "revenue_attempted_inr": r.revenue_attempted,
            "revenue_recovered_inr": r.revenue_recovered,
            "revenue_blocked_inr": r.revenue_blocked,
            "revenue_escalated_inr": r.revenue_escalated,
            "pending_count": r.pending_count,
            "revenue_pending_inr": r.revenue_pending,
            "recovery_rate_pct": round(recovery_rate, 2),
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        }


@router.get("/{batch_id}/cases")
def get_batch_cases(batch_id: str, limit: int = 200):
    """Returns individual cases for a batch with full recovery case details."""
    factory = get_session_factory()
    with factory() as session:
        stmt = (
            select(BatchCase)
            .where(BatchCase.batch_id == batch_id)
            .order_by(BatchCase.sequence)
            .limit(limit)
        )
        batch_cases = session.execute(stmt).scalars().all()

        results = []
        for bc in batch_cases:
            case_data = {
                "sequence": bc.sequence,
                "batch_case_id": bc.id,
                "batch_id": bc.batch_id,
                "case_id": bc.recovery_case_id,
                "status": bc.status,
                "error": bc.error_message,
                "amount": 0.0,
                "case_type": None,
                "current_action": None,
                "risk_probability": None,
                "ai_used": None,
                "ai_classification": None,
                "ai_confidence": None,
                "ai_reasoning": None,
                "selected_action": None,
                "decision_confidence": None,
                "expected_recovery": None,
                "safety_eligibility": None,
                "safety_reason_code": None,
                "events": [],
            }

            if bc.recovery_case_id:
                rc = session.execute(
                    select(RecoveryCase).where(RecoveryCase.id == bc.recovery_case_id)
                ).scalar_one_or_none()
                if rc:
                    case_data["amount"] = rc.amount_at_risk
                    case_data["case_type"] = rc.case_type
                    case_data["current_action"] = rc.current_action
                    case_data["risk_probability"] = rc.risk_probability
                    case_data["ai_used"] = rc.ai_used
                    case_data["ai_classification"] = rc.ai_classification
                    case_data["ai_confidence"] = rc.ai_confidence
                    case_data["ai_reasoning"] = rc.ai_reasoning

                    from backend.app.db.models import RecoveryDecision as RecoveryDecisionModel, RecoveryEvent
                    latest_decision = session.execute(
                        select(RecoveryDecisionModel)
                        .where(RecoveryDecisionModel.recovery_case_id == bc.recovery_case_id)
                        .order_by(desc(RecoveryDecisionModel.created_at))
                        .limit(1)
                    ).scalar_one_or_none()
                    if latest_decision:
                        case_data["selected_action"] = latest_decision.selected_action
                        case_data["decision_confidence"] = latest_decision.confidence
                        case_data["expected_recovery"] = latest_decision.expected_recovery

                    events = session.execute(
                        select(RecoveryEvent)
                        .where(RecoveryEvent.recovery_case_id == bc.recovery_case_id)
                        .order_by(RecoveryEvent.created_at)
                    ).scalars().all()
                    case_data["events"] = [
                        {
                            "event_type": e.event_type,
                            "action": e.action,
                            "status": e.status,
                            "amount": e.amount,
                            "metadata": e.metadata_json,
                            "created_at": e.created_at.isoformat() if e.created_at else None,
                        }
                        for e in events
                    ]

                    safety_event = None
                    for e in events:
                        if e.event_type == "safety_check_completed":
                            safety_event = e
                    if safety_event and safety_event.metadata_json:
                        case_data["safety_eligibility"] = safety_event.metadata_json.get("eligibility")
                        case_data["safety_reason_code"] = safety_event.metadata_json.get("reason_code")

            results.append(case_data)
        return results
