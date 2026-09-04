import React, { useState, useEffect } from 'react';
import { simulatePayment, createOrder, fetchConfig } from '../services/api';
import { formatCurrency } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ArrowRight, Loader } from 'lucide-react';

const PRESETS = [
    { label: 'Payment Failure', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 5000, failure_reason: 'payment_timed_out', mandate_state: 'INACTIVE', customer_id: 'cust_demo123', method: 'UPI', churn_risk: 'LOW', fraud_risk: 'LOW' } },
    { label: 'Mandate Revoked', payload: { case_type: 'SUBSCRIPTION', amount_inr: 8999, failure_reason: 'mandate_revoked', mandate_state: 'REVOKED', customer_id: 'cust_sub_001', method: 'CARD', churn_risk: 'LOW', fraud_risk: 'LOW' } },
    { label: 'High Risk / Fraud', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 15000, failure_reason: 'fraud_suspected', mandate_state: 'ACTIVE', customer_id: 'cust_risk_999', method: 'NETBANKING', churn_risk: 'HIGH', fraud_risk: 'HIGH' } }
];

declare global {
  interface Window {
    Razorpay: any;
  }
}

export const Simulator = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [payload, setPayload] = useState(PRESETS[0].payload);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [config, setConfig] = useState<any>({ mode: 'synthetic' });

    useEffect(() => {
        fetchConfig().then(setConfig).catch(() => {});
        
        if (!document.getElementById('razorpay-checkout-js')) {
            const script = document.createElement('script');
            script.id = 'razorpay-checkout-js';
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.async = true;
            document.body.appendChild(script);
        }
    }, []);

    const processChakraPipeline = async (failureReason: string) => {
        try {
            const trace = await simulatePayment({
                ...payload,
                failure_reason: failureReason
            });
            setResult(trace);
            if (refresh) refresh();
        } catch (err) {
            console.error(err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setResult(null);

        try {
            const orderRes = await createOrder({
                amount_inr: payload.amount_inr,
                customer_id: payload.customer_id
            });

            if (config.mode === 'test' && config.razorpay_key_id && window.Razorpay) {
                const options = {
                    key: config.razorpay_key_id,
                    amount: orderRes.amount_inr * 100,
                    currency: "INR",
                    name: "Chakra Simulator",
                    description: "Test Transaction",
                    order_id: orderRes.order_id,
                    handler: function (_response: any) {
                        alert("Payment succeeded. No recovery needed.");
                        setLoading(false);
                    },
                    prefill: {
                        name: "Test Customer",
                        email: "test@example.com",
                        contact: "9999999999"
                    },
                    theme: {
                        color: "#0F51E3"
                    }
                };
                const rzp = new window.Razorpay(options);
                
                rzp.on('payment.failed', async function (_response: any) {
                    const reason = response.error.reason || payload.failure_reason;
                    await processChakraPipeline(reason);
                    setLoading(false);
                });
                
                rzp.open();
            } else {
                await processChakraPipeline(payload.failure_reason);
                setLoading(false);
            }
        } catch (err) {
            console.error(err);
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Create Payment</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Process a live event through the Chakra pipeline</p>
                    </div>
                    {config.mode === 'test' ? (
                        <Badge status="SUCCESS">RAZORPAY TEST MODE</Badge>
                    ) : (
                        <Badge status="INFO">SYNTHETIC SIMULATOR</Badge>
                    )}
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Scenario Lab</h3>
                        <div className="space-y-2 mb-6">
                            {PRESETS.map((p, i) => (
                                <button key={i} onClick={() => setPayload(p.payload)} className={`block w-full text-left px-4 py-2 border rounded text-sm transition-colors ${payload.failure_reason === p.payload.failure_reason ? 'border-rzp-blue bg-blue-50 text-rzp-blue font-bold' : 'border-border text-text-main hover:bg-gray-50'}`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Amount (INR)</label>
                                    <input type="number" value={payload.amount_inr} onChange={e => setPayload({...payload, amount_inr: Number(e.target.value)})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Customer ID</label>
                                    <input type="text" value={payload.customer_id} onChange={e => setPayload({...payload, customer_id: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Case Type</label>
                                <select value={payload.case_type} onChange={e => setPayload({...payload, case_type: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                    <option value="PAYMENT_FAILURE">PAYMENT_FAILURE</option>
                                    <option value="SUBSCRIPTION">SUBSCRIPTION</option>
                                    <option value="CHECKOUT_ABANDONMENT">CHECKOUT_ABANDONMENT</option>
                                    <option value="RECEIVABLE">RECEIVABLE</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Payment Method</label>
                                <select value={payload.method} onChange={e => setPayload({...payload, method: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                    <option value="UPI">UPI</option>
                                    <option value="CARD">Card</option>
                                    <option value="NETBANKING">Netbanking</option>
                                </select>
                            </div>

                            {config.mode !== 'test' && (
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Synthetic Failure Reason</label>
                                    <select value={payload.failure_reason} onChange={e => setPayload({...payload, failure_reason: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                        <option value="payment_timed_out">Timeout</option>
                                        <option value="insufficient_funds">Insufficient Funds</option>
                                        <option value="card_declined">Card Declined</option>
                                        <option value="mandate_revoked">Mandate Revoked</option>
                                        <option value="fraud_suspected">Fraud Suspected</option>
                                    </select>
                                </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Mandate State</label>
                                    <select value={payload.mandate_state} onChange={e => setPayload({...payload, mandate_state: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                        <option value="ACTIVE">ACTIVE</option>
                                        <option value="INACTIVE">INACTIVE</option>
                                        <option value="REVOKED">REVOKED</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Retry Count</label>
                                    <input type="number" min="0" defaultValue="0" className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Churn Risk</label>
                                    <select value={payload.churn_risk} onChange={e => setPayload({...payload, churn_risk: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                        <option value="LOW">LOW</option>
                                        <option value="MEDIUM">MEDIUM</option>
                                        <option value="HIGH">HIGH</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Fraud Risk</label>
                                    <select value={payload.fraud_risk} onChange={e => setPayload({...payload, fraud_risk: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                        <option value="LOW">LOW</option>
                                        <option value="MEDIUM">MEDIUM</option>
                                        <option value="HIGH">HIGH</option>
                                    </select>
                                </div>
                            </div>

                            <button type="submit" disabled={loading} className="w-full mt-4 bg-rzp-blue text-white font-bold uppercase tracking-widest text-xs py-3 rounded hover:bg-blue-700 transition-colors flex justify-center items-center">
                                {loading ? <Loader className="animate-spin" size={16} /> : 'CREATE & PROCESS PAYMENT'}
                            </button>
                            
                            {config.mode === 'test' && (
                                <p className="text-[10px] text-text-muted text-center mt-2">
                                    This will open the Razorpay Test Checkout. Use a test card to simulate a failure.
                                </p>
                            )}
                        </form>
                    </div>

                    <div className="bg-gray-50 border border-border rounded p-6">
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Pipeline Execution</h3>
                        {result ? (
                            <div className="space-y-4">
                                <div className="text-sm font-mono text-rzp-blue font-bold mb-4">CASE: {result.case_id}</div>
                                
                                <div className="space-y-3 relative before:absolute before:inset-0 before:ml-[7px] before:h-full before:w-px before:bg-border">
                                    {result.trace.map((ev: any, i: number) => (
                                        <div key={i} className="relative flex items-start">
                                            <div className="w-4 h-4 rounded-full bg-white border-2 border-rzp-blue shrink-0 z-10 mt-0.5"></div>
                                            <div className="ml-4 bg-white border border-border rounded p-3 shadow-sm w-full">
                                                <div className="text-[10px] font-bold text-text-main uppercase">{ev.event_type.replace(/_/g, ' ')}</div>
                                                <div className="text-xs font-mono text-text-muted mt-1 truncate">
                                                    {ev.details.decision || ev.details.status || ev.details.effective_action || (ev.details.revenue_at_risk_inr && formatCurrency(ev.details.revenue_at_risk_inr)) || 'Processed'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                
                                <button onClick={() => navigate(`/cases/${result.case_id}`)} className="w-full mt-6 bg-white border border-border text-text-main font-bold uppercase tracking-widest text-xs py-2 rounded hover:bg-gray-50 transition-colors flex justify-center items-center space-x-2">
                                    <span>View Case Detail</span>
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm font-mono text-text-muted">
                                Awaiting payment simulation...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
