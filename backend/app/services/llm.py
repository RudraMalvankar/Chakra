"""
Gemini LLM Service with Strict Structured Output and Graceful Degradation.
Enforces DPDP Act PII redaction checks before sending prompts to Gemini.
Catches 429/timeouts/exceptions and safely escalates without crashing the pipeline.
"""
from typing import Dict, Any, Optional
import json
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from backend.app.config import settings


class TriageDecision(BaseModel):
    action: str = Field(description="Must be one of: 'retry', 'send_payment_link', 'block', or 'escalate'")
    reason: str = Field(description="A short diagnostic explanation for the decision")
    template: Optional[str] = Field(None, description="The DLT template ID if action is 'send_payment_link'")
    delay_hours: Optional[int] = Field(None, description="Hours to wait before retry, if action is 'retry'")
    confidence: float = Field(description="Confidence score between 0.0 and 1.0")


def gemini_classify(redacted_payment: Dict[str, Any]) -> TriageDecision:
    """
    Calls Gemini 2.5 Flash using structured output to classify ambiguous failures.
    Strictly verifies pii_redacted flag is True before invocation.
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

    try:
        api_key = settings.gemini_api_key
        if not api_key:
            return TriageDecision(
                action="escalate",
                reason="llm_api_failure_fallback",
                confidence=1.0,
            )

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TriageDecision,
                temperature=0.1,
            ),
        )
        if response.parsed and isinstance(response.parsed, TriageDecision):
            return response.parsed
        elif response.text:
            parsed_dict = json.loads(response.text)
            return TriageDecision(**parsed_dict)
        return TriageDecision(action="escalate", reason="llm_api_failure_fallback", confidence=1.0)
    except Exception as e:
        err_msg = str(e)
        if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
            # Graceful degradation notice for rate limits
            pass
        return TriageDecision(
            action="escalate",
            reason="llm_api_failure_fallback",
            confidence=1.0,
        )


# Module-level convenience aliases
classify_ambiguous_error = gemini_classify

