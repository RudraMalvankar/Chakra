from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from backend.app.models.mandate import MandateState


class PaymentState(str, Enum):
    RECEIVED = "RECEIVED"
    FAILED = "FAILED"
    TRIAGED = "TRIAGED"
    SAFETY_CHECK = "SAFETY_CHECK"
    ELIGIBLE = "ELIGIBLE"
    BLOCKED = "BLOCKED"
    INTERVENTION_SELECTED = "INTERVENTION_SELECTED"
    INTERVENTION_ATTEMPTED = "INTERVENTION_ATTEMPTED"
    RECOVERY_PENDING = "RECOVERY_PENDING"
    RECOVERED = "RECOVERED"
    RECOVERY_FAILED = "RECOVERY_FAILED"
    ESCALATED = "ESCALATED"


class InterventionType(str, Enum):
    RETRY_NOW = "RETRY_NOW"
    RETRY_LATER = "RETRY_LATER"
    PAYMENT_LINK = "PAYMENT_LINK"
    AFA_PAYMENT_LINK = "AFA_PAYMENT_LINK"
    ESCALATE = "ESCALATE"
    BLOCK = "BLOCK"


class PaymentContext(BaseModel):
    payment_id: str
    customer_id: str = "unknown"
    amount_inr: float
    error_code: str
    mandate_id: Optional[str] = None
    mandate_state: MandateState = MandateState.UNKNOWN
    network: str = "unknown"
    is_first_transaction: bool = False
    retry_count: int = 0
    alerts_ignored: int = 0
    fraud_flag: bool = False
    currency: str = "INR"
    bank_name: Optional[str] = "unknown"
    current_state: PaymentState = PaymentState.RECEIVED
    metadata: Dict[str, Any] = Field(default_factory=dict)
    raw_metadata: Dict[str, Any] = Field(default_factory=dict)


class TriageResult(BaseModel):
    error_code: str
    is_ambiguous: bool = False
    recommended_action: InterventionType = InterventionType.ESCALATE
    reason: str = ""
    confidence: float = 1.0
    template_id: Optional[str] = None
    delay_hours: Optional[int] = None
    requires_human: bool = False

    @property
    def action(self) -> str:
        """Helper property mapping recommended_action to string for eval runner and legacy code."""
        if self.recommended_action in [InterventionType.RETRY_NOW, InterventionType.RETRY_LATER]:
            return "retry"
        elif self.recommended_action in [InterventionType.PAYMENT_LINK, InterventionType.AFA_PAYMENT_LINK]:
            return "send_payment_link"
        elif self.recommended_action == InterventionType.BLOCK:
            return "block"
        return "escalate"


class RecoveryDecision(BaseModel):
    decision: InterventionType
    eligibility: str = "PENDING_SAFETY"  # "ALLOWED", "BLOCKED", "ESCALATED", "PENDING_SAFETY"
    reason_code: str
    policy_id: str
    confidence: float = 1.0
    requires_human: bool = False
    delay_hours: Optional[int] = None
    template_id: Optional[str] = None


class SafetyEvaluation(BaseModel):
    allowed: bool = True
    final_decision: Optional[InterventionType] = None
    decision: Optional[InterventionType] = None
    eligibility: str = "ALLOWED"  # "ALLOWED", "BLOCKED", "ESCALATED"
    reason_code: str = ""
    idempotency_key: Optional[str] = None
    budget_count: int = 0
    policy_id: str = "safety_gate_v1"
    modified_from_proposed: bool = False
    original_decision: Optional[InterventionType] = None
    enforced_rules: List[str] = Field(default_factory=list)


class OutcomeResult(BaseModel):
    payment_id: str
    status: str  # e.g. "captured", "failed", "pending"
    recovered: bool = False
    amount_recovered_inr: float = 0.0
    raw_response: Dict[str, Any] = Field(default_factory=dict)
    evaluated_at: Optional[str] = None
