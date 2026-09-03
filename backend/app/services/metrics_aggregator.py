"""
Metrics Aggregator: Computes revenue-first recovery metrics and enforces mathematical invariants.
Parses append-only JSONL audit logs to produce structured reporting for benchmarks and dashboards.
"""
import json
import os
from typing import Dict, Any, Optional
from backend.app.lib.audit import AUDIT_FILE

SIMULATION_DISCLOSURE = (
    "Recovery outcomes are modeled probabilistically based on stated assumptions. "
    "This is a synthetic benchmark, not a claim of production throughput."
)


def verify_invariants(metrics: Dict[str, Any]) -> Dict[str, bool]:
    """
    Validates core mathematical invariants:
    1. revenue_recovered_inr <= revenue_attempted_inr <= revenue_at_risk_inr
    2. payments_recovered <= interventions_succeeded <= interventions_attempted <= payments_processed
    3. payments_blocked + payments_escalated + payments_recovery_eligible == payments_processed
    """
    eps = 1e-4  # float precision tolerance
    
    rev_recovered = metrics.get("revenue_recovered_inr", 0.0)
    rev_attempted = metrics.get("revenue_attempted_inr", 0.0)
    rev_at_risk = metrics.get("revenue_at_risk_inr", 0.0)
    
    p_recovered = metrics.get("payments_recovered", 0)
    i_succeeded = metrics.get("interventions_succeeded", 0)
    i_attempted = metrics.get("interventions_attempted", 0)
    p_processed = metrics.get("payments_processed", 0)
    
    p_blocked = metrics.get("payments_blocked", 0)
    p_escalated = metrics.get("payments_escalated", 0)
    p_eligible = metrics.get("payments_recovery_eligible", 0)
    
    inv1 = (rev_recovered <= rev_attempted + eps) and (rev_attempted <= rev_at_risk + eps)
    inv2 = (p_recovered <= i_succeeded) and (i_succeeded <= i_attempted) and (i_attempted <= p_processed)
    inv3 = (p_blocked + p_escalated + p_eligible == p_processed)
    
    return {
        "revenue_hierarchy_invariant": inv1,
        "count_hierarchy_invariant": inv2,
        "partition_sum_invariant": inv3,
        "all_passed": inv1 and inv2 and inv3,
    }


