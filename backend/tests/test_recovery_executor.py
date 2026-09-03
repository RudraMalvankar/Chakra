from backend.app.models.case import RecoveryCase
import pytest
from unittest.mock import patch, AsyncMock
from backend.app.models.case import RecoveryDecision, InterventionType, PaymentState
from backend.app.services.recovery_executor import RecoveryExecutor, execute_recovery_pipeline


@pytest.mark.asyncio
async def test_executor_blocked_decision():
    ctx = RecoveryCase(payment_id="p_blk", amount_inr=1000.0, error_code="fraud_flag")
    decision = RecoveryDecision(
        decision=InterventionType.BLOCK,
        eligibility="BLOCKED",
        reason_code="HARD_COMPLIANCE_BLOCK",
        policy_id="safety_v1",
    )
    res = await RecoveryExecutor.execute(ctx, decision)
    assert res.current_state == PaymentState.BLOCKED


@pytest.mark.asyncio
async def test_executor_escalated_decision():
    ctx = RecoveryCase(payment_id="p_esc", amount_inr=1000.0, error_code="insufficient_funds")
    decision = RecoveryDecision(
        decision=InterventionType.ESCALATE,
        eligibility="ESCALATED",
        reason_code="HIGH_CHURN_RISK",
        policy_id="safety_v1",
        requires_human=True,
    )
    res = await RecoveryExecutor.execute(ctx, decision)
    assert res.current_state == PaymentState.ESCALATED


@pytest.mark.asyncio
async def test_executor_dry_run_mode():
    ctx = RecoveryCase(payment_id="p_dry", amount_inr=1000.0, error_code="insufficient_funds")
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="ALLOWED",
        reason_code="TRANSIENT_FAILURE",
        policy_id="retry_v1",
        delay_hours=24,
    )
    res = await RecoveryExecutor.execute(ctx, decision, dry_run=True)
    assert res.current_state == PaymentState.INTERVENTION_ATTEMPTED


@pytest.mark.asyncio
async def test_executor_live_retry_success():
    ctx = RecoveryCase(payment_id="p_ret_ok", amount_inr=1000.0, error_code="insufficient_funds")
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_NOW,
        eligibility="ALLOWED",
        reason_code="TRANSIENT_FAILURE",
        policy_id="retry_v1",
        delay_hours=0,
    )
    with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", new_callable=AsyncMock) as mock_retry:
        mock_retry.return_value = {"status": "captured", "payment_id": "p_ret_ok"}
        res = await RecoveryExecutor.execute(ctx, decision, dry_run=False)
        assert res.current_state == PaymentState.RECOVERED
        mock_retry.assert_called_once()


@pytest.mark.asyncio
async def test_executor_live_retry_failure():
    ctx = RecoveryCase(payment_id="p_ret_fail", amount_inr=1000.0, error_code="insufficient_funds")
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_NOW,
        eligibility="ALLOWED",
        reason_code="TRANSIENT_FAILURE",
        policy_id="retry_v1",
        delay_hours=0,
    )
    with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", new_callable=AsyncMock) as mock_retry:
        mock_retry.return_value = {"status": "failed", "payment_id": "p_ret_fail"}
        res = await RecoveryExecutor.execute(ctx, decision, dry_run=False)
        assert res.current_state == PaymentState.RECOVERY_FAILED
        mock_retry.assert_called_once()


@pytest.mark.asyncio
async def test_executor_deferred_retry():
    ctx = RecoveryCase(payment_id="p_ret_def", amount_inr=1000.0, error_code="insufficient_funds")
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_LATER,
        eligibility="ALLOWED",
        reason_code="TRANSIENT_FAILURE",
        policy_id="retry_v1",
        delay_hours=24,
    )
    with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", new_callable=AsyncMock) as mock_retry:
        res = await RecoveryExecutor.execute(ctx, decision, dry_run=False)
        assert res.current_state == PaymentState.RECOVERY_PENDING
        mock_retry.assert_not_called()


@pytest.mark.asyncio
async def test_executor_live_payment_link_success():
    ctx = RecoveryCase(
        payment_id="p_link_ok",
        customer_id="cust_123",
        amount_inr=999.0,
        error_code="expired_card",
    )
    decision = RecoveryDecision(
        decision=InterventionType.PAYMENT_LINK,
        eligibility="ALLOWED",
        reason_code="ALTERNATIVE_PAYMENT_LINK_EXPIRED_CARD",
        policy_id="link_v1",
        template_id="dlt_card_update_v1",
    )
    with patch("backend.app.services.recovery_executor.razorpay_client.create_payment_link", new_callable=AsyncMock) as mock_link:
        mock_link.return_value = {"status": "captured", "id": "plink_123"}
        res = await RecoveryExecutor.execute(ctx, decision, dry_run=False)
        assert res.current_state == PaymentState.RECOVERED
        mock_link.assert_awaited_once_with(
            customer_id="cust_123",
            amount=99900,
            template="dlt_card_update_v1",
            payment_id="p_link_ok",
        )


@pytest.mark.asyncio
async def test_executor_api_exception_handling():
    ctx = RecoveryCase(payment_id="p_err", amount_inr=1000.0, error_code="insufficient_funds")
    decision = RecoveryDecision(
        decision=InterventionType.RETRY_NOW,
        eligibility="ALLOWED",
        reason_code="TRANSIENT_FAILURE",
        policy_id="retry_v1",
    )
    with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", new_callable=AsyncMock) as mock_retry:
        mock_retry.side_effect = Exception("Connection timeout")
        res = await RecoveryExecutor.execute(ctx, decision, dry_run=False)
        assert res.current_state == PaymentState.RECOVERY_FAILED


@pytest.mark.asyncio
async def test_full_pipeline_orchestrator():
    payload = {
        "payment_id": "p_pipe_1",
        "customer_id": "cust_pipe",
        "amount": 49900,
        "error_code": "insufficient_funds",
        "mandate_state": "ACTIVE",
    }
    final_ctx = await execute_recovery_pipeline(payload, dry_run=True)
    assert final_ctx.payment_id == "p_pipe_1"
    assert final_ctx.amount_inr == 499.0
    assert final_ctx.current_state == PaymentState.INTERVENTION_ATTEMPTED
