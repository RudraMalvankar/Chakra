from typing import Dict, Any, Optional
import yaml
from dataclasses import dataclass

with open("backend/app/data/rules.yaml", "r") as f:
    RULES = yaml.safe_load(f)

@dataclass
class ComplianceResult:
    action: Optional[str] # "escalate", "require_afa", or None
    reason: Optional[str]
    template: Optional[str] = None

def check_compliance(payment: Dict[str, Any]) -> ComplianceResult:
    """Evaluates payment against hard-coded RBI and Network rules. LLM cannot override this."""
    
    # 1. Hard Decline Codes (Fraud, Revoked Mandate)
    if payment.get("error_code") in RULES["hard_decline_codes"]:
        return ComplianceResult(action="escalate", reason=payment["error_code"])
        
    # 2. First Transaction AFA Rule
    if payment.get("is_first_transaction") and RULES["first_transaction_afa_required"]:
        return ComplianceResult(action="require_afa", reason="first_transaction", template="dlt_first_txn_v1")
        
    # 3. AFA Threshold (> 15k INR)
    # Note: payment amount is in paise (100 paise = 1 INR)
    amt_inr = payment.get("amount", 0) / 100 
    if amt_inr > RULES["afa_thresholds"]["standard"]:
        return ComplianceResult(action="require_afa", reason="afa_threshold_exceeded", template="dlt_afa_threshold_v1")
        
    # 4. Network Retry Caps (Visa 15/30d, Mastercard 10/30d)
    metadata = payment.get("metadata", {})
    network = metadata.get("network")
    retries = metadata.get("retries_this_month", 0)
    
    if network and network in RULES["network_retry_caps"]:
        cap = RULES["network_retry_caps"][network]["max_retries"]
        if retries >= cap:
            return ComplianceResult(action="escalate", reason="network_retry_cap_exceeded")
            
    # 5. Pre-debit alerts ignored (if >= 2, escalate to prevent burning network retry slot)
    alerts_ignored = metadata.get("pre_debit_alerts_ignored", 0)
    if alerts_ignored >= 2:
        return ComplianceResult(action="escalate", reason="high_alerts_ignored_churn_risk")

    # Safe to proceed to standard triage/AI fallback
    return ComplianceResult(action=None, reason=None)
