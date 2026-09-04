"""
Persistent Database Models for Chakra Revenue Recovery Control Plane.
Neon Postgres via SQLAlchemy 2.x.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from sqlalchemy import (
    Column,
    String,
    Float,
    Integer,
    Boolean,
    DateTime,
    Text,
    JSON,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from backend.app.db.session import Base

def utcnow():
    return datetime.now(timezone.utc)

def gen_uuid():
    return uuid.uuid4().hex


class Customer(Base):
    __tablename__ = "customers"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    external_customer_id = Column(String(128), unique=True, index=True, nullable=False)
    display_name = Column(String(255), nullable=True)
    risk_tier = Column(String(32), default="LOW")
    customer_history_summary = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    payments = relationship("Payment", back_populates="customer")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    external_payment_id = Column(String(128), index=True, nullable=True)
    external_order_id = Column(String(128), index=True, nullable=True)
    customer_id = Column(String(64), ForeignKey("customers.id"), nullable=True, index=True)
    amount = Column(Float, nullable=False, default=0.0)
    currency = Column(String(8), default="INR", nullable=False)
    payment_method = Column(String(64), default="UPI")
    status = Column(String(64), default="FAILED", index=True)  # FAILED, CAPTURED, PENDING
    failure_code = Column(String(128), default="unknown")
    provider = Column(String(64), default="synthetic")
    source = Column(String(64), default="api")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    customer = relationship("Customer", back_populates="payments")
    cases = relationship("RecoveryCase", back_populates="payment")


class RecoveryCase(Base):
    __tablename__ = "recovery_cases"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    payment_id = Column(String(64), ForeignKey("payments.id"), nullable=True, index=True)
    case_type = Column(String(64), default="PAYMENT_FAILURE", index=True)
    status = Column(String(64), default="PENDING", index=True)  # PENDING, RECOVERY_PENDING, RECOVERED, BLOCKED, ESCALATED, FAILED
    amount_at_risk = Column(Float, default=0.0, nullable=False)
    risk_probability = Column(Float, default=0.0)
    recovery_eligible = Column(Boolean, default=True)
    current_action = Column(String(64), default="NONE")

    # AI Triage Fields
    ai_used = Column(Boolean, default=False)
    ai_classification = Column(String(64), nullable=True)
    ai_confidence = Column(Float, nullable=True)
    ai_reasoning = Column(Text, nullable=True)
    ai_fallback_used = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    payment = relationship("Payment", back_populates="cases")
    decisions = relationship("RecoveryDecision", back_populates="recovery_case")
    events = relationship("RecoveryEvent", back_populates="recovery_case")


class RecoveryDecision(Base):
    __tablename__ = "recovery_decisions"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    recovery_case_id = Column(String(64), ForeignKey("recovery_cases.id"), nullable=False, index=True)
    selected_action = Column(String(64), nullable=False)
    confidence = Column(Float, default=1.0)
    reasoning_summary = Column(Text, nullable=True)
    base_probability = Column(Float, default=0.5)
    probability_modifier = Column(Float, default=1.0)
    effective_probability = Column(Float, default=0.5)
    expected_recovery = Column(Float, default=0.0)
    score = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    recovery_case = relationship("RecoveryCase", back_populates="decisions")


class RecoveryEvent(Base):
    __tablename__ = "recovery_events"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    recovery_case_id = Column(String(64), ForeignKey("recovery_cases.id"), nullable=False, index=True)
    event_type = Column(String(128), nullable=False, index=True)
    action = Column(String(64), nullable=True)
    status = Column(String(64), nullable=True)
    amount = Column(Float, default=0.0)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    recovery_case = relationship("RecoveryCase", back_populates="events")


class ProviderEvent(Base):
    __tablename__ = "provider_events"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    provider = Column(String(64), nullable=False)
    provider_event_id = Column(String(128), unique=True, index=True, nullable=False)
    event_type = Column(String(128), nullable=False)
    payment_order_ref = Column(String(128), nullable=True, index=True)
    payload_hash = Column(String(128), nullable=True, index=True)
    processed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    recovery_case_id = Column(String(64), nullable=True, index=True)
    payment_id = Column(String(128), nullable=True, index=True)
    event_type = Column(String(128), nullable=False, index=True)
    actor = Column(String(64), default="system")
    action = Column(String(64), nullable=True)
    status = Column(String(64), nullable=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class BatchRun(Base):
    __tablename__ = "batch_runs"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    status = Column(String(64), default="QUEUED", index=True)  # QUEUED, PROCESSING, COMPLETED, FAILED
    scenario = Column(String(64), default="mixed")
    requested_count = Column(Integer, nullable=False, default=100)
    processed_count = Column(Integer, default=0)
    recovered_count = Column(Integer, default=0)
    revenue_at_risk = Column(Float, default=0.0)
    revenue_attempted = Column(Float, default=0.0)
    revenue_recovered = Column(Float, default=0.0)
    revenue_blocked = Column(Float, default=0.0)
    revenue_escalated = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    cases = relationship("BatchCase", back_populates="batch_run")


class BatchCase(Base):
    __tablename__ = "batch_cases"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    batch_id = Column(String(64), ForeignKey("batch_runs.id"), nullable=False, index=True)
    recovery_case_id = Column(String(64), nullable=True, index=True)
    sequence = Column(Integer, nullable=False)
    status = Column(String(64), default="PROCESSED")
    error_message = Column(Text, nullable=True)

    batch_run = relationship("BatchRun", back_populates="cases")


class Receivable(Base):
    __tablename__ = "receivables"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    customer_id = Column(String(128), nullable=False, index=True)
    customer_name = Column(String(255), nullable=False)
    invoice_number = Column(String(128), unique=True, index=True, nullable=False)
    amount = Column(Float, nullable=False, default=0.0)
    due_date = Column(String(32), nullable=False)
    days_overdue = Column(Integer, default=0)
    status = Column(String(64), default="OVERDUE", index=True)  # UPCOMING, OVERDUE, PROMISE_TO_PAY, PAID, IN_RECOVERY
    risk_level = Column(String(32), default="MEDIUM")
    previous_promises = Column(Integer, default=0)
    payment_behavior = Column(String(64), default="USUALLY_ONTIME")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    promises = relationship("PromiseToPay", back_populates="receivable")


class PromiseToPay(Base):
    __tablename__ = "promises_to_pay"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    receivable_id = Column(String(64), ForeignKey("receivables.id"), nullable=False, index=True)
    customer_name = Column(String(255), nullable=False)
    promised_amount = Column(Float, nullable=False)
    promise_date = Column(String(32), nullable=False)
    status = Column(String(64), default="UPCOMING", index=True)  # UPCOMING, DUE_TODAY, FULFILLED, BROKEN
    source = Column(String(64), default="manual")  # manual, voice, link
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    receivable = relationship("Receivable", back_populates="promises")


class VoiceInteraction(Base):
    __tablename__ = "voice_interactions"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    customer_id = Column(String(128), nullable=False, index=True)
    receivable_id = Column(String(64), nullable=True, index=True)
    call_sid = Column(String(128), unique=True, index=True, nullable=False)
    transcript = Column(Text, nullable=True)
    detected_intent = Column(String(64), nullable=True)
    language = Column(String(16), default="hi-IN")
    status = Column(String(64), default="INITIATED")  # INITIATED, RINGING, IN_PROGRESS, COMPLETED, FAILED
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class SafetyState(Base):
    """Persistent safety gate state: idempotency keys and customer intervention budgets.
    Authoritative source — in-memory caches are performance only."""
    __tablename__ = "safety_state"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    state_type = Column(String(64), nullable=False, index=True)  # "idempotency" or "intervention_budget"
    state_key = Column(String(256), nullable=False, index=True)
    state_value = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint('state_type', 'state_key', name='uq_safety_state_type_key'),
    )
