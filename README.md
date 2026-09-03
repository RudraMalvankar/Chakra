<div align="center">
  
# Chakra
**The Autonomous, Mandate-Aware Revenue Recovery Engine**

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

*"We don't just recover payments. We recover them through the safest, most compliant path."*

</div>

---

## 📖 Overview

Failed subscription payments represent billions in lost revenue globally. However, blindly retrying every failure burns network slots, frustrates customers, and violates strict regional regulations (such as the RBI's e-mandate rules in India). 

**Chakra** is an intelligent, fintech-grade middleware that ingests failed payment webhooks, understands the lifecycle of the underlying mandate, checks strict regulatory and merchant constraints, and executes the optimal recovery strategy.

> **Disclaimer:** Chakra's recovery outcomes are currently modeled using a deterministic/seeded synthetic mock provider based on stated assumptions. These results are synthetic benchmarks for the architecture, not claims of production throughput or actual recovered merchant funds.

---

## 🏛️ Core Architecture

Chakra abandons the flawed "LLM-as-a-router" design pattern in favor of a strict, deterministically governed multi-stage pipeline:

1. **Context Builder**: Normalizes raw webhook payloads into strictly typed Pydantic structures (`PaymentContext`, `Mandate`), aggregating history, retry counts, and redacting PII to ensure DPDP Act compliance.
2. **Triage Engine**: Operates purely as a diagnostic layer ("What happened?"). It handles known failures deterministically and falls back to **Google Gemini** *only* for ambiguous failure classification.
3. **Mandate-Aware Recovery Router**: The strategic core. It evaluates the triage classification against the mandate's lifecycle (e.g., `NEW`, `ACTIVE`, `REVOKED`) to orchestrate a structured `RecoveryDecision`.
4. **Safety Enforcer Gate**: A hard-coded, non-overridable policy gate. It blocks the router's proposed actions if they violate hard limits:
   - RBI Additional Factor of Authentication (AFA) limits (>₹15,000 INR).
   - Network retry caps and cooldown periods.
   - Fraud flags or revoked mandates.
   - Customer intervention fatigue (monthly budgets).
5. **Recovery Executor**: A clean execution layer that triggers the approved action (e.g., `RETRY_NOW`, `AFA_PAYMENT_LINK`, `ESCALATE`) without making safety assumptions.
6. **Outcome Evaluator**: Monitors the external provider's response, ensuring only mathematically proven `PAYMENT_SUCCEEDED` events trigger revenue metrics.

---

## 🚀 Key Features

* **Compliance-by-Design**: Absolute separation between LLM intelligence and policy execution. AI classifies; deterministic code governs.
* **Revenue-First Metrics**: Chakra tracks actual `revenue_recovered_inr`, filtering out failed attempts, scheduled links, and blocks.
* **Idempotency & Safety**: Built-in, SHA-256 cryptographic idempotency safeguards against double-charging and duplicate webhook processing.
* **Graceful Degradation**: If external intelligence (LLM) is unavailable, Chakra falls back to safe heuristics or human escalation instead of crashing.

---

## 🛠️ Quickstart & Synthetic Benchmark

Chakra includes a built-in Mock Razorpay API to simulate deterministic and probabilistic network conditions, allowing you to benchmark the engine locally against 100 seeded payment failures.

### Prerequisites
- Python 3.11+
- A `.env` file containing:
  ```env
  GEMINI_API_KEY=your_api_key_here
  RAZORPAY_KEY_ID=test_key
  RAZORPAY_KEY_SECRET=test_secret
  WEBHOOK_SECRET=your_secret
  ```

### Running the Suite

Chakra leverages a unified `Makefile` for streamlined testing and execution.

```bash
# 1. Install dependencies
make install

# 2. Start the Mock Razorpay Provider (Port 8001)
make mock

# 3. Start the Chakra Engine (Port 8000)
make backend

# 4. In a new terminal, trigger the webhook ingestion
make trigger
```

### Analyzing the Results
Once the benchmark concludes, Chakra will output a mathematically verifiable metrics report, isolating `revenue_at_risk_inr` from `revenue_recovered_inr`. You can also inspect the generated `audit_log.jsonl` for a granular, legally auditable trail of every decision, safety check, and outcome.

---

## 🧪 Testing
Run the comprehensive Pytest suite (which validates the router, safety gates, metric invariants, and DPDP PII redaction) via:
```bash
make test
```

---
<div align="center">
Built for the Razorpay AI Buildathon 2026.
</div>

### Extended Revenue Recovery Orchestrator
Chakra has been expanded from a pure payment-recovery agent into a unified **Revenue Recovery Orchestrator**.
All of the following revenue leaks converge into the exact same deterministic routing, safety, and metrics pipeline:
- **Payment Failures**
- **Failed Subscriptions**
- **Checkout Abandonment**
- **B2B Receivables**
- **Promise-to-Pay tracking**

These are executed via ContextBuilder -> Triage -> Router -> SafetyGate -> Executor -> Audit.
