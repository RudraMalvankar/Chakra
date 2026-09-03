import pytest
from backend.app.services.notify import get_template

def test_all_templates_resolve():
    templates_to_test = [
        "dlt_upi_alternate_v1",
        "dlt_card_update_v1",
        "dlt_afa_threshold_v1",
        "dlt_first_txn_v1",
        "sub_recovery_link",
        "checkout_recovery",
        "invoice_reminder",
        "invoice_link"
    ]
    for template_id in templates_to_test:
        template = get_template(template_id)
        assert template is not None, f"Template {template_id} failed to resolve."
