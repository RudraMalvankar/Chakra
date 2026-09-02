import json
from backend.app.lib.audit import AUDIT_FILE
import os

def generate_metrics_report() -> dict:
    """Parses the JSONL audit trail to generate live metrics for the dashboard."""
    if not os.path.exists(AUDIT_FILE):
        return {"error": "No audit log found"}
        
    metrics = {
        "summary": {
            "total_processed": 0,
            "recovered_or_scheduled": 0,
            "escalated_to_human": 0,
            "blocked_by_safety_gate": 0,
            "recovery_rate_pct": 0.0
        },
        "simulation_disclosure": "Recovery outcomes are modeled probabilistically based on stated assumptions."
    }
    
    with open(AUDIT_FILE, "r") as f:
        for line in f:
            if not line.strip(): continue
            event = json.loads(line)
            
            if event["event_type"] == "triage_decision":
                metrics["summary"]["total_processed"] += 1
                
            elif event["event_type"] == "execution_success":
                metrics["summary"]["recovered_or_scheduled"] += 1
                
            elif event["event_type"] == "dry_run_execution":
                action = event.get("details", {}).get("simulated_action")
                if action == "escalate":
                    metrics["summary"]["escalated_to_human"] += 1
                else:
                    metrics["summary"]["recovered_or_scheduled"] += 1
                    
            elif event["event_type"] == "escalated_to_human":
                metrics["summary"]["escalated_to_human"] += 1
                
            elif event["event_type"] == "execution_blocked":
                metrics["summary"]["blocked_by_safety_gate"] += 1
                
    total = metrics["summary"]["total_processed"]
    if total > 0:
        recovered = metrics["summary"]["recovered_or_scheduled"]
        metrics["summary"]["recovery_rate_pct"] = round((recovered / total) * 100, 2)
        
    return metrics
