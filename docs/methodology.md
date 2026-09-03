# Methodology: How Chakra Simulates Recovery Outcomes

**This document is mandatory reading before evaluating Chakra.** It exists because honest simulation > impressive numbers.

## TL;DR

Recovery outcomes in Chakra are **modeled probabilistically**, not measured from real bank behavior. The benchmark sets are generated, not collected from production data. The recovery rates you see in the metrics report are simulation results based on stated assumptions.

## What Is Real

| Component | Status |
|---|---|
| Safety & Policy rules (RBI AFA, network caps) | Real, enforced by SafetyGate |
| PII redaction | Real, verified by tests |
| Webhook Idempotency | Real, verified by tests |
| Graceful Gemini fallback | Real, escalates safely if API fails |
| Audit log (JSONL) | Real, decision summaries generated |

## What Is Simulated

### 1. The Seeded Payments
The mock-razorpay/seed.py file generates a benchmark set of payments with deterministic distribution (seed 42).
This is not a representative sample of Razorpay's real failure distribution. It's a reasonable test set for demonstrating routing logic, not a predictive model.

### 2. The Recovery Percentages
The recovery outcomes (captured vs failed) are determined probabilistically by the mock server based on the failure reason and intervention type (retry vs link). The system enforces that only a provider-confirmed success triggers a recovery metric.

### 3. The LLM Usage
Gemini is called only for ambiguous error codes (cases the deterministic triage does not confidently handle).

## What This Means for Evaluation

**Judge / interviewer checklist:**

1. Does the Safety Gate correctly hard-decline fraud and revoked mandates?
2. Does PII redaction actually strip raw metadata?
3. Does graceful fallback work when the LLM API fails?

**Chakra's bet:** a credible architecture with honest metrics beats a flashy demo with fudged numbers.
