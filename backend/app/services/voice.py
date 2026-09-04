"""
Voice Recovery Service - Twilio Provider Architecture.

Provides VoiceProvider, TwilioVoiceProvider, MockVoiceProvider abstractions.
Also maintains generate_hinglish_voice_note for backward compat with RecoveryExecutor.
AI intent extraction uses Gemini via gemini_classify with keyword-override fallback.
"""
import os
from typing import Dict, Any, Optional
import httpx
import json

from pydantic import BaseModel, Field


class VoiceProvider:
    async def start_call(self, to_number: str, context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class TwilioVoiceProvider(VoiceProvider):
    def __init__(self):
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        self.from_number = os.getenv("TWILIO_FROM_NUMBER")

    async def start_call(self, to_number: str, context: Dict[str, Any]) -> Dict[str, Any]:
        if not self.account_sid or not self.auth_token or not self.from_number:
            return {"status": "error", "message": "Twilio not configured"}

        backend_url = os.getenv("CHAKRA_BACKEND_URL", "http://localhost:8001")
        webhook_url = f"{backend_url}/webhooks/twilio/twiml?case_id={context.get('case_id')}&amount={context.get('amount')}"

        payload = {
            "To": to_number,
            "From": self.from_number,
            "Url": webhook_url,
            "Method": "POST"
        }

        async with httpx.AsyncClient() as client:
            base_url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}"
            res = await client.post(
                f"{base_url}/Calls.json",
                data=payload,
                auth=(self.account_sid, self.auth_token)
            )
            if res.status_code in (200, 201):
                return {"status": "success", "call_sid": res.json().get("sid")}
            return {"status": "error", "message": res.text}


class MockVoiceProvider(VoiceProvider):
    async def start_call(self, to_number: str, context: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "success",
            "call_sid": f"CA_mock_{os.urandom(8).hex()}",
            "mocked": True
        }


def get_voice_provider() -> VoiceProvider:
    if os.getenv("TWILIO_ACCOUNT_SID"):
        return TwilioVoiceProvider()
    return MockVoiceProvider()


class VoiceIntent(BaseModel):
    intent: str = Field(..., description="One of: pay_now, promise_to_pay, unwilling, wrong_number, unclear")
    amount: Optional[float] = None
    promised_date: Optional[str] = Field(None, description="ISO date YYYY-MM-DD if promised")
    confidence: float = 0.0


async def extract_voice_intent(transcript: str) -> VoiceIntent:
    """Uses Gemini + keyword overrides to extract structured intent from a voice transcript."""
    from backend.app.services.llm import gemini_classify

    try:
        fake_ctx = {
            "pii_redacted": True,
            "transcript": transcript,
            "task": "voice_intent_extraction"
        }
        result = gemini_classify(fake_ctx)
        intent_map = {
            "retry": "pay_now",
            "send_payment_link": "pay_now",
            "escalate": "unwilling",
            "block": "unwilling",
        }
        intent_str = intent_map.get(result.action, "unclear")
        lower = transcript.lower()
        if any(w in lower for w in ["kal", "tomorrow", "baad", "next week", "agle", "promise"]):
            intent_str = "promise_to_pay"
        elif any(w in lower for w in ["abhi", "now", "pay", "haan", "yes", "ok"]):
            intent_str = "pay_now"
        elif any(w in lower for w in ["nahi", "no", "mat", "wrong", "galat"]):
            intent_str = "unwilling"

        return VoiceIntent(intent=intent_str, confidence=result.confidence)
    except Exception:
        return VoiceIntent(intent="unclear", confidence=0.0)


def generate_hinglish_voice_note(customer_name: str, amount_inr: float, payment_link: str = "") -> Optional[str]:
    """
    Backward-compatible stub for RecoveryExecutor.
    Previously used pyttsx3. Returns None — Twilio TTS handles speech via TwiML.
    """
    return None
