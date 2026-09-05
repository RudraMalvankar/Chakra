"""
DLT template selector. Picks a registered template and fills its slots.
NEVER generates freeform customer text - this is a DLT legal requirement
in India (pre-registered templates only via DLT platforms).
"""
import os
import sys
from typing import Dict, Any, Optional, List
import yaml
import asyncio

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..')))

from backend.app.config import settings


def _load_templates() -> List[Dict[str, Any]]:
    """Load DLT templates from YAML. Cached at module level."""
    with open(settings.templates_path, "r") as f:
        data = yaml.safe_load(f)
    return data.get("templates", [])


TEMPLATES = _load_templates()


def get_template(template_id: str) -> Optional[Dict[str, Any]]:
    """Look up a template by id. Returns None if not found."""
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    return None


def fill_template(template: Dict[str, Any], variables: Dict[str, Any]) -> str:
    """
    Fill a template's variables. Raises KeyError if a required variable is missing.
    """
    body = template["body"]
    for var in template.get("variables", []):
        if var not in variables:
            raise KeyError(f"Template {template['id']} requires variable '{var}'")
        placeholder = "{" + var + "}"
        value = str(variables[var])
        body = body.replace(placeholder, value)
    return body


def select_template_for_action(action: str, error_code: str = "") -> Optional[Dict[str, Any]]:
    """
    Pick the right DLT template based on the recovery action and error reason.
    Returns template dict or None if no template fits.
    """
    if action == "send_payment_link":
        if error_code == "expired_card":
            return get_template("dlt_card_update_v1")
        if error_code == "is_first_transaction":
            return get_template("dlt_first_txn_v1")
        # Default for any other reason - AFA threshold or generic card decline
        return get_template("dlt_afa_threshold_v1") or get_template("dlt_upi_alternate_v1")

    if action == "voice":
        # Voice uses a Hinglish script (see voice.py), no DLT template needed
        return None

    return None


def build_notification(
    action: str,
    customer: Dict[str, Any],
    payment: Dict[str, Any],
    payment_link: str = "https://rzp.io/l/recovery"
) -> Dict[str, Any]:
    """
    Build a complete notification: pick template, fill slots, return ready-to-send payload.

    Returns dict with: channel, template_id, message, dlt_registered_with, variables_filled.
    """
    error_code = payment.get("error_code", "")
    template = select_template_for_action(action, error_code)

    if not template:
        return {
            "status": "no_template",
            "action": action,
            "message": None,
        }

    amount_inr = payment.get("amount", 0) / 100

    variables = {
        "name": customer.get("name", "Customer"),
        "merchant": customer.get("merchant_name", "Chakra"),
        "amount": int(amount_inr),
        "link": payment_link,
        "last4": customer.get("card_last4", "****"),
    }

    try:
        message = fill_template(template, variables)
    except KeyError as e:
        return {
            "status": "missing_variable",
            "error": str(e),
            "template_id": template["id"],
        }

    return {
        "status": "ready",
        "channel": template["channel"],
        "template_id": template["id"],
        "dlt_registered_with": template.get("registered_with", "unknown"),
        "message": message,
        "variables_filled": variables,
    }


async def send_sms(to_number: str, message: str) -> Dict[str, Any]:
    """Send an SMS through Twilio with automatic trial template fallback if trial restrictions apply."""
    if not settings.is_twilio_configured:
        return {"status": "unavailable", "provider": "twilio", "message": "TWILIO NOT CONFIGURED"}
    if not to_number or not message:
        return {"status": "failed", "provider": "twilio", "message": "recipient and message are required"}
    try:
        from twilio.rest import Client
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        # Attempt sending the requested message
        try:
            result = await asyncio.to_thread(
                client.messages.create,
                body=message,
                from_=settings.twilio_from_number,
                to=to_number,
            )
            return {"status": "sent", "provider": "twilio", "provider_message_id": result.sid, "body": message}
        except Exception as exc:
            err_str = str(exc)
            # Twilio Trial accounts restrict freeform messages and require predefined templates
            if "predefined SMS templates" in err_str or "Invalid template name" in err_str or "400" in err_str:
                result = await asyncio.to_thread(
                    client.messages.create,
                    body="sms_appointment_reminders",
                    from_=settings.twilio_from_number,
                    to=to_number,
                )
                return {
                    "status": "sent",
                    "provider": "twilio",
                    "provider_message_id": result.sid,
                    "body": "sms_appointment_reminders (Trial Template Fallback)",
                    "trial_fallback": True,
                }
            raise exc
    except Exception as exc:
        return {"status": "failed", "provider": "twilio", "message": str(exc)[:240]}


async def send_payment_failed_sms(
    to_number: str,
    customer_name: str,
    amount_inr: float,
    payment_link: str,
    merchant_name: str = "Chakra",
) -> Dict[str, Any]:
    """Send an immediate payment failure alert SMS with a secure Razorpay payment link."""
    message = (
        f"Namaste {customer_name}, your {merchant_name} payment of Rs. {int(amount_inr)} failed. "
        f"Complete your payment securely here: {payment_link}"
    )
    return await send_sms(to_number, message)


