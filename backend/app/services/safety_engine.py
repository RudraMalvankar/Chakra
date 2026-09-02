"""
Compatibility layer re-exporting SafetyGate symbols for existing tests and scripts.
"""
from backend.app.services.safety_gate import (
    SafetyGate,
    enforce_safety,
    generate_idempotency_key,
    reset_safety_state,
    IDEMPOTENCY_STORE,
    CUSTOMER_INTERVENTION_COUNTS,
)

__all__ = [
    "SafetyGate",
    "enforce_safety",
    "generate_idempotency_key",
    "reset_safety_state",
    "IDEMPOTENCY_STORE",
    "CUSTOMER_INTERVENTION_COUNTS",
]
