import pytest
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.mandate_router import MandateRouter
from backend.app.models.case import CaseType, InterventionType
from backend.app.models.payment import TriageResult

def test_subscription_nested_days_overdue():
    payload = {
        "event": "subscription.failed",
        "payload": {
            "subscription": {
                "entity": {
                    "id": "sub_1",
                    "notes": {"days_overdue": 7}
                }
            }
        }
    }
    ctx = ContextBuilder.build_context(payload)
    triage = TriageResult(recommended_action=InterventionType.ESCALATE, reason="fail", confidence=1.0, error_code="unknown")
    decision = MandateRouter.route(ctx, triage)
    # days_overdue = 7 => 7 to 13 => VOICE_RECOVERY
    assert decision.decision == InterventionType.VOICE_RECOVERY
    assert decision.reason_code == "SUB_DAY_7_VOICE"

def test_receivable_nested_days_overdue():
    payload = {
        "event": "invoice.overdue",
        "payload": {
            "invoice": {
                "entity": {
                    "id": "inv_1",
                    "metadata": {"days_overdue": 45}
                }
            }
        }
    }
    ctx = ContextBuilder.build_context(payload)
    triage = TriageResult(recommended_action=InterventionType.ESCALATE, reason="fail", confidence=1.0, error_code="unknown")
    decision = MandateRouter.route(ctx, triage)
    # days_overdue = 45 => 31 to 60 => PAYMENT_LINK (invoice_link)
    assert decision.decision == InterventionType.PAYMENT_LINK
    assert decision.reason_code == "INVOICE_LINK"

def test_promise_nested_status():
    payload = {
        "event": "promise.broken",
        "payload": {
            "promise": {
                "entity": {
                    "id": "ptp_1",
                    "notes": {"promise_status": "BROKEN"}
                }
            }
        }
    }
    ctx = ContextBuilder.build_context(payload)
    triage = TriageResult(recommended_action=InterventionType.ESCALATE, reason="fail", confidence=1.0, error_code="unknown")
    decision = MandateRouter.route(ctx, triage)
    assert decision.decision == InterventionType.ESCALATE
    assert decision.reason_code == "PROMISE_BROKEN_NO_RETRY"
