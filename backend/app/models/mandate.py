from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class MandateState(str, Enum):
    NEW = "NEW"
    ACTIVE = "ACTIVE"
    REISSUED = "REISSUED"
    REVOKED = "REVOKED"
    UNKNOWN = "UNKNOWN"


class Mandate(BaseModel):
    mandate_id: str
    customer_id: str
    state: MandateState = MandateState.UNKNOWN
    network: Optional[str] = None
    max_amount_inr: Optional[float] = None
    frequency: Optional[str] = None
    bank_name: Optional[str] = None
    created_at: Optional[str] = None
    revoked_at: Optional[str] = None
    last_updated: Optional[str] = None
