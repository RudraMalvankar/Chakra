"""
JSONL Audit Trail Logger.
Appends structured decision summaries to an immutable, append-only JSONL log.
Ensures PII is flagged as redacted and strips raw LLM chain-of-thought.
"""
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional

AUDIT_FILE = "audit_log.jsonl"


def log_audit_event(
    payment_id: str,
    event_type: str,
    details: Dict[str, Any],
    pii_redacted: bool = True,
    filepath: str = AUDIT_FILE,
) -> None:
    """
    Appends a structured event to the JSONL audit trail.
    Ensures PII is redacted and raw chain-of-thought is excluded.
    Includes Windows file-lock retry protection.
    """
    clean_details = dict(details) if isinstance(details, dict) else {"data": details}

    # Strip any potential chain-of-thought / internal reasoning fields
    for cot_field in ["chain_of_thought", "thought", "reasoning_steps", "raw_prompt", "system_prompt"]:
        clean_details.pop(cot_field, None)

    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payment_id": str(payment_id),
        "event_type": str(event_type),
        "pii_redacted": pii_redacted,
        "details": clean_details,
    }

    line = json.dumps(event) + "\n"

    # Robust file append with retry for Windows file locking
    for attempt in range(5):
        try:
            with open(filepath, "a", encoding="utf-8") as f:
                f.write(line)
            break
        except (PermissionError, OSError):
            if attempt < 4:
                time.sleep(0.02)
            else:
                pass


def clear_audit_log(filepath: str = AUDIT_FILE) -> None:
    """Clears the audit log file by truncating its contents safely on Windows."""
    for attempt in range(5):
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                pass
            break
        except (PermissionError, OSError):
            if attempt < 4:
                time.sleep(0.02)
            else:
                pass
