"""
Compatibility layer re-exporting SafetyGate symbols for existing tests and scripts.
"""
from backend.app.services.safety_gate import (
    SafetyGate,
    enforce_safety,
    generate_idempotency_key,
    reset_safety_state,
    IDEMPOTENCY_CACHE,
    CUSTOMER_INTERVENTION_CACHE,
)

__all__ = [
    "SafetyGate",
    "enforce_safety",
    "generate_idempotency_key",
    "reset_safety_state",
    "IDEMPOTENCY_CACHE",
    "CUSTOMER_INTERVENTION_CACHE",
]
