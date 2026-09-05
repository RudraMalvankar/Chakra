"""
Voice Recovery Service - Twilio Provider Architecture.

Provides VoiceProvider, TwilioVoiceProvider, MockVoiceProvider abstractions.
Also maintains generate_hinglish_voice_note for backward compat with RecoveryExecutor.
AI intent extraction uses the dedicated Gemini voice-intent schema with bounded fallback.
"""
from typing import Dict, Any, Optional
import httpx
import json

from pydantic import BaseModel, Field
from backend.app.config import settings


class VoiceProvider:
    async def start_call(self, to_number: str, context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class TwilioVoiceProvider(VoiceProvider):
    def __init__(self):
        self.account_sid = settings.twilio_account_sid
        self.auth_token = settings.twilio_auth_token
        self.from_number = settings.twilio_from_number

    async def start_call(self, to_number: str, context: Dict[str, Any]) -> Dict[str, Any]:
        if not self.account_sid or not self.auth_token or not self.from_number:
            return {"status": "error", "message": "TWILIO NOT CONFIGURED"}

        if not settings.twilio_webhook_base_url:
            return {"status": "error", "message": "TWILIO WEBHOOK URL NOT CONFIGURED"}
        backend_url = settings.twilio_webhook_base_url.rstrip("/")
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
        import os as _os
        return {
            "status": "success",
            "call_sid": f"CA_mock_{_os.urandom(8).hex()}",
            "mocked": True,
            "provider_status": "SIMULATED"
        }


class UnavailableVoiceProvider(VoiceProvider):
    async def start_call(self, to_number: str, context: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "status": "error",
            "provider": "twilio",
            "message": "TWILIO NOT CONFIGURED",
        }


def get_voice_provider() -> VoiceProvider:
    if settings.is_twilio_configured:
        return TwilioVoiceProvider()
    if settings.use_mock_voice:
        return MockVoiceProvider()
    return UnavailableVoiceProvider()


class VoiceIntent(BaseModel):
    intent: str = Field(..., description="One of: pay_now, promise_to_pay, unwilling, needs_more_time, dispute, wrong_person, unknown")
    amount: Optional[float] = None
    promised_date: Optional[str] = Field(None, description="ISO date YYYY-MM-DD if promised")
    confidence: float = 0.0
    language: Optional[str] = None
    reasoning: Optional[str] = None
    model_used: Optional[str] = None
    ai_used: bool = False
    fallback_used: bool = False


async def extract_voice_intent(transcript: str) -> VoiceIntent:
    """Use dedicated Gemini interpretation; fallback is explicit and zero-confidence."""
    from backend.app.services.llm import gemini_voice_intent
    result = gemini_voice_intent(transcript)
    if result.ai_used:
        return VoiceIntent(
            intent=result.intent, amount=result.promised_amount,
            promised_date=result.promised_date, confidence=result.confidence,
            language=result.language, reasoning=result.reasoning,
            model_used=result.model_used, ai_used=True,
        )
    lower = (transcript or "").lower()
    fallback_intent = "unknown"
    if any(w in lower for w in ["galat", "wrong invoice", "dispute"]):
        fallback_intent = "dispute"
    elif any(w in lower for w in ["nahi", "no", "mat", "not paying"]):
        fallback_intent = "unwilling"
    elif any(w in lower for w in ["kal", "tomorrow", "baad", "next week", "agle", "promise"]):
        fallback_intent = "promise_to_pay"
    elif any(w in lower for w in ["abhi", "now", "pay", "haan", "yes", "ok"]):
        fallback_intent = "pay_now"
    if not (transcript or "").strip():
        fallback_intent = "unclear"
    return VoiceIntent(intent=fallback_intent, confidence=0.0, ai_used=False,
                       fallback_used=True, reasoning=result.reasoning)


def generate_hinglish_voice_note(customer_name: str, amount_inr: float, payment_link: str = "") -> Optional[str]:
    """
    Backward-compatible stub for RecoveryExecutor.
    Previously used pyttsx3. Returns None — Twilio TTS handles speech via TwiML.
    """
    return None
