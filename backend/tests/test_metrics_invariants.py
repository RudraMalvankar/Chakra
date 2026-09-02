import os
import json
import tempfile
import pytest

from backend.app.lib.audit import log_audit_event, clear_audit_log
from backend.app.services.metrics_aggregator import (
    generate_metrics_report,
    verify_invariants,
    SIMULATION_DISCLOSURE,
)


def test_audit_log_pii_and_cot_protection():
    with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".jsonl") as tf:
        temp_path = tf.name

    try:
        # Log event with PII and CoT fields
        details = {
            "amount_inr": 1500.0,
            "chain_of_thought": "I think the customer should be charged again...",
            "thought": "Internal thinking process",
            "reasoning_steps": ["step 1", "step 2"],
            "decision": "RETRY_LATER",
        }
        log_audit_event("pay_test_001", "triage_decision_proposed", details, pii_redacted=True, filepath=temp_path)

        with open(temp_path, "r", encoding="utf-8") as f:
            lines = [json.loads(line) for line in f if line.strip()]

        assert len(lines) == 1
        entry = lines[0]
        assert entry["payment_id"] == "pay_test_001"
        assert entry["event_type"] == "triage_decision_proposed"
        assert entry["pii_redacted"] is True
        assert "chain_of_thought" not in entry["details"]
        assert "thought" not in entry["details"]
        assert "reasoning_steps" not in entry["details"]
        assert entry["details"]["decision"] == "RETRY_LATER"
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def test_metrics_invariants_on_synthetic_log():
    with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".jsonl") as tf:
        temp_path = tf.name

    try:
        # 1. Payment 1: Eligible, Attempted, Recovered (1000 INR)
        log_audit_event("p1", "triage_decision_proposed", {"amount_inr": 1000.0}, filepath=temp_path)
        log_audit_event("p1", "safety_check_completed", {"decision": "RETRY_LATER", "eligibility": "ALLOWED"}, filepath=temp_path)
        log_audit_event("p1", "execution_outcome", {"status": "captured", "recovered": True}, filepath=temp_path)

        # 2. Payment 2: Eligible, Attempted, Failed Recovery (2000 INR)
        log_audit_event("p2", "triage_decision_proposed", {"amount_inr": 2000.0}, filepath=temp_path)
        log_audit_event("p2", "safety_check_completed", {"decision": "PAYMENT_LINK", "eligibility": "ALLOWED"}, filepath=temp_path)
        log_audit_event("p2", "execution_outcome", {"status": "failed", "recovered": False}, filepath=temp_path)

        # 3. Payment 3: Blocked by Safety Gate (5000 INR)
        log_audit_event("p3", "triage_decision_proposed", {"amount_inr": 5000.0}, filepath=temp_path)
        log_audit_event("p3", "safety_check_completed", {"decision": "BLOCK", "eligibility": "BLOCKED"}, filepath=temp_path)
        log_audit_event("p3", "execution_blocked", {"reason_code": "HARD_COMPLIANCE_BLOCK"}, filepath=temp_path)

        # 4. Payment 4: Escalated by Safety Gate (3000 INR)
        log_audit_event("p4", "triage_decision_proposed", {"amount_inr": 3000.0}, filepath=temp_path)
        log_audit_event("p4", "safety_check_completed", {"decision": "ESCALATE", "eligibility": "ESCALATED"}, filepath=temp_path)
        log_audit_event("p4", "execution_escalated", {"reason_code": "HIGH_ALERTS_IGNORED_CHURN_RISK"}, filepath=temp_path)

        report = generate_metrics_report(audit_file=temp_path)
        metrics = report["metrics"]
        invariants = report["invariants"]

        # 1. Counts
        assert metrics["payments_processed"] == 4
        assert metrics["payments_recovery_eligible"] == 2
        assert metrics["payments_blocked"] == 1
        assert metrics["payments_escalated"] == 1
        assert metrics["interventions_attempted"] == 2
        assert metrics["interventions_succeeded"] == 1
        assert metrics["payments_recovered"] == 1
        assert metrics["payments_failed_recovery"] == 1

        # 2. Revenues
        assert metrics["revenue_at_risk_inr"] == 11000.0  # 1000 + 2000 + 5000 + 3000
        assert metrics["revenue_attempted_inr"] == 3000.0  # 1000 + 2000
        assert metrics["revenue_recovered_inr"] == 1000.0  # 1000

        # 3. Rates
        assert metrics["safety_block_rate_pct"] == 25.0
        assert metrics["escalation_rate_pct"] == 25.0
        assert metrics["payment_recovery_rate_pct"] == 25.0
        assert metrics["intervention_success_rate_pct"] == 50.0
        assert metrics["revenue_recovery_rate_pct"] == round((1000.0 / 11000.0) * 100, 2)

        # 4. Invariants
        assert invariants["revenue_hierarchy_invariant"] is True
        assert invariants["count_hierarchy_invariant"] is True
        assert invariants["partition_sum_invariant"] is True
        assert invariants["all_passed"] is True

        # 5. Disclosure
        assert report["simulation_disclosure"] == SIMULATION_DISCLOSURE

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def test_verify_invariants_detects_violations():
    # Violation 1: revenue_recovered > revenue_attempted
    invalid_metrics_1 = {
        "payments_processed": 10,
        "payments_recovery_eligible": 10,
        "payments_blocked": 0,
        "payments_escalated": 0,
        "interventions_attempted": 5,
        "interventions_succeeded": 5,
        "payments_recovered": 5,
        "revenue_at_risk_inr": 1000.0,
        "revenue_attempted_inr": 500.0,
        "revenue_recovered_inr": 600.0,  # VIOLATION: > attempted
    }
    res1 = verify_invariants(invalid_metrics_1)
    assert res1["revenue_hierarchy_invariant"] is False
    assert res1["all_passed"] is False

    # Violation 2: recovered > attempted
    invalid_metrics_2 = {
        "payments_processed": 10,
        "payments_recovery_eligible": 10,
        "payments_blocked": 0,
        "payments_escalated": 0,
        "interventions_attempted": 3,
        "interventions_succeeded": 4,  # VIOLATION: > attempted
        "payments_recovered": 4,
        "revenue_at_risk_inr": 1000.0,
        "revenue_attempted_inr": 500.0,
        "revenue_recovered_inr": 400.0,
    }
    res2 = verify_invariants(invalid_metrics_2)
    assert res2["count_hierarchy_invariant"] is False
    assert res2["all_passed"] is False

    # Violation 3: partition sum does not equal processed
    invalid_metrics_3 = {
        "payments_processed": 10,
        "payments_recovery_eligible": 5,
        "payments_blocked": 2,
        "payments_escalated": 1,  # SUM = 8 != 10
        "interventions_attempted": 5,
        "interventions_succeeded": 3,
        "payments_recovered": 3,
        "revenue_at_risk_inr": 1000.0,
        "revenue_attempted_inr": 500.0,
        "revenue_recovered_inr": 300.0,
    }
    res3 = verify_invariants(invalid_metrics_3)
    assert res3["partition_sum_invariant"] is False
    assert res3["all_passed"] is False


def test_metrics_empty_audit_log():
    report = generate_metrics_report("non_existent_file.jsonl")
    assert report["metrics"]["payments_processed"] == 0
    assert report["metrics"]["revenue_at_risk_inr"] == 0.0
    assert report["invariants"]["all_passed"] is True
    assert "simulation_disclosure" in report
