# Chakra: Mandate-Aware Revenue Recovery Engine

**Pitch Line:** "We don't just recover payments. We recover them through the safest, highest-value path."

Failed subscription payments represent billions in lost revenue, but blindly retrying every failure burns network retry slots and violates regulations (like RBI's e-mandate rules in India). Chakra is an intelligent middleware that ingests failed payment webhooks, understands the failure context, checks regulatory and merchant constraints, and acts safely.

> **Note:** Chakra's recovery outcomes are modeled using a deterministic/seeded synthetic simulation based on stated assumptions. These results do not represent real bank behavior, production recovery rates, or actual recovered merchant funds. This is a synthetic benchmark, not a claim of production throughput.

## Architecture

Chakra relies on a 5-stage pipeline:
1. **Webhook Ingestion:** Verifies HMAC signatures and ensures event authenticity.
2. **Context Builder:** Reconstructs the payment history and redacts PII.
3. **Triage Engine:** Uses deterministic heuristics for obvious cases and a fallback Gemini LLM for ambiguous errors.
4. **Safety Engine:** A hard-coded, non-overridable policy gate. It blocks interventions if they violate retry caps, AFA limits, or customer budgets. It also enforces idempotency.
5. **Recovery Executor:** Dispatches the final action (Retry, Payment Link, or Escalate).

## Features
- **Revenue-First Metrics:** We measure `revenue_recovered_inr`, not just actions taken.
- **Compliance-by-Design:** PII is bucketed/hashed before LLM ingestion.
- **Graceful Degradation:** If Gemini is unavailable or rate-limited, Chakra falls back to safe heuristics or human escalation instead of crashing.
- **Idempotency & Rate Limiting:** Built-in safeguards against double-charging.

## Demo / Benchmark

You can run the full benchmark suite locally to process 100 seeded mock payments.

### Requirements
- Python 3.11+
- `.env` file with `GEMINI_API_KEY`

### Running the System
```bash
# Install dependencies
make install

# Start the mock Razorpay API and Chakra Backend 
make mock
make backend

# In a new terminal, trigger the webhook ingestion
make trigger
```

Once the benchmark finishes, check `audit_log.jsonl` for a mathematically provable audit trail of every decision, safety check, and outcome.
