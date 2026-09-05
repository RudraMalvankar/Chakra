# Chakra API Reference Manual

The Chakra Recovery Engine provides a RESTful API built on **FastAPI**. By default, the API runs at `http://localhost:8000` (or `8001` depending on configuration).

All responses use standard HTTP status codes:
- `200 OK`: Request succeeded.
- `400 Bad Request`: Validation failure or invalid signature.
- `404 Not Found`: Entity not found in database or audit log.
- `422 Unprocessable Entity`: Input payload failed Pydantic schema validation.
- `503 Service Unavailable`: Upstream provider or database not configured.

---

## 1. System Health & Configuration

### `GET /health`
Returns the operational health status and configuration status of connected subsystems.

**Response `200 OK`:**
```json
{
  "status": "healthy",
  "database": "connected",
  "razorpay": "synthetic",
  "twilio": "not_configured",
  "gemini": "configured"
}
```

---

### `GET /api/config`
Exposes the active payment provider mode and public credentials for the client frontend.

**Response `200 OK`:**
```json
{
  "provider": "synthetic",
  "mode": "synthetic",
  "razorpay_key_id": null
}
```

---

### `GET /api/policy`
Retrieves current recovery rules and regulatory policies enforced by the Safety Gate. Used by the Command Center Safety Center panel.

**Response `200 OK`:**
```json
{
  "recovery": {
    "max_interventions_per_customer_per_month": 4,
    "transient_failure_retry_delay_hours": 24,
    "standard_retry_delay_hours": 48,
    "llm_confidence_threshold": 0.85
  },
  "regulatory": {
    "afa_free_threshold_standard_inr": 15000,
    "afa_free_threshold_special_inr": 100000,
    "first_mandate_transaction_requires_afa": true,
    "network_retry_caps": {
      "visa": { "max_attempts": 4, "window_days": 16 },
      "mastercard": { "max_attempts": 10, "window_days": 30 }
    }
  },
  "retry_limit": 4,
  "fraud_policy": "Hard block when fraud_flag or error_code=fraud_flag",
  "mandate_policy": {
    "revoked": "Hard block / stop recovery when mandate is REVOKED",
    "first_transaction_requires_afa": true
  },
  "stopping_rules": [
    "HARD_COMPLIANCE_BLOCK on fraud_flag",
    "HARD_COMPLIANCE_BLOCK on mandate_revoked",
    "NETWORK_RETRY_CAP_REACHED when network retry cap exceeded",
    "CUSTOMER_BUDGET_EXCEEDED when monthly intervention budget exceeded",
    "IDEMPOTENCY_DUPLICATE_EVENT on duplicate same-day intervention"
  ],
  "escalation_rules": [
    "Escalate when pre-debit alerts ignored >= 2",
    "Escalate when triage/agent requires_human"
  ]
}
```

---

## 2. Metrics & Observability

### `GET /api/metrics`
Generates the real-time aggregated metrics report including the breakdown by intervention, breakdown by case type, and invariant validations.

**Response `200 OK`:**
```json
{
  "metrics": {
    "payments_processed": 120,
    "payments_recovery_eligible": 71,
    "payments_blocked": 13,
    "payments_escalated": 36,
    "interventions_attempted": 67,
    "interventions_succeeded": 52,
    "payments_recovered": 52,
    "payments_failed_recovery": 15,
    "revenue_at_risk_inr": 3560390.86,
    "revenue_attempted_inr": 2299207.07,
    "revenue_recovered_inr": 1950019.64,
    "revenue_recovery_rate_pct": 54.77,
    "payment_recovery_rate_pct": 43.33,
    "intervention_success_rate_pct": 77.61,
    "safety_block_rate_pct": 10.83,
    "escalation_rate_pct": 30.0,
    "by_intervention": {
      "RETRY_NOW": {
        "attempted": 5,
        "succeeded": 1,
        "failed": 4,
        "pending": 0,
        "revenue_attempted_inr": 3446.61,
        "revenue_recovered_inr": 835.99
      },
      "PAYMENT_LINK": {
        "attempted": 30,
        "succeeded": 24,
        "failed": 6,
        "pending": 0,
        "revenue_attempted_inr": 42715.21,
        "revenue_recovered_inr": 37204.73
      },
      "AFA_PAYMENT_LINK": {
        "attempted": 32,
        "succeeded": 27,
        "failed": 5,
        "pending": 0,
        "revenue_attempted_inr": 2253045.25,
        "revenue_recovered_inr": 1911978.92
      }
    },
    "by_case_type": {
      "PAYMENT_FAILURE": { "processed": 24, "recovered": 3, "revenue_at_risk": 276035.53, "revenue_recovered": 17535.12 },
      "SUBSCRIPTION": { "processed": 24, "recovered": 5, "revenue_at_risk": 14620.04, "revenue_recovered": 3344.74 },
      "CHECKOUT_ABANDONMENT": { "processed": 24, "recovered": 18, "revenue_at_risk": 23837.87, "revenue_recovered": 18327.39 },
      "RECEIVABLE": { "processed": 24, "recovered": 14, "revenue_at_risk": 2479860.17, "revenue_recovered": 1486914.87 },
      "PROMISE_TO_PAY": { "processed": 24, "recovered": 12, "revenue_at_risk": 766037.25, "revenue_recovered": 423897.52 }
    }
  },
  "invariants": {
    "revenue_hierarchy_invariant": true,
    "count_hierarchy_invariant": true,
    "partition_sum_invariant": true,
    "all_passed": true
  },
  "simulation_disclosure": "Synthetic benchmark — not production Razorpay data."
}
```

