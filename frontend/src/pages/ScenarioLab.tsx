import React, { useState, useEffect } from 'react';
import { simulatePayment, createOrder, fetchConfig, verifyPayment, ApiError } from '../services/api';
import { formatCurrency, formatExact } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ArrowRight, Loader } from 'lucide-react';

const PRESETS = [
    { label: 'Timeout (deterministic)', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 5000, failure_reason: 'payment_timed_out', mandate_state: 'INACTIVE', customer_id: 'cust_demo123', method: 'UPI', churn_risk: 'LOW', fraud_risk: 'LOW', retry_count: 0 } },
    { label: 'Insufficient Funds', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 85000, failure_reason: 'insufficient_funds', mandate_state: 'ACTIVE', customer_id: 'cust_funds_01', method: 'UPI', churn_risk: 'LOW', fraud_risk: 'LOW', retry_count: 0 } },
    { label: 'Card Declined', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 12000, failure_reason: 'card_declined', mandate_state: 'ACTIVE', customer_id: 'cust_card_01', method: 'CARD', churn_risk: 'MEDIUM', fraud_risk: 'LOW', retry_count: 1 } },
    { label: 'Mandate Revoked → BLOCK', payload: { case_type: 'SUBSCRIPTION', amount_inr: 8999, failure_reason: 'mandate_revoked', mandate_state: 'REVOKED', customer_id: 'cust_sub_001', method: 'CARD', churn_risk: 'LOW', fraud_risk: 'LOW', retry_count: 0 } },
    { label: 'Fraud → BLOCK/ESCALATE', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 15000, failure_reason: 'fraud_suspected', mandate_state: 'ACTIVE', customer_id: 'cust_risk_999', method: 'NETBANKING', churn_risk: 'HIGH', fraud_risk: 'HIGH', retry_count: 0 } },
    { label: 'Gemini: bank_server_error', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 7200, failure_reason: 'bank_server_error', mandate_state: 'ACTIVE', customer_id: 'cust_gemini_01', method: 'UPI', churn_risk: 'LOW', fraud_risk: 'LOW', retry_count: 0 }, gemini: true },
    { label: 'Gemini: unknown_gateway_state', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 4500, failure_reason: 'unknown_gateway_state', mandate_state: 'ACTIVE', customer_id: 'cust_gemini_02', method: 'CARD', churn_risk: 'MEDIUM', fraud_risk: 'LOW', retry_count: 0 }, gemini: true },
    { label: 'Gemini: processor_route_mismatch', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 9800, failure_reason: 'processor_route_mismatch', mandate_state: 'ACTIVE', customer_id: 'cust_gemini_03', method: 'NETBANKING', churn_risk: 'LOW', fraud_risk: 'LOW', retry_count: 0 }, gemini: true },
];

declare global {
  interface Window {
    Razorpay: any;
  }
}

