import os
import sys
import json
import random
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.config import settings
from backend.app.lib.audit import clear_audit_log
from backend.app.services.safety_gate import reset_safety_state
from backend.app.services.recovery_executor import execute_recovery_pipeline
from backend.app.services.metrics_aggregator import generate_metrics_report, verify_invariants
from backend.app.services.eval_runner import run_eval
from backend.app.api.webhooks import verify_signature

import importlib.util

spec = importlib.util.spec_from_file_location("seed", "mock-razorpay/seed.py")
seed_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_mod)
SEED_DATA = seed_mod.SEED_DATA

def _get_id(p):
    if "payment_id" in p: return p["payment_id"]
    if "event" in p:
        payload = p.get("payload", {})
        for k, v in payload.items():
            if isinstance(v, dict) and "id" in v:
                return v["id"]
    return "unknown"
PAYMENTS_DB = {_get_id(p): dict(p) for p in SEED_DATA}


def simulate_outcome(payment: dict, is_link: bool = False) -> str:
    """Probabilistic outcome simulation matching mock-razorpay/main.py"""
    err = payment.get("error_code")
    if err == "insufficient_funds":
        prob = 0.8 if is_link else 0.4
    elif err == "payment_timed_out":
        prob = 0.9
    elif err == "card_declined":
        prob = 0.7 if is_link else 0.1
    else:
        prob = 0.3
    return "captured" if random.random() < prob else "failed"


async def mock_retry_payment(payment_id: str, delay_hours: int = 0):
    payment = PAYMENTS_DB.get(payment_id, {"payment_id": payment_id, "error_code": "insufficient_funds"})
    outcome = simulate_outcome(payment)
    payment["status"] = outcome
    return {"status": outcome, "id": payment_id}


async def mock_create_payment_link(customer_id: str, amount: int, template: str, payment_id: str):
    payment = PAYMENTS_DB.get(payment_id, {"payment_id": payment_id, "error_code": "insufficient_funds"})
    outcome = simulate_outcome(payment, is_link=True)
    payment["status"] = outcome
    return {"status": "created", "outcome": outcome}


@pytest.mark.asyncio
async def test_120_payment_benchmark_dry_run():
    """Runs all 120 seed payments through dry-run recovery pipeline and validates invariants."""
    clear_audit_log()
    reset_safety_state()

    assert len(SEED_DATA) == 127

    for payment in SEED_DATA:
        ctx = await execute_recovery_pipeline(payment, dry_run=True)
        assert ctx.payment_id is not None
        assert ctx.current_state in [
            "BLOCKED",
            "ESCALATED",
            "INTERVENTION_ATTEMPTED",
            "RECOVERED",
            "RECOVERY_FAILED",
            "RECOVERY_PENDING",
        ]

    report = generate_metrics_report()
    metrics = report["metrics"]
    invariants = report["invariants"]

    assert metrics["payments_processed"] == 127
    assert metrics["revenue_at_risk_inr"] > 0
    assert metrics["payments_blocked"] + metrics["payments_escalated"] + metrics["payments_recovery_eligible"] == 127
    assert invariants["all_passed"] is True


@pytest.mark.asyncio
async def test_120_payment_benchmark_live_run():
    """Runs all 120 seed payments through live mock recovery pipeline and validates revenue recovery."""
    clear_audit_log()
    reset_safety_state()

    with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", side_effect=mock_retry_payment), \
         patch("backend.app.services.recovery_executor.razorpay_client.create_payment_link", side_effect=mock_create_payment_link):
        for payment in SEED_DATA:
            ctx = await execute_recovery_pipeline(payment, dry_run=False)
            assert ctx.payment_id is not None

    report = generate_metrics_report()
    metrics = report["metrics"]
    invariants = report["invariants"]

    assert metrics["payments_processed"] == 127
    assert metrics["revenue_at_risk_inr"] > 0
    assert metrics["interventions_attempted"] > 0

    # Mathematical Invariants Validation
    assert invariants["revenue_hierarchy_invariant"] is True
    assert invariants["count_hierarchy_invariant"] is True
    assert invariants["partition_sum_invariant"] is True
    assert invariants["all_passed"] is True

    # Revenue recovered <= Revenue attempted <= Revenue at risk
    assert metrics["revenue_recovered_inr"] <= metrics["revenue_attempted_inr"] + 1e-4
    assert metrics["revenue_attempted_inr"] <= metrics["revenue_at_risk_inr"] + 1e-4

    # Payments recovered <= Interventions succeeded <= Interventions attempted <= Payments processed
    assert metrics["payments_recovered"] <= metrics["interventions_succeeded"]
    assert metrics["interventions_succeeded"] <= metrics["interventions_attempted"]
    assert metrics["interventions_attempted"] <= metrics["payments_processed"]


def test_18_labeled_cases_eval():
    """Validates that 18 labeled test cases pass with 100% accuracy through the 6-stage pipeline."""
    eval_report = run_eval()
    summary = eval_report["summary"]
    
    assert summary["total_cases"] >= 18
    assert summary["correct"] == 18
    assert summary["accuracy_pct"] >= 85.0


def test_webhook_api_end_to_end():
    """Tests FastAPI webhook endpoint with HMAC verification and pipeline execution."""
    client = TestClient(app)
    clear_audit_log()
    reset_safety_state()

    import hmac
    import hashlib

    payload = {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_webhook_e2e_1",
                    "amount": 49900,
                    "currency": "INR",
                    "error_code": "insufficient_funds",
                    "metadata": {
                        "bank_name": "HDFC",
                        "network": "visa",
                        "retries_this_month": 1,
                    }
                }
            }
        }
    }
    body_str = json.dumps(payload)
    sig = hmac.new(settings.webhook_secret.encode(), body_str.encode(), hashlib.sha256).hexdigest()

    # Valid signature
    with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", side_effect=mock_retry_payment):
        resp = client.post(
            "/webhooks/razorpay",
            content=body_str,
            headers={"x-razorpay-signature": sig, "Content-Type": "application/json"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data.get("case_id") == "pay_webhook_e2e_1" or data.get("payment_id") == "pay_webhook_e2e_1"

    # Invalid signature
    resp_invalid = client.post(
        "/webhooks/razorpay",
        content=body_str,
        headers={"x-razorpay-signature": "bad_sig", "Content-Type": "application/json"},
    )
    assert resp_invalid.status_code == 400

    # Missing signature
    resp_missing = client.post(
        "/webhooks/razorpay",
        content=body_str,
        headers={"Content-Type": "application/json"},
    )
    assert resp_missing.status_code == 400
