"""
Chakra Revenue Recovery Agent - One command end-to-end demo.

Usage:
    python backend/scripts/run_demo.py                    # Real run (uses mock server)
    python backend/scripts/run_demo.py --dry-run          # Log actions, no execution
    python backend/scripts/run_demo.py --skip-eval        # Skip accuracy eval
    python backend/scripts/run_demo.py --skip-voice       # Skip voice note generation

Outputs:
    - audit_log.jsonl         (every decision + outcome)
    - metrics_report.json     (summary metrics)
    - eval_report.json        (accuracy on 18 labeled cases)
    - voice_notes/*.mp3       (Hinglish voice notes for high-value payments)
"""
import asyncio
import sys
import os
import argparse
import json

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backend.app.services.razorpay_client import razorpay_client
from backend.app.services.recover import process_failed_payment
from backend.app.lib.audit import clear_audit_log
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.services.eval_runner import run_eval
from backend.app.services.voice import generate_hinglish_voice_note, should_use_voice
from backend.app.services.notify import build_notification
from backend.app.config import settings


async def main():
    parser = argparse.ArgumentParser(description="Chakra Agent CLI")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run without executing real Razorpay calls")
    parser.add_argument("--skip-eval", action="store_true",
                        help="Skip the 18-case accuracy eval")
    parser.add_argument("--skip-voice", action="store_true",
                        help="Skip Hinglish voice note generation")
    args = parser.parse_args()

    is_dry = args.dry_run or settings.dry_run

    print(f"\n🚀 Chakra Revenue Recovery Agent")
    print(f"   Mode: {'DRY-RUN (no real actions)' if is_dry else 'LIVE (mock Razorpay)'}")
    print(f"   Mock server: {settings.use_mock_razorpay}")
    print("----------------------------------------------------------")

    clear_audit_log()

    # 1. Fetch payments
    print("📥 Fetching failed payments...")
    try:
        if settings.use_mock_razorpay:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "seed", "mock-razorpay/seed.py"
            )
            seed_mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(seed_mod)
            payments = seed_mod.SEED_DATA
            print(f"   Loaded {len(payments)} mock payments from local seed")
        else:
            payments = await razorpay_client.get_payments()
            print(f"   Fetched {len(payments)} failed payments from Razorpay")
    except Exception as e:
        print(f"❌ Failed to fetch payments: {e}")
        return

    # 2. Process each payment
    print(f"\n⚙️  Triaging & Executing Recovery Paths...")
    voice_count = 0
    for p in payments:
        await process_failed_payment(p, dry_run=is_dry)

        # Generate voice note for high-value payments (if not dry-run, after execution)
        if not is_dry and not args.skip_voice and should_use_voice(p):
            amount_inr = int(p.get("amount", 0) / 100)
            customer_name = f"customer_{p.get('customer_id', 'unknown')[-4:]}"
            audio_path = generate_hinglish_voice_note(
                customer_name=customer_name,
                amount_inr=amount_inr,
                payment_link=f"https://rzp.io/l/{p.get('payment_id', 'recover')[:8]}",
            )
            if audio_path:
                voice_count += 1

    print(f"\n✅ Processing complete. {voice_count} voice notes generated.")

    # 3. Build and write metrics report
    print("\n📊 Aggregating metrics...")
    metrics = generate_metrics_report()
    metrics["voice_notes_generated"] = voice_count
    if os.path.exists("audit_log.jsonl"):
        with open("audit_log.jsonl", "r") as f:
            metrics["audit_event_count"] = sum(1 for line in f if line.strip())

    with open("metrics_report.json", "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"📄 Wrote metrics_report.json")
    print(f"\n{'='*60}")
    print(f"📊 FINAL DEMO METRICS:")
    print(f"{'='*60}")
    print(json.dumps(metrics, indent=2))

    # 4. Run eval (credibility test)
    if not args.skip_eval:
        print(f"\n{'='*60}")
        print(f"🎯 Running accuracy eval on 18 labeled cases...")
        print(f"{'='*60}")
        eval_report = run_eval()
        with open("eval_report.json", "w") as f:
            json.dump(eval_report, f, indent=2)

        print(f"\n   Accuracy: {eval_report['summary']['accuracy_pct']}% "
              f"({eval_report['summary']['correct']}/{eval_report['summary']['total_cases']})")
        if eval_report["failures"]:
            print(f"\n   Failures ({len(eval_report['failures'])}):")
            for fail in eval_report["failures"]:
                print(f"     Case {fail['id']}: expected {fail['expected']}, "
                      f"got {fail.get('predicted', 'ERROR')}")
        print(f"\n📄 Wrote eval_report.json")

    print(f"\n{'='*60}")
    print(f"📝 Artifacts:")
    print(f"   - audit_log.jsonl       (every decision + outcome)")
    print(f"   - metrics_report.json   (summary metrics)")
    if not args.skip_eval:
        print(f"   - eval_report.json      (accuracy on 18 cases)")
    if not args.skip_voice and voice_count > 0:
        print(f"   - voice_notes/          ({voice_count} Hinglish voice notes)")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
