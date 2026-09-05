import re
with open('backend/tests/test_stabilization_suite.py', 'r') as f:
    text = f.read()
text = text.replace('with patch(\"backend.app.services.razorpay_client.RazorpayTestProvider.create_payment_link\", return_value={\"id\": \"plink_123\"}):', 'with patch(\"backend.app.services.razorpay_client.UnavailablePaymentProvider.create_payment_link\", return_value={\"id\": \"plink_123\", \"short_url\": \"https://rzp.io/test\"}):')
with open('backend/tests/test_stabilization_suite.py', 'w') as f:
    f.write(text)
