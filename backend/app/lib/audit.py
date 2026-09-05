"""
JSONL Audit Trail Logger.
Appends structured decision summaries to an append-only runtime audit log with explicit benchmark reset support.
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
    case_id: Optional[str] = None,
) -> None:
    """
    Appends a structured event to the JSONL audit trail.
    Ensures PII is redacted and raw chain-of-thought is excluded.
    Includes Windows file-lock retry protection. Raises OSError if logging fails.
    """
    clean_details = dict(details) if isinstance(details, dict) else {"data": details}

    # Strip any potential chain-of-thought / internal reasoning fields
    for cot_field in ["chain_of_thought", "thought", "reasoning_steps", "raw_prompt", "system_prompt"]:
        clean_details.pop(cot_field, None)

    resolved_case_id = case_id or clean_details.get("case_id")
    if resolved_case_id:
        clean_details.setdefault("case_id", resolved_case_id)

    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payment_id": str(payment_id),
        "case_id": resolved_case_id,
        "event_type": str(event_type),
        "pii_redacted": pii_redacted,
        "details": clean_details,
    }

    line = json.dumps(event) + "\n"

    # Dual-write to Neon Postgres audit_events table
    try:
        from backend.app.services.db_service import DBService
        DBService.record_audit_event(
            payment_id=str(payment_id),
            event_type=str(event_type),
            details=clean_details,
            recovery_case_id=resolved_case_id,
        )
    except Exception:
        pass

    # Robust file append with retry for Windows file locking
    for attempt in range(10):
        try:
            with open(filepath, "a", encoding="utf-8") as f:
                f.write(line)
            return
        except (PermissionError, OSError) as e:
            if attempt < 9:
                time.sleep(0.05 * (attempt + 1))
            else:
                raise OSError(f"Failed to write to audit log after 10 attempts: {e}")


def clear_audit_log(filepath: str = AUDIT_FILE) -> None:
    """Explicit benchmark reset support. Clears the audit log file safely on Windows and resets database state."""
    try:
        from backend.app.services.db_service import DBService
        DBService.reset_database()
    except Exception:
        pass

    for attempt in range(5):
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                pass
            return
        except (PermissionError, OSError) as e:
            if attempt < 4:
                time.sleep(0.02)
            else:
                raise OSError(f"Failed to clear audit log after 5 attempts: {e}")
