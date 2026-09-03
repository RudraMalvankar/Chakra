import pytest
import sys
sys.path.append('mock-razorpay')
from seed import SEED_DATA
from backend.app.services.context_builder import ContextBuilder
from backend.app.models.case import CaseType

def test_benchmark_case_distribution():
    assert len(SEED_DATA) == 120, "Benchmark must contain exactly 120 cases."
    
    distribution = {
        CaseType.PAYMENT_FAILURE: 0,
        CaseType.SUBSCRIPTION: 0,
        CaseType.CHECKOUT_ABANDONMENT: 0,
        CaseType.RECEIVABLE: 0,
        CaseType.PROMISE_TO_PAY: 0,
    }
    
    for payload in SEED_DATA:
        ctx = ContextBuilder.build_context(payload)
        distribution[ctx.case_type] += 1
        
    assert distribution[CaseType.PAYMENT_FAILURE] == 24
    assert distribution[CaseType.SUBSCRIPTION] == 24
    assert distribution[CaseType.CHECKOUT_ABANDONMENT] == 24
    assert distribution[CaseType.RECEIVABLE] == 24
    assert distribution[CaseType.PROMISE_TO_PAY] == 24
