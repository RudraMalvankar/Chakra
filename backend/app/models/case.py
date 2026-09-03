from enum import Enum
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field, model_validator
from backend.app.models.payment import PaymentState, InterventionType, MandateState, TriageResult, RecoveryDecision, SafetyEvaluation, OutcomeResult

class CaseType(str, Enum):
    PAYMENT_FAILURE = "PAYMENT_FAILURE"
    SUBSCRIPTION = "SUBSCRIPTION"
    CHECKOUT_ABANDONMENT = "CHECKOUT_ABANDONMENT"
    RECEIVABLE = "RECEIVABLE"
    PROMISE_TO_PAY = "PROMISE_TO_PAY"

class RevenueRiskAssessment(BaseModel):
    revenue_at_risk_inr: float
    recovery_probability: float
    expected_recovery_inr: float
    priority: str
    urgency: str
    risk_factors: List[str]
    recovery_window: str
    reason: str

class CandidateAction(BaseModel):
    action: str
    score: float
    expected_recovery_inr: float
    eligible: bool
    reason: str

class AgentDecision(BaseModel):
    selected_action: str
    confidence: float
    expected_recovery_inr: float
    priority: str = "MEDIUM"
    decision_factors: List[str]
    candidate_actions: List[CandidateAction] = Field(default_factory=list)

class RecoveryCase(BaseModel):
    case_id: str = "unknown"
    case_type: CaseType = CaseType.PAYMENT_FAILURE
    customer_id: str = "unknown"
    amount_at_risk: float = 0.0
    currency: str = "INR"
    status: PaymentState = PaymentState.RECEIVED
    failure_reason: str = "unknown"
    context: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    risk_assessment: Optional[RevenueRiskAssessment] = None
    
    retry_count: int = 0
    alerts_ignored: int = 0
    fraud_flag: bool = False

    @model_validator(mode="before")
    @classmethod
    def map_legacy_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "payment_id" in data and "case_id" not in data:
                data["case_id"] = data.pop("payment_id")
            if "amount_inr" in data and "amount_at_risk" not in data:
                data["amount_at_risk"] = data.pop("amount_inr")
            if "error_code" in data and "failure_reason" not in data:
                data["failure_reason"] = data.pop("error_code")
            if "current_state" in data and "status" not in data:
                data["status"] = data.pop("current_state")
            
            # Put extra kwargs into context
            context = data.get("context", {})
            for key in list(data.keys()):
                if key not in ["case_id", "case_type", "customer_id", "amount_at_risk", "currency", "status", "failure_reason", "context", "metadata", "retry_count", "alerts_ignored", "fraud_flag", "risk_assessment"]:
                    context[key] = data.pop(key)
            data["context"] = context
        return data

    @property
    def payment_id(self) -> str:
        return self.case_id
        
    @property
    def amount_inr(self) -> float:
        return self.amount_at_risk
        
    @property
    def current_state(self) -> PaymentState:
        return self.status
        
    @current_state.setter
    def current_state(self, val: PaymentState):
        self.status = val

    @property
    def error_code(self) -> str:
        return self.failure_reason

    @property
    def mandate_id(self) -> Optional[str]:
        return self.context.get("mandate_id")

    @property
    def mandate_state(self) -> MandateState:
        return self.context.get("mandate_state", MandateState.UNKNOWN)

    @property
    def network(self) -> str:
        return self.context.get("network", "unknown")

    @property
    def is_first_transaction(self) -> bool:
        return self.context.get("is_first_transaction", False)

    @property
    def bank_name(self) -> str:
        return self.context.get("bank_name", "unknown")

    @property
    def raw_metadata(self) -> Dict[str, Any]:
        return self.context.get("raw_metadata", {})

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return getattr(self, key)
        except AttributeError:
            return default

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)
