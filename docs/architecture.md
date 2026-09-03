# Chakra Architecture

## What Chakra Is (Expanded Orchestrator)

Chakra is a **Unified Revenue Recovery Orchestrator**. It now supports extending beyond payment failures to handle:
- **Payment Failures**
- **Subscription Failures**
- **Checkout Abandonments**
- **Receivables & Promise-to-Pay**

These all share a single execution pipeline mapping heterogeneous events to a single RecoveryCase object.

## Architecture (6-Stage Runtime Loop)

1. **ContextBuilder**: Normalizes incoming webhooks/payloads into a unified RecoveryCase.
2. **TriageEngine**: Diagnoses ambiguity using deterministic checks or an LLM fallback.
3. **MandateRouter**: Routes the case based on its case_type, applying business rules.
4. **SafetyGate**: A non-overridable firewall enforcing idempotency, retry caps, and fraud blocks.
5. **RecoveryExecutor**: Deterministically maps decisions to API calls (or voice artifact generation).
6. **OutcomeEvaluator**: Measures actual outcome and metrics strictly based on payment realization.

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