---

### `GET /api/audit`
Retrieves chronological audit events from the runtime audit trail.

**Query Parameters:**
- `limit` *(integer, optional)*: Maximum events to return (default: `100`).

**Response `200 OK`:**
```json
{
  "events": [
    {
      "timestamp": "2026-09-03T19:59:45.120400Z",
      "payment_id": "pay_9823171829",
      "event_type": "safety_check_completed",
      "pii_redacted": true,
      "details": {
        "allowed": true,
        "decision": "AFA_PAYMENT_LINK",
        "eligibility": "ALLOWED",
        "reason_code": "SAFETY_MODIFIED_AFA_LIMIT",
        "enforced_rules": ["AFA_THRESHOLD_EXCEEDED"]
      }
    }
  ]
}
```

---

## 3. Case Inspection & Trace API

### `GET /api/cases`
Lists all tracked recovery cases.

**Query Parameters:**
- `limit` *(integer, optional)*: Maximum cases to return (default: `200`).

---

### `GET /api/cases/{case_id}/trace`
Retrieves the complete decision journey for an individual recovery case from the audit trail.

**Path Parameters:**
- `case_id` *(string, required)*: The case identifier.

**Response `200 OK`:**
```json
{
  "case_id": "pay_9823171829",
  "trace": [
    {
      "timestamp": "2026-09-03T19:59:45.010Z",
      "event_type": "triage_decision_proposed",
      "details": {
        "amount_inr": 22000.0,
        "case_type": "PAYMENT_FAILURE",
        "triage": {
          "error_code": "insufficient_funds",
          "recommended_action": "RETRY_NOW",
          "confidence": 0.98,
          "is_ambiguous": false
        },
        "decision": {
          "decision": "RETRY_NOW",
          "policy_id": "policy_standard_retry"
        }
      }
    },
    {
      "timestamp": "2026-09-03T19:59:45.050Z",
      "event_type": "safety_check_completed",
      "details": {
        "allowed": true,
        "decision": "AFA_PAYMENT_LINK",
        "eligibility": "ALLOWED",
        "reason_code": "SAFETY_MODIFIED_AFA_LIMIT",
        "enforced_rules": ["AFA_THRESHOLD_EXCEEDED"]
      }
    },
    {
      "timestamp": "2026-09-03T19:59:45.100Z",
      "event_type": "execution_outcome",
      "details": {
        "effective_action": "AFA_PAYMENT_LINK",
        "status": "link_created",
        "recovered": false
      }
    }
  ]
}
```

---

## 4. Live Simulation API

### `POST /api/demo/simulate`
Executes an ad-hoc revenue-at-risk event through the real Chakra backend recovery pipeline.

**Request Body:**
```json
{
  "case_type": "PAYMENT_FAILURE",
  "amount_inr": 2499.0,
  "failure_reason": "insufficient_funds",
  "mandate_state": "ACTIVE",
  "customer_id": "cust_demo_8921",
  "churn_risk": "LOW",
  "fraud_risk": "LOW"
}
```

**Response `200 OK`:**
Returns the structured trace object identical to `/api/cases/{case_id}/trace`.

---

## 5. Payment & Checkout Endpoints

### `POST /api/payments/orders`
Creates an upstream checkout order with Razorpay or the Synthetic Gateway.

**Request Body:**
```json
{
  "amount_inr": 2499.0,
  "customer_id": "cust_123"
}
```

**Response `200 OK`:**
```json
{
  "order_id": "order_syn_87612984",
  "amount_inr": 2499.0,
  "customer_id": "cust_123",
  "mode": "synthetic"
}
```

---

### `POST /api/payments/verify`
Server-side signature verification of checkout capture.

**Request Body:**
```json
{
  "razorpay_payment_id": "pay_982312",
  "razorpay_order_id": "order_876129",
  "razorpay_signature": "e892bf9817293a..."
}
```

---

### `POST /api/payments/abandon`
Captures checkout modal dismissals and dispatches recovery workflows.

**Request Body:**
```json
{
  "order_id": "order_syn_87612984",
  "amount_inr": 2499.0,
  "customer_id": "cust_123"
}
```

---

### `POST /webhooks/razorpay`
Ingests Razorpay webhook payloads with HMAC SHA-256 signature verification.
- Validates header: `X-Razorpay-Signature`.
- Rejects invalid signatures with `400 Bad Request`.
- Dispatches event asynchronously into the Chakra recovery engine.
