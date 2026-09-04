import { API_BASE } from '../services/api';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, XCircle, Loader2 } from 'lucide-react';
import { formatCurrency } from '../lib/format';


export const CheckoutRecovery = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [status, setStatus] = useState<'IDLE'|'CREATING'|'OPENED'|'ABANDONED'|'RECOVERING'|'RECOVERED'>('IDLE');
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [caseId, setCaseId] = useState<string | null>(null);
    
    // Simulate Razorpay Checkout via fake Razorpay object for the demo, 
    // OR use the real script if you want. 
    // The requirement says: "use actual Razorpay Checkout". 
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);
        return () => { document.body.removeChild(script); };
    }, []);

    const startCheckout = async () => {
        setLoading(true);
        setStatus('CREATING');
        
        try {
            // 1. Create Order via backend
            const orderRes = await fetch(`${API_BASE}/api/payments/create_order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount_inr: 5000, customer_id: 'cust_demo_001' })
            });
            const orderData = await orderRes.json();
            setOrderId(orderData.order_id);
            
            // 2. Fetch config
            const configRes = await fetch(`${API_BASE}/api/config`);
            const config = await configRes.json();
            
            // 3. Open Razorpay Checkout
            setStatus('OPENED');
            
            const options: any = {
                key: config.razorpay_key_id || 'rzp_test_mock',
                amount: 500000,
                currency: 'INR',
                name: 'Chakra Demo Store',
                description: 'Test Transaction',
                order_id: orderData.order_id,
                handler: function (response: any) {
                    console.log('Payment success', response);
                    setStatus('RECOVERED');
                },
                modal: {
                    ondismiss: async function() {
                        setStatus('ABANDONED');
                        await handleAbandonment();
                    }
                }
            };
            
            // @ts-ignore
            if (window.Razorpay) {
                // @ts-ignore
                const rzp = new window.Razorpay(options);
                rzp.open();
            } else {
                // Fallback if script failed
                setTimeout(() => {
                    setStatus('ABANDONED');
                    handleAbandonment();
                }, 2000);
            }
        } catch (e) {
            console.error(e);
            setStatus('IDLE');
        } finally {
            setLoading(false);
        }
    };
    
    const handleAbandonment = async () => {
        setStatus('RECOVERING');
        try {
            const simRes = await fetch(`${API_BASE}/api/demo/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    case_type: 'CHECKOUT_ABANDONMENT',
                    amount_inr: 5000,
                    failure_reason: 'user_abandoned',
                    customer_id: 'cust_demo_001'
                })
            });
            const simData = await simRes.json();
            setCaseId(simData.case_id);
            
            // Refresh global state so Command Center updates
            if (refresh) refresh();
            
            // Look into the trace to see if a payment link was generated
            const lastEvent = simData.trace[simData.trace.length - 1];
            if (lastEvent && lastEvent.details && lastEvent.details.recovery_url) {
                setPaymentLink(lastEvent.details.recovery_url);
            }
        } catch (e) {
            console.error(e);
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
                            <span className="text-text-muted">Method</span>
                            <span className="font-mono">UPI / Card</span>
                        </div>
                    </div>
                    
                    <button 
                        onClick={startCheckout}
                        disabled={loading || status === 'OPENED'}
                        className="w-full max-w-sm bg-rzp-blue text-white font-bold tracking-widest uppercase py-3 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                        {status === 'CREATING' ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
                        PAY WITH RAZORPAY
                    </button>
                </div>
                
                <div className="bg-gray-50 border border-border shadow-sm p-6">
                    <h3 className="text-sm font-bold text-text-main uppercase tracking-wider mb-6">Recovery Lifecycle</h3>
                    
                    <div className="space-y-6 font-mono text-sm">
                        <Step active={status !== 'IDLE'} label="CHECKOUT OPENED" />
                        <Step active={status === 'ABANDONED' || status === 'RECOVERING' || status === 'RECOVERED'} label="CHECKOUT ABANDONED" error={status === 'ABANDONED'} />
                        <Step active={status === 'RECOVERING' || status === 'RECOVERED'} label="REVENUE AT RISK" />
                        <Step active={(status === 'RECOVERING' || status === 'RECOVERED') && caseId != null} label="AI TRIAGE & RISK ASSESSMENT" />
                        <Step active={(status === 'RECOVERING' || status === 'RECOVERED') && caseId != null} label="RECOVERY AGENT & SAFETY GATE" />
                        
                        {paymentLink && (
                            <div className="p-4 bg-blue-50 border border-blue-200 rounded mt-4">
                                <div className="text-xs font-bold text-rzp-blue uppercase tracking-wider mb-2">Payment Link Generated</div>
                                <a href={paymentLink} target="_blank" rel="noreferrer" className="text-rzp-blue underline break-all">
                                    {paymentLink}
                                </a>
                                <div className="mt-2 text-xs text-text-muted">Click link to complete payment in Test Mode</div>
                            </div>
                        )}
                    </div>
                    
                    {caseId && (
                        <div className="mt-8 pt-6 border-t border-border">
                            <button onClick={() => navigate(`/cases/${caseId}`)} className="text-rzp-blue text-xs font-bold uppercase tracking-wider hover:underline">
                                View Recovery Mission →
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
