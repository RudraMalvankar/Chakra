# Chakra Simulation & Evaluation Methodology

**This document defines the mathematical modeling, benchmark construction, and verification invariants used in Chakra.**

> **Core Principle:** Honest, mathematically rigorous simulation is superior to fabricated metrics.

---

## 1. What Is Real vs. What Is Simulated

| Component | Nature | Rationale / Verification |
|---|---|---|
| **Safety Gate Enforcements** | **REAL** | Deterministically verified against RBI AFA regulations and card scheme retry rules via unit tests. |
| **Pipeline Decision Engine** | **REAL** | `ContextBuilder`, `TriageEngine`, `MandateRouter`, and `SafetyGate` run genuine production logic. |
| **Audit Trail Ledger** | **REAL** | Generates real, append-only JSONL files (`audit_log.jsonl`) with PII redaction and Windows lock retries. |
| **PII Redaction Service** | **REAL** | Customer names, phone numbers, and emails are scrubbed before LLM dispatch. |
| **Google Gemini Fallback** | **REAL** | Connected via official Google GenAI SDK when `GEMINI_API_KEY` is provided; safely escalates if offline. |
| **Seed Payment Dataset** | **SIMULATED** | Generated synthetically via `mock-razorpay/seed.py` (120 deterministic cases, seed 42) for reproducible evaluation. |
| **Bank Gateway Settlement** | **SIMULATED** | Gateway success probabilities are modeled conditionally based on failure cause, time-of-day, and intervention type. |

---

## 2. The 120-Case Synthetic Benchmark

To evaluate Chakra across a diverse fintech failure distribution, `mock-razorpay/seed.py` generates 120 synthetic cases spanning five core revenue recovery scenarios:

1. **Payment Failures (100 cases):**
   - Transient balance deficiencies (`insufficient_funds`)
   - Expired card credentials (`expired_card`)
   - Gateway communication timeouts (`payment_timed_out`)
   - Revoked mandates (`mandate_revoked`)
   - Stolen card / fraud indicators (`fraud_flag`)
   - Network retry cap exhaustion (Visa / Mastercard)
2. **Subscriptions (5 cases):** Multi-day dunning overdue intervals requiring conversational voice interventions.
3. **Checkout Abandonments (5 cases):** Cart drop-offs requiring alternative payment links.
4. **B2B Receivables (5 cases):** Invoices 30–60 days past due.
5. **Promise-to-Pay (5 cases):** Expired customer payment commitments.

---

## 3. Mathematical Accounting Invariants

Chakra enforces three mathematical accounting invariants on every metrics aggregation run to ensure zero fraudulent reporting:

### Invariant 1: Revenue Hierarchy
$$\text{Revenue Recovered} \le \text{Revenue Attempted} \le \text{Revenue At Risk}$$
- **Meaning:** Chakra can never claim to recover more money than it attempted to recover, nor attempt more money than was initially at risk.

### Invariant 2: Count Hierarchy
$$\text{Payments Recovered} \le \text{Interventions Succeeded} \le \text{Interventions Attempted} \le \text{Payments Processed}$$
- **Meaning:** Successful payments cannot exceed succeeded interventions, which cannot exceed total attempted touches, bounded by total processed payments.

### Invariant 3: Partition Sum Conservation
$$\text{Payments Blocked} + \text{Payments Escalated} + \text{Payments Eligible} = \text{Payments Processed}$$
- **Meaning:** Every single ingested payment must be definitively classified into exactly one mutually exclusive bucket: Blocked, Escalated, or Recovery Eligible.

$$\textbf{Benchmark Verification: ALL 3 INVARIANTS PASS (100\%)}$$

---

## 4. Probabilistic Recovery Modeling

When operating against the synthetic payment provider, recovery probabilities are calculated as a conditional function:

$$P(\text{Capture} \mid \text{FailureReason}, \text{Intervention}, \text{OverdueDays})$$

- **Insufficient Funds + Immediate Retry:** $P \approx 0.20$ (low likelihood of immediate liquidity replenishment).
- **Insufficient Funds + Delayed Retry (24h–48h):** $P \approx 0.65$ (reflects payroll deposit timing).
- **Expired Card + Payment Link:** $P \approx 0.70$ (customer provides replacement payment instrument).
- **Checkout Abandonment + Instant Link:** $P \approx 0.80$ (high intent re-engagement).
- **Revoked Mandate / Fraud:** $P = 0.00$ (strictly blocked by Safety Gate; zero debits attempted).

---

## 5. Adversarial Testing & Evaluation Suite (`eval_report.json`)

Chakra includes an 18-case adversarial suite designed to test boundary conditions:
- Exact threshold boundaries (e.g. ₹15,000 INR exactly)
- Extreme values (> ₹100,000 INR)
- Simultaneous failure reasons (fraud flag + expired card)
- Counter-cycling retry caps

All 18 adversarial scenarios achieve 100% agreement between predicted action and expected compliance action.
