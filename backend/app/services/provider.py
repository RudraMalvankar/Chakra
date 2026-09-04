from typing import Optional, Dict, Any, List
from pydantic import BaseModel
import os
import uuid
import razorpay
from razorpay.errors import SignatureVerificationError

class NormalizedPaymentEvent(BaseModel):
    provider: str
    provider_event_id: str
    payment_id: Optional[str] = None
    order_id: Optional[str] = None
    event_type: str
    status: str
    amount_inr: float
    currency: str = "INR"
    failure_reason: Optional[str] = None
    customer_id: Optional[str] = None
    raw_metadata: Dict[str, Any]

class PaymentProvider:
    def create_order(self, amount_inr: float, currency: str, customer_id: str) -> Dict[str, Any]:
        raise NotImplementedError
        
    def verify_webhook_signature(self, payload: str, signature: str, secret: str) -> bool:
        raise NotImplementedError

class RazorpayTestProvider(PaymentProvider):
    def __init__(self, key_id: str, key_secret: str):
        self.client = razorpay.Client(auth=(key_id, key_secret))
        
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
        
    def verify_webhook_signature(self, payload: str, signature: str, secret: str) -> bool:
        try:
            self.client.utility.verify_webhook_signature(payload, signature, secret)
            return True
        except SignatureVerificationError:
            return False

class SyntheticPaymentProvider(PaymentProvider):
    def create_order(self, amount_inr: float, currency: str, customer_id: str) -> Dict[str, Any]:
        return {
            "order_id": f"order_synth_{uuid.uuid4().hex[:8]}",
            "amount_inr": amount_inr,
            "provider": "synthetic"
        }
        
    def verify_webhook_signature(self, payload: str, signature: str, secret: str) -> bool:
        return True

def get_payment_provider() -> PaymentProvider:
    rzp_key = os.getenv("RAZORPAY_KEY_ID")
    rzp_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if rzp_key and rzp_secret:
        return RazorpayTestProvider(key_id=rzp_key, key_secret=rzp_secret)
    return SyntheticPaymentProvider()
