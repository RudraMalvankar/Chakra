"""
Subscription Module Tests.
Covers triage, risk assessment, agent decision, context builder, and e2e pipeline.
"""
import pytest
from backend.app.models.case import RecoveryCase, CaseType, InterventionType
from backend.app.models.payment import PaymentState


class TestSubscriptionTriage:
    def test_subscription_failed_fast_path(self):
        from backend.app.services.triage import TriageEngine
        case = RecoveryCase(
            case_id="sub_triage_001",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=999.0,
            failure_reason="subscription.failed",
            customer_id="cust_triage_sub",
            context={"days_overdue": 3, "churn_risk": "LOW"},
        )
        result = TriageEngine.triage(case)
        assert result.is_ambiguous is False
        assert result.recommended_action == InterventionType.RETRY_LATER
        assert result.confidence >= 0.8

    def test_subscription_halted_fast_path(self):
        from backend.app.services.triage import TriageEngine
        case = RecoveryCase(
            case_id="sub_triage_002",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=2999.0,
            failure_reason="subscription.halted",
            customer_id="cust_triage_sub2",
            context={},
        )
        result = TriageEngine.triage(case)
        assert result.is_ambiguous is False
        assert result.recommended_action == InterventionType.ESCALATE
        assert result.requires_human is True


class TestSubscriptionRiskEngine:
    def test_day0_high_probability(self):
        from backend.app.services.revenue_risk_engine import RevenueRiskEngine
        case = RecoveryCase(
            case_id="sub_risk_001",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=1500.0,
            failure_reason="subscription.failed",
            customer_id="cust_risk_sub",
            context={"days_overdue": 0, "churn_risk": "LOW", "past_failed_payments_count": 0, "subscription_age_days": 90, "grace_period_remaining": 7},
        )
        assessment = RevenueRiskEngine.assess(case)
        assert assessment.recovery_probability >= 0.7

    def test_day14_low_probability(self):
        from backend.app.services.revenue_risk_engine import RevenueRiskEngine
        case = RecoveryCase(
            case_id="sub_risk_002",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=5000.0,
            failure_reason="subscription.failed",
            customer_id="cust_risk_sub2",
            context={"days_overdue": 14, "churn_risk": "HIGH", "past_failed_payments_count": 3, "subscription_age_days": 15, "grace_period_remaining": 0},
        )
        assessment = RevenueRiskEngine.assess(case)
        assert assessment.recovery_probability <= 0.35
        assert "high_churn_risk" in assessment.risk_factors


class TestSubscriptionRecoveryAgent:
    def test_day0_retry_now(self):
        from backend.app.services.recovery_agent import RecoveryAgent
        case = RecoveryCase(
            case_id="sub_agent_001",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=999.0,
            failure_reason="subscription.failed",
            customer_id="cust_agent_sub",
            context={"days_overdue": 0, "churn_risk": "LOW", "past_failed_payments_count": 0, "grace_period_remaining": 7},
        )
        from backend.app.services.revenue_risk_engine import RevenueRiskEngine
        RevenueRiskEngine.assess(case)
        decision = RecoveryAgent.decide(case)
        assert decision.selected_action in ("RETRY_NOW", "PAYMENT_LINK")

    def test_day14_escalate(self):
        from backend.app.services.recovery_agent import RecoveryAgent
        case = RecoveryCase(
            case_id="sub_agent_002",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=5000.0,
            failure_reason="subscription.failed",
            customer_id="cust_agent_sub2",
            context={"days_overdue": 14, "churn_risk": "HIGH", "past_failed_payments_count": 3, "grace_period_remaining": 0},
        )
        from backend.app.services.revenue_risk_engine import RevenueRiskEngine
        RevenueRiskEngine.assess(case)
        decision = RecoveryAgent.decide(case)
        assert decision.selected_action == "ESCALATE"

    def test_high_churn_risk_escalation(self):
        from backend.app.services.recovery_agent import RecoveryAgent
        case = RecoveryCase(
            case_id="sub_agent_003",
            case_type=CaseType.SUBSCRIPTION,
            amount_at_risk=2999.0,
            failure_reason="subscription.failed",
            customer_id="cust_agent_sub3",
            context={"days_overdue": 10, "churn_risk": "HIGH", "past_failed_payments_count": 2, "grace_period_remaining": 0},
        )
        from backend.app.services.revenue_risk_engine import RevenueRiskEngine
        RevenueRiskEngine.assess(case)
        decision = RecoveryAgent.decide(case)
        escalation_candidate = next((c for c in decision.candidate_actions if c.action == "ESCALATE"), None)
        assert escalation_candidate is not None
        assert escalation_candidate.score >= 50000


