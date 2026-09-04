"""
Shared configuration utilities for Chakra.
Centralizes policy loading to avoid duplication across services.
"""
from typing import Dict, Any
from pathlib import Path
import yaml

from backend.app.config import settings


def load_yaml_policy(path: str) -> Dict[str, Any]:
    """Loads a YAML policy file and returns the 'policy.rules' section."""
    policy_path = Path(path)
    if policy_path.exists():
        try:
            with open(policy_path, "r") as f:
                data = yaml.safe_load(f)
                if data and "policy" in data:
                    return data["policy"].get("rules", {})
        except Exception:
            pass
    return {}


def get_regulatory_threshold() -> float:
    """Returns the AFA free threshold in INR from regulatory_policy.yaml."""
    rules = load_yaml_policy(settings.regulatory_policy_path)
    return float(rules.get("afa_free_threshold_standard_inr", 15000))


def get_recovery_policy() -> Dict[str, Any]:
    """Returns all recovery policy rules from recovery_policy.yaml."""
    return load_yaml_policy(settings.recovery_policy_path)


def get_regulatory_policy() -> Dict[str, Any]:
    """Returns all regulatory policy rules from regulatory_policy.yaml."""
    return load_yaml_policy(settings.regulatory_policy_path)
