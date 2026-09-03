# Chakra Pitch Script (5 Minutes)

## Setup
- Screen recording: 1080p, terminal in large font, no window chrome
- Audio: clear voice, no music, no background noise
- Format: close-up terminal + small face cam in corner (optional)

---

## 0:00 - 0:30 | The Problem

**[TERMINAL: title card, then a single number]**

> "UPI Autopay success rates have collapsed from 50% in 2024 to 30-36% in 2025. 20 million UPI Autopay mandates get revoked every month.
>
> Razorpay's own subscription retry is a fixed daily schedule. Same card. Same reason ignored. No awareness of why the payment failed.
>
> The result: ~25% recovery on failed recurring payments. The other 75% becomes involuntary churn — money you already earned, walking out the door."

---

## 0:30 - 1:00 | The Idea

**[TERMINAL: clean, show project structure]**

> "Chakra is a mandate-aware, regulation-aware recovery layer that sits between Razorpay's infrastructure and a merchant's failed payments.
>
> It asks the questions Razorpay's retry doesn't: Was this amount over the AFA threshold? Was this the first transaction on a new mandate? Have we already hit the network retry cap?
>
> Deterministic triage rules answer these in microseconds. For the ambiguous cases, Gemini — with PII redacted, with structured JSON output, with a graceful fallback if the API fails — picks the recovery path."

---

## 1:00 - 2:00 | The Live Demo

**[TERMINAL: run the command]**

```bash
python backend/scripts/trigger_webhooks.py
```

> "Let me show you. We seed 100 failed payments. The agent processes all 100.
>
> Watch what happens:
> - The fraud-flagged payments? Escalated. Hard-coded, no AI can override.
> - The mandate-revoked cases? Escalated. Customer consent is sacred.
> - The payments over the AFA threshold? Routed to a payment link with an OTP.
> - The insufficient_funds cases? Scheduled for retry.
>
> In our synthetic benchmark, we recover a significant chunk of revenue while the rest safely go to human review. Not because we failed — because they should."

---

## 2:00 - 2:30 | The Safety Gate

**[TERMINAL: show safety_gate.py file]**

> "Look at this file. safety_gate.py. Hard-coded rules. No AI can override these. The fraud flag will always block. The mandate revocation will always block.
>
> Even if Gemini hallucinates a reason to retry a fraud-flagged payment, this gate catches it first. The AI can only choose between compliant options. It cannot invent a new one."

---

## 2:30 - 3:00 | The Graceful Fallback

**[TERMINAL: show llm.py file]**

> "Now here's what happens when Gemini fails or is unavailable.
>
> Caught the API error. Logged it. Routed those payments to escalation. Kept processing the rest of the queue. 
>
> When the AI is unsure or unavailable, Chakra defaults to safety. It does not invent an answer."

---

## 3:00 - 4:00 | Why Razorpay

**[TERMINAL: show file structure, dependencies]**

> "Why this fits Razorpay:
>
> Chakra is not a replacement. It sits on top of existing APIs. It doesn't change how merchants charge — it changes how they recover.
>
> The PII redaction strips sensitive data. The network retry limits mirror operating guides. The safety rules represent real e-mandate constraints.
>
> This is what a technically credible prototype looks like."

---

## 4:00 - 4:30 | The Close

**[TERMINAL: final metrics card]**

> "Autonomous recovery on the simulation. Zero crashes when the AI fails. 100 payments in, 100 decisions out, every one auditable.
>
> This is Chakra. Mandate-aware, regulation-aware, audit-first revenue recovery.
>
> Thank you."
