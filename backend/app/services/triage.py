# backend/app/services/triage.py
from typing import Dict, Any
from .compliance import check_compliance
from .pii_redact import redact_for_llm
from .llm import gemini_classify, TriageDecision

def triage_payment(payment: Dict[str, Any]) -> TriageDecision:
    """
    The main routing loop.
    1. Rules check (Hard compliance gate)
    2. Heuristics (Common fast-paths)
    3. LLM Fallback (Ambiguous cases)
    """
    # 1. Hard Compliance Gate (AI cannot override)
    compliance = check_compliance(payment)
    if compliance.action == "escalate":
        return TriageDecision(
            action="escalate", 
            reason=f"compliance_gate: {compliance.reason}", 
            confidence=1.0
        )
    if compliance.action == "require_afa":
        return TriageDecision(
            action="send_payment_link", 
            template=compliance.template, 
            reason=f"compliance_gate: {compliance.reason}", 
            confidence=1.0
        )
        
    # 2. Rule-based Heuristics for common cases
    error_code = payment.get("error_code")
    if error_code == "insufficient_funds":
        return TriageDecision(
            action="retry",
            delay_hours=24,
            reason="insufficient_funds_standard_retry",
            confidence=0.92
        )
    if error_code == "payment_timed_out":
        return TriageDecision(
            action="retry",
            delay_hours=1,
            reason="temporary_network_timeout",
            confidence=0.88
        )
        
    # 3. Gemini Fallback for Ambiguous / Remaining Cases
    redacted_data = redact_for_llm(payment)
    decision = gemini_classify(redacted_data)
    
    # Confidence-gated autonomy: if confidence < 0.9, require human review
    if decision.confidence < 0.9 and decision.action != "escalate":
        original_action = decision.action
        decision.action = "escalate"
        decision.reason = f"low_confidence_override (was {original_action}): {decision.reason}"
        
    return decision
