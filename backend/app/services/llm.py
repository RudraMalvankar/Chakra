"""
Gemini LLM Service with Multi-Model Fallback, Structured Output, and Graceful Degradation.
Enforces DPDP Act PII redaction checks before sending prompts to Gemini.
Tries primary model (gemini-2.5-flash), falls back to secondary model (gemini-3-flash-preview)
on 429/quota limits, and safely escalates without crashing the pipeline if unavailable.
"""
from typing import Dict, Any, Optional
import json
import logging

try:
    from google import genai
    from google.genai import types
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    types = None
    GEMINI_AVAILABLE = False

from pydantic import BaseModel, Field
from backend.app.config import settings

logger = logging.getLogger("chakra.llm")


class TriageDecision(BaseModel):
    action: str = Field(description="Must be one of: 'retry', 'send_payment_link', 'block', or 'escalate'")
    reason: str = Field(description="A short diagnostic explanation for the decision")
    template: Optional[str] = Field(None, description="The DLT template ID if action is 'send_payment_link'")
    delay_hours: Optional[int] = Field(None, description="Hours to wait before retry, if action is 'retry'")
    confidence: float = Field(description="Confidence score between 0.0 and 1.0")
    model_used: Optional[str] = Field(None, description="The Gemini model that generated this triage")
    ai_used: bool = Field(True, description="True if a live Gemini model generated the response")
    fallback_used: bool = Field(False, description="True if fallback heuristic had to be used")


class VoiceIntent(BaseModel):
    """Natural-language interpretation only; never a financial decision."""
    intent: str = Field(description="One of: pay_now, promise_to_pay, unwilling, needs_more_time, dispute, wrong_person, unknown")
    promised_amount: Optional[float] = None
    promised_date: Optional[str] = None
    language: Optional[str] = None
    confidence: float = Field(description="Model confidence, or 0 when fallback is used")
    reasoning: Optional[str] = None
    model_used: Optional[str] = None
    ai_used: bool = True
    fallback_used: bool = False


def gemini_voice_intent(transcript: str) -> VoiceIntent:
    """Extract conversational intent from Hinglish/Hindi/English speech.

    Dedicated voice-intent schema — not payment triage. Callers should
    light-redact phone/email first; the spoken transcript content itself
    must remain so amount/date/intent phrases can be interpreted.
    """
    if not isinstance(transcript, str) or not transcript.strip():
        return VoiceIntent(intent="unknown", confidence=0.0, ai_used=False, fallback_used=True,
                           reasoning="empty_transcript")
    if not GEMINI_AVAILABLE or not settings.gemini_api_key:
        return VoiceIntent(intent="unknown", confidence=0.0, ai_used=False, fallback_used=True,
                           reasoning="gemini_unavailable")
    prompt = f"""
You are Chakra's conversational voice-intent interpreter. Interpret this customer
speech in Hindi, Hinglish, or English. Extract only what the customer said:
payment intent, promised amount, and promised date/time if explicitly stated.
Do not choose a recovery action, authorize payment, or bypass policy.
Return JSON matching the VoiceIntent schema exactly.
Transcript: {transcript}
"""
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        for model_name in [settings.gemini_model, settings.gemini_fallback_model]:
            try:
                response = client.models.generate_content(
                    model=model_name, contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json", response_schema=VoiceIntent,
                        temperature=0.1,
                    ),
                )
                parsed = response.parsed if isinstance(response.parsed, VoiceIntent) else None
                if parsed is None and response.text:
                    parsed = VoiceIntent(**json.loads(response.text))
                if parsed:
                    parsed.model_used = model_name
                    parsed.ai_used = True
                    parsed.fallback_used = False
                    return parsed
            except Exception as exc:
                logger.warning("Gemini voice intent call to %s failed: %s", model_name, str(exc)[:120])
    except Exception as exc:
        logger.warning("Gemini voice intent initialization failed: %s", str(exc)[:120])
    return VoiceIntent(intent="unknown", confidence=0.0, ai_used=False, fallback_used=True,
                       reasoning="gemini_request_failed")


def gemini_classify(redacted_payment: Dict[str, Any]) -> TriageDecision:
    """
    Calls Gemini using structured output to classify ambiguous failures.
    Strictly verifies pii_redacted flag is True before invocation.
    Supports primary model -> fallback model -> safe rule fallback.
    """
    if not isinstance(redacted_payment, dict) or not redacted_payment.get("pii_redacted"):
        raise ValueError("FATAL: Unredacted PII sent to LLM. Execution blocked.")

    prompt = f"""
    You are 'Chakra', a payment recovery triage diagnostic agent for an Indian payment gateway.
    Given the following REDACTED payment failure data, classify the failure and recommend a diagnostic recovery path.
    
    Data:
    {redacted_payment}
    
    Rules:
    - If error indicates a temporary soft decline, action='retry' with a delay_hours (e.g., 1 or 24).
    - If error indicates issuer decline but user can update or use alternative (e.g., 'expired_card', 'card_declined'), action='send_payment_link'. Select DLT template ('dlt_card_update_v1', 'dlt_upi_alternate_v1', 'dlt_afa_threshold_v1').
    - If error is highly ambiguous or indicates risk/fraud, action='escalate' or 'block'.
    - Your output MUST match the TriageDecision schema exactly.
    """

    if not GEMINI_AVAILABLE:
        return TriageDecision(
            action="escalate",
            reason="llm_dependency_missing",
            confidence=0.0,
            ai_used=False,
            fallback_used=True,
        )

    api_key = settings.gemini_api_key
    if not api_key:
        return TriageDecision(
            action="escalate",
            reason="llm_api_failure_fallback",
            confidence=0.0,
            ai_used=False,
            fallback_used=True,
        )

    try:
        client = genai.Client(api_key=api_key)
        models_to_try = [settings.gemini_model, settings.gemini_fallback_model]

        for model_name in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=TriageDecision,
                        temperature=0.1,
                    ),
                )
                parsed = None
                if response.parsed and isinstance(response.parsed, TriageDecision):
                    parsed = response.parsed
                elif response.text:
                    parsed_dict = json.loads(response.text)
                    parsed = TriageDecision(**parsed_dict)

                if parsed:
                    parsed.model_used = model_name
                    parsed.ai_used = True
                    parsed.fallback_used = False
                    return parsed

            except Exception as e:
                err_msg = str(e)
                logger.warning(f"Gemini call to {model_name} failed: {err_msg[:120]}")
                continue
    except Exception as outer_e:
        logger.warning(f"Gemini client initialization failed: {outer_e}")

    # All model attempts failed, safely escalate without crashing
    return TriageDecision(
        action="escalate",
        reason="llm_api_failure_fallback",
        confidence=0.0,
        ai_used=False,
        fallback_used=True,
    )


# Module-level convenience aliases
classify_ambiguous_error = gemini_classify