export const ScenarioLab = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [payload, setPayload] = useState(PRESETS[0].payload);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [paymentResult, setPaymentResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<any>({ mode: 'synthetic' });
    const [mode, setMode] = useState<'synthetic' | 'razorpay'>('synthetic');

    useEffect(() => {
        fetchConfig()
            .then((cfg) => {
                setConfig(cfg);
                setMode(cfg.mode === 'test' ? 'razorpay' : 'synthetic');
            })
            .catch(() => setConfig({ mode: 'unavailable' }));

        if (!document.getElementById('razorpay-checkout-js')) {
            const script = document.createElement('script');
            script.id = 'razorpay-checkout-js';
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.async = true;
            document.body.appendChild(script);
        }
    }, []);

    const processChakraPipeline = async (failureReason: string) => {
        const trace = await simulatePayment({
            ...payload,
            failure_reason: failureReason,
            error_code: failureReason,
        });
        setResult(trace);
        setPaymentResult(null);
        if (refresh) refresh();
        return trace;
    };

    const handleSynthetic = async () => {
        setLoading(true);
        setResult(null);
        setPaymentResult(null);
        setError(null);
        try {
            await processChakraPipeline(payload.failure_reason);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Simulation failed');
        } finally {
            setLoading(false);
        }
    };

    const handleRazorpaySuccessPath = async () => {
        setLoading(true);
        setResult(null);
        setPaymentResult(null);
        setError(null);
        try {
            const orderRes = await createOrder({
                amount_inr: payload.amount_inr,
                customer_id: payload.customer_id,
            });
            if (!config.razorpay_key_id || !window.Razorpay) {
                throw new Error('Razorpay Test Mode not available in this browser session');
            }
            const options = {
                key: config.razorpay_key_id,
                amount: Math.round(orderRes.amount_inr * 100),
                currency: 'INR',
                name: 'Chakra Scenario Lab',
                description: 'Razorpay Test Mode',
                order_id: orderRes.order_id,
                handler: async function (response: any) {
                    try {
                        const verified = await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id || orderRes.order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            customer_id: payload.customer_id,
                        });
                        setPaymentResult(verified);
                        if (refresh) refresh();
                    } catch (e) {
                        setError(e instanceof Error ? e.message : 'Verification failed');
                    } finally {
                        setLoading(false);
                    }
                },
                modal: {
                    ondismiss: async () => {
                        try {
                            const abandonRes = await fetch('/api/payments/abandon', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ order_id: orderRes.order_id, customer_id: payload.customer_id }),
                            });
                            if (!abandonRes.ok) throw new Error(`Abandon failed (${abandonRes.status})`);
                            const data = await abandonRes.json();
                            setResult({ case_id: data.case_id, status: data.status, amount_inr: data.amount_inr, workflow: 'CHECKOUT_ABANDONMENT', trace: [] });
                            if (refresh) refresh();
                        } catch (e) {
                            setError(e instanceof Error ? e.message : 'Abandon failed');
                        } finally {
                            setLoading(false);
                        }
                    },
                },
                theme: { color: '#0F51E3' },
            };
            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', async function (resp: any) {
                try {
                    const reason = resp?.error?.reason || payload.failure_reason || 'unknown_gateway_failure';
                    await processChakraPipeline(reason);
                } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failure pipeline error');
                } finally {
                    setLoading(false);
                }
            });
            rzp.open();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to start Razorpay checkout');
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (mode === 'razorpay' && config.mode === 'test') {
            await handleRazorpaySuccessPath();
        } else {
            await handleSynthetic();
        }
    };

    const caseId = result?.case_id;
    const aiEvent = (result?.trace || []).find((e: any) => e.event_type === 'ai_triage_completed');

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Scenario Lab</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Real Test Mode or explicitly labelled synthetic simulation</p>
                    </div>
                    {config.mode === 'test' ? (
                        <Badge status="SUCCESS">RAZORPAY TEST MODE AVAILABLE</Badge>
                    ) : config.mode === 'synthetic' ? (
                        <Badge status="INFO">SYNTHETIC SIMULATION</Badge>
                    ) : (
                        <Badge status="FAILED">PROVIDER UNAVAILABLE</Badge>
                    )}
                </div>

                {error && (
                    <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-rzp-red p-3 text-sm font-mono">{error}</div>
                )}

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <div className="flex gap-2 mb-4">
                            <button type="button" onClick={() => setMode('synthetic')} className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider border rounded ${mode === 'synthetic' ? 'bg-gray-900 text-white' : 'bg-white'}`}>
                                SYNTHETIC SIMULATION
                            </button>
                            <button type="button" onClick={() => setMode('razorpay')} disabled={config.mode !== 'test'} className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider border rounded ${mode === 'razorpay' ? 'bg-rzp-blue text-white' : 'bg-white'} disabled:opacity-40`}>
                                RAZORPAY TEST CHECKOUT
                            </button>
                        </div>

                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Presets</h3>
                        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
                            {PRESETS.map((p, i) => (
                                <button
                                    key={i}
                                    onClick={() => setPayload(p.payload)}
                                    className={`block w-full text-left px-4 py-2 border rounded text-sm transition-colors ${payload.failure_reason === p.payload.failure_reason ? 'border-rzp-blue bg-blue-50 text-rzp-blue font-bold' : 'border-border text-text-main hover:bg-gray-50'}`}
                                >
                                    {p.label}
                                    {(p as any).gemini && <span className="ml-2 text-[10px] font-mono text-purple-600">GEMINI</span>}
                                </button>
                            ))}
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Amount (INR)</label>
                                    <input type="number" value={payload.amount_inr} onChange={e => setPayload({ ...payload, amount_inr: Number(e.target.value) })} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Customer ID</label>
                                    <input type="text" value={payload.customer_id} onChange={e => setPayload({ ...payload, customer_id: e.target.value })} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Failure / Error Code</label>
                                <select value={payload.failure_reason} onChange={e => setPayload({ ...payload, failure_reason: e.target.value })} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                    <option value="payment_timed_out">TIMEOUT</option>
                                    <option value="insufficient_funds">INSUFFICIENT FUNDS</option>
                                    <option value="card_declined">CARD DECLINED</option>
                                    <option value="mandate_revoked">MANDATE REVOKED</option>
                                    <option value="fraud_suspected">FRAUD</option>
                                    <option value="bank_server_error">bank_server_error (Gemini)</option>
                                    <option value="processor_route_mismatch">processor_route_mismatch (Gemini)</option>
                                    <option value="unknown_gateway_state">unknown_gateway_state (Gemini)</option>
                                    <option value="risk_review_pending">risk_review_pending (Gemini)</option>
                                    <option value="network_authorization_anomaly">network_authorization_anomaly (Gemini)</option>
                                    <option value="unknown_gateway_failure">UNKNOWN GATEWAY FAILURE</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Retry Count</label>
                                <input type="number" min="0" value={payload.retry_count ?? 0} onChange={e => setPayload({ ...payload, retry_count: Number(e.target.value) })} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                            </div>
                            <button type="submit" disabled={loading} className="w-full mt-4 bg-rzp-blue text-white font-bold uppercase tracking-widest text-xs py-3 rounded hover:bg-blue-700 transition-colors flex justify-center items-center">
                                {loading ? <Loader className="animate-spin" size={16} /> : mode === 'razorpay' ? 'OPEN RAZORPAY TEST CHECKOUT' : 'RUN SYNTHETIC SIMULATION'}
                            </button>
                        </form>
                    </div>

                    <div className="bg-gray-50 border border-border rounded p-6">
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Result</h3>
                        {paymentResult ? (
                            <div className="space-y-3 font-mono text-sm">
                                <Badge status="SUCCESS">PAYMENT COMPLETED</Badge>
                                <div>Provider: Razorpay Test Mode</div>
                                <div>Amount: {formatExact(paymentResult.amount_inr)}</div>
                                <div>Status: {paymentResult.status}</div>
                                <div>Provider verified: {paymentResult.provider_verified ? 'YES' : 'NO'}</div>
                                <div>Payment ID: {paymentResult.payment_id}</div>
                                <div>Order ID: {paymentResult.order_id}</div>
                                <div className="text-xs text-text-muted">No recovery case — successful checkout is not abandonment.</div>
                            </div>
                        ) : result ? (
                            <div className="space-y-4">
                                <div className="text-sm font-mono text-rzp-blue font-bold">CASE: {result.case_id || 'NONE'}</div>
                                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                    <div>Workflow: {result.workflow || payload.case_type}</div>
                                    <div>Status: {result.status || 'PROCESSED'}</div>
                                    <div>Amount: {formatCurrency(result.amount_inr || payload.amount_inr)}</div>
                                    <div>AI used: {aiEvent ? 'YES' : result.ai_used ? 'YES' : 'NO / DETERMINISTIC'}</div>
                                </div>
                                {aiEvent && (
                                    <div className="p-3 bg-purple-50 border border-purple-100 text-xs font-mono space-y-1">
                                        <div>Classification: {aiEvent.details?.classification || 'NOT AVAILABLE'}</div>
                                        <div>Confidence: {aiEvent.details?.confidence != null ? `${Math.round(aiEvent.details.confidence * 100)}%` : 'NOT AVAILABLE'}</div>
                                        <div>Model: {aiEvent.details?.model_used || 'NOT AVAILABLE'}</div>
                                        <div>Reason: {aiEvent.details?.reason || 'NOT AVAILABLE'}</div>
                                    </div>
                                )}
                                {(result.trace || []).length > 0 && (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {result.trace.map((ev: any, i: number) => (
                                            <div key={i} className="text-[10px] font-mono border border-border bg-white p-2">
                                                {String(ev.event_type || '').replace(/_/g, ' ').toUpperCase()}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {caseId ? (
                                    <button onClick={() => navigate(`/cases/${caseId}`)} className="w-full mt-4 bg-white border border-border text-text-main font-bold uppercase tracking-widest text-xs py-2 rounded hover:bg-gray-50 transition-colors flex justify-center items-center space-x-2">
                                        <span>View Case</span>
                                        <ArrowRight size={14} />
                                    </button>
                                ) : (
                                    <div className="text-xs text-text-muted font-mono">No recovery case for this outcome.</div>
                                )}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm font-mono text-text-muted min-h-[200px]">
                                {loading ? 'Executing…' : 'No result yet.'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const Simulator = ScenarioLab;
