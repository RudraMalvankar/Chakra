"""
DLT template selector. Picks a registered template and fills its slots.
NEVER generates freeform customer text - this is a DLT legal requirement
in India (pre-registered templates only via DLT platforms).
"""
import os
import sys
from typing import Dict, Any, Optional, List
import yaml

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
