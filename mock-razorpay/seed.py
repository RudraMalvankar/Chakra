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
    import random
    random.seed(42)
    base = []
    
    # 24 PAYMENT_FAILURE
    for i in range(24):
        amt = random.randint(50000, 2000000)
        err = random.choice(["insufficient_funds", "card_declined", "expired_card", "payment_timed_out", "fraud_flag", "mandate_revoked"])
        base.append({
            "event": "payment.failed",
            "payload": {
                "payment": {
                    "entity": {
                        "id": f"pay_Mck_{i:03d}",
                        "amount": amt,
                        "currency": "INR",
                        "customer_id": f"cust_{i:03d}",
                        "error_code": err,
                        "status": "failed",
                        "is_first_transaction": random.choice([True, False, False]),
                        "metadata": {
                            "pre_debit_alerts_ignored": random.choice([0, 0, 0, 1, 2, 3]),
                            "bank_name": random.choice(["HDFC", "SBI", "ICICI", "Axis"]),
                            "network": random.choice(["visa", "mastercard", "rupay"]),
                            "retries_this_month": random.choice([0, 1, 15, 20])
                        }
                    }
                }
            }
        })
        
    new_cases = []
    
    # 24 Subscriptions
    for i in range(24):
        days = random.choice([0, 3, 7, 14, 30])
        new_cases.append({
            "event": "subscription.failed",
            "payload": {
                "subscription": {
                    "entity": {
                        "id": f"sub_Mck_new_{i}",
                        "customer_id": f"cust_new_sub_{i}",
                        "amount": random.randint(19900, 99900),
                        "currency": "INR",
                        "status": "failed",
                        "notes": {"days_overdue": days}
                    }
                }
            }
        })

    # Additional subscription scenarios: grace period, churn risk, mandate revoked
    sub_scenarios = [
        {"days": 0, "churn": "LOW", "past_failures": 0, "grace": 7, "label": "fresh_failure"},
        {"days": 3, "churn": "LOW", "past_failures": 1, "grace": 4, "label": "grace_period"},
        {"days": 7, "churn": "MEDIUM", "past_failures": 2, "grace": 0, "label": "grace_expired"},
        {"days": 14, "churn": "HIGH", "past_failures": 3, "grace": 0, "label": "high_churn"},
        {"days": 30, "churn": "HIGH", "past_failures": 5, "grace": 0, "label": "cancellation_threshold"},
        {"days": 0, "churn": "LOW", "past_failures": 0, "grace": 7, "label": "mandate_revoked", "error": "mandate_revoked"},
        {"days": 5, "churn": "MEDIUM", "past_failures": 2, "grace": 2, "label": "fraud_subscription", "error": "fraud_flag"},
    ]
    for i, sc in enumerate(sub_scenarios):
        new_cases.append({
            "event": "subscription.failed",
            "payload": {
                "subscription": {
                    "entity": {
                        "id": f"sub_Mck_sc_{i}",
                        "customer_id": f"cust_sub_sc_{i}",
                        "amount": random.randint(29900, 149900),
                        "currency": "INR",
                        "status": "failed",
                        "error_code": sc.get("error", "subscription_failed"),
                        "notes": {
                            "days_overdue": sc["days"],
                            "churn_risk": sc["churn"],
                            "past_failed_payments_count": sc["past_failures"],
                            "grace_period_remaining": sc["grace"],
                        }
                    }
                }
            }
        })
        
    # 24 Checkout Abandonment
    for i in range(24):
        new_cases.append({
            "event": "checkout.abandoned",
            "payload": {
                "checkout": {
                    "entity": {
                        "id": f"order_new_{i}",
                        "customer_id": f"cust_new_ord_{i}",
                        "amount": random.randint(59900, 159900),
                        "currency": "INR",
                        "status": "abandoned"
                    }
                }
            }
        })
        
    # 24 Receivables
    for i in range(24):
        days = random.choice([10, 35, 45, 90, 20, 50, 120])
        new_cases.append({
            "event": "invoice.overdue",
            "payload": {
                "invoice": {
                    "entity": {
                        "id": f"inv_new_{i}",
                        "customer_id": f"cust_new_inv_{i}",
                        "amount": random.randint(5000000, 15000000),
                        "currency": "INR",
                        "status": "overdue",
                        "metadata": {"days_overdue": days}
                    }
                }
            }
        })
        
    # 24 Promise to Pay
    for i in range(24):
        status = random.choice(["ACTIVE", "BROKEN"])
        new_cases.append({
            "event": "promise.updated",
            "payload": {
                "promise": {
                    "entity": {
                        "id": f"ptp_new_{i}",
                        "customer_id": f"cust_new_ptp_{i}",
                        "amount": random.randint(1500000, 5000000),
                        "currency": "INR",
                        "status": status,
                        "notes": {"promise_status": status, "failure_reason": "broken" if status == "BROKEN" else ""}
                    }
                }
            }
        })
        
    return base + new_cases
SEED_DATA = generate_mock_data()
