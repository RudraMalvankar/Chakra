"""
Writes the metrics report to disk as metrics_report.json.
Called at the end of run_demo.py and by verification tasks.
"""
import json
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backend.app.services.metrics_aggregator import generate_metrics_report

METRICS_FILE = "metrics_report.json"


def write_metrics_report(audit_file: str = "audit_log.jsonl", output_file: str = METRICS_FILE) -> dict:
    """Compute metrics from audit log and write to disk. Returns the report."""
    report = generate_metrics_report(audit_file=audit_file)

    # Enrich with extra metadata fields
    if os.path.exists(audit_file):
        with open(audit_file, "r", encoding="utf-8") as f:
            audit_lines = [line for line in f if line.strip()]
        report["audit_event_count"] = len(audit_lines)
        report["audit_log_path"] = os.path.abspath(audit_file)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return report


if __name__ == "__main__":
    report = write_metrics_report()
    print(f"Wrote {METRICS_FILE}")
    print(json.dumps(report, indent=2))
