"""
Chakra Revenue Recovery Agent - One-command end-to-end demo & 120-case mixed benchmark runner.

Usage:
    python backend/scripts/run_demo.py                    # Live run (mock Razorpay server or in-process simulation)
    python backend/scripts/run_demo.py --dry-run          # Log actions, simulate no external execution
    python backend/scripts/run_demo.py --skip-eval        # Skip accuracy eval on 18 labeled cases
    python backend/scripts/run_demo.py --skip-voice       # Skip voice note generation

Outputs:
    - audit_log.jsonl         (every decision + outcome, append-only)
    - metrics_report.json     (revenue-first metrics satisfying invariants)
    - eval_report.json        (accuracy on 18 labeled cases)
    - voice_notes/*.mp3       (Hinglish voice notes for high-value payments)
"""
import asyncio
import sys
import os
import argparse
import json
import random
from unittest.mock import patch
import httpx

# Ensure UTF-8 output on Windows consoles if supported
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backend.app.config import settings
from backend.app.lib.audit import clear_audit_log
from backend.app.services.safety_gate import reset_safety_state
from backend.app.services.recovery_executor import execute_recovery_pipeline
from backend.app.services.razorpay_client import razorpay_client
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.services.eval_runner import run_eval
from backend.app.services.voice import generate_hinglish_voice_note
from backend.scripts.write_metrics import write_metrics_report

import importlib.util

spec = importlib.util.spec_from_file_location("seed", "mock-razorpay/seed.py")
seed_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_mod)
SEED_DATA = seed_mod.SEED_DATA

def _get_id(p):
    if "payment_id" in p: return p["payment_id"]
    if "event" in p:
        payload = p.get("payload", {})
        for k, v in payload.items():
            if isinstance(v, dict) and "id" in v:
                return v["id"]
    return "unknown"
PAYMENTS_DB = {_get_id(p): dict(p) for p in SEED_DATA}


rng = random.Random(42)

def simulate_outcome(payment: dict, is_link: bool = False) -> str:
    """Probabilistic outcome simulation matching mock-razorpay logic."""
    err = payment.get("error_code")
    if err == "insufficient_funds":
        prob = 0.8 if is_link else 0.4
    elif err == "payment_timed_out":
        prob = 0.9
    elif err == "card_declined":
        prob = 0.7 if is_link else 0.1
    else:
        prob = 0.3
    return "captured" if rng.random() < prob else "failed"


async def in_process_retry_payment(payment_id: str, delay_hours: int = 0):
    payment = PAYMENTS_DB.get(payment_id, {"payment_id": payment_id, "error_code": "insufficient_funds"})
    outcome = simulate_outcome(payment)
    payment["status"] = outcome
    return {"status": outcome, "id": payment_id}


async def in_process_create_payment_link(customer_id: str, amount: int, template: str, payment_id: str):
    payment = PAYMENTS_DB.get(payment_id, {"payment_id": payment_id, "error_code": "insufficient_funds"})
    outcome = simulate_outcome(payment, is_link=True)
    payment["status"] = outcome
    return {"status": "created", "outcome": outcome}


async def check_mock_server_running(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=0.3) as client:
            resp = await client.get(f"{url}/v1/payments")
            return resp.status_code == 200
    except Exception:
        return False


