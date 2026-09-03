# Chakra
## Autonomous Revenue Recovery Agent

### The problem
Revenue leaks across:
- failed payments
- failed subscriptions
- abandoned checkout
- overdue receivables
- broken promises

Recurring payment failures and checkout drop-offs create significant revenue leakage. Fixed retry strategies may not adapt to the reason a payment failed. This can lead to involuntary churn — money you already earned, walking out the door.

### The solution
Chakra detects revenue at risk, diagnoses why it is slipping away, selects the highest-value compliant intervention, executes a bounded recovery workflow, and measures whether the money actually came back.

Detect → Diagnose → Prioritize → Decide → Safety Gate → Execute → Measure → Learn/continue/stop

### Why Chakra is different
1. **Revenue-first prioritization**: Rank opportunities by expected recoverable revenue multiplied by urgency.
2. **Agentic intervention selection**: Uses deterministic scoring and AI to select the optimal intervention.
3. **Mandate-aware recovery**: Leverages Razorpay mandate state to drive frictionless recoveries.
4. **Deterministic safety boundaries**: Prevents unsafe actions (e.g. bypassing AFA requirements, exceeding retry caps) using strict gates.
5. **Bounded workflows**: Escalate or stop based on limits.
6. **Provider-confirmed recovery**: Focuses on actual captured revenue, not just sent notifications.
7. **Auditability**: Complete structured event logs of the entire decision chain.
8. **Multi-scenario recovery**: Five Track-03 scenarios seamlessly unified.

### Architecture
Event → ContextBuilder → RecoveryCase → RevenueRiskEngine → Recovery Agent → SafetyGate → Executor → Provider → OutcomeEvaluator → Metrics/Audit

### Benchmark (Synthetic)
Our benchmark tests the engine across a perfectly balanced 120-case scenario:
- **TOTAL CASES**: 120 (24 of each case type)
- **REVENUE AT RISK**: ₹3,560,390
- **REVENUE RECOVERED**: ₹1,950,019
- **RECOVERY RATE (REVENUE)**: 54.77%
- **INTERVENTION SUCCESS RATE**: 77.61%

*Note: All benchmark results are generated using a synthetic mock provider.*

### Limitations
- **Synthetic provider**: The demo uses an in-process mock simulator; it is not calling production Razorpay endpoints.
- **In-memory state**: Idempotency and budget states reset on application restart.
- **Deferred execution**: `RETRY_LATER` generates intent, but no active polling cron-job executes them dynamically yet.
- **Local Voice Artifacts**: `pyttsx3` generates `.mp3` artifacts, but actual phone calls (e.g. Twilio) are not triggered.
- **No persistent DB**: The audit trail appends to a local `.jsonl` file.
