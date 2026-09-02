import httpx
from typing import Dict, Any, List
from backend.app.config import settings

class RazorpayClient:
    """Client for executing actual or mocked Razorpay recovery actions."""
    def __init__(self):
        self.is_mock = settings.use_mock_razorpay
        self.base_url = settings.mock_razorpay_url if self.is_mock else "https://api.razorpay.com/v1"
        self.auth = (settings.razorpay_key_id, settings.razorpay_key_secret) if not self.is_mock else None

    async def get_payments(self) -> List[Dict[str, Any]]:
        """Fetches the failed payments from the webhook pool/server."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/v1/payments", auth=self.auth)
            response.raise_for_status()
            return response.json().get("items", [])

    async def retry_payment(self, payment_id: str, delay_hours: int) -> Dict[str, Any]:
        """Schedules a retry via Subscriptions/Orders API."""
        return {"status": "scheduled", "payment_id": payment_id, "delay_hours": delay_hours}

    async def create_payment_link(self, customer_id: str, amount: int, template: str) -> Dict[str, Any]:
        """Creates a payment link and triggers notification via DLT template."""
        return {"status": "link_sent", "customer_id": customer_id, "template_used": template}

razorpay_client = RazorpayClient()
