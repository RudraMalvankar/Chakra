import re
with open('backend/tests/test_stabilization_suite.py', 'r') as f:
    text = f.read()

target = 'def test_razorpay_checkout_abandon():'
replacement = '''@patch("backend.app.services.recovery_executor.razorpay_client.create_payment_link")
def test_razorpay_checkout_abandon(mock_create_payment_link):
    mock_create_payment_link.return_value = {"id": "plink_123", "short_url": "https://rzp.io/test"}'''

text = text.replace(target, replacement)
with open('backend/tests/test_stabilization_suite.py', 'w') as f:
    f.write(text)
