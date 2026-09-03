# Chakra Pitch Script (5 Minutes)

## Setup
- Screen recording: 1080p, terminal in large font, no window chrome
- Audio: clear voice, no music, no background noise
- Format: close-up terminal + small face cam in corner (optional)

---

## 0:00 - 0:30 | The Problem

**[TERMINAL: title card, then a single number]**

> "Recurring payment failures, abandoned checkouts, and overdue receivables create significant revenue leakage.
>
> Fixed retry strategies or generic notification bots may not adapt to why a payment failed. This can lead to involuntary churn — money you already earned, walking out the door."

---

## 0:30 - 1:00 | The Idea

**[TERMINAL: clean, show project structure]**

> "Chakra is an Autonomous Revenue Recovery Agent. Our tagline: DETECT. DECIDE. RECOVER. PROVE.
>
> Instead of just blindly retrying a failed payment, Chakra assesses the actual revenue at risk. It acts as an agentic decision layer, proposing the highest-conversion intervention—whether that's a silent retry, a checkout payment link, or a Hinglish voice call.
>
> Most importantly: AI proposes, but deterministic policy constrains. Chakra will never bypass AFA limits, ignore retry caps, or retry a revoked mandate."

---

## 1:00 - 2:00 | The Live Demo

**[TERMINAL: run the command]**

```bash
python backend/scripts/run_demo.py
```

> "Let me show you. We seed a perfectly balanced 120-case synthetic benchmark encompassing all five Track 03 scenarios: Payments, Subscriptions, Abandoned Checkouts, Receivables, and Promises to Pay. 
> 
> The pipeline executes instantly. The Revenue Risk Engine calculates the opportunity. The Recovery Agent selects the action. The Safety Gate enforces rules. And the clean Executor interacts with the provider."

---

## 2:00 - 3:30 | The Results & Proof

**[TERMINAL: show the final metrics printout]**

> "The result? Chakra processed 120 cases. It blocked 13 cases that violated safety rules. It successfully recovered ₹1,950,019 out of ₹3,560,390 at risk.
>
> We don't measure success by how many emails we sent. We measure success by provider-confirmed revenue actually captured. We hit an intervention success rate of over 77% while safely halting unrecoverable cases."

---

## 3:30 - 5:00 | Audit & Conclusion

**[TERMINAL: tail the audit log]**

> "Every single decision, safety check, and provider outcome is logged in a structured, PII-redacted audit trail. There's no hidden chain of thought. You see exactly why the agent chose a payment link, and exactly why the safety gate allowed it.
>
> Chakra doesn't just identify the problem. It proves measured money recovered across a batch, with compliant escalation, strict stopping rules, and full auditability."
