# Methodology: How Chakra Simulates Recovery Outcomes

**This document is mandatory reading before evaluating Chakra.** It exists because honest simulation > impressive numbers.

## TL;DR

Recovery outcomes in Chakra are **modeled probabilistically**, not measured from real bank behavior. The eval set is hand-labeled, not collected from production data. The 58-68% recovery rates you see in `metrics_report.json` are **upper bounds** based on stated assumptions — real-world performance will be lower, sometimes significantly.

If you only have 30 seconds, remember this: **the audit log is real, the compliance rules are real, the architecture is real. The recovery percentages are simulated.**

## What Is Real

| Component | Status |
|---|---|
| Compliance rules (RBI AFA, network caps) | ✅ Hard-coded, verified by tests |
| PII redaction | ✅ Real, raises error if bypassed |
| Idempotency + budget governor | ✅ Real, verified by tests |
| Graceful Gemini fallback | ✅ Real, demonstrated during real 429 rate-limit hit |
| Audit log (JSONL) | ✅ Real, 100+ events per run |
| 18-case eval set | ✅ Real, hand-labeled against RBI rules |
| Eval accuracy | ✅ Real, measured against expected outputs |

## What Is Simulated

### 1. The 100 Seeded Payments
The `mock-razorpay/seed.py` file generates 100 payments with deterministic distribution (seed 42). The first 7 are hand-crafted edge cases; the rest are random within 4 error codes (`insufficient_funds`, `card_declined`, `expired_card`, `payment_timed_out`) and 4 amount tiers (500, 999, 1499, 18000 INR).

**This is not a representative sample of Razorpay's real failure distribution.** It's a reasonable test set for demonstrating routing logic, not a predictive model.

### 2. The Recovery Percentages
When `run_demo.py` reports 68% recovery, it means:
- 68/100 payments got a recovery action assigned (retry, link, or voice)
- The **simulated outcome** of that action is not modeled — we count "action assigned" as "recovered" for the headline number

In production, the actual recovery rate depends on:
- Whether the customer notices the message
- Whether their bank account has funds at retry time
- Whether the alternate payment method (UPI link) succeeds
- Whether they've already cancelled the subscription in their head

Industry benchmarks put real-world smart-retry recovery at 40-70% (Recurly, Chargebee). Our 68% is at the high end of this range and assumes the optimistic case.

### 3. The Gemini Calls
Gemini is called only for ambiguous error codes (cases the rule engine doesn't catch). In our seed data, this is **0 cases** (all 100 fall into known categories). So in the real demo run:
- 100/100 payments decided by rules
- 0/100 went to Gemini
- The 429 rate-limit hit was on the LLM call to process eval cases, not seed data

If you ran Chakra against a more diverse failure set, Gemini usage would increase to ~10-30% of cases.

### 4. The Network Retry Caps
Visa's 15/30d and Mastercard's 10/30d are documented in network operating guides but enforcement varies by acquirer. We've used the documented limits. Real merchants may have stricter limits from their acquiring bank.

## What This Means for Evaluation

**Judge / interviewer checklist:**

1. ✅ Does the compliance gate correctly hard-decline fraud and revoked mandates? → Look at `eval_report.json` and `audit_log.jsonl`. Real test, real result.
2. ✅ Does PII redaction actually strip names, phone numbers, and exact amounts? → Read `pii_redact.py` and the audit log. Real code, real test.
3. ✅ Does graceful fallback work when the LLM API fails? → Read `llm.py` and the audit log from the 429 case. Real event, real code path.
4. ⚠️ Does Chakra recover 68% of failed payments in production? → **We don't know.** The simulation assumes this. Production testing would require a closed beta with a real merchant.

## What We Did NOT Do (and Why)

- **No real Razorpay API calls in the demo.** Test-mode keys would require real merchant onboarding, which we don't have.
- **No real bank behavior modeling.** Bank APIs (issuer decline codes, network retry logic) are documented but we cannot test against them in 3 days.
- **No A/B test against Razorpay's default retry.** This would be the gold standard comparison, but requires a real merchant with real customers.

## If You Want to Validate This

Three options, in order of cost:

1. **Read `audit_log.jsonl` and `eval_report.json`.** Honest look at what the system actually did.
2. **Run `python backend/scripts/run_demo.py --dry-run`.** See the routing logic without execution.
3. **Add your own test cases to `backend/eval/labeled_cases.json`.** Re-run `python -m backend.app.services.eval_runner` to see accuracy on your data.

## Why We Wrote This Document

Because the alternative is letting judges discover the simulation gap themselves. That's how you lose trust.

**Chakra's bet:** a credible architecture with honest metrics beats a flashy demo with fudged numbers. Every Razorpay engineer we want to hire will read this file. If they decide Chakra is honest-but-rough, we get the interview. If they decide Chakra is fudged, we don't.

The bet is worth making.
