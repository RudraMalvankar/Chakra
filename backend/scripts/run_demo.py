import asyncio
import sys
import os
import argparse
import json

# Ensure backend module can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backend.app.services.razorpay_client import razorpay_client
from backend.app.services.recover import process_failed_payment
from backend.app.lib.audit import clear_audit_log
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.config import settings

async def main():
    parser = argparse.ArgumentParser(description="Chakra Agent CLI")
    parser.add_argument("--dry-run", action="store_true", help="Run without hitting execute endpoints")
    args = parser.parse_args()
    
    is_dry = args.dry_run or settings.dry_run
    
    print(f"\n🚀 Starting Chakra Revenue Recovery Agent (Dry Run: {is_dry})")
    print("----------------------------------------------------------")
    clear_audit_log() # Reset for demo
    
    print("📥 Fetching failed payments...")
    try:
        # NOTE: If not using mock server running on port 8001, we fetch directly from seed for demo simplicity
        if settings.use_mock_razorpay:
            import importlib.util
            spec = importlib.util.spec_from_file_location("seed", "mock-razorpay/seed.py")
            seed_mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(seed_mod)
            payments = seed_mod.SEED_DATA
            print(f"Loaded {len(payments)} mock payments from local seed (bypassing HTTP for demo stability).")
        else:
            payments = await razorpay_client.get_payments()
            print(f"Fetched {len(payments)} failed payments from Razorpay.")
            
    except Exception as e:
        print(f"❌ Failed to fetch payments: {e}")
        return

    print("⚙️ Triaging & Executing Recovery Paths...")
    for p in payments:
        await process_failed_payment(p, dry_run=is_dry)
        
    print("\n✅ Processing complete. Aggregating metrics...\n")
    metrics = generate_metrics_report()
    
    print("📊 FINAL DEMO METRICS:")
    print(json.dumps(metrics, indent=2))
    print("\n📝 View full JSONL audit trail in 'audit_log.jsonl'")

if __name__ == "__main__":
    asyncio.run(main())
