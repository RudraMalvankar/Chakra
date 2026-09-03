"""
Displays the formatted revenue-first metrics report from audit_log.jsonl or metrics_report.json.
"""
import sys
import os
import json

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from backend.app.services.metrics_aggregator import generate_metrics_report

if __name__ == "__main__":
    report = generate_metrics_report()
    print("\n" + "="*60)
    print("  REVENUE-FIRST METRICS REPORT (120 CASES)")
    print("="*60)
    print(json.dumps(report, indent=2))
    print("="*60 + "\n")
