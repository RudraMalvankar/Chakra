# mock-razorpay/seed.py
MOCK_PAYMENTS = [
    # 1. Standard AFA threshold failure (insufficient_funds, amount < 15k)
    {
        "payment_id": "pay_Mck_001",
        "subscription_id": "sub_Mck_001",
        "amount": 99900, # 999 INR
        "currency": "INR",
        "customer_id": "cust_001",
        "error_code": "insufficient_funds",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "HDFC",
            "network": "visa",
            "retries_this_month": 2
        }
    },
    # 2. AFA Threshold exceeded (> 15k)
    {
        "payment_id": "pay_Mck_002",
        "subscription_id": "sub_Mck_002",
        "amount": 1600000, # 16,000 INR
        "currency": "INR",
        "customer_id": "cust_002",
        "error_code": "insufficient_funds",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "SBI",
            "network": "mastercard",
            "retries_this_month": 1
        }
    },
    # 3. First Transaction (always requires AFA)
    {
        "payment_id": "pay_Mck_003",
        "subscription_id": "sub_Mck_003",
        "amount": 50000, # 500 INR
        "currency": "INR",
        "customer_id": "cust_003",
        "error_code": "card_declined",
        "status": "failed",
        "is_first_transaction": True,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "ICICI",
            "network": "visa",
            "retries_this_month": 0
        }
    },
    # 4. Fraud Flag (escalate)
    {
        "payment_id": "pay_Mck_004",
        "subscription_id": "sub_Mck_004",
        "amount": 200000,
        "currency": "INR",
        "customer_id": "cust_004",
        "error_code": "fraud_flag",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "Axis",
            "network": "mastercard",
            "retries_this_month": 0
        }
    },
    # 5. Mandate Revoked (escalate)
    {
        "payment_id": "pay_Mck_005",
        "subscription_id": "sub_Mck_005",
        "amount": 100000,
        "currency": "INR",
        "customer_id": "cust_005",
        "error_code": "mandate_revoked",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "HDFC",
            "network": "visa",
            "retries_this_month": 0
        }
    },
    # 6. High alerts ignored (> 2) -> escalate/churn prediction
    {
        "payment_id": "pay_Mck_006",
        "subscription_id": "sub_Mck_006",
        "amount": 120000,
        "currency": "INR",
        "customer_id": "cust_006",
        "error_code": "payment_timed_out",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 3,
            "bank_name": "SBI",
            "network": "rupay",
            "retries_this_month": 0
        }
    },
    # 7. Network Retry Cap Reached (Visa = 15)
    {
        "payment_id": "pay_Mck_007",
        "subscription_id": "sub_Mck_007",
        "amount": 99900,
        "currency": "INR",
        "customer_id": "cust_007",
        "error_code": "card_declined",
        "status": "failed",
        "is_first_transaction": False,
        "metadata": {
            "pre_debit_alerts_ignored": 0,
            "bank_name": "ICICI",
            "network": "visa",
            "retries_this_month": 15
        }
    }
]

def generate_mock_data():
    base = list(MOCK_PAYMENTS)
    import random
    random.seed(42) # Deterministic for demo
    
    for i in range(8, 101):
        amt = random.choice([50000, 99900, 149900, 1800000]) # 18k hits AFA
        err = random.choice(["insufficient_funds", "card_declined", "expired_card", "payment_timed_out"])
        base.append({
            "payment_id": f"pay_Mck_{i:03d}",
            "subscription_id": f"sub_Mck_{i:03d}",
            "amount": amt,
            "currency": "INR",
            "customer_id": f"cust_{i:03d}",
            "error_code": err,
            "status": "failed",
            "is_first_transaction": False, # mostly false
            "metadata": {
                "pre_debit_alerts_ignored": random.choice([0, 0, 0, 1, 2]),
                "bank_name": random.choice(["HDFC", "SBI", "ICICI", "Axis"]),
                "network": random.choice(["visa", "mastercard", "rupay"]),
                "retries_this_month": random.randint(0, 5)
            }
        })
    return base

SEED_DATA = generate_mock_data()
