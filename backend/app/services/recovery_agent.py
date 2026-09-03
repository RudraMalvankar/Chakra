from backend.app.models.case import RecoveryCase, AgentDecision, AlternativeAction, InterventionType, CaseType

class RecoveryAgent:
    @staticmethod
    def decide(case: RecoveryCase) -> AgentDecision:
        # Determine candidate action
        selected_action = InterventionType.RETRY_LATER
        decision_factors = []
        confidence = 0.85
        alternatives = []
        
        # Base logic by Case Type
        if case.case_type == CaseType.PAYMENT_FAILURE:
            if case.error_code in ["insufficient_funds", "payment_timed_out"]:
                selected_action = InterventionType.RETRY_LATER
                decision_factors.append("soft payment failure detected")
                decision_factors.append("customer likely to have funds later")
                alternatives.append(AlternativeAction(action="RETRY_NOW", reason_rejected="lower expected recovery due to timing"))
            elif case.error_code in ["card_declined", "expired_card"]:
                selected_action = InterventionType.PAYMENT_LINK
                decision_factors.append("hard failure requires customer action")
                decision_factors.append("updating payment method needed")
                alternatives.append(AlternativeAction(action="RETRY_LATER", reason_rejected="card issues cannot be resolved by silent retry"))
            elif case.error_code in ["fraud_flag", "mandate_revoked"]:
                selected_action = InterventionType.BLOCK
                confidence = 1.0
                decision_factors.append(f"strict compliance rule: {case.error_code}")
                
        elif case.case_type == CaseType.SUBSCRIPTION:
            days_overdue = int(case.metadata.get("days_overdue", case.context.get("days_overdue", case.context.get("notes", {}).get("days_overdue", 0))))
            if days_overdue == 0:
                selected_action = InterventionType.RETRY_NOW
                decision_factors.append("day 0 subscription failure")
            elif days_overdue < 7:
                selected_action = InterventionType.PAYMENT_LINK
                decision_factors.append("day 3-7 subscription failure")
            elif days_overdue < 14:
                selected_action = InterventionType.VOICE_RECOVERY
                decision_factors.append("high overdue days (7-14)")
                decision_factors.append("voice intervention proven effective for engagement")
            else:
                selected_action = InterventionType.ESCALATE
                decision_factors.append("severe subscription delinquency (>14 days)")
                
        elif case.case_type == CaseType.CHECKOUT_ABANDONMENT:
            selected_action = InterventionType.PAYMENT_LINK
            decision_factors.append("high-intent checkout dropoff")
            decision_factors.append("cart recovery link typically yields highest conversion")
            
        elif case.case_type == CaseType.RECEIVABLE:
            days_overdue = int(case.metadata.get("days_overdue", case.context.get("days_overdue", case.context.get("notes", {}).get("days_overdue", 0))))
            if days_overdue > 60:
                selected_action = InterventionType.ESCALATE
                decision_factors.append("severely overdue invoice (>60 days)")
            else:
                selected_action = InterventionType.REMINDER
                decision_factors.append("standard invoice reminder window")
                alternatives.append(AlternativeAction(action="ESCALATE", reason_rejected="escalation premature at this stage"))
                
        elif case.case_type == CaseType.PROMISE_TO_PAY:
            status = case.metadata.get("promise_status", case.context.get("promise_status", case.context.get("notes", {}).get("promise_status", "UNKNOWN")))
            if status == "BROKEN":
                selected_action = InterventionType.ESCALATE
                decision_factors.append("customer broke explicit promise to pay")
            else:
                selected_action = InterventionType.REMINDER
                decision_factors.append("active promise pending fulfillment")
        
        # Heuristics that the agent considers
        if case.amount_at_risk > 15000 and selected_action in [InterventionType.RETRY_NOW, InterventionType.RETRY_LATER]:
            selected_action = InterventionType.AFA_PAYMENT_LINK
            decision_factors.append("high value transaction limits silent retries")
            
        if hasattr(case.mandate_state, "value"):
            if case.mandate_state.value == "ACTIVE" and selected_action == InterventionType.PAYMENT_LINK:
                decision_factors.append("active mandate provides frictionless recovery path if link succeeds")
        
        expected_recovery = case.risk_assessment.expected_recovery_inr if case.risk_assessment else (case.amount_at_risk * 0.5)

        return AgentDecision(
            selected_action=selected_action.value if hasattr(selected_action, "value") else selected_action,
            confidence=confidence,
            decision_factors=decision_factors,
            expected_recovery_inr=float(expected_recovery),
            alternative_actions=alternatives
        )