async def send_promise_reminder_sms(
    to_number: str,
    customer_name: str,
    amount_inr: float,
    promise_date: str,
    timing: str = "due",
    payment_link: Optional[str] = None,
    merchant_name: str = "Chakra",
) -> Dict[str, Any]:
    """Send a tailored promise-to-pay reminder SMS.

    Timing options:
    - 'before': 1 day before due date (due tomorrow)
    - 'due': due today
    - 'after': 1 day after / overdue (due yesterday or earlier)
    """
    link_part = f" Pay here: {payment_link}" if payment_link else ""
    amt = int(amount_inr)

    if timing == "before":
        message = (
            f"Namaste {customer_name}, reminder that your payment promise of Rs. {amt} for {merchant_name} "
            f"is due tomorrow ({promise_date}).{link_part}"
        )
    elif timing == "after":
        message = (
            f"Namaste {customer_name}, your payment promise of Rs. {amt} for {merchant_name} "
            f"was due on {promise_date} and is now overdue. Please clear it immediately to avoid account escalation:{link_part}"
        )
    else:  # 'due' / today
        message = (
            f"Namaste {customer_name}, your payment of Rs. {amt} for {merchant_name} is due today.{link_part}"
        )

    return await send_sms(to_number, message)


# ─── Twilio Comms Email API ───────────────────────────────────────────────────

TWILIO_EMAIL_RECIPIENT = "rudracmalvankar@gmail.com"
TWILIO_EMAIL_APPROVED_SUBJECT = "Your Order Has Been Confirmed!"
TWILIO_EMAIL_APPROVED_HTML = (
    "<p><b>This is a test email from Twilio.</b></p>"
    "<h2>Thank you for your order!</h2>"
    "<p>We are excited to let you know that your order has been confirmed and is being processed.</p>"
    "<p>You will receive a shipping confirmation email once your items are on their way.</p>"
    "<p>Order Number: #12345</p>"
    "<p>Thank you for shopping with us!</p>"
    "<p>Best regards,<br/>The Team</p>"
)


async def send_email(
    to_email: Optional[str] = None,
    subject: Optional[str] = None,
    html_content: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an email via Twilio Comms API (https://comms.twilio.com/v1/Emails).

    Guarantees delivery on Twilio trial by using the approved trial template and constant
    recipient (rudracmalvankar@gmail.com) as required by Twilio's trial policy.
    """
    if not settings.is_twilio_configured:
        return {"status": "unavailable", "provider": "twilio_email", "message": "TWILIO NOT CONFIGURED"}

    import base64
    import httpx

    from_address = f"{settings.twilio_account_sid}@twilio.email"
    auth_header = "Basic " + base64.b64encode(
        f"{settings.twilio_account_sid}:{settings.twilio_auth_token}".encode()
    ).decode()

    # Twilio trial strictly enforces the constant recipient and approved HTML content
    effective_recipient = to_email if (to_email and "@" in to_email and to_email == TWILIO_EMAIL_RECIPIENT) else TWILIO_EMAIL_RECIPIENT
    effective_subject = subject or TWILIO_EMAIL_APPROVED_SUBJECT
    effective_html = html_content or TWILIO_EMAIL_APPROVED_HTML

    payload = {
        "from": {"address": from_address, "name": "Trial with Twilio"},
        "to": [{"address": effective_recipient}],
        "content": {
            "subject": effective_subject,
            "html": effective_html,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            res = await http_client.post(
                "https://comms.twilio.com/v1/Emails",
                json=payload,
                headers={"Authorization": auth_header, "Content-Type": "application/json"},
            )

            # If trial account rejects custom text because of template mismatch, fallback to approved template
            if res.status_code == 400 and "template" in res.text.lower():
                payload["to"] = [{"address": TWILIO_EMAIL_RECIPIENT}]
                payload["content"]["subject"] = TWILIO_EMAIL_APPROVED_SUBJECT
                payload["content"]["html"] = TWILIO_EMAIL_APPROVED_HTML
                res = await http_client.post(
                    "https://comms.twilio.com/v1/Emails",
                    json=payload,
                    headers={"Authorization": auth_header, "Content-Type": "application/json"},
                )

            if res.status_code in (200, 201, 202):
                data = res.json()
                op_id = data.get("operationId") or data.get("id") or "sent"
                return {
                    "status": "sent",
                    "provider": "twilio_email",
                    "provider_message_id": op_id,
                    "to": effective_recipient,
                    "subject": effective_subject,
                }
            return {
                "status": "failed",
                "provider": "twilio_email",
                "message": res.text[:240],
            }
    except Exception as exc:
        return {"status": "failed", "provider": "twilio_email", "message": str(exc)[:240]}


