"""
Voice Recovery Service - Twilio Provider Architecture.

Provides VoiceProvider, TwilioVoiceProvider, MockVoiceProvider abstractions.
Also maintains generate_hinglish_voice_note for backward compat with RecoveryExecutor.
AI intent extraction uses the dedicated Gemini voice-intent schema with bounded fallback
(never the payment-triage classifier).
"""
from typing import Dict, Any, Optional, Tuple
import httpx
import json
import re

from pydantic import BaseModel, Field
from backend.app.config import settings

# Contact identifiers only. Spoken payment language (amounts, dates, intent
# phrases) must remain in the transcript for gemini_voice_intent to work.
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s\-()]{8,}\d)")


def redact_transcript_contact_pii(transcript: str) -> Tuple[str, bool]:
    """Mask phone/email in a voice transcript before sending to Gemini.

    Returns (redacted_transcript, did_redact). The rest of the utterance is
    preserved intentionally — intent extraction needs the customer's words.
    """
    if not isinstance(transcript, str) or not transcript:
        return transcript or "", False
    redacted = _EMAIL_RE.sub("[EMAIL]", transcript)
    redacted = _PHONE_RE.sub("[PHONE]", redacted)
    return redacted, redacted != transcript


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
        status_url = f"{backend_url}/webhooks/twilio/status?case_id={context.get('case_id')}"

        payload = {
            "To": to_number,
            "From": self.from_number,
            "Url": webhook_url,
            "Method": "POST",
            "StatusCallback": status_url,
            "StatusCallbackEvent": "initiated ringing answered completed",
            "StatusCallbackMethod": "POST",
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
    promised_amount: Optional[float] = None
    promised_date: Optional[str] = Field(None, description="ISO date YYYY-MM-DD if promised")
    confidence: float = 0.0
    language: Optional[str] = None
    reasoning: Optional[str] = None
    model_used: Optional[str] = None
    ai_used: bool = False
    fallback_used: bool = False


async def extract_voice_intent(transcript: str) -> VoiceIntent:
    """Use dedicated Gemini voice-intent path; fallback is explicit and zero-confidence.

    Does not call payment triage (gemini_classify). Light-redacts phone/email
    before the model call; keeps speech content required for intent.
    """
    from backend.app.services.llm import gemini_voice_intent
    safe_transcript, _ = redact_transcript_contact_pii(transcript or "")
    result = gemini_voice_intent(safe_transcript)
    if result.ai_used:
        return VoiceIntent(
            intent=result.intent, promised_amount=result.promised_amount,
            promised_date=result.promised_date, confidence=result.confidence,
            language=result.language, reasoning=result.reasoning,
            model_used=result.model_used, ai_used=True,
        )
    lower = safe_transcript.lower()
    fallback_intent = "unknown"
    if any(w in lower for w in ["galat", "wrong invoice", "dispute"]):
        fallback_intent = "dispute"
    elif any(w in lower for w in ["nahi", "no", "mat", "not paying"]):
        fallback_intent = "unwilling"
    elif any(w in lower for w in ["kal", "tomorrow", "baad", "next week", "agle", "promise"]):
        fallback_intent = "promise_to_pay"
    elif any(w in lower for w in ["abhi", "now", "pay", "haan", "yes", "ok"]):
        fallback_intent = "pay_now"
    if not safe_transcript.strip():
        fallback_intent = "unclear"
    return VoiceIntent(intent=fallback_intent, confidence=0.0, ai_used=False,
                       fallback_used=True, reasoning=result.reasoning)


def generate_hinglish_voice_note(customer_name: str, amount_inr: float, payment_link: str = "") -> Optional[str]:
    """
    Backward-compatible stub for RecoveryExecutor.
    Previously used pyttsx3. Returns None — Twilio TTS handles speech via TwiML.
    """
    return None


def clean_text_for_speech(text: str) -> str:
    """Pre-process dialogue text to make natural spoken speech.

    Replaces raw payment link URLs with natural speech phrase ('SMS par bheje gaye link')
    and removes special characters/markdown formatting that degrade pronunciation.
    """
    if not text:
        return ""
    # Replace URLs so TTS doesn't spell out 'h-t-t-p-s-colon-slash-slash...'
    cleaned = re.sub(r"https?://\S+", "SMS par bheje gaye link", text)
    # Remove asterisks, hashes, backticks
    cleaned = re.sub(r"[*#`_]", "", cleaned)
    # Replace Rupee symbol with 'Rupees'
    cleaned = cleaned.replace("₹", "Rupees ")
    return cleaned.strip()


async def synthesize_neural_speech(
    text: str, voice_preference: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Synthesizes high-fidelity, human-like voice audio for in-browser voice recovery.

    Supports:
    1. Neural Indian Hinglish (edge-tts: hi-IN-SwaraNeural, en-IN-NeerjaNeural, hi-IN-MadhurNeural)
    2. Google Gemini 3.1 Flash Native TTS (gemini-Sulafat, gemini-Kore, gemini-Aoede, gemini-Puck)
    3. Seamless bidirectional fallback if network or quota limits arise.
    """
    import io
    import wave
    import base64
    import logging

    logger = logging.getLogger("chakra.voice_synthesis")
    clean_text = clean_text_for_speech(text)
    if not clean_text:
        return None

    pref = (voice_preference or "hi-IN-SwaraNeural").strip()

    # Strategy 1: If requested Gemini TTS
    if pref.startswith("gemini-"):
        voice_name = pref.replace("gemini-", "").strip() or "Sulafat"
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.gemini_api_key)
            resp = client.models.generate_content(
                model="gemini-3.1-flash-tts-preview",
                contents=clean_text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                        )
                    ),
                ),
            )
            part = resp.candidates[0].content.parts[0]
            pcm_bytes = part.inline_data.data
            wav_buf = io.BytesIO()
            with wave.open(wav_buf, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)
                wf.writeframes(pcm_bytes)
            return {
                "audio_base64": base64.b64encode(wav_buf.getvalue()).decode("utf-8"),
                "audio_format": "audio/wav",
                "engine": "gemini-3.1-flash-tts",
                "voice": voice_name,
            }
        except Exception as exc:
            logger.warning("Gemini TTS synthesis failed (%s), falling back to Neural Indian Voice: %s", pref, exc)
            pref = "hi-IN-SwaraNeural"

    # Strategy 2: Neural Indian Voice via edge-tts
    try:
        import edge_tts

        voice_name = pref if pref.startswith(("hi-IN-", "en-IN-")) else "hi-IN-SwaraNeural"
        comm = edge_tts.Communicate(clean_text, voice_name)
        chunks = []
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        mp3_bytes = b"".join(chunks)
        if mp3_bytes:
            return {
                "audio_base64": base64.b64encode(mp3_bytes).decode("utf-8"),
                "audio_format": "audio/mp3",
                "engine": "neural-indian-voice",
                "voice": voice_name,
            }
    except Exception as exc:
        logger.warning("Edge-TTS neural synthesis failed for %s: %s", pref, exc)

    # Strategy 3: Final fallback to Gemini TTS if Edge-TTS failed
    if settings.gemini_api_key:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.gemini_api_key)
            resp = client.models.generate_content(
                model="gemini-3.1-flash-tts-preview",
                contents=clean_text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                        )
                    ),
                ),
            )
            part = resp.candidates[0].content.parts[0]
            pcm_bytes = part.inline_data.data
            wav_buf = io.BytesIO()
            with wave.open(wav_buf, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)
                wf.writeframes(pcm_bytes)
            return {
                "audio_base64": base64.b64encode(wav_buf.getvalue()).decode("utf-8"),
                "audio_format": "audio/wav",
                "engine": "gemini-3.1-flash-tts",
                "voice": "Sulafat",
            }
        except Exception as exc:
            logger.warning("Gemini TTS fallback also failed: %s", exc)

    return None