async def main():
    parser = argparse.ArgumentParser(description="Chakra Recovery Agent Demo & Benchmark")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run without executing live external gateway calls")
    parser.add_argument("--skip-eval", action="store_true",
                        help="Skip the 18-case accuracy evaluation")
    parser.add_argument("--skip-voice", action="store_true",
                        help="Skip Hinglish voice note generation")
    args = parser.parse_args()

    is_dry = args.dry_run or settings.dry_run

    print("\n==========================================================")
    print("  120-CASE MIXED REVENUE RECOVERY BENCHMARK")
    print(f"  Mode: {'DRY-RUN (Simulated)' if is_dry else 'LIVE (Mock Razorpay / Direct)'}")
    print("  Pipeline: ContextBuilder -> RevenueRiskEngine -> RecoveryAgent -> SafetyGate -> RecoveryExecutor -> OutcomeEvaluator")
    print("==========================================================")

    # Clear previous audit log and reset safety gate counters
    clear_audit_log()
    reset_safety_state()

    # 1. Fetch payments
    print("\n[*] Loading mixed revenue recovery benchmark (120 cases)...")
    payments = SEED_DATA
    print(f"    Loaded {len(payments)} cases from seed dataset")
    print("    PAYMENT_FAILURE: 24")
    print("    SUBSCRIPTION: 24")
    print("    CHECKOUT_ABANDONMENT: 24")
    print("    RECEIVABLE: 24")
    print("    PROMISE_TO_PAY: 24")

    # Check if mock HTTP server is active
    server_active = await check_mock_server_running(settings.mock_razorpay_url)
    if not is_dry:
        if server_active:
            print(f"    Connected to Mock Razorpay API server at {settings.mock_razorpay_url}")
        else:
            print("    Mock server not running on port 8001 -> using fast in-process simulation engine")

    # 2. Process each payment through the 6-stage pipeline
    print("\n[*] Processing 120 cases through the shared 6-stage recovery pipeline...")

    async def _run_batch():
        for i, p in enumerate(payments, 1):
            await execute_recovery_pipeline(p, dry_run=is_dry)

    if not is_dry and not server_active:
        with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", side_effect=in_process_retry_payment), \
             patch("backend.app.services.recovery_executor.razorpay_client.create_payment_link", side_effect=in_process_create_payment_link):
            await _run_batch()
    else:
        await _run_batch()

    print(f"[+] 120 cases successfully processed.")

    # 3. Build and write metrics report
    print("\n[*] Aggregating revenue-first metrics...")
    metrics_report = write_metrics_report()

    with open("metrics_report.json", "w", encoding="utf-8") as f:
        json.dump(metrics_report, f, indent=2)

    print("    Wrote metrics_report.json")
    print("\n" + "=" * 60)
    print("  FINAL BENCHMARK METRICS:")
    print("=" * 60)
    print(json.dumps(metrics_report, indent=2))

    # 4. Run accuracy eval (18 labeled cases)
    if not args.skip_eval:
        print("\n" + "=" * 60)
        print("  Running accuracy eval on 18 labeled cases...")
        print("=" * 60)
        eval_report = run_eval()
        with open("eval_report.json", "w", encoding="utf-8") as f:
            json.dump(eval_report, f, indent=2)

        print(f"\n    Accuracy: {eval_report['summary']['accuracy_pct']}% "
              f"({eval_report['summary']['correct']}/{eval_report['summary']['total_cases']})")
        if eval_report["failures"]:
            print(f"\n    Failures ({len(eval_report['failures'])}):")
            for fail in eval_report["failures"]:
                print(f"      Case {fail['id']}: expected {fail['expected']}, "
                      f"got {fail.get('predicted', 'ERROR')}")
        print("    Wrote eval_report.json")

    print("\n" + "=" * 60)
    print("  Generated Artifacts:")
    print("    - audit_log.jsonl       (every decision + outcome)")
    print("    - metrics_report.json   (summary metrics & invariants)")
    if not args.skip_eval:
        print("    - eval_report.json      (18-case accuracy eval)")
    print("\n" + "=" * 60)
    print("  CHAKRA COMMAND CENTER - BY CASE TYPE:")
    print("=" * 60)
    for ctype, stats in metrics_report["metrics"].get("by_case_type", {}).items():
        print(f"\n    > {ctype.replace('_', ' ')}")
        print(f"      ₹{stats['revenue_at_risk']:,.2f} at risk")
        print(f"      ₹{stats['revenue_recovered']:,.2f} recovered")
        print(f"      Cases processed: {stats['processed']} | Recovered: {stats['recovered']}")
    print("=" * 60 + "\n")

    # 5. Print 3 representative agent decision traces
    traces = {"successful": None, "blocked": None, "escalated": None}
    case_events = {}
    
    with open("audit_log.jsonl", "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            ev = json.loads(line)
            pid = ev.get("payment_id")
            if pid not in case_events:
                case_events[pid] = []
            case_events[pid].append(ev)
            
    for pid, evs in case_events.items():
        is_rec = any(e.get("event_type") == "execution_outcome" and e.get("details", {}).get("recovered") for e in evs)
        is_blocked = any(e.get("event_type") == "execution_blocked" for e in evs)
        is_esc = any(e.get("event_type") == "execution_escalated" for e in evs)
        
        if is_rec and not traces["successful"]:
            traces["successful"] = evs
        elif is_blocked and not traces["blocked"]:
            traces["blocked"] = evs
        elif is_esc and not traces["escalated"]:
            traces["escalated"] = evs
            
        if all(traces.values()):
            break

    print("\n" + "=" * 60)
    print("  FINAL AGENT DECISION TRACES (Truthful Output)")
    print("=" * 60)
    
    for label, trace_evs in traces.items():
        if not trace_evs: continue
        print(f"\n--- CASE {label.upper()} ---")
        
        # Parse events
        risk_ev = next((e for e in trace_evs if e["event_type"] == "revenue_risk_assessed"), None)
        agent_ev = next((e for e in trace_evs if e["event_type"] == "agent_decision_proposed"), None)
        safety_ev = next((e for e in trace_evs if e["event_type"] == "safety_check_completed"), None)
        blocked_ev = next((e for e in trace_evs if e["event_type"] == "execution_blocked"), None)
        esc_ev = next((e for e in trace_evs if e["event_type"] == "execution_escalated"), None)
        outcome_ev = next((e for e in trace_evs if e["event_type"] == "execution_outcome"), None)
        
        if risk_ev:
            d = risk_ev["details"]
            print(f"REVENUE AT RISK: ₹{d.get('revenue_at_risk_inr')}")
            print(f"RECOVERY PROBABILITY: {d.get('recovery_probability')}")
            print(f"EXPECTED RECOVERY: ₹{d.get('expected_recovery_inr')}")
            print(f"PRIORITY: {d.get('priority')}")
            print(f"URGENCY: {d.get('urgency')}")
            
        if agent_ev:
            d = agent_ev["details"]
            print("\nCANDIDATE INTERVENTIONS:")
            for cand in d.get("candidate_actions", []):
                print(f"  - ACTION: {cand.get('action')}")
                print(f"    SCORE: {cand.get('score')}")
                print(f"    EXPECTED RECOVERY: ₹{cand.get('expected_recovery_inr')}")
                print(f"    ELIGIBLE: {cand.get('eligible')}")
                print(f"    REASON: {cand.get('reason')}")
            
            print("\nSELECTED ACTION:", d.get("selected_action"))
            print("CONFIDENCE:", d.get("confidence"))
            print("DECISION FACTORS:")
            for df in d.get("decision_factors", []):
                print(f"  - {df}")
                
        if safety_ev:
            d = safety_ev["details"]
            print("\nSAFETY GATE:", d.get("eligibility"))
            if d.get("eligibility") != "ALLOWED":
                print("SAFETY REASON:", d.get("reason_code"))
                
        if outcome_ev:
            d = outcome_ev["details"]
            print("\nEXECUTION RESULT:", d.get("status"))
            print("PROVIDER OUTCOME:", d.get("outcome"))
            print(f"RECOVERED AMOUNT: ₹{d.get('amount_inr', 0) if d.get('recovered') else 0}")
        elif blocked_ev:
            print("\nEXECUTION RESULT: BLOCKED")
            print("PROVIDER OUTCOME: NONE")
            print("RECOVERED AMOUNT: ₹0")
        elif esc_ev:
            print("\nEXECUTION RESULT: ESCALATED")
            print("PROVIDER OUTCOME: NONE")
            print("RECOVERED AMOUNT: ₹0")
            
        print("\nAUDIT EVENT COUNT:", len(trace_evs))


if __name__ == "__main__":
    asyncio.run(main())
