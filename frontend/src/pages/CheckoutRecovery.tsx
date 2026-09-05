import { API_BASE, createOrder, verifyPayment, abandonCheckout, fetchConfig } from '../services/api';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, XCircle, Loader2, AlertTriangle, CheckCircle2, Repeat, Package, ArrowRight } from 'lucide-react';
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

type CheckoutMode = 'order' | 'subscription';

export const CheckoutRecovery = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [mode, setMode] = useState<CheckoutMode>('order');
    const [loading, setLoading] = useState(false);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [status, setStatus] = useState<CheckoutStatus>('READY');
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [caseId, setCaseId] = useState<string | null>(null);
    const [paymentId, setPaymentId] = useState<string | null>(null);
    const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [scriptError, setScriptError] = useState(false);
    const scriptRef = useRef<HTMLScriptElement | null>(null);

    // Mode-specific configurations
    const orderConfig = {
        title: 'Premium Headphones',
        amount: 5000,
        desc: 'One-time hardware purchase',
    };

    const subConfig = {
        title: 'Enterprise SaaS Pro Plan',
        amount: 2999,
        desc: 'Monthly recurring subscription with e-Mandate auto-debit',
        frequency: 'monthly',
    };

    const currentItem = mode === 'order' ? orderConfig : subConfig;
    const [amountInr, setAmountInr] = useState(orderConfig.amount);

    // Sync amount and reset lifecycle when switching mode
    const handleModeSwitch = (newMode: CheckoutMode) => {
        setMode(newMode);
        setAmountInr(newMode === 'order' ? orderConfig.amount : subConfig.amount);
        setOrderId(null);
        setPaymentId(null);
        setSubscriptionId(null);
        setPaymentLink(null);
        setCaseId(null);
        setStatus('READY');
        setError(null);
    };

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
        setSubscriptionId(null);
        setStatus('ORDER_CREATED');

        try {
            const orderData = await createOrder({
                amount_inr: amountInr,
                customer_id: 'cust_demo_001',
                item_type: mode,
                frequency: mode === 'subscription' ? 'monthly' : undefined,
                plan_name: mode === 'subscription' ? 'Enterprise SaaS Pro' : undefined,
            });
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
                name: mode === 'order' ? 'Chakra Demo Store' : 'Chakra Subscriptions',
                description: mode === 'order' ? 'Test Hardware Purchase' : 'Monthly SaaS Recurring Subscription',
                order_id: createdOrderId,
                notes: {
                    item_type: mode,
                    plan: mode === 'subscription' ? 'Enterprise SaaS Pro' : 'Single Order',
                },
                handler: async function (response: any) {
                    setStatus('PAYMENT_VERIFIED');
                    try {
                        const verified = await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id || createdOrderId,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            customer_id: 'cust_demo_001',
                            item_type: mode,
                            frequency: mode === 'subscription' ? 'monthly' : undefined,
                            plan_name: mode === 'subscription' ? 'Enterprise SaaS Pro' : undefined,
                        });
                        setPaymentId(verified.payment_id);
                        setAmountInr(verified.amount_inr ?? amount);
                        if (verified.subscription_id) {
                            setSubscriptionId(verified.subscription_id);
                        }
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
            {/* Header & Mode Switcher */}
            <div className="bg-white border border-border shadow-sm p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <ShoppingBag className="mr-3 text-rzp-blue" size={20} />
                        Checkout & Subscription Recovery
                    </h2>
                    <p className="text-sm text-text-muted mt-1">
                        Test live Razorpay checkout for both single orders and recurring subscriptions.
                    </p>
                </div>

                {/* 2-Mode Switcher */}
                <div className="flex bg-gray-100 p-1 rounded border border-border self-start sm:self-auto">
                    <button
                        onClick={() => handleModeSwitch('order')}
                        className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded transition-all ${
                            mode === 'order'
                                ? 'bg-white text-rzp-blue shadow-sm'
                                : 'text-text-muted hover:text-text-main'
                        }`}
                    >
                        <Package size={14} />
                        <span>Normal Order</span>
                    </button>
                    <button
                        onClick={() => handleModeSwitch('subscription')}
                        className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded transition-all ${
                            mode === 'subscription'
                                ? 'bg-rzp-blue text-white shadow-sm'
                                : 'text-text-muted hover:text-text-main'
                        }`}
                    >
                        <Repeat size={14} />
                        <span>Recurring Subscription</span>
                    </button>
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
                {/* Checkout Product Card */}
                <div className="bg-white border border-border shadow-sm flex flex-col items-center justify-center p-10 relative">
                    <div className="absolute top-4 right-4">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded font-mono border ${
                            mode === 'subscription'
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                : 'bg-gray-100 border-gray-200 text-gray-700'
                        }`}>
                            {mode === 'subscription' ? 'Auto-Debit e-Mandate' : 'One-Time Payment'}
                        </span>
                    </div>

                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-5 ${
                        mode === 'subscription' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'
                    }`}>
                        {mode === 'subscription' ? <Repeat size={40} /> : <ShoppingBag size={40} />}
                    </div>

                    <h3 className="text-lg font-bold font-mono uppercase text-center mb-1">{currentItem.title}</h3>
                    <p className="text-xs text-text-muted text-center mb-4 max-w-xs">{currentItem.desc}</p>

                    <div className="text-2xl font-bold text-text-main font-mono mb-6">
                        {formatExact(amountInr)}
                        {mode === 'subscription' && <span className="text-xs text-text-muted font-normal"> / month</span>}
                    </div>

                    <div className="w-full max-w-sm space-y-2.5 mb-6 text-sm">
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Customer</span>
                            <span className="font-mono">cust_demo_001</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Type</span>
                            <span className="font-mono font-semibold uppercase text-xs">
                                {mode === 'subscription' ? 'Subscription (Monthly)' : 'Standard Order'}
                            </span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Order ID</span>
                            <span className="font-mono text-xs">{orderId || 'Generated on click'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Payment ID</span>
                            <span className="font-mono text-xs">{paymentId || '—'}</span>
                        </div>
                        {subscriptionId && (
                            <div className="flex justify-between border-b border-border pb-2 bg-indigo-50/50 px-2 py-1 rounded">
                                <span className="text-indigo-700 font-bold text-xs">Subscription ID</span>
                                <span className="font-mono text-xs font-bold text-indigo-700">{subscriptionId}</span>
                            </div>
                        )}
                        <div className="flex justify-between border-b border-border pb-2">
                            <span className="text-text-muted">Gateway</span>
                            <span className="font-mono">{scriptError ? 'UNAVAILABLE' : 'Razorpay Test Mode'}</span>
                        </div>
                    </div>

                    <button
                        onClick={startCheckout}
                        disabled={loading || status === 'CHECKOUT_OPENED' || scriptError}
                        className={`w-full max-w-sm text-white font-bold tracking-widest uppercase py-3 rounded transition-colors disabled:opacity-50 flex items-center justify-center ${
                            mode === 'subscription'
                                ? 'bg-indigo-600 hover:bg-indigo-700'
                                : 'bg-rzp-blue hover:bg-blue-700'
                        }`}
                    >
                        {status === 'ORDER_CREATED' ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
                        {scriptError
                            ? 'CHECKOUT UNAVAILABLE'
                            : mode === 'subscription'
                            ? 'SUBSCRIBE WITH RAZORPAY'
                            : 'PAY WITH RAZORPAY'}
                    </button>
                </div>

                {/* Lifecycle & Status Card */}
                <div className="bg-gray-50 border border-border shadow-sm p-6 flex flex-col justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-text-main uppercase tracking-wider mb-6">Lifecycle Flow</h3>

                        <div className="space-y-4 font-mono text-sm">
                            <Step active={status !== 'IDLE'} label={mode === 'subscription' ? 'SUBSCRIPTION CHECKOUT READY' : 'CHECKOUT READY'} />
                            <Step active={['ORDER_CREATED', 'CHECKOUT_OPENED', 'PAYMENT_VERIFIED', 'CAPTURED', 'ABANDONED', 'REVENUE_AT_RISK', 'RECOVERY_PENDING'].includes(status)} label="ORDER CREATED (RAZORPAY)" />
                            <Step active={['CHECKOUT_OPENED', 'PAYMENT_VERIFIED', 'CAPTURED', 'ABANDONED', 'REVENUE_AT_RISK', 'RECOVERY_PENDING'].includes(status)} label="CHECKOUT MODAL OPENED" />

                            {successPath && (
                                <>
                                    <Step active={status === 'PAYMENT_VERIFIED' || status === 'CAPTURED'} label="SUCCESS → PAYMENT VERIFIED" />
                                    <Step
                                        active={status === 'CAPTURED'}
                                        label={mode === 'subscription' ? 'ACTIVE → RECURRING SUBSCRIPTION REGISTERED' : 'CAPTURED'}
                                        done={status === 'CAPTURED'}
                                    />
                                </>
                            )}

                            {abandonPath && (
                                <>
                                    <Step active error={status === 'ABANDONED'} label="MODAL DISMISSED → REVENUE AT RISK" />
                                    <Step active={status === 'REVENUE_AT_RISK' || status === 'RECOVERY_PENDING'} label="RISK → AGENT → SAFETY GATE" />
                                    <Step active={status === 'RECOVERY_PENDING'} label="RECOVERY PENDING → PAYMENT LINK SENT" />
                                </>
                            )}

                            {status === 'CAPTURED' && (
                                <div className="p-4 bg-green-50 border border-green-200 rounded mt-4 space-y-2">
                                    <div className="text-xs font-bold text-rzp-green uppercase tracking-wider flex items-center gap-2">
                                        <CheckCircle2 size={14} /> {mode === 'subscription' ? 'SUBSCRIPTION ACTIVATED' : 'PAYMENT COMPLETED'}
                                    </div>
                                    <div className="text-xs">Razorpay Test Mode · {formatExact(amountInr)} · CAPTURED</div>
                                    <div className="text-xs">Authoritative server verification: PASSED</div>
                                    {mode === 'subscription' && subscriptionId && (
                                        <div className="text-xs font-semibold text-indigo-700 pt-1">
                                            Linked to Subscriptions table as {subscriptionId}
                                        </div>
                                    )}
                                </div>
                            )}

                            {paymentLink && (
                                <div className="p-4 bg-blue-50 border border-blue-200 rounded mt-4">
                                    <div className="text-xs font-bold text-rzp-blue uppercase tracking-wider mb-2">Recovery Payment Link Generated</div>
                                    <a href={paymentLink} target="_blank" rel="noreferrer" className="text-rzp-blue underline break-all text-xs">
                                        {paymentLink}
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Quick navigation to Cases or Subscriptions page */}
                    <div className="mt-8 pt-6 border-t border-border space-y-2">
                        {caseId && (
                            <div>
                                <button onClick={() => navigate(`/cases/${caseId}`)} className="text-rzp-blue text-xs font-bold uppercase tracking-wider hover:underline flex items-center">
                                    View Recovery Case ({caseId}) <ArrowRight size={12} className="ml-1" />
                                </button>
                            </div>
                        )}
                        {status === 'CAPTURED' && mode === 'subscription' && (
                            <div>
                                <button
                                    onClick={() => navigate('/subscriptions')}
                                    className="w-full py-2.5 px-4 bg-white border border-indigo-300 text-indigo-700 text-xs font-bold uppercase tracking-wider rounded hover:bg-indigo-50 transition-colors flex items-center justify-center"
                                >
                                    <span>View In Subscriptions Dashboard</span>
                                    <ArrowRight size={14} className="ml-1.5" />
                                </button>
                            </div>
                        )}
                    </div>
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

