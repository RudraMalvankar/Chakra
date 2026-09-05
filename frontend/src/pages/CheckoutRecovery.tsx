import { API_BASE } from '../services/api';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, XCircle, Loader2, AlertTriangle } from 'lucide-react';

export const CheckoutRecovery = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [status, setStatus] = useState<'IDLE'|'CREATING'|'OPENED'|'SCRIPT_ERROR'|'ABANDONED'|'RECOVERING'|'RECOVERED'>('IDLE');
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [caseId, setCaseId] = useState<string | null>(null);
    const [scriptError, setScriptError] = useState(false);
    const scriptRef = useRef<HTMLScriptElement | null>(null);

    useEffect(() => {
        const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (existing) {
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onerror = () => setScriptError(true);
        document.body.appendChild(script);
        scriptRef.current = script;

        return () => {
            if (scriptRef.current && document.body.contains(scriptRef.current)) {
                document.body.removeChild(scriptRef.current);
            }
        };
    }, []);

    const startCheckout = async () => {
        if (scriptError) {
            setStatus('SCRIPT_ERROR');
            return;
        }

        setLoading(true);
        setStatus('CREATING');
        setPaymentLink(null);
        setCaseId(null);

        try {
            const orderRes = await fetch(`${API_BASE}/api/payments/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount_inr: 5000, customer_id: 'cust_demo_001' })
            });
            if (!orderRes.ok) {
                const fbRes = await fetch(`${API_BASE}/api/payments/create_order`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount_inr: 5000, customer_id: 'cust_demo_001' })
                });
                if (!fbRes.ok) throw new Error(`Unable to create checkout order (${fbRes.status})`);
                const fbData = await fbRes.json();
                if (!fbData.order_id) throw new Error('Provider did not return an order id');
                setOrderId(fbData.order_id);
                initiateModal(fbData.order_id);
            } else {
                const orderData = await orderRes.json();
                setOrderId(orderData.order_id);
                initiateModal(orderData.order_id);
            }
        } catch (e) {
            console.error('Error starting checkout:', e);
            setStatus('IDLE');
            setLoading(false);
        }
    };

    const initiateModal = async (createdOrderId: string) => {
        try {
            const configRes = await fetch(`${API_BASE}/api/config`);
            const config = await configRes.json();

            if (!config.razorpay_key_id) {
                setStatus('SCRIPT_ERROR');
                setLoading(false);
                return;
            }

            setStatus('OPENED');

            const options: any = {
                key: config.razorpay_key_id,
                amount: 500000,
                currency: 'INR',
                name: 'Chakra Demo Store',
                description: 'Test Transaction',
                order_id: createdOrderId,
                handler: async function (response: any) {
                    setStatus('RECOVERING');
                    try {
                        const verifyRes = await fetch(`${API_BASE}/api/payments/verify`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id || createdOrderId,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                                amount_inr: 5000,
                            })
                        });
                        if (verifyRes.ok) {
                            setStatus('RECOVERED');
                            if (refresh) refresh();
                        } else {
                            setStatus('ABANDONED');
                        }
                    } catch (verifyErr) {
                        console.error('Verification error:', verifyErr);
                        setStatus('ABANDONED');
                    }
                },
                modal: {
                    ondismiss: async function() {
                        setStatus('ABANDONED');
                        await handleAbandonment(createdOrderId);
                    }
                }
            };

            // @ts-ignore
            if (window.Razorpay) {
                // @ts-ignore
                const rzp = new window.Razorpay(options);
                rzp.open();
            } else {
                setStatus('SCRIPT_ERROR');
            }
        } catch (e) {
            console.error(e);
            setStatus('IDLE');
        } finally {
            setLoading(false);
        }
    };

    const handleAbandonment = async (orderIdToAbandon: string) => {
        setStatus('RECOVERING');
        try {
            const abandonRes = await fetch(`${API_BASE}/api/payments/abandon`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    order_id: orderIdToAbandon,
                    amount_inr: 5000,
                    customer_id: 'cust_demo_001'
                })
            });
            if (!abandonRes.ok) throw new Error(`Unable to record abandonment (${abandonRes.status})`);
            const data = await abandonRes.json();
            if (!data.case_id) throw new Error('Backend did not return a recovery case');
            setCaseId(data.case_id);

            if (refresh) refresh();

            try {
                const caseRes = await fetch(`${API_BASE}/api/cases/${data.case_id}`);
                if (caseRes.ok) {
                    const caseDetail = await caseRes.json();
                    const linkEv = caseDetail.events?.find((e: any) => e.metadata?.recovery_url);
                    if (linkEv?.metadata?.recovery_url) {
                        setPaymentLink(linkEv.metadata.recovery_url);
                    }
                }
            } catch {
                // Ignore link retrieval failure
            }
        } catch (e) {
            console.error('Abandonment handler error:', e);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <ShoppingBag className="mr-3 text-rzp-blue" size={20} />
                        Checkout Recovery
                    </h2>
                    <p className="text-sm text-text-muted mt-1">Demonstrate a real Razorpay checkout abandonment and Chakra recovery pipeline.</p>
                </div>
            </div>

            {status === 'SCRIPT_ERROR' && (
                <div className="bg-red-50 border border-red-200 p-4 flex items-center space-x-3">
                    <AlertTriangle className="text-rzp-red" size={20} />
                    <div>
                        <div className="text-sm font-bold text-rzp-red uppercase tracking-wider">RAZORPAY CHECKOUT UNAVAILABLE</div>
                        <div className="text-xs text-text-muted mt-1">
                            {!scriptError ? 'Razorpay key not configured. Set RAZORPAY_KEY_ID in .env.' : 'checkout.js failed to load. Check network connection.'}
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border border-border shadow-sm flex flex-col items-center justify-center p-12">
                    <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                        <ShoppingBag size={48} className="text-gray-400" />
                    </div>
                    <h3 className="text-xl font-bold font-mono uppercase mb-2">Premium Headphones</h3>
                    <div className="text-2xl font-bold text-text-main font-mono mb-8">₹5,000</div>

                    <div className="w-full max-w-sm space-y-3 mb-8 text-sm">
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Customer</span>
                            <span className="font-mono">cust_demo_001</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Order ID</span>
                            <span className="font-mono text-xs">{orderId || 'Generated on click'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Mode</span>
                            <span className="font-mono">{scriptError ? 'UNAVAILABLE' : 'Razorpay Test Mode'}</span>
                        </div>
                    </div>

                    <button
                        onClick={startCheckout}
                        disabled={loading || status === 'OPENED' || scriptError}
                        className="w-full max-w-sm bg-rzp-blue text-white font-bold tracking-widest uppercase py-3 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                        {status === 'CREATING' ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
                        {scriptError ? 'CHECKOUT UNAVAILABLE' : 'PAY WITH RAZORPAY'}
                    </button>
                </div>

                <div className="bg-gray-50 border border-border shadow-sm p-6">
                    <h3 className="text-sm font-bold text-text-main uppercase tracking-wider mb-6">Recovery Lifecycle</h3>

                    <div className="space-y-6 font-mono text-sm">
                        <Step active={status !== 'IDLE' && status !== 'SCRIPT_ERROR'} label="CHECKOUT OPENED" />
                        <Step active={status === 'ABANDONED' || status === 'RECOVERING' || status === 'RECOVERED'} label="CHECKOUT ABANDONED / DISMISSED" error={status === 'ABANDONED'} />
                        <Step active={status === 'RECOVERING' || status === 'RECOVERED'} label="REVENUE AT RISK EVALUATED" />
                        <Step active={(status === 'RECOVERING' || status === 'RECOVERED') && caseId != null} label="AI TRIAGE & SAFETY GATE" />
                        <Step active={status === 'RECOVERED'} label="RECOVERY VERIFIED (SIGNATURE VALIDATED)" />

                        {paymentLink && (
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded mt-4">
                                <div className="text-xs font-bold text-rzp-blue uppercase tracking-wider mb-2">Payment Link Generated</div>
                                <a href={paymentLink} target="_blank" rel="noreferrer" className="text-rzp-blue underline break-all text-xs">
                                    {paymentLink}
                                </a>
                                <div className="mt-2 text-[10px] text-text-muted">Click link to complete payment in Test Mode</div>
                            </div>
                        )}
                    </div>

                    {caseId && (
                        <div className="mt-8 pt-6 border-t border-border">
                            <button onClick={() => navigate(`/cases/${caseId}`)} className="text-rzp-blue text-xs font-bold uppercase tracking-wider hover:underline">
                                View Recovery Mission ({caseId}) →
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Step = ({ active, label, error }: { active: boolean, label: string, error?: boolean }) => (
    <div className={`flex items-center space-x-3 ${active ? 'text-text-main' : 'text-gray-300'}`}>
        {error ? <XCircle className="text-rzp-red" size={16} /> : <div className={`w-4 h-4 rounded-full border-2 ${active ? 'border-rzp-blue bg-rzp-blue' : 'border-gray-300'}`} />}
        <span className={active ? 'font-semibold' : ''}>{label}</span>
    </div>
);
