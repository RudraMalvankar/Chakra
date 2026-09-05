import { API_BASE, createOrder, verifyPayment, abandonCheckout, fetchConfig } from '../services/api';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, XCircle, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatExact } from '../lib/format';

type CheckoutStatus =
    | 'IDLE'
    | 'READY'
    | 'ORDER_CREATED'
    | 'CHECKOUT_OPENED'
    | 'SCRIPT_ERROR'
    | 'PAYMENT_VERIFIED'
    | 'CAPTURED'
    | 'ABANDONED'
    | 'REVENUE_AT_RISK'
    | 'RECOVERY_PENDING'
    | 'FAILED';

export const CheckoutRecovery = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [status, setStatus] = useState<CheckoutStatus>('READY');
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [caseId, setCaseId] = useState<string | null>(null);
    const [paymentId, setPaymentId] = useState<string | null>(null);
    const [amountInr, setAmountInr] = useState(5000);
    const [error, setError] = useState<string | null>(null);
    const [scriptError, setScriptError] = useState(false);
    const scriptRef = useRef<HTMLScriptElement | null>(null);

    useEffect(() => {
        const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (existing) return;

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
        setError(null);
        setPaymentLink(null);
        setCaseId(null);
        setPaymentId(null);
        setStatus('ORDER_CREATED');

        try {
            const orderData = await createOrder({ amount_inr: amountInr, customer_id: 'cust_demo_001' });
            if (!orderData.order_id) throw new Error('Provider did not return an order id');
            setOrderId(orderData.order_id);
            setAmountInr(orderData.amount_inr ?? amountInr);
            await initiateModal(orderData.order_id, orderData.amount_inr ?? amountInr);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to create order');
            setStatus('FAILED');
            setLoading(false);
        }
    };

    const initiateModal = async (createdOrderId: string, amount: number) => {
        try {
            const config = await fetchConfig();
            if (!config.razorpay_key_id) {
                setStatus('SCRIPT_ERROR');
                setError('RAZORPAY TEST MODE NOT CONFIGURED');
                setLoading(false);
                return;
            }

            setStatus('CHECKOUT_OPENED');

            const options: any = {
                key: config.razorpay_key_id,
                amount: Math.round(amount * 100),
                currency: 'INR',
                name: 'Chakra Demo Store',
                description: 'Test Transaction',
                order_id: createdOrderId,
                handler: async function (response: any) {
                    setStatus('PAYMENT_VERIFIED');
                    try {
                        const verified = await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id || createdOrderId,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            customer_id: 'cust_demo_001',
                        });
                        setPaymentId(verified.payment_id);
                        setAmountInr(verified.amount_inr ?? amount);
                        setStatus('CAPTURED');
                        if (refresh) refresh();
                    } catch (verifyErr) {
                        setError(verifyErr instanceof Error ? verifyErr.message : 'Verification failed');
                        setStatus('FAILED');
                    }
                },
                modal: {
                    ondismiss: async function () {
                        await handleAbandonment(createdOrderId);
                    },
                },
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
            setError(e instanceof Error ? e.message : 'Checkout open failed');
            setStatus('FAILED');
        } finally {
            setLoading(false);
        }
    };

    const handleAbandonment = async (orderIdToAbandon: string) => {
        setStatus('ABANDONED');
        try {
            const data = await abandonCheckout({
                order_id: orderIdToAbandon,
                customer_id: 'cust_demo_001',
            });
            if (!data.case_id) throw new Error('Backend did not return a recovery case');
            setCaseId(data.case_id);
            setAmountInr(data.amount_inr ?? amountInr);
            setStatus('REVENUE_AT_RISK');
            if (refresh) refresh();

            try {
                const caseRes = await fetch(`${API_BASE}/api/cases/${data.case_id}`);
                if (caseRes.ok) {
                    const caseDetail = await caseRes.json();
                    const link =
                        caseDetail.payment_links?.[0]?.url ||
                        caseDetail.events?.find((e: any) => e.metadata?.recovery_url)?.metadata?.recovery_url;
                    if (link) setPaymentLink(link);
                    setStatus('RECOVERY_PENDING');
                }
            } catch {
                setStatus('RECOVERY_PENDING');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Abandonment handler error');
            setStatus('FAILED');
        }
    };

    const successPath = status === 'PAYMENT_VERIFIED' || status === 'CAPTURED';
    const abandonPath = ['ABANDONED', 'REVENUE_AT_RISK', 'RECOVERY_PENDING'].includes(status);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <ShoppingBag className="mr-3 text-rzp-blue" size={20} />
                        Checkout Recovery
                    </h2>
                    <p className="text-sm text-text-muted mt-1">SUCCESS, FAILURE, and ABANDONMENT are separate outcomes. Backend is authoritative.</p>
                </div>
            </div>

            {(status === 'SCRIPT_ERROR' || error) && (
                <div className="bg-red-50 border border-red-200 p-4 flex items-center space-x-3">
                    <AlertTriangle className="text-rzp-red" size={20} />
                    <div>
                        <div className="text-sm font-bold text-rzp-red uppercase tracking-wider">
                            {status === 'SCRIPT_ERROR' ? 'RAZORPAY CHECKOUT UNAVAILABLE' : 'CHECKOUT ERROR'}
                        </div>
                        <div className="text-xs text-text-muted mt-1 font-mono">{error || (scriptError ? 'checkout.js failed to load' : 'Provider not configured')}</div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border border-border shadow-sm flex flex-col items-center justify-center p-12">
                    <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                        <ShoppingBag size={48} className="text-gray-400" />
                    </div>
                    <h3 className="text-xl font-bold font-mono uppercase mb-2">Premium Headphones</h3>
                    <div className="text-2xl font-bold text-text-main font-mono mb-8">{formatExact(amountInr)}</div>

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
                            <span className="text-text-muted">Payment ID</span>
                            <span className="font-mono text-xs">{paymentId || '—'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Mode</span>
                            <span className="font-mono">{scriptError ? 'UNAVAILABLE' : 'Razorpay Test Mode'}</span>
                        </div>
                    </div>

                    <button
                        onClick={startCheckout}
                        disabled={loading || status === 'CHECKOUT_OPENED' || scriptError}
                        className="w-full max-w-sm bg-rzp-blue text-white font-bold tracking-widest uppercase py-3 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                        {status === 'ORDER_CREATED' ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
                        {scriptError ? 'CHECKOUT UNAVAILABLE' : 'PAY WITH RAZORPAY'}
                    </button>
                </div>

                <div className="bg-gray-50 border border-border shadow-sm p-6">
                    <h3 className="text-sm font-bold text-text-main uppercase tracking-wider mb-6">Lifecycle</h3>

                    <div className="space-y-4 font-mono text-sm">
                        <Step active={status !== 'IDLE'} label="CHECKOUT READY" />
                        <Step active={['ORDER_CREATED', 'CHECKOUT_OPENED', 'PAYMENT_VERIFIED', 'CAPTURED', 'ABANDONED', 'REVENUE_AT_RISK', 'RECOVERY_PENDING'].includes(status)} label="ORDER CREATED" />
                        <Step active={['CHECKOUT_OPENED', 'PAYMENT_VERIFIED', 'CAPTURED', 'ABANDONED', 'REVENUE_AT_RISK', 'RECOVERY_PENDING'].includes(status)} label="CHECKOUT OPENED" />

                        {successPath && (
                            <>
                                <Step active={status === 'PAYMENT_VERIFIED' || status === 'CAPTURED'} label="SUCCESS → PAYMENT VERIFIED" />
                                <Step active={status === 'CAPTURED'} label="CAPTURED" done={status === 'CAPTURED'} />
                            </>
                        )}

                        {abandonPath && (
                            <>
                                <Step active error={status === 'ABANDONED'} label="ABANDONED → REVENUE AT RISK" />
                                <Step active={status === 'REVENUE_AT_RISK' || status === 'RECOVERY_PENDING'} label="RISK → AGENT → SAFETY" />
                                <Step active={status === 'RECOVERY_PENDING'} label="AWAITING PAYMENT / RECOVERY PENDING" />
                            </>
                        )}

                        {status === 'CAPTURED' && (
                            <div className="p-4 bg-green-50 border border-green-200 rounded mt-4 space-y-1">
                                <div className="text-xs font-bold text-rzp-green uppercase tracking-wider flex items-center gap-2">
                                    <CheckCircle2 size={14} /> PAYMENT COMPLETED
                                </div>
                                <div className="text-xs">Razorpay Test Mode · {formatExact(amountInr)} · CAPTURED</div>
                                <div className="text-xs">Provider verified: YES</div>
                                <div className="text-[10px] text-text-muted">No fake recovery mission for successful checkout.</div>
                            </div>
                        )}

                        {paymentLink && (
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded mt-4">
                                <div className="text-xs font-bold text-rzp-blue uppercase tracking-wider mb-2">Payment Link Generated</div>
                                <a href={paymentLink} target="_blank" rel="noreferrer" className="text-rzp-blue underline break-all text-xs">
                                    {paymentLink}
                                </a>
                            </div>
                        )}
                    </div>

                    {caseId && (
                        <div className="mt-8 pt-6 border-t border-border">
                            <button onClick={() => navigate(`/cases/${caseId}`)} className="text-rzp-blue text-xs font-bold uppercase tracking-wider hover:underline">
                                View Recovery Case ({caseId}) →
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Step = ({ active, label, error, done }: { active: boolean; label: string; error?: boolean; done?: boolean }) => (
    <div className={`flex items-center space-x-3 ${active ? 'text-text-main' : 'text-gray-300'}`}>
        {error ? (
            <XCircle className="text-rzp-red" size={16} />
        ) : done ? (
            <CheckCircle2 className="text-rzp-green" size={16} />
        ) : (
            <div className={`w-4 h-4 rounded-full border-2 ${active ? 'border-rzp-blue bg-rzp-blue' : 'border-gray-300'}`} />
        )}
        <span className={active ? 'font-semibold' : ''}>{label}</span>
    </div>
);
