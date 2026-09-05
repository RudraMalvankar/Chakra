# Chakra Operations & Deployment Runbook

This runbook outlines standard operating procedures for installing, configuring, deploying, and troubleshooting the Chakra Autonomous Revenue Recovery Engine.

---

## 1. System Requirements & Prerequisites

| Dependency | Minimum Version | Recommended Version |
|---|---|---|
| **Python** | 3.11 | 3.11.x / 3.12.x |
| **Node.js** | 18.x LTS | 20.x LTS |
| **Operating System** | Windows 10/11, macOS, Linux (Ubuntu 22.04+) | Linux (Ubuntu 22.04+) |
| **RAM** | 4 GB | 8 GB |

---

## 2. Environment Configuration Reference

Create a `.env` file in the project root:

```ini
# Application Mode
DRY_RUN=false

# Payment Provider Configuration
USE_MOCK_RAZORPAY=true
MOCK_RAZORPAY_URL=http://localhost:8001

# Razorpay Test Mode Credentials (Optional)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Google Gemini API (Optional for LLM Fallback)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# Twilio Voice Credentials (Optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_WEBHOOK_BASE_URL=

# CORS Settings
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

---

## 3. Standard Operating Commands

### 3.1 Running the Backend
From project root:
```bash
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```
Health check verification:
```bash
curl http://localhost:8000/health
```

### 3.2 Running the Synthetic Razorpay Gateway
From project root:
```bash
python -m uvicorn mock-razorpay.main:app --host 0.0.0.0 --port 8001
```

### 3.3 Running the Command Center Frontend
From `frontend/` directory:
```bash
cd frontend
python -m http.server 3000
```
Navigate to `http://localhost:3000`.

### 3.4 Executing the Benchmark & Generating Reports
```bash
python backend/scripts/run_demo.py
```
Outputs:
- `audit_log.jsonl` (Full decision ledger)
- `metrics_report.json` (Summary metrics & invariant checks)
- `eval_report.json` (18-case safety accuracy verification)

### 3.5 Running Automated Tests
```bash
python -m pytest -q backend/tests
```
All 200 tests must pass with zero failures.

### 3.6 Python Compilation Syntax Verification
```bash
python -m compileall -q backend mock-razorpay
```

---

## 4. Troubleshooting & Operational FAQs

### Q: Why does the simulator show `RECOVERY_PENDING` with ₹0 recovered?
**A:** This is by design (Zero False-Recovery Guarantee). When a payment link or voice call is dispatched, the money is not yet in the bank. Only provider-confirmed capture updates the status to `RECOVERED`.

### Q: What happens if the Gemini API key is missing or offline?
**A:** The engine operates with **graceful deterministic degradation**. Recognized failure codes are triaged deterministically. Ambiguous codes that cannot reach Gemini are automatically routed to `ESCALATE` (human review), ensuring no unverified automated charges occur.

### Q: How do I clear the local audit trail for a clean demo?
**A:** Simply delete or truncate `audit_log.jsonl`, or run `python backend/scripts/run_demo.py` which resets the log safely.
