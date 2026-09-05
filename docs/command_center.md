# Chakra Command Center Operator Manual

The **Chakra Command Center** is a high-density, real-time operations console designed for payment operations teams, risk managers, and recovery engineers. Built with a dark financial infrastructure aesthetic, it provides full visibility into revenue at risk, live recovery transactions, safety decisions, and pipeline execution traces.

---

## 1. Accessing the Command Center

1. Ensure the Chakra backend is running:
   ```bash
   python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
2. Start the Command Center frontend server:
   ```bash
   cd frontend
   python -m http.server 3000
   ```
3. Open your browser and navigate to:
   $$\text{\textbf{http://localhost:3000}}$$

---

## 2. Interface Navigation & Panels

The Command Center is organized into 7 functional operational panels accessible via the left sidebar:

```text
┌──────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
│  CHAKRA COMMAND CENTER               │                                                             │
│                                      │                                                             │
│  [■] Overview                        │                    PRIMARY CONTENT AREA                     │
│  [⚡] Live Feed                      │                                                             │
│  [🛡] Safety Center                  │  • Renders selected panel in high-density dark layout       │
│  [≡] Audit Trail                     │  • Auto-polls backend every 5 seconds for telemetry updates │
│  [▶] Simulator                       │  • Seamlessly opens Decision Explorer upon case click       │
│  [🖹] Architecture                   │                                                             │
│                                      │                                                             │
└──────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

### Panel 1: Overview Dashboard
The command view providing macro visibility over all revenue recovery operations:

- **Financial Ingestion Cards:**
  - **Revenue At Risk:** Total monetary value of all failed or overdue payments ingested.
  - **Revenue Attempted:** Total revenue for which recovery was authorized by the Safety Gate.
  - **Revenue Recovered:** Total revenue verified as captured by the provider.
  - **Recovery Rate (%):** $\frac{\text{Revenue Recovered}}{\text{Revenue At Risk}} \times 100$.
  - **Payments Recovered:** Count of unique payments successfully settled.
- **Operational Status Row:**
  - `Blocked`: Payments blocked by the Safety Gate for compliance, fraud, or network limits.
  - `Escalated`: Payments flagged for human operator review (churn, severe alerts ignored).
  - `Pending`: Interventions awaiting customer action or scheduled retry window.
  - `Evaluation Score`: 18 / 18 safety checks passed.
- **Recovery Funnel:**
  Visual flow from **Revenue At Risk** $\longrightarrow$ **Revenue Attempted** $\longrightarrow$ **Revenue Recovered**.
- **Recovery by Intervention Breakdown:**
  Tabular audit of each intervention type (`RETRY_NOW`, `RETRY_LATER`, `PAYMENT_LINK`, `AFA_PAYMENT_LINK`, `VOICE_RECOVERY`, `REMINDER`, `ESCALATE`, `BLOCK`) displaying attempted, succeeded, failed, and pending volumes.
- **Case Type Breakdown:**
  Performance across Payment Failures, Subscriptions, Checkout Abandonments, Receivables, and Promises-to-Pay.
- **Synthetic Benchmark Label:**
  Prominently displays the disclosure notice: *"Synthetic 120-case benchmark — not production Razorpay data."*

---

### Panel 2: Live Recovery Feed
A real-time updating operational monitor tracking incoming events and active cases:
- Each case card shows:
  - Amount in INR with status glyph:
    - `✓` (Green): `RECOVERED` (Provider-confirmed capture)
    - `◷` (Yellow): `RECOVERY_PENDING` (Link created, awaiting payment)
    - `🛡` (Red): `BLOCKED` (Safety Gate blocked)
    - `↗` (Orange): `ESCALATED` (Manual ops escalation)
  - Case Type (`PAYMENT_FAILURE`, `SUBSCRIPTION`, etc.)
  - Timestamp
  - Action Dispatched
  - Final State
- **Interactive Action:** Clicking any case card immediately launches the **Decision Explorer** for that specific case ID.

---

### Panel 3: Decision Explorer (Case Detail View)
The primary debugging and audit view, exposing the full 8-stage decision journey without exposing LLM chain-of-thought:

1. **EVENT:** Original sanitized event type, amount (₹), case ID, timestamp.
2. **CONTEXT:** Customer profile, mandate state, previous intervention count.
3. **TRIAGE:** Classification category, confidence percentage, recommended action.
4. **AI FALLBACK:** Transparently indicates if Gemini was used. If not needed, displays *"Deterministic policy path — AI fallback not required."*
5. **MANDATE ROUTER:** Applied routing policy and candidate action.
6. **SAFETY GATE:** Visual checklist of all 6 compliance checks. Renders `ALLOWED`, `AFA REQUIRED`, or `BLOCKED` in bold colored banners with specific reason codes.
7. **EXECUTOR:** Dispatched action, target provider, and execution status.
8. **OUTCOME:** Final lifecycle state and recovered revenue amount. If pending, clearly explains: *"Revenue is not counted as recovered until provider-confirmed success."*

---

### Panel 4: Safety Center
A dedicated compliance monitor showing active protection guardrails:
- **Protection Rules Checklist:** Active policies for revoked mandates, fraud flags, retry caps, intervention budgets, duplicate prevention, and RBI AFA limits.
- **Visual Example Banner:**
  $$\text{AI PROPOSED: RETRY\_NOW} \longrightarrow \text{SAFETY GATE: MANDATE REVOKED} \longrightarrow \textbf{BLOCKED}$$
- **Recent Safety Decisions Table:** Real-time log of cases evaluated by the gate with candidate decisions, final safety verdicts, and rule codes.

---

### Panel 5: Audit Trail
The chronological ledger of all system activity:
- Displays timestamp, case ID, event stage, and formatted JSON payload.
- Interactive JSON inspector allows operators to inspect payload details, reason codes, and idempotency keys with PII redacted.

---

### Panel 6: Live Demo & Event Simulator
A controlled testing console to inject synthetic recovery events directly into the real backend engine:
- **Configurable Inputs:**
  - **Case Type:** Payment Failure, Subscription, Checkout Abandonment, Receivable, Promise-to-Pay.
  - **Amount (₹):** Any custom integer/float amount.
  - **Failure Reason:** `insufficient_funds`, `mandate_revoked`, `card_declined`, `payment_timed_out`, etc.
  - **Mandate State:** `ACTIVE`, `REVOKED`, or `UNKNOWN`.
- **Execution:** Clicking **`[ RUN CHAKRA ]`** sends a `POST /api/demo/simulate` request to the backend. The backend executes the genuine pipeline (Context Builder $\rightarrow$ Triage $\rightarrow$ Router $\rightarrow$ Safety Gate $\rightarrow$ Executor $\rightarrow$ Outcome) and immediately redirects the user to inspect the result in the **Decision Explorer**.

---

### Panel 7: System Architecture Panel
An embedded visual representation of the complete 11-stage Chakra recovery architecture, matching technical documentation.
