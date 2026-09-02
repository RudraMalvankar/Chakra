# backend/app/services/llm.py
import os
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
from backend.app.config import settings

class TriageDecision(BaseModel):
    action: str = Field(description="Must be one of: 'retry', 'send_payment_link', or 'escalate'")
    reason: str = Field(description="A short explanation for the decision")
    template: Optional[str] = Field(None, description="The DLT template ID if action is 'send_payment_link'")
    delay_hours: Optional[int] = Field(None, description="Hours to wait before retry, if action is 'retry'")
    confidence: float = Field(description="Confidence score between 0.0 and 1.0")

def gemini_classify(redacted_payment: Dict[str, Any]) -> TriageDecision:
    """
    Calls Gemini using strict structured output to classify the failure.
    Requires redacted data to ensure absolute DPDP Act compliance.
    """
    if not redacted_payment.get("pii_redacted"):
        raise ValueError("FATAL: Unredacted PII sent to LLM. Execution blocked.")

    prompt = f"""
    You are 'Chakra', a payment recovery routing agent for an Indian payment gateway.
    Given the following REDACTED payment failure data, decide the best recovery action.
    
    Data:
    {redacted_payment}
    
    Rules:
    - If error indicates a temporary soft decline, action='retry' with a delay_hours.
    - If error indicates issuer decline but user can use alternative (e.g., 'expired_card', 'card_declined'), action='send_payment_link'. Select appropriate DLT template (e.g., 'dlt_card_update_v1', 'dlt_upi_alternate_v1').
    - If error is highly ambiguous or indicates risk, action='escalate'.
    - Your output MUST match the TriageDecision schema exactly.
    """
    
    try:
        # Initialize client using config
        client = genai.Client(api_key=settings.gemini_api_key)
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TriageDecision,
                temperature=0.1 # Low temperature for deterministic behavior
            ),
        )
        return response.parsed
    except Exception as e:
        # The requested "Graceful failure shown live"
        # Print concise version to avoid flooding console with 429 details
        err_short = str(e)[:120] if len(str(e)) > 120 else str(e)
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            print(f"LLM Fallback triggered: API rate limit (Gemini free tier) - safe escalation")
        else:
            print(f"LLM Fallback triggered due to error: {err_short}")
        return TriageDecision(
            action="escalate",
            reason="llm_api_failure_fallback",
            confidence=1.0
        )
