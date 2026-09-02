import asyncio
import sys
import os
import argparse
import json
import httpx
import hmac
import hashlib

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from backend.app.config import settings

def generate_signature(body: str, secret: str) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()

async def fetch_and_trigger():
    print("📥 Fetching seeded failed payments from Mock Razorpay API (Port 8001)...")
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{settings.mock_razorpay_url}/v1/payments")
            res.raise_for_status()
            payments = res.json().get("items", [])
        except Exception as e:
            print(f"❌ Failed to fetch from mock server: {e}")
            print("Make sure it is running: uvicorn mock-razorpay.main:app --port 8001")
            return

    print(f"🚀 Triaging {len(payments)} payments through Chakra Ingestion API (Port 8000)...")
    
    async with httpx.AsyncClient() as client:
        for p in payments:
            # Construct standard Razorpay webhook payload
            webhook_payload = {
                "event": "payment.failed",
                "payload": {
                    "payment": {
                        "entity": p
                    }
                }
            }
            body_str = json.dumps(webhook_payload)
            sig = generate_signature(body_str, settings.webhook_secret)
            
            try:
                res = await client.post(
                    "http://localhost:8000/webhooks/razorpay",
                    content=body_str,
                    headers={"x-razorpay-signature": sig, "Content-Type": "application/json"},
                    timeout=10.0
                )
                if res.status_code != 200:
                    print(f"Failed to trigger webhook for {p['payment_id']}: {res.status_code} {res.text}")
            except httpx.ReadTimeout:
                # Due to LLM calls and synchronous iteration in this simple demo script, timeouts may happen
                # In real life, webhooks are placed on a queue.
                pass
            except Exception as e:
                print(f"Webhook connection error: {e}")

    print("\n✅ Webhook ingestion complete. Check audit_log.jsonl or dashboard for metrics.")

if __name__ == "__main__":
    asyncio.run(fetch_and_trigger())
