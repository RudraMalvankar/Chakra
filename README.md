# Chakra
**Autonomous Revenue Recovery Agent**

*Track 03 — AI Revenue Recovery*

Chakra is a sophisticated fintech operational platform designed to act as an Autonomous Revenue Recovery Agent. It continuously monitors payment failures, evaluates revenue risk using a dedicated Risk Engine, selects appropriate recovery actions (like deferring retries, creating AFA payment links, or issuing reminders), enforces deterministic safety boundaries via a Safety Gate, and automatically executes recovery using a provider adapter.

**IMPORTANT:** Chakra is an integration demonstration. It performs **Razorpay Test Mode integration** exclusively and does not process real money.

## Architecture

The system operates via a strict, auditable recovery pipeline:
`Payment Failure (Webhook) -> Context Builder -> Revenue Risk Engine -> Recovery Agent (Candidate Selection) -> Safety Gate (Deterministic Enforcer) -> Recovery Executor -> Payment Provider -> Audit/Metrics`

Chakra ensures clear separation of concerns:
- **Backend:** FastAPI, providing the source of truth for all recovery actions, policy enforcements, and metrics.
- **Frontend:** React + TypeScript + Vite, an operational "Command Center" dashboard rendering the backend state.
- **Provider Adapters:** A robust `PaymentProvider` abstraction that seamlessly toggles between `RazorpayTestProvider` and `SyntheticPaymentProvider`.

## Razorpay Test Mode & Synthetic Gateway

Chakra supports two operational environments determined seamlessly by your configuration:

1. **Razorpay Test Mode:** If `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are provided, Chakra configures itself to integrate with actual Razorpay Test Mode APIs. Orders are generated dynamically against Razorpay, and the frontend launches the official checkout.js modal in Test Mode.
2. **Synthetic Gateway:** If no API keys are present, Chakra gracefully falls back to a Synthetic Gateway. This allows comprehensive end-to-end testing, failure injection, and demonstration of the recovery engine purely over localhost without external dependencies. 

*Synthetic Benchmark Disclaimer: All preset benchmarks run through the "Synthetic Gateway" are deliberate simulations testing the logic pipeline. They are not historical Razorpay transaction logs.*

## Local Setup & Environment Variables

Create a `.env` file in the root of the project (or inside `backend/`):
```env
# Optional: Provide these to enable Razorpay Test Mode. 
# DO NOT USE PRODUCTION CREDENTIALS.
RAZORPAY_KEY_ID=rzp_test_your_key_here
RAZORPAY_KEY_SECRET=your_test_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here

# For LLM-assisted ambiguity classification in the agent (optional)
GEMINI_API_KEY=your_gemini_api_key
```

## Running the Application

**1. Backend Server**
From the root directory:
```bash
pip install -r requirements.txt
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8001
```

**2. Synthetic Gateway Server** (Required if Razorpay Test Mode is not used)
```bash
python -m uvicorn mock-razorpay.main:app --host 0.0.0.0 --port 8002
```

**3. Frontend Command Center**
```bash
cd frontend
npm install
npm run dev -- --port 3000
```

## Webhook Setup & Localhost Limitations

Chakra correctly exposes `POST /webhooks/razorpay` to process Razorpay Test Mode webhooks (validating HMAC SHA-256 signatures and ensuring idempotency).
**Localhost Limitation:** Razorpay cannot natively route webhooks to `localhost:8001`. To receive real external webhooks during local development, you must expose your backend via a tunneling service (like `ngrok`):
```bash
ngrok http 8001
```
Configure your Razorpay Test Dashboard to point to `https://<your-ngrok-url>/webhooks/razorpay`. 
For demonstration purposes without ngrok, the frontend Simulator intercepts the browser `checkout.js` error callback and posts the mock payload to the backend's simulation endpoint to guarantee the demo flow executes locally.

## Test Commands

Run the full Python test suite (ensuring 168 passing tests):
```bash
python -m pytest -q backend/tests
```

Run the frontend linter and build:
```bash
cd frontend
npm run lint
npm run build
```

## CI/CD Pipeline

Chakra includes a professional CI/CD pipeline managed via GitHub Actions (`.github/workflows/ci-cd.yml`).

### CI (Continuous Integration)
The CI pipeline runs automatically on all `push` and `pull_request` events targeting the `main` branch. It ensures system integrity by verifying:
- **Backend**: Sets up Python 3.11, installs dependencies via `requirements.txt`, and runs the full Pytest suite (`python -m pytest -q backend/tests`).
- **Frontend**: Sets up Node 20, installs dependencies (`npm ci`), and runs strict linting (`npm run lint`) and production builds (`npm run build`).

*Note: CI explicitly runs without Razorpay API keys, seamlessly falling back to the Synthetic Gateway to guarantee reproducible and dependency-safe verification.*

### CD (Continuous Delivery)
When CI successfully passes on the `main` branch, the CD pipeline builds containerized artifacts and publishes them to the GitHub Container Registry (GHCR). 
- `chakra-backend:latest`: Built via `backend/Dockerfile`.
- `chakra-frontend:latest`: Built via `frontend/Dockerfile` (multi-stage Nginx container).

Deployment activation is strictly contingent upon successful CI completion; untested or failing code is never built for delivery.

### Reproducing CI Checks Locally
To mirror the CI verification on your local machine, run the following commands:
```bash
# Backend Verification
python -m pytest -q backend/tests

# Frontend Verification
cd frontend
npm ci
npm run lint
npm run build
```
