import httpx
from typing import Dict, Any, List
from backend.app.config import settings

class RazorpayClient:
    """Client for executing actual or mocked Razorpay recovery actions."""
    def __init__(self):
        self.is_mock = settings.use_mock_razorpay
        self.base_url = settings.mock_razorpay_url if self.is_mock else "https://api.razorpay.com"
        self.auth = (settings.razorpay_key_id, settings.razorpay_key_secret) if not self.is_mock else None

    async def get_payments(self) -> List[Dict[str, Any]]:
        """Fetches the failed payments from the webhook pool/server."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/v1/payments", auth=self.auth)
            response.raise_for_status()
            return response.json().get("items", [])

    async def retry_payment(self, payment_id: str, delay_hours: int) -> Dict[str, Any]:
        """Schedules a retry via API. Returns the simulated outcome."""
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/v1/payments/{payment_id}/retry", auth=self.auth)
            if response.status_code == 200:
                return response.json()
            return {"status": "failed", "payment_id": payment_id}

    async def create_payment_link(self, customer_id: str, amount: int, template: str, payment_id: str) -> Dict[str, Any]:
        """Creates a payment link. Returns the simulated outcome."""
        payload = {"customer": {"id": customer_id}, "amount": amount, "notes": {"payment_id": payment_id}}
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/v1/payment_links", json=payload, auth=self.auth)
            if response.status_code == 200:
                return response.json()
            return {"status": "failed"}

razorpay_client = RazorpayClient()
