import re
with open('backend/tests/test_stabilization_suite.py', 'r') as f:
    text = f.read()

target = 'mock_create_payment_link.return_value = {"id": "plink_123", "short_url": "https://rzp.io/test"}'
replacement = 'mock_create_payment_link.return_value = {"id": "plink_123", "status": "created", "short_url": "https://rzp.io/test"}'

text = text.replace(target, replacement)
with open('backend/tests/test_stabilization_suite.py', 'w') as f:
    f.write(text)