class TestSubscriptionContextBuilder:
    def test_subscription_context_fields(self):
        from backend.app.services.context_builder import ContextBuilder
        payload = {
            "event": "subscription.failed",
            "payload": {
                "subscription": {
                    "entity": {
                        "id": "sub_ctx_001",
                        "customer_id": "cust_ctx_sub",
                        "amount": 49900,
                        "currency": "INR",
                        "status": "failed",
                        "notes": {
                            "days_overdue": 5,
                            "churn_risk": "MEDIUM",
                            "past_failed_payments_count": 2,
                            "grace_period_remaining": 2,
                        }
                    }
                }
            }
        }
        ctx = ContextBuilder.build_context(payload)
        assert ctx.case_type == CaseType.SUBSCRIPTION
        assert ctx.amount_at_risk == 499.0
        assert ctx.context.get("subscription_id") == "sub_ctx_001"
        assert ctx.context.get("churn_risk") == "MEDIUM"
        assert ctx.context.get("past_failed_payments_count") == 2
        assert ctx.context.get("grace_period_remaining") == 2

    def test_subscription_case_type_from_explicit_payload(self):
        from backend.app.services.context_builder import ContextBuilder
        payload = {
            "payment_id": "pay_sub_explicit",
            "amount_inr": 1999,
            "error_code": "subscription.failed",
            "case_type": "SUBSCRIPTION",
            "customer_id": "cust_explicit",
            "context": {"days_overdue": 3},
        }
        ctx = ContextBuilder.build_context(payload)
        assert ctx.case_type == CaseType.SUBSCRIPTION


class TestSubscriptionE2EPipeline:
    @pytest.mark.asyncio
    async def test_subscription_day0_pipeline_dry_run(self):
        from backend.app.services.recovery_executor import execute_recovery_pipeline
        payload = {
            "payment_id": "sub_e2e_001",
            "amount_inr": 999,
            "error_code": "subscription.failed",
            "case_type": "SUBSCRIPTION",
            "customer_id": "cust_e2e_sub",
            "context": {"days_overdue": 0, "churn_risk": "LOW", "past_failed_payments_count": 0, "grace_period_remaining": 7},
        }
        result = await execute_recovery_pipeline(payload, dry_run=True)
        assert result.current_state in (PaymentState.RECOVERY_PENDING, PaymentState.INTERVENTION_ATTEMPTED)

    @pytest.mark.asyncio
    async def test_subscription_day14_pipeline_dry_run(self):
        from backend.app.services.recovery_executor import execute_recovery_pipeline
        payload = {
            "payment_id": "sub_e2e_002",
            "amount_inr": 5000,
            "error_code": "subscription.failed",
            "case_type": "SUBSCRIPTION",
            "customer_id": "cust_e2e_sub2",
            "context": {"days_overdue": 14, "churn_risk": "HIGH", "past_failed_payments_count": 3, "grace_period_remaining": 0},
        }
        result = await execute_recovery_pipeline(payload, dry_run=True)
        assert result.current_state in (PaymentState.ESCALATED, PaymentState.RECOVERY_PENDING, PaymentState.INTERVENTION_ATTEMPTED)

    @pytest.mark.asyncio
    async def test_subscription_mandate_revoked_blocks(self):
        from backend.app.services.recovery_executor import execute_recovery_pipeline
        payload = {
            "payment_id": "sub_e2e_003",
            "amount_inr": 2999,
            "error_code": "mandate_revoked",
            "case_type": "SUBSCRIPTION",
            "customer_id": "cust_e2e_sub3",
            "context": {"mandate_state": "REVOKED", "days_overdue": 0},
        }
        result = await execute_recovery_pipeline(payload, dry_run=True)
        assert result.current_state == PaymentState.BLOCKED
