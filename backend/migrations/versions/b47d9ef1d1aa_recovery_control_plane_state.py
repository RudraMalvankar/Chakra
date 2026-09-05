"""add durable recovery control-plane state

Revision ID: b47d9ef1d1aa
Revises: 0e514620f9bb
Create Date: 2026-09-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b47d9ef1d1aa"
down_revision: Union[str, Sequence[str], None] = "0e514620f9bb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("receivables", sa.Column("recovered_amount", sa.Float, nullable=False, server_default="0.0"))
    op.add_column("batch_runs", sa.Column("pending_count", sa.Integer, server_default="0"))
    op.add_column("batch_runs", sa.Column("revenue_pending", sa.Float, server_default="0.0"))
    op.create_table(
        "communications",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("customer_id", sa.String(128), nullable=True, index=True),
        sa.Column("recovery_case_id", sa.String(64), sa.ForeignKey("recovery_cases.id"), nullable=True, index=True),
        sa.Column("channel", sa.String(32), nullable=False),
        sa.Column("communication_type", sa.String(64), nullable=True),
        sa.Column("body_metadata", sa.JSON, server_default="{}"),
        sa.Column("provider", sa.String(64), nullable=True),
        sa.Column("provider_message_id", sa.String(128), nullable=True, unique=True, index=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "payment_links",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("provider_link_id", sa.String(128), nullable=True, unique=True, index=True),
        sa.Column("recovery_case_id", sa.String(64), sa.ForeignKey("recovery_cases.id"), nullable=True, index=True),
        sa.Column("customer_id", sa.String(128), nullable=True, index=True),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("url", sa.Text, nullable=True),
        sa.Column("amount", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("status", sa.String(32), nullable=False, server_default="CREATED"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "escalations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("recovery_case_id", sa.String(64), sa.ForeignKey("recovery_cases.id"), nullable=False, index=True),
        sa.Column("reason", sa.String(128), nullable=False),
        sa.Column("priority", sa.String(32), nullable=False, server_default="MEDIUM"),
        sa.Column("severity", sa.String(32), nullable=False, server_default="MEDIUM"),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPEN", index=True),
        sa.Column("assigned_to", sa.String(128), nullable=True, index=True),
        sa.Column("sla_deadline", sa.DateTime(timezone=True), nullable=True, index=True),
        sa.Column("resolution", sa.String(128), nullable=True),
        sa.Column("resolution_notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "escalation_actions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("escalation_id", sa.String(64), sa.ForeignKey("escalations.id"), nullable=False, index=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False, server_default="system"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("metadata_json", sa.JSON, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("batch_runs", "revenue_pending")
    op.drop_column("batch_runs", "pending_count")
    op.drop_column("receivables", "recovered_amount")
    op.drop_table("escalation_actions")
    op.drop_table("escalations")
    op.drop_table("payment_links")
    op.drop_table("communications")
