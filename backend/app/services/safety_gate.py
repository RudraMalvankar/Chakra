# backend/app/services/safety_gate.py
import hashlib
from typing import Dict, Any
from backend.app.config import settings
import yaml
from datetime import datetime

with open(settings.rules_path, "r") as f:
    RULES = yaml.safe_load(f)

# Mocked storage for idempotency and rate limiting (In prod: Redis/Postgres)
IDEMPOTENCY_STORE = set()
CUSTOMER_INTERVENTION_COUNTS = {}

def generate_idempotency_key(payment_id: str, intervention: str, day: str) -> str:
    """Hashes payment_id + intervention + day to prevent duplicates."""
    raw = f"{payment_id}_{intervention}_{day}"
    return hashlib.sha256(raw.encode()).hexdigest()

def check_safety_gate(payment: Dict[str, Any], action: str, day: str = None) -> bool:
    """
    Returns True if safe to proceed, False if blocked by idempotency or budget governor.
    """
    if day is None:
        day = datetime.utcnow().strftime("%Y-%m-%d")
        
    payment_id = payment.get("payment_id")
    customer_id = payment.get("customer_id")
    
    # 1. Idempotency Check (Prevent double-charging/messaging)
    key = generate_idempotency_key(payment_id, action, day)
    if key in IDEMPOTENCY_STORE:
        print(f"Safety Gate: Blocked duplicate action {action} for {payment_id}")
        return False 
        
    # 2. Recovery Budget Governor Check (Prevent spamming)
    monthly_limit = RULES["recovery_budget"]["max_interventions_per_customer_per_month"]
    current_count = CUSTOMER_INTERVENTION_COUNTS.get(customer_id, 0)
    
    if current_count >= monthly_limit:
        print(f"Safety Gate: Blocked action {action} for {customer_id}. Budget exceeded.")
        return False
        
    # Lock it in
    IDEMPOTENCY_STORE.add(key)
    CUSTOMER_INTERVENTION_COUNTS[customer_id] = current_count + 1
    
    return True
