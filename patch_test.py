import re
with open('backend/tests/test_stabilization_suite.py', 'r') as f:
    text = f.read()
text = text.replace('res = client.post(\"/api/payments/abandon\"', 'with patch(\"backend.app.services.razorpay_client.RazorpayTestProvider.create_payment_link\", return_value={\"id\": \"plink_123\"}):\n        res = client.post(\"/api/payments/abandon\"')
with open('backend/tests/test_stabilization_suite.py', 'w') as f:
    f.write(text)
