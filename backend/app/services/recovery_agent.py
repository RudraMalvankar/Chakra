from typing import List

from backend.app.lib.config_utils import get_regulatory_threshold

REGULATORY_THRESHOLD = get_regulatory_threshold()

from backend.app.models.case import RecoveryCase, AgentDecision, CandidateAction, InterventionType, CaseType

class RecoveryAgent:
    @staticmethod
    def decide(case: RecoveryCase) -> AgentDecision:
        candidates: List[CandidateAction] = []
        
        # Base values from Risk Engine if available
        base_probability = case.risk_assessment.recovery_probability if case.risk_assessment else 0.5
        urgency = case.risk_assessment.urgency if case.risk_assessment else "MEDIUM"
        amount = case.amount_at_risk
        
        # Scoring logic
        def add_candidate(action: InterventionType, p_mod: float, cost: float, reason: str, eligible: bool = True):
            eff_p = max(0.0, min(1.0, base_probability * p_mod))
            exp_rec = amount * eff_p
            
            # Urgency multiplier
            u_mult = 1.2 if urgency == "HIGH" else (1.0 if urgency == "MEDIUM" else 0.8)
            
            # Penalize repeated retries
            retry_penalty = (case.retry_count * 5.0) if action in [InterventionType.RETRY_NOW, InterventionType.RETRY_LATER] else 0.0
            
            score = (exp_rec * u_mult) - cost - retry_penalty
            if not eligible:
                score = -999999.0
                
            candidates.append(CandidateAction(
                action=action.value if hasattr(action, 'value') else str(action),
                base_probability=round(base_probability, 2),
                probability_modifier=round(p_mod, 2),
                effective_probability=round(eff_p, 2),
                score=round(score, 2),
                expected_recovery_inr=round(exp_rec, 2),
                eligible=eligible,
                reason=reason
            ))

        # 1. Start with fallbacks
        add_candidate(InterventionType.ESCALATE, 0.0, 0.0, "default escalation path / stop recovery")
        
        # 2. Hard Blockers (Fraud / Revoked)
        if case.error_code in ["fraud_flag", "mandate_revoked"] or case.fraud_flag:
            add_candidate(InterventionType.BLOCK, 0.0, 0.0, f"strict policy constraint: {case.error_code}")
            # Ensure block wins
            for c in candidates:
                if c.action == "BLOCK":
                    c.score = 999999.0
                    c.eligible = True
                else:
                    c.eligible = False
                    c.score = -999999.0

        # 3. Candidate Generation by Case Type
        elif case.case_type == CaseType.PAYMENT_FAILURE:
            if case.retry_count >= 3:
                add_candidate(InterventionType.RETRY_NOW, 0.0, 0.0, "retry cap exceeded", eligible=False)
                # Escalate becomes the only eligible path
                for c in candidates:
                    if c.action == "ESCALATE":
                        c.score += 100000.0
                        c.reason = "retry cap exceeded, forcing escalation"
            elif case.error_code in ["insufficient_funds", "payment_timed_out"]:
                add_candidate(InterventionType.RETRY_LATER, 1.1, 0.0, "soft failure favors delayed retry")
                add_candidate(InterventionType.RETRY_NOW, 0.8, 0.0, "immediate retry less effective for NSF")
                add_candidate(InterventionType.PAYMENT_LINK, 0.9, 10.0, "payment link is viable but adds friction")
            elif case.error_code in ["card_declined", "expired_card"]:
                add_candidate(InterventionType.RETRY_LATER, 0.0, 0.0, "hard failure cannot be fixed by silent retry", eligible=False)
                add_candidate(InterventionType.PAYMENT_LINK, 1.2, 10.0, "hard failure requires customer action")
            
        elif case.case_type == CaseType.SUBSCRIPTION:
            days_overdue = int(case.metadata.get("days_overdue", case.context.get("days_overdue", case.context.get("notes", {}).get("days_overdue", 0))))
            past_failures = int(case.context.get("past_failed_payments_count", 0))
            grace_remaining = int(case.context.get("grace_period_remaining", 7))
            churn_risk = str(case.context.get("churn_risk", "LOW")).upper()

            if days_overdue == 0:
                add_candidate(InterventionType.RETRY_NOW, 1.2, 0.0, "day 0 subscription failure ideal for immediate retry")
                add_candidate(InterventionType.PAYMENT_LINK, 0.9, 10.0, "link is fallback if retry fails")
            elif days_overdue < 7 and grace_remaining > 0:
                add_candidate(InterventionType.RETRY_LATER, 1.1, 0.0, "within grace period, deferred retry appropriate")
                add_candidate(InterventionType.PAYMENT_LINK, 1.0, 10.0, "payment link for manual update during grace")
            elif days_overdue < 14:
                add_candidate(InterventionType.PAYMENT_LINK, 1.1, 10.0, "grace expiring, payment link for quick recovery")
                add_candidate(InterventionType.VOICE_RECOVERY, 1.3, 50.0, "voice engagement before pause decision")
            elif days_overdue < 30 and past_failures < 3:
                add_candidate(InterventionType.VOICE_RECOVERY, 1.5, 50.0, "high overdue, voice as last automated attempt")
                add_candidate(InterventionType.PAYMENT_LINK, 0.8, 10.0, "payment link lower conversion at this stage")
            else:
                for c in candidates:
                    if c.action == "ESCALATE":
                        c.score += 100000.0
                        c.reason = "severe subscription delinquency, pause/cancel decision required"

            if churn_risk == "HIGH" and days_overdue > 7:
                for c in candidates:
                    if c.action == "ESCALATE":
                        c.score += 50000.0
                        c.reason = "high churn risk subscription requires human intervention"

        elif case.case_type == CaseType.CHECKOUT_ABANDONMENT:
            add_candidate(InterventionType.PAYMENT_LINK, 1.5, 10.0, "high-intent cart recovery link typically yields highest conversion")
            add_candidate(InterventionType.VOICE_RECOVERY, 1.2, 50.0, "voice can recover high value carts but has higher cost")
            
        elif case.case_type == CaseType.RECEIVABLE:
            days_overdue = int(case.metadata.get("days_overdue", case.context.get("days_overdue", case.context.get("notes", {}).get("days_overdue", 0))))
            if days_overdue > 60:
                for c in candidates:
                    if c.action == "ESCALATE":
                        c.score += 100000.0
                        c.reason = "severely overdue invoice (>60 days)"
            else:
                add_candidate(InterventionType.REMINDER, 1.2, 5.0, "standard invoice reminder window")
                add_candidate(InterventionType.PAYMENT_LINK, 1.0, 10.0, "direct payment link for faster collection")
                
        elif case.case_type == CaseType.PROMISE_TO_PAY:
            status = case.metadata.get("promise_status", case.context.get("promise_status", case.context.get("notes", {}).get("promise_status", "UNKNOWN")))
            if status == "BROKEN":
                for c in candidates:
                    if c.action == "ESCALATE":
                        c.score += 100000.0
                        c.reason = "customer broke explicit promise to pay"
            else:
                add_candidate(InterventionType.REMINDER, 1.3, 5.0, "active promise pending fulfillment")
        
        # 4. Global Modifiers (AFA Limits)
        if case.amount_at_risk > REGULATORY_THRESHOLD:
            for c in candidates:
                if c.action in ["RETRY_NOW", "RETRY_LATER"] and c.eligible:
                    c.eligible = False
                    c.score = -999999.0
                    c.reason = "high value transaction limits silent retries (AFA required)"
                elif c.action == "PAYMENT_LINK" and c.eligible:
                    # Upgrade generic payment link to AFA payment link
                    c.action = InterventionType.AFA_PAYMENT_LINK.value
                    c.reason = "high value transaction requires AFA authenticated flow"

        # 5. Select Best Candidate
        candidates.sort(key=lambda x: x.score, reverse=True)
        best_candidate = candidates[0]
        
        # Assemble decision factors for explanation
        decision_factors = [best_candidate.reason]
        if case.amount_at_risk > REGULATORY_THRESHOLD:
            decision_factors.append("AFA threshold required authenticated intervention")
        if case.retry_count > 0:
            decision_factors.append(f"previous retries penalized score ({case.retry_count})")
        if case.fraud_flag:
            decision_factors.append("fraud flag triggered immediate block")

        priority = "HIGH" if best_candidate.expected_recovery_inr > 10000 else "MEDIUM"
        if best_candidate.action in ["BLOCK", "ESCALATE"]:
            priority = "CRITICAL"
            
        # Calculate pseudo-confidence based on score margin (bounded between 0.5 and 0.99 for valid actions)
        confidence = 0.99 if best_candidate.action in ["BLOCK", "ESCALATE"] else 0.85
        if len(candidates) > 1 and best_candidate.score > 0 and candidates[1].score > 0:
            margin = best_candidate.score / max(1.0, candidates[1].score)
            confidence = min(0.99, max(0.5, 0.5 + (margin * 0.1)))

        return AgentDecision(
            selected_action=best_candidate.action,
            confidence=round(confidence, 2),
            expected_recovery_inr=best_candidate.expected_recovery_inr,
            priority=priority,
            decision_factors=decision_factors,
            candidate_actions=candidates
        )
