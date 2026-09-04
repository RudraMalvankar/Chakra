"""initial_neon_schema

Revision ID: 0e514620f9bb
Revises: 
Create Date: 2026-09-04 19:33:14.575415

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0e514620f9bb'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'customers',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('external_customer_id', sa.String(128), unique=True, index=True, nullable=False),
        sa.Column('display_name', sa.String(255), nullable=True),
        sa.Column('risk_tier', sa.String(32), server_default='LOW'),
        sa.Column('customer_history_summary', sa.JSON, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'payments',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('external_payment_id', sa.String(128), index=True, nullable=True),
        sa.Column('external_order_id', sa.String(128), index=True, nullable=True),
        sa.Column('customer_id', sa.String(64), sa.ForeignKey('customers.id'), nullable=True, index=True),
        sa.Column('amount', sa.Float, nullable=False, server_default='0.0'),
        sa.Column('currency', sa.String(8), nullable=False, server_default='INR'),
        sa.Column('payment_method', sa.String(64), server_default='UPI'),
        sa.Column('status', sa.String(64), server_default='FAILED', index=True),
        sa.Column('failure_code', sa.String(128), server_default='unknown'),
        sa.Column('provider', sa.String(64), server_default='synthetic'),
        sa.Column('source', sa.String(64), server_default='api'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'recovery_cases',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('payment_id', sa.String(64), sa.ForeignKey('payments.id'), nullable=True, index=True),
        sa.Column('case_type', sa.String(64), server_default='PAYMENT_FAILURE', index=True),
        sa.Column('status', sa.String(64), server_default='PENDING', index=True),
        sa.Column('amount_at_risk', sa.Float, nullable=False, server_default='0.0'),
        sa.Column('risk_probability', sa.Float, server_default='0.0'),
        sa.Column('recovery_eligible', sa.Boolean, server_default='1'),
        sa.Column('current_action', sa.String(64), server_default='NONE'),
        sa.Column('ai_used', sa.Boolean, server_default='0'),
        sa.Column('ai_classification', sa.String(64), nullable=True),
        sa.Column('ai_confidence', sa.Float, nullable=True),
        sa.Column('ai_reasoning', sa.Text, nullable=True),
        sa.Column('ai_fallback_used', sa.Boolean, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'recovery_decisions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('recovery_case_id', sa.String(64), sa.ForeignKey('recovery_cases.id'), nullable=False, index=True),
        sa.Column('selected_action', sa.String(64), nullable=False),
        sa.Column('confidence', sa.Float, server_default='1.0'),
        sa.Column('reasoning_summary', sa.Text, nullable=True),
        sa.Column('base_probability', sa.Float, server_default='0.5'),
        sa.Column('probability_modifier', sa.Float, server_default='1.0'),
        sa.Column('effective_probability', sa.Float, server_default='0.5'),
        sa.Column('expected_recovery', sa.Float, server_default='0.0'),
        sa.Column('score', sa.Float, server_default='0.0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'recovery_events',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('recovery_case_id', sa.String(64), sa.ForeignKey('recovery_cases.id'), nullable=False, index=True),
        sa.Column('event_type', sa.String(128), nullable=False, index=True),
        sa.Column('action', sa.String(64), nullable=True),
        sa.Column('status', sa.String(64), nullable=True),
        sa.Column('amount', sa.Float, server_default='0.0'),
        sa.Column('metadata_json', sa.JSON, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'provider_events',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('provider', sa.String(64), nullable=False),
        sa.Column('provider_event_id', sa.String(128), unique=True, index=True, nullable=False),
        sa.Column('event_type', sa.String(128), nullable=False),
        sa.Column('payment_order_ref', sa.String(128), nullable=True, index=True),
        sa.Column('payload_hash', sa.String(128), nullable=True, index=True),
        sa.Column('processed', sa.Boolean, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'audit_events',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('recovery_case_id', sa.String(64), nullable=True, index=True),
        sa.Column('payment_id', sa.String(128), nullable=True, index=True),
        sa.Column('event_type', sa.String(128), nullable=False, index=True),
        sa.Column('actor', sa.String(64), server_default='system'),
        sa.Column('action', sa.String(64), nullable=True),
        sa.Column('status', sa.String(64), nullable=True),
        sa.Column('metadata_json', sa.JSON, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'batch_runs',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('status', sa.String(64), server_default='QUEUED', index=True),
        sa.Column('scenario', sa.String(64), server_default='mixed'),
        sa.Column('requested_count', sa.Integer, nullable=False, server_default='100'),
        sa.Column('processed_count', sa.Integer, server_default='0'),
        sa.Column('recovered_count', sa.Integer, server_default='0'),
        sa.Column('revenue_at_risk', sa.Float, server_default='0.0'),
        sa.Column('revenue_attempted', sa.Float, server_default='0.0'),
        sa.Column('revenue_recovered', sa.Float, server_default='0.0'),
        sa.Column('revenue_blocked', sa.Float, server_default='0.0'),
        sa.Column('revenue_escalated', sa.Float, server_default='0.0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'batch_cases',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('batch_id', sa.String(64), sa.ForeignKey('batch_runs.id'), nullable=False, index=True),
        sa.Column('recovery_case_id', sa.String(64), nullable=True, index=True),
        sa.Column('sequence', sa.Integer, nullable=False),
        sa.Column('status', sa.String(64), server_default='PROCESSED'),
        sa.Column('error_message', sa.Text, nullable=True),
    )

    op.create_table(
        'receivables',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('customer_id', sa.String(128), nullable=False, index=True),
        sa.Column('customer_name', sa.String(255), nullable=False),
        sa.Column('invoice_number', sa.String(128), unique=True, index=True, nullable=False),
        sa.Column('amount', sa.Float, nullable=False, server_default='0.0'),
        sa.Column('due_date', sa.String(32), nullable=False),
        sa.Column('days_overdue', sa.Integer, server_default='0'),
        sa.Column('status', sa.String(64), server_default='OVERDUE', index=True),
        sa.Column('risk_level', sa.String(32), server_default='MEDIUM'),
        sa.Column('previous_promises', sa.Integer, server_default='0'),
        sa.Column('payment_behavior', sa.String(64), server_default='USUALLY_ONTIME'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'promises_to_pay',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('receivable_id', sa.String(64), sa.ForeignKey('receivables.id'), nullable=False, index=True),
        sa.Column('customer_name', sa.String(255), nullable=False),
        sa.Column('promised_amount', sa.Float, nullable=False),
        sa.Column('promise_date', sa.String(32), nullable=False),
        sa.Column('status', sa.String(64), server_default='UPCOMING', index=True),
        sa.Column('source', sa.String(64), server_default='manual'),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'voice_interactions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('customer_id', sa.String(128), nullable=False, index=True),
        sa.Column('receivable_id', sa.String(64), nullable=True, index=True),
        sa.Column('call_sid', sa.String(128), unique=True, index=True, nullable=False),
        sa.Column('transcript', sa.Text, nullable=True),
        sa.Column('detected_intent', sa.String(64), nullable=True),
        sa.Column('language', sa.String(16), server_default='hi-IN'),
        sa.Column('status', sa.String(64), server_default='INITIATED'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        'safety_state',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('state_type', sa.String(64), nullable=False, index=True),
        sa.Column('state_key', sa.String(256), nullable=False, index=True),
        sa.Column('state_value', sa.Text, nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('state_type', 'state_key', name='uq_safety_state_type_key'),
    )


def downgrade() -> None:
    op.drop_table('safety_state')
    op.drop_table('voice_interactions')
    op.drop_table('promises_to_pay')
    op.drop_table('receivables')
    op.drop_table('batch_cases')
    op.drop_table('batch_runs')
    op.drop_table('audit_events')
    op.drop_table('provider_events')
    op.drop_table('recovery_events')
    op.drop_table('recovery_decisions')
    op.drop_table('recovery_cases')
    op.drop_table('payments')
    op.drop_table('customers')
