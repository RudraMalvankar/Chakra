import json
from backend.app.lib.audit import AUDIT_FILE
import os

def generate_metrics_report() -> dict:
    if not os.path.exists(AUDIT_FILE):
        return {"error": "No audit log found"}
        
    metrics = {
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
        "escalation_rate_pct": 0.0
    }
    
    payment_amounts = {}
    
    with open(AUDIT_FILE, "r") as f:
        for line in f:
            if not line.strip(): continue
            event = json.loads(line)
            pid = event["payment_id"]
            etype = event["event_type"]
            details = event.get("details", {})
            
            if etype == "triage_decision_proposed":
                metrics["payments_processed"] += 1
                amt = details.get("amount_inr", 0.0)
                payment_amounts[pid] = amt
                metrics["revenue_at_risk_inr"] += amt
                
            elif etype == "safety_check_completed":
                dec = details.get("decision", "BLOCK")
                if dec == "BLOCK":
                    metrics["payments_blocked"] += 1
                elif dec == "ESCALATE":
                    metrics["payments_escalated"] += 1
                else:
                    metrics["payments_recovery_eligible"] += 1
                    
            elif etype == "dry_run_execution":
                metrics["interventions_attempted"] += 1
                metrics["revenue_attempted_inr"] += payment_amounts.get(pid, 0.0)
                # In dry run, we don't have real outcomes, so we can't accurately simulate revenue recovered.
                
            elif etype == "execution_outcome":
                metrics["interventions_attempted"] += 1
                metrics["revenue_attempted_inr"] += payment_amounts.get(pid, 0.0)
                status = details.get("status") or details.get("outcome")
                if status == "captured":
                    metrics["interventions_succeeded"] += 1
                    metrics["payments_recovered"] += 1
                    metrics["revenue_recovered_inr"] += payment_amounts.get(pid, 0.0)
                else:
                    metrics["payments_failed_recovery"] += 1
                    
    # Calculations
    p_proc = metrics["payments_processed"]
    if p_proc > 0:
        metrics["safety_block_rate_pct"] = round((metrics["payments_blocked"] / p_proc) * 100, 2)
        metrics["escalation_rate_pct"] = round((metrics["payments_escalated"] / p_proc) * 100, 2)
        metrics["payment_recovery_rate_pct"] = round((metrics["payments_recovered"] / p_proc) * 100, 2)
        
    i_att = metrics["interventions_attempted"]
    if i_att > 0:
        metrics["intervention_success_rate_pct"] = round((metrics["interventions_succeeded"] / i_att) * 100, 2)
        
    r_risk = metrics["revenue_at_risk_inr"]
    if r_risk > 0:
        metrics["revenue_recovery_rate_pct"] = round((metrics["revenue_recovered_inr"] / r_risk) * 100, 2)

    return {"metrics": metrics, "simulation_disclosure": "Recovery outcomes are modeled probabilistically based on stated assumptions. This is a synthetic benchmark, not a claim of production throughput."}