def generate_metrics_report(audit_file: Optional[str] = None) -> Dict[str, Any]:
    """
    Parses the JSONL audit log and aggregates revenue-first recovery metrics.
    """
    log_path = audit_file or AUDIT_FILE
    if not os.path.exists(log_path):
        return {
            "metrics": {
                "payments_processed": 0,
                "payments_recovery_eligible": 0,
                "payments_blocked": 0,
                "payments_escalated": 0,
                "interventions_attempted": 0,
                "interventions_succeeded": 0,
                "payments_recovered": 0,
                "payments_failed_recovery": 0,
                "revenue_at_risk_inr": 0.0,
                "revenue_attempted_inr": 0.0,
                "revenue_recovered_inr": 0.0,
                "revenue_recovery_rate_pct": 0.0,
                "payment_recovery_rate_pct": 0.0,
                "intervention_success_rate_pct": 0.0,
                "safety_block_rate_pct": 0.0,
                "escalation_rate_pct": 0.0,
            },
            "invariants": {
                "revenue_hierarchy_invariant": True,
                "count_hierarchy_invariant": True,
                "partition_sum_invariant": True,
                "all_passed": True,
            },
            "simulation_disclosure": SIMULATION_DISCLOSURE,
        }

    # Tracking per payment_id
    payment_amounts: Dict[str, float] = {}
    payment_safety: Dict[str, str] = {}  # "BLOCKED", "ESCALATED", "ELIGIBLE"
    payment_attempted: Dict[str, bool] = {}
    payment_recovered: Dict[str, bool] = {}
    payment_dry_run: Dict[str, bool] = {}

    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if not line_str:
                continue
            try:
                event = json.loads(line_str)
            except json.JSONDecodeError:
                continue

            pid = str(event.get("payment_id", "unknown"))
            etype = event.get("event_type", "")
            details = event.get("details", {})
            if not isinstance(details, dict):
                details = {}

            if etype == "triage_decision_proposed":
                amt = float(details.get("amount_inr", 0.0))
                payment_amounts[pid] = amt

            elif etype == "safety_check_completed":
                dec = str(details.get("decision", "")).strip().upper()
                elig = str(details.get("eligibility", "")).strip().upper()
                if dec == "BLOCK" or elig == "BLOCKED" or "BLOCK" in dec:
                    payment_safety[pid] = "BLOCKED"
                elif dec == "ESCALATE" or elig == "ESCALATED" or "ESCALATE" in dec:
                    payment_safety[pid] = "ESCALATED"
                else:
                    payment_safety[pid] = "ELIGIBLE"

            elif etype == "execution_blocked":
                payment_safety[pid] = "BLOCKED"

            elif etype == "execution_escalated":
                payment_safety[pid] = "ESCALATED"

            elif etype == "dry_run_execution":
                payment_dry_run[pid] = True
                # explicitly NOT marked as payment_attempted

            elif etype == "execution_outcome":
                payment_attempted[pid] = True
                status = str(details.get("status", "")).strip().lower()
                outcome = str(details.get("outcome", "")).strip().lower()
                is_rec = details.get("recovered") is True or status == "captured" or outcome in ["captured", "success"]
                if is_rec:
                    payment_recovered[pid] = True
                else:
                    payment_recovered.setdefault(pid, False)

    # Compute aggregate numbers from unique payments
    payments_processed = len(payment_amounts)
    revenue_at_risk_inr = round(sum(payment_amounts.values()), 2)

    payments_blocked = sum(1 for pid in payment_amounts if payment_safety.get(pid) == "BLOCKED")
    payments_escalated = sum(1 for pid in payment_amounts if payment_safety.get(pid) == "ESCALATED")
    # Remaining payments are recovery eligible
    payments_recovery_eligible = payments_processed - payments_blocked - payments_escalated

    interventions_attempted = sum(1 for pid in payment_amounts if payment_attempted.get(pid, False))
    dry_run_actions_proposed = sum(1 for pid in payment_amounts if payment_dry_run.get(pid, False))
    revenue_attempted_inr = round(sum(payment_amounts[pid] for pid in payment_amounts if payment_attempted.get(pid, False)), 2)

    payments_recovered = sum(1 for pid in payment_amounts if payment_recovered.get(pid, False))
    interventions_succeeded = payments_recovered
    revenue_recovered_inr = round(sum(payment_amounts[pid] for pid in payment_amounts if payment_recovered.get(pid, False)), 2)

    payments_failed_recovery = interventions_attempted - payments_recovered

    # Rates
    safety_block_rate_pct = round((payments_blocked / payments_processed) * 100, 2) if payments_processed > 0 else 0.0
    escalation_rate_pct = round((payments_escalated / payments_processed) * 100, 2) if payments_processed > 0 else 0.0
    payment_recovery_rate_pct = round((payments_recovered / payments_processed) * 100, 2) if payments_processed > 0 else 0.0
    intervention_success_rate_pct = round((interventions_succeeded / interventions_attempted) * 100, 2) if interventions_attempted > 0 else 0.0
    revenue_recovery_rate_pct = round((revenue_recovered_inr / revenue_at_risk_inr) * 100, 2) if revenue_at_risk_inr > 0 else 0.0

    metrics = {
        "payments_processed": payments_processed,
        "payments_recovery_eligible": payments_recovery_eligible,
        "payments_blocked": payments_blocked,
        "payments_escalated": payments_escalated,
        "interventions_attempted": interventions_attempted,
        "interventions_succeeded": interventions_succeeded,
        "dry_run_actions_proposed": dry_run_actions_proposed,
        "payments_recovered": payments_recovered,
        "payments_failed_recovery": payments_failed_recovery,
        "revenue_at_risk_inr": revenue_at_risk_inr,
        "revenue_attempted_inr": revenue_attempted_inr,
        "revenue_recovered_inr": revenue_recovered_inr,
        "revenue_recovery_rate_pct": revenue_recovery_rate_pct,
        "payment_recovery_rate_pct": payment_recovery_rate_pct,
        "intervention_success_rate_pct": intervention_success_rate_pct,
        "safety_block_rate_pct": safety_block_rate_pct,
        "escalation_rate_pct": escalation_rate_pct,
    }

    invariants = verify_invariants(metrics)

    return {
        "metrics": metrics,
        "invariants": invariants,
        "simulation_disclosure": SIMULATION_DISCLOSURE,
    }
