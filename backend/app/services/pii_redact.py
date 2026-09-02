import hashlib
from typing import Dict, Any

def redact_for_llm(payment: Dict[str, Any]) -> Dict[str, Any]:
    """
    Strips PII (exact amounts, names, phone numbers) before sending to Gemini.
    Logs `pii_redacted: True` to guarantee compliance.
    """
    redacted = {}
    
    # 1. Bucket Amount (e.g., instead of 16000 INR, say '15k-100k')
    amt_inr = payment.get("amount", 0) / 100
    if amt_inr < 5000:
        amt_bucket = "<5k"
    elif amt_inr <= 15000:
        amt_bucket = "5k-15k"
    elif amt_inr <= 100000:
        amt_bucket = "15k-100k"
    else:
        amt_bucket = ">100k"
        
    redacted["amount_bucket"] = amt_bucket
    redacted["error_code"] = payment.get("error_code")
    redacted["is_first_transaction"] = payment.get("is_first_transaction")
    
    # 2. Hash Bank Name
    metadata = payment.get("metadata", {})
    bank = metadata.get("bank_name", "unknown")
    redacted["bank_hash"] = hashlib.sha256(bank.encode()).hexdigest()[:8]
    
    # 3. Safe Metadata
    redacted["network"] = metadata.get("network")
    redacted["alerts_ignored"] = metadata.get("pre_debit_alerts_ignored", 0)
    
    # 4. Explicitly mark as redacted
    redacted["pii_redacted"] = True
    
    return redacted
