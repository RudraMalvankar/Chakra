# Razorpay AI Buildathon — Submission Checklist

## Required for Submission (Google Form)

- [ ] **Public GitHub repo** with all code
- [ ] **5-minute pitch video** (YouTube unlisted, Loom, or Google Drive link)
- [ ] **Architecture document** — done (`docs/architecture.md`)
- [ ] **README with quickstart** — done

## Demo Artifacts

- [x] `audit_log.jsonl` — every decision + outcome
- [x] `metrics_report.json` — recovery rate, escalation count

## Code Completeness

- [x] Hard-coded safety rules (AFA + network caps)
- [x] PII redaction before all LLM calls
- [x] Idempotency keys on all write actions
- [x] Graceful Gemini fallback (escalation on failure)
- [x] Honest simulation disclosure
- [x] Unit tests for safety + triage

## What This Project Does NOT Claim

- Real Razorpay API calls (we used the mock server)
- Production recovery rates (simulated, not measured)
- Real bank behavior modeling (synthetic test data)
- Legal/compliance certification

See `docs/methodology.md` for the full honest disclosure.

## Pre-Submission Steps (Do These Last)

1. [ ] Run `python backend/scripts/trigger_webhooks.py` — verify no errors
2. [ ] Run `pytest -q` — verify all tests pass
3. [ ] Commit everything: `git add . && git commit -m "Final Submission"`
4. [ ] Push to GitHub: `git push origin main`
5. [ ] Record 5-min video following `docs/PITCH_SCRIPT.md`
