from typing import List, Dict, Any

from backend.app.lib.config_utils import get_regulatory_threshold

REGULATORY_THRESHOLD = get_regulatory_threshold()

from backend.app.models.case import RecoveryCase, RevenueRiskAssessment, CaseType

class RevenueRiskEngine:
    @staticmethod
    def assess(case: RecoveryCase) -> RevenueRiskAssessment:
        risk_factors = []
        probability = 0.5
        urgency = "MEDIUM"
        priority = "MEDIUM"
        window = "48h"
        
        # Base rules by case type
        if case.case_type == CaseType.PAYMENT_FAILURE:
            if case.error_code in ["insufficient_funds", "payment_timed_out"]:
                probability += 0.2
                risk_factors.append("soft_failure")
            elif case.error_code in ["card_declined", "expired_card"]:
                probability -= 0.1
                risk_factors.append("hard_failure_or_card_issue")
            if case.retry_count < 2:
                probability += 0.1
                risk_factors.append("low_retry_count")
            
        elif case.case_type == CaseType.SUBSCRIPTION:
            days_overdue = int(case.metadata.get("days_overdue", case.context.get("days_overdue", case.context.get("notes", {}).get("days_overdue", 0))))
            past_failures = int(case.context.get("past_failed_payments_count", 0))
            sub_age = int(case.context.get("subscription_age_days", 999))
            churn_risk = str(case.context.get("churn_risk", "LOW")).upper()
            grace_remaining = int(case.context.get("grace_period_remaining", 7))

            urgency = "HIGH" if days_overdue > 14 else "MEDIUM"
            if days_overdue == 0:
                probability += 0.3
                risk_factors.append("day0_high_recovery")
            elif days_overdue < 7:
                probability += 0.1
                risk_factors.append("within_grace_period")
            elif days_overdue < 14:
                probability -= 0.1
                risk_factors.append("approaching_cancellation")
            else:
                probability -= 0.2
                risk_factors.append("high_days_overdue")

            if past_failures >= 3:
                probability -= 0.15
                risk_factors.append("multiple_past_failures")
            if sub_age < 30:
                probability -= 0.1
                risk_factors.append("new_subscriber_churn_risk")
            if churn_risk == "HIGH":
                probability -= 0.15
                risk_factors.append("high_churn_risk")
            elif churn_risk == "MEDIUM":
                probability -= 0.05
                risk_factors.append("medium_churn_risk")
            if grace_remaining <= 0:
                risk_factors.append("grace_period_expired")
                urgency = "HIGH"
            window = "24h"
            
        elif case.case_type == CaseType.CHECKOUT_ABANDONMENT:
            probability = 0.4
            urgency = "HIGH"
            window = "2h"
            risk_factors.append("high_intent_dropoff")
            
        elif case.case_type == CaseType.RECEIVABLE:
            days_overdue = int(case.metadata.get("days_overdue", case.context.get("days_overdue", case.context.get("notes", {}).get("days_overdue", 0))))
            if days_overdue > 60:
                probability = 0.2
                urgency = "HIGH"
                risk_factors.append("severely_overdue")
            elif days_overdue > 30:
                probability = 0.5
                urgency = "MEDIUM"
            else:
                probability = 0.8
                urgency = "LOW"
            window = "7d"
            
        elif case.case_type == CaseType.PROMISE_TO_PAY:
            status = case.metadata.get("promise_status", case.context.get("promise_status", case.context.get("notes", {}).get("promise_status", "UNKNOWN")))
            if status == "BROKEN":
                probability = 0.1
                urgency = "HIGH"
                risk_factors.append("broken_promise")
                window = "12h"
            else:
                probability = 0.9
                urgency = "LOW"
                risk_factors.append("active_promise")
                window = "till_due_date"
        
        # Modifiers
        if case.amount_at_risk > REGULATORY_THRESHOLD:
            priority = "HIGH"
            risk_factors.append("high_value_transaction")
            
        if hasattr(case.mandate_state, "value"):
            if case.mandate_state.value == "ACTIVE":
                probability += 0.15
                risk_factors.append("active_mandate")
        elif case.mandate_state == "ACTIVE":
            probability += 0.15
            risk_factors.append("active_mandate")
            
        if case.is_first_transaction:
            risk_factors.append("first_transaction_afa_required")
            
        if case.fraud_flag:
            probability = 0.0
            urgency = "IMMEDIATE"
            priority = "CRITICAL"
            risk_factors.append("fraud_flag")
            
        # Clamp probability
        probability = max(0.0, min(1.0, probability))
        
        expected_recovery = case.amount_at_risk * probability
        
        reason = f"Calculated based on {case.case_type.value} with factors: {', '.join(risk_factors[:2]) if risk_factors else 'standard'}"

        assessment = RevenueRiskAssessment(
            revenue_at_risk_inr=float(case.amount_at_risk),
            recovery_probability=round(probability, 2),
            expected_recovery_inr=round(expected_recovery, 2),
            priority=priority,
            urgency=urgency,
            risk_factors=risk_factors,
            recovery_window=window,
            reason=reason
        )
        
        case.risk_assessment = assessment
        return assessment
