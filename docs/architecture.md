# Chakra Architecture

## What Chakra Is

Chakra is a **mandate-aware revenue recovery agent** that sits between Razorpay's payment infrastructure and a merchant's failed recurring payments. It detects failures, classifies them by constraints, and routes to the appropriate recovery path.

## The Problem It Solves

Static subscriptions retry on a fixed daily schedule that:
- Retries the same card repeatedly regardless of failure reason.
- Ignores e-mandate rules (AFA thresholds, first-transaction rules).
- Ignores card network retry limits.
- Treats hard declines (fraud, revoked mandate) the same as soft declines.

## Architecture (6-Stage Runtime Loop)

Chakra implements a strict 6-stage pipeline:

1. **ContextBuilder**: Normalizes webhook events into a clean `PaymentContext`.
2. **TriageEngine**: Deterministic triage outputs a `TriageResult` ("What happened?"). Gemini is invoked ONLY for ambiguous cases and its output is strictly constrained.
3. **MandateRouter**: The core decision orchestrator. Evaluates the triage result against mandate states to propose a `RecoveryDecision`.
4. **SafetyGate**: The final policy enforcement layer. Evaluates the router's proposed decision and blocks invalid/fraudulent actions. LLM output NEVER bypasses this.
5. **RecoveryExecutor**: Strictly executes approved decisions (retries, payment links) without making its own safety judgments.
6. **OutcomeEvaluator**: Evaluates the mock provider's API response. Only an actual `PAYMENT_SUCCEEDED` / `captured` outcome triggers a recovery metric.

## PII Protection
PII is redacted before LLM processing. Raw details never reach the model.

## Auditable Event Trail
Every processed payment generates structured JSONL events with decision summaries. Regulatory constraints are represented as configurable safety policies.
