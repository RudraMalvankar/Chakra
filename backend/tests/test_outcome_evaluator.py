from backend.app.models.case import RecoveryCase
import pytest
from datetime import datetime
from backend.app.models.case import PaymentState, OutcomeResult
from backend.app.services.outcome_evaluator import OutcomeEvaluator, evaluate_outcome


def test_outcome_evaluator_captured_status():
    ctx = RecoveryCase(payment_id="p_rec_1", amount_inr=1500.0, error_code="insufficient_funds")
    raw = {"status": "captured", "id": "p_rec_1"}
    
    res = OutcomeEvaluator.evaluate(raw, ctx)
    
    assert isinstance(res, OutcomeResult)
    assert res.payment_id == "p_rec_1"
    assert res.status == "captured"
    assert res.recovered is True
    assert res.amount_recovered_inr == 1500.0
    assert ctx.current_state == PaymentState.RECOVERED
    assert res.evaluated_at is not None


def test_outcome_evaluator_outcome_success():
    ctx = RecoveryCase(payment_id="p_rec_2", amount_inr=750.0, error_code="payment_timed_out")
    raw = {"status": "created", "outcome": "success"}
    
    res = evaluate_outcome(raw, ctx)
    
    assert res.recovered is True
    assert res.status == "captured"
    assert res.amount_recovered_inr == 750.0
    assert ctx.current_state == PaymentState.RECOVERED


def test_outcome_evaluator_outcome_captured():
    ctx = RecoveryCase(payment_id="p_rec_3", amount_inr=2499.0, error_code="card_declined")
    raw = {"status": "created", "outcome": "captured"}
    
    res = OutcomeEvaluator.evaluate(raw, ctx)
    
    assert res.recovered is True
    assert res.status == "captured"
    assert res.amount_recovered_inr == 2499.0
    assert ctx.current_state == PaymentState.RECOVERED


def test_outcome_evaluator_failed_status():
    ctx = RecoveryCase(payment_id="p_fail_1", amount_inr=1200.0, error_code="insufficient_funds")
    raw = {"status": "failed", "id": "p_fail_1"}
    
    res = OutcomeEvaluator.evaluate(raw, ctx)
    
    assert res.recovered is False
    assert res.status == "failed"
    assert res.amount_recovered_inr == 0.0
    assert ctx.current_state == PaymentState.RECOVERY_FAILED


def test_outcome_evaluator_pending_status():
    ctx = RecoveryCase(payment_id="p_pend_1", amount_inr=500.0, error_code="card_declined")
    raw = {"status": "created", "outcome": "pending"}
    
    res = OutcomeEvaluator.evaluate(raw, ctx)
    
    assert res.recovered is False
    assert res.status == "created" or res.status == "pending"
    assert res.amount_recovered_inr == 0.0
    # A provider-created payment link is awaiting customer payment, not a
    # failed recovery. Only an explicit provider failure may enter FAILED.
    assert ctx.current_state == PaymentState.RECOVERY_PENDING


def test_outcome_evaluator_gateway_error():
    ctx = RecoveryCase(payment_id="p_err_1", amount_inr=999.0, error_code="payment_timed_out")
    raw = {"error": "gateway_timeout", "code": 504}
    
    res = OutcomeEvaluator.evaluate(raw, ctx)
    
    assert res.recovered is False
    assert res.status == "error"
    assert res.amount_recovered_inr == 0.0
    assert ctx.current_state == PaymentState.RECOVERY_FAILED


def test_outcome_evaluator_none_or_empty_response():
    ctx = RecoveryCase(payment_id="p_empty_1", amount_inr=499.0, error_code="expired_card")
    
    res_none = OutcomeEvaluator.evaluate(None, ctx)
    assert res_none.recovered is False
    assert ctx.current_state == PaymentState.RECOVERY_FAILED
    
    ctx2 = RecoveryCase(payment_id="p_empty_2", amount_inr=499.0, error_code="expired_card")
    res_empty = OutcomeEvaluator.evaluate({}, ctx2)
    assert res_empty.recovered is False
    assert ctx2.current_state == PaymentState.RECOVERY_FAILED


def test_outcome_evaluator_dict_payload_conversion():
    payload = {
        "payment_id": "p_dict_1",
        "amount": 100000,  # 1000 INR
        "error_code": "insufficient_funds"
    }
    raw = {"status": "captured"}
    
    res = OutcomeEvaluator.evaluate(raw, payload)
    assert res.payment_id == "p_dict_1"
    assert res.recovered is True
    assert res.amount_recovered_inr == 1000.0


def test_outcome_evaluator_rejects_fake_status():
    ctx = RecoveryCase(payment_id="p_fake_1", amount_inr=3000.0, error_code="insufficient_funds")
    raw = {"status": "almost_captured", "outcome": "partial"}
    
    res = OutcomeEvaluator.evaluate(raw, ctx)
    assert res.recovered is False
    assert res.amount_recovered_inr == 0.0
    assert ctx.current_state == PaymentState.RECOVERY_FAILED
