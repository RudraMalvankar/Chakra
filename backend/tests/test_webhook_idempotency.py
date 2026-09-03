import pytest
import hmac
import hashlib
import json
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.config import settings

client = TestClient(app)

def generate_signature(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

def test_webhook_missing_signature():
    response = client.post("/webhooks/razorpay", content=b"{}")
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing signature"

def test_webhook_invalid_signature():
    response = client.post(
        "/webhooks/razorpay",
        content=b"{}",
        headers={"x-razorpay-signature": "invalid_sig"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid signature"

def test_webhook_malformed_json():
    body = b"not_a_json"
    sig = generate_signature(body, settings.webhook_secret)
    response = client.post(
        "/webhooks/razorpay",
        content=body,
        headers={"x-razorpay-signature": sig}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Malformed JSON payload"

def test_webhook_idempotency():
    payload = {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "payment_id": "pay_test_idemp_1",
                    "amount_inr": 1000.0,
                    "error_code": "insufficient_funds"
                }
            }
        }
    }
    body = json.dumps(payload).encode("utf-8")
    sig = generate_signature(body, settings.webhook_secret)
    event_id = "evt_12345"

    # 1. First event processed
    response1 = client.post(
        "/webhooks/razorpay",
        content=body,
        headers={"x-razorpay-signature": sig, "x-razorpay-event-id": event_id}
    )
    assert response1.status_code == 200
    assert response1.json()["status"] == "ok"

    # 2 & 3. Same event submitted twice (duplicate) -> should return ignored
    response2 = client.post(
        "/webhooks/razorpay",
        content=body,
        headers={"x-razorpay-signature": sig, "x-razorpay-event-id": event_id}
    )
    assert response2.status_code == 200
    assert response2.json()["status"] == "ignored"
    assert response2.json()["reason"] == "duplicate_webhook"

    # 7. Different event ID with identical payload -> should process
    event_id_2 = "evt_67890"
    response3 = client.post(
        "/webhooks/razorpay",
        content=body,
        headers={"x-razorpay-signature": sig, "x-razorpay-event-id": event_id_2}
    )
    assert response3.status_code == 200
    assert response3.json()["status"] == "ok"
