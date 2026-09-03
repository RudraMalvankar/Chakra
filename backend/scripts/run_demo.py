"""
Chakra Revenue Recovery Agent - One-command end-to-end demo & 100-payment benchmark runner.

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
from backend.app.services.voice import generate_hinglish_voice_note, should_use_voice
from backend.scripts.write_metrics import write_metrics_report

import importlib.util

spec = importlib.util.spec_from_file_location("seed", "mock-razorpay/seed.py")
seed_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_mod)
SEED_DATA = seed_mod.SEED_DATA

PAYMENTS_DB = {p["payment_id"]: dict(p) for p in SEED_DATA}


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
    print("  CHAKRA REVENUE RECOVERY AGENT - 100-PAYMENT BENCHMARK")
    print(f"  Mode: {'DRY-RUN (Simulated)' if is_dry else 'LIVE (Mock Razorpay / Direct)'}")
    print("  Pipeline: ContextBuilder -> TriageEngine -> MandateRouter -> SafetyGate -> RecoveryExecutor -> OutcomeEvaluator")
    print("==========================================================")

    # Clear previous audit log and reset safety gate counters
    clear_audit_log()
    reset_safety_state()

    # 1. Fetch payments
    print("\n[*] Loading failed payments benchmark (100 payments)...")
    payments = SEED_DATA
    print(f"    Loaded {len(payments)} mock payments from seed dataset")

    # Check if mock HTTP server is active
    server_active = await check_mock_server_running(settings.mock_razorpay_url)
    if not is_dry:
        if server_active:
            print(f"    Connected to Mock Razorpay API server at {settings.mock_razorpay_url}")
        else:
            print("    Mock server not running on port 8001 -> using fast in-process simulation engine")

    # 2. Process each payment through the 6-stage pipeline
    print("\n[*] Processing 100 payments through 6-stage recovery pipeline...")
    voice_count = 0

    async def _run_batch():
        nonlocal voice_count
        for i, p in enumerate(payments, 1):
            final_ctx = await execute_recovery_pipeline(p, dry_run=is_dry)

            # Generate voice note for eligible high-value payments
            if not is_dry and not args.skip_voice and should_use_voice(p):
                amount_inr = int(p.get("amount", 0) / 100)
                cust_id = p.get("customer_id", "unknown")
                customer_name = f"customer_{cust_id[-4:]}"
                audio_path = generate_hinglish_voice_note(
                    customer_name=customer_name,
                    amount_inr=amount_inr,
                    payment_link=f"https://rzp.io/l/{p.get('payment_id', 'recover')[:8]}",
                )
                if audio_path:
                    voice_count += 1

    if not is_dry and not server_active:
        with patch("backend.app.services.recovery_executor.razorpay_client.retry_payment", side_effect=in_process_retry_payment), \
             patch("backend.app.services.recovery_executor.razorpay_client.create_payment_link", side_effect=in_process_create_payment_link):
            await _run_batch()
    else:
        await _run_batch()

    print(f"[+] 100 payments successfully processed. ({voice_count} voice notes generated)")

    # 3. Build and write metrics report
    print("\n[*] Aggregating revenue-first metrics...")
    metrics_report = write_metrics_report()
    metrics_report["voice_notes_generated"] = voice_count

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
    if not args.skip_voice and voice_count > 0:
        print(f"    - voice_notes/          ({voice_count} Hinglish voice notes)")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
