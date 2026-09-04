import httpx
from typing import Dict, Any, List
from backend.app.config import settings
import os
import uuid
import razorpay
from razorpay.errors import SignatureVerificationError

class PaymentProvider:
    def create_order(self, amount_inr: float, currency: str, customer_id: str) -> Dict[str, Any]:
        raise NotImplementedError
        
    def verify_webhook_signature(self, payload: bytes, signature: str, secret: str) -> bool:
        raise NotImplementedError

    async def retry_payment(self, payment_id: str, delay_hours: int) -> Dict[str, Any]:
        raise NotImplementedError
        
    async def create_payment_link(self, customer_id: str, amount: int, template: str, payment_id: str) -> Dict[str, Any]:
        raise NotImplementedError

    async def get_payments(self) -> List[Dict[str, Any]]:
        raise NotImplementedError

class RazorpayTestProvider(PaymentProvider):
    def __init__(self, key_id: str, key_secret: str):
        self.key_id = key_id
        self.key_secret = key_secret
        self.client = razorpay.Client(auth=(key_id, key_secret))
        self.base_url = "https://api.razorpay.com"
        
    def create_order(self, amount_inr: float, currency: str, customer_id: str) -> Dict[str, Any]:
        order = self.client.order.create({
            "amount": int(amount_inr * 100),
            "currency": currency,
            "receipt": f"rcpt_{uuid.uuid4().hex[:8]}",
            "notes": {
                "customer_id": customer_id
            }
        })
        return {
            "order_id": order["id"],
            "amount_inr": amount_inr,
            "provider": "razorpay_test"
        }
        
    def verify_webhook_signature(self, payload: bytes, signature: str, secret: str) -> bool:
        try:
            self.client.utility.verify_webhook_signature(payload.decode('utf-8'), signature, secret)
            return True
        except SignatureVerificationError:
            return False

    async def retry_payment(self, payment_id: str, delay_hours: int) -> Dict[str, Any]:
        # Razorpay does not expose a generic /v1/payments/{id}/retry endpoint.
        # Direct retries must be managed by the provider's subscription/checkout flow or payment links.
        return {
            "status": "failed", 
            "error": "unsupported_operation", 
            "message": "Direct generic retry API not supported by Razorpay Test Mode. Represented as provider-managed retry."
        }

    async def create_payment_link(self, customer_id: str, amount: int, template: str, payment_id: str) -> Dict[str, Any]:
        payload = {"customer": {"contact": "9999999999", "email": "test@example.com"}, "amount": amount, "currency": "INR", "notes": {"payment_id": payment_id, "template": template}}
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/v1/payment_links", json=payload, auth=(self.key_id, self.key_secret))
            if response.status_code == 200:
                return response.json()
            return {"status": "failed"}

    async def get_payments(self) -> List[Dict[str, Any]]:
        # This gets real payments from Razorpay test mode
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/v1/payments", auth=(self.key_id, self.key_secret))
            if response.status_code == 200:
                return response.json().get("items", [])
            return []


class SyntheticPaymentProvider(PaymentProvider):
    def __init__(self):
        self.base_url = settings.mock_razorpay_url

    def create_order(self, amount_inr: float, currency: str, customer_id: str) -> Dict[str, Any]:
        return {
            "order_id": f"order_synth_{uuid.uuid4().hex[:8]}",
            "amount_inr": amount_inr,
            "provider": "synthetic"
        }
        
    def verify_webhook_signature(self, payload: bytes, signature: str, secret: str) -> bool:
        import hmac, hashlib
        expected_mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected_mac, signature.strip())

    async def retry_payment(self, payment_id: str, delay_hours: int) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                response = await client.post(f"{self.base_url}/v1/payments/{payment_id}/retry")
                if response.status_code == 200:
                    return response.json()
                return {"status": "failed", "error": f"HTTP {response.status_code}"}
            except httpx.RequestError as e:
                return {"status": "failed", "error": "network_error", "message": str(e)}

    async def create_payment_link(self, customer_id: str, amount: int, template: str, payment_id: str) -> Dict[str, Any]:
        payload = {"customer": {"id": customer_id}, "amount": amount, "notes": {"payment_id": payment_id, "template": template}}
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                response = await client.post(f"{self.base_url}/v1/payment_links", json=payload)
                if response.status_code == 200:
                    return response.json()
                return {"status": "failed", "error": f"HTTP {response.status_code}"}
            except httpx.RequestError as e:
                return {"status": "failed", "error": "network_error", "message": str(e)}

    async def get_payments(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                response = await client.get(f"{self.base_url}/v1/payments")
                if response.status_code == 200:
                    return response.json().get("items", [])
            except httpx.RequestError:
                pass
            return []


def get_payment_provider() -> PaymentProvider:
    rzp_key = os.getenv("RAZORPAY_KEY_ID")
    rzp_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if rzp_key and rzp_secret:
        return RazorpayTestProvider(key_id=rzp_key, key_secret=rzp_secret)
    return SyntheticPaymentProvider()

# For backwards compatibility with other files using razorpay_client
razorpay_client = get_payment_provider()
