import re
with open('backend/app/services/razorpay_client.py', 'r') as f:
    text = f.read()
target = 'payload = {"customer": {"contact": "9999999999", "email": "test@example.com"}, "amount": amount, "currency": "INR", "notes": {"payment_id": payment_id, "template": template}}'
replacement = 'payload = {"customer": {"contact": "9999999999", "email": "test@example.com"}, "amount": amount, "currency": "INR", "description": "Recovery Payment", "notes": {"payment_id": payment_id, "template": template}}'
text = text.replace(target, replacement)
with open('backend/app/services/razorpay_client.py', 'w') as f:
    f.write(text)
