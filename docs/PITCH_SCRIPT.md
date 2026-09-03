# Chakra Pitch Script (5 Minutes)

## Setup
- Screen recording: 1080p, terminal in large font, no window chrome
- Audio: clear voice, no music, no background noise
- Format: close-up terminal + small face cam in corner (optional)

---

## 0:00 - 0:30 | The Problem

**[TERMINAL: title card, then a single number]**

> "UPI Autopay success rates have collapsed from 50% in 2024 to 30-36% in 2025. SBI processed 2.13 billion UPI AutoPay transactions in August — only 36% went through. Airtel Payments Bank: 10.5%. 20 million UPI Autopay mandates get revoked every month.
>
> Razorpay's own subscription retry is a fixed T+1, T+2, T+3 daily schedule. Same card. Same reason ignored. No awareness of why the payment failed.
>
> The result: ~25% recovery on failed recurring payments. The other 75% becomes involuntary churn — money you already earned, walking out the door."

---

## 0:30 - 1:00 | The Idea

**[TERMINAL: clean, show project structure]**

> "Chakra is a mandate-aware, regulation-aware recovery layer that sits between Razorpay's infrastructure and a merchant's failed payments.
>
> It asks the questions Razorpay's retry doesn't: Was this amount over the ₹15,000 AFA threshold? Was this the first transaction on a new mandate? Has this customer already ignored 3 pre-debit alerts? Have we already hit the Visa 15/30 day retry cap?
>
> Rules answer these in microseconds. For the ambiguous cases, Gemini — with PII redacted, with structured JSON output, with a graceful fallback if the API fails — picks the recovery path."

---

## 1:00 - 2:00 | The Live Demo

**[TERMINAL: run the command]**

```bash
python backend/scripts/run_demo.py
```

> "Let me show you. We seed 100 failed payments — a mix of insufficient funds, card declines, expired cards, fraud flags, mandate revocations. The agent processes all 100.
>
> Watch what happens:
> - The 5 fraud-flagged payments? Escalated. Hard-coded, no AI can override.
> - The mandate-revoked cases? Escalated. Customer consent is sacred.
> - The payments over ₹15K? Routed to a payment link with an OTP. The AFA threshold rule.
> - The first transactions? Same — OTP required by RBI.
> - The insufficient_funds cases? Scheduled for retry, with salary-day timing.
> - Two of them already at the Visa 15-retries cap? Escalated, not retried. Avoid the $2 fine and the merchant monitoring flag.
>
> Total recovered: 58 of 100. The other 42 went to human review. Not because we failed — because they should."

---

## 2:00 - 2:30 | The Dry Run

**[TERMINAL: same command with --dry-run flag]**

```bash
python backend/scripts/run_demo.py --dry-run
```

> "Here's the same pipeline in dry-run mode. No Razorpay calls, no customer messages, no retries scheduled. Every action logged, every decision explained.
>
> This is the production-grade safety pattern: ship the recovery agent in dry-run first, watch the audit log, then flip the switch. Same code path, same compliance rules, zero risk."

---

## 2:30 - 3:00 | The Graceful Fallback

**[TERMINAL: show audit log with 429 events]**

> "Now here's what happens when Gemini fails.
>
> During a real run, we hit Google AI Studio's 15-requests-per-minute free-tier rate limit. Most hackathon projects would crash. Here's what Chakra did:
>
> [scroll audit log]
>
> Caught the API error. Logged it. Routed those payments to escalation. Kept processing the rest of the queue. 100 in, 100 accounted for, 58 autonomous recoveries, 42 safe escalations.
>
> When the AI is unsure or unavailable, Chakra defaults to safety. It does not invent an answer."

---

## 3:00 - 3:30 | The Hard-Coded Floor

**[TERMINAL: show compliance.py file]**

> "Look at this file. compliance.py. Hard-coded rules. No AI can override these. The fraud flag will always escalate. The mandate revocation will always escalate. The first transaction will always require an OTP.
>
> Even if Gemini hallucinates a reason to retry a fraud-flagged payment, this gate catches it first. The AI can only choose between compliant options. It cannot invent a new one."

---

## 3:30 - 4:00 | The Eval

**[TERMINAL: show eval_report.json]**

> "18 hand-labeled edge cases. Each one is a real Razorpay error scenario mapped against RBI rules and card network constraints.
>
> [show eval summary]
>
> Chakra correctly classifies 16 of 18 — 88.9% accuracy. The 2 failures are documented: a confidence-gated case and a network-cap boundary. Both are flagged for future improvement, not hidden.
>
> And here's the honest disclosure: this is a synthetic environment. Real bank behavior will differ. We don't know if Chakra recovers 58% in production. We know it routes correctly, escalates safely, and recovers in simulation. Production testing is the next step."

---

## 4:00 - 4:30 | Why Razorpay

**[TERMINAL: show file structure, dependencies]**

> "Why this fits Razorpay:
>
> Chakra is not a replacement. It sits on top of Subscriptions, Orders, and Payment Links APIs. It doesn't change how merchants charge — it changes how they recover.
>
> The PII redaction follows DPDP Act 2023. The template system follows DLT registration requirements. The network retry limits match Visa and Mastercard operating guides. The compliance rules encode RBI's 2021 e-mandate framework.
>
> This is what production-grade payments engineering looks like. Built in 3 days, designed for 100K payments per day."

---

## 4:30 - 5:00 | The Close

**[TERMINAL: final metrics card]**

> "58% autonomous recovery on the simulation. 88.9% accuracy on the eval set. Zero crashes when the AI fails. 100 payments in, 100 decisions out, every one auditable.
>
> This is Chakra. Mandate-aware, regulation-aware, audit-first revenue recovery.
>
> Thank you."

---

## Post-Production Notes

- **B-roll shots:** Use `tree backend/`, `cat audit_log.jsonl | head -20`, `pytest -v`
- **Cut list:** If running long, cut 2:30-3:00 (graceful fallback) to 30 seconds
- **Music:** Optional ambient, fade in/out, never over voice
- **Captions:** Required — English + Hindi (track this for accessibility)
- **CTA:** End with GitHub link + "Apply for the AI Builder Intern role at Razorpay"
