from typing import Dict, Any
from .triage import triage_payment
from .safety_gate import check_safety_gate
from .razorpay_client import razorpay_client
from backend.app.lib.audit import log_audit_event

async def process_failed_payment(payment: Dict[str, Any], dry_run: bool = False):
    """
    The orchestrator. Takes a payload, triages it, checks safety gates, and executes.
    """
    payment_id = payment["payment_id"]
    
    # 1. Triage (Compliance -> Rules -> LLM)
    decision = triage_payment(payment)
    
    log_audit_event(payment_id, "triage_decision", {
        "action": decision.action,
        "reason": decision.reason,
        "confidence": decision.confidence,
        "template": decision.template
    })

    # 2. Safety Gate (Idempotency, Budgets, Rate Limits)
    is_safe = check_safety_gate(payment, decision.action)
    if not is_safe:
        log_audit_event(payment_id, "execution_blocked", {"reason": "safety_gate_rejected_budget_or_idempotency"})
        return
        
    # 3. Execute
    if dry_run:
        log_audit_event(payment_id, "dry_run_execution", {"simulated_action": decision.action})
        return
        
    try:
        if decision.action == "retry":
            res = await razorpay_client.retry_payment(payment_id, decision.delay_hours or 24)
            log_audit_event(payment_id, "execution_success", res)
            
        elif decision.action == "send_payment_link":
            res = await razorpay_client.create_payment_link(payment["customer_id"], payment["amount"], decision.template or "default")
            log_audit_event(payment_id, "execution_success", res)
            
        elif decision.action == "escalate":
            log_audit_event(payment_id, "escalated_to_human", {"reason": decision.reason})
            
    except Exception as e:
        log_audit_event(payment_id, "execution_failed", {"error": str(e)})
