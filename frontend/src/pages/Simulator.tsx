import React, { useState } from 'react';
import { simulatePayment } from '../services/api';
import { formatCurrency } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ArrowRight, Loader } from 'lucide-react';

const PRESETS = [
    { label: 'Payment Failure', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 5000, failure_reason: 'payment_timed_out', mandate_state: 'INACTIVE', customer_id: 'cust_demo123' } },
    { label: 'Mandate Revoked', payload: { case_type: 'SUBSCRIPTION', amount_inr: 8999, failure_reason: 'mandate_revoked', mandate_state: 'REVOKED', customer_id: 'cust_sub_001' } },
    { label: 'High Risk / Fraud', payload: { case_type: 'PAYMENT_FAILURE', amount_inr: 15000, failure_reason: 'fraud_suspected', mandate_state: 'ACTIVE', customer_id: 'cust_risk_999' } }
];

export const Simulator = ({ refresh }: any) => {
    const navigate = useNavigate();
    const [payload, setPayload] = useState(PRESETS[0].payload);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const trace = await simulatePayment(payload);
            setResult(trace);
            refresh(); // refresh global data
        } catch (err) {
            console.error(err);
        }
        setLoading(false);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Create Synthetic Payment</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Process a live event through the Chakra mock environment</p>
                    </div>
                    <Badge status="INFO">SYNTHETIC ENVIRONMENT</Badge>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Presets</h3>
                        <div className="space-y-2 mb-6">
                            {PRESETS.map((p, i) => (
                                <button key={i} onClick={() => setPayload(p.payload)} className={`block w-full text-left px-4 py-2 border rounded text-sm transition-colors ${payload.failure_reason === p.payload.failure_reason ? 'border-rzp-blue bg-blue-50 text-rzp-blue font-bold' : 'border-border text-text-main hover:bg-gray-50'}`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Amount (INR)</label>
                                <input type="number" value={payload.amount_inr} onChange={e => setPayload({...payload, amount_inr: Number(e.target.value)})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Case Type</label>
                                <select value={payload.case_type} onChange={e => setPayload({...payload, case_type: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                    <option value="PAYMENT_FAILURE">PAYMENT_FAILURE</option>
                                    <option value="SUBSCRIPTION">SUBSCRIPTION</option>
                                    <option value="CHECKOUT_ABANDONMENT">CHECKOUT_ABANDONMENT</option>
                                    <option value="RECEIVABLE">RECEIVABLE</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Failure Reason (Gateway)</label>
                                <select value={payload.failure_reason} onChange={e => setPayload({...payload, failure_reason: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                    <option value="payment_timed_out">Timeout</option>
                                    <option value="insufficient_funds">Insufficient Funds</option>
                                    <option value="card_declined">Card Declined</option>
                                    <option value="mandate_revoked">Mandate Revoked</option>
                                    <option value="fraud_suspected">Fraud Suspected</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Mandate State</label>
                                <select value={payload.mandate_state} onChange={e => setPayload({...payload, mandate_state: e.target.value})} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                                    <option value="ACTIVE">ACTIVE</option>
                                    <option value="INACTIVE">INACTIVE</option>
                                    <option value="REVOKED">REVOKED</option>
                                </select>
                            </div>

                            <button type="submit" disabled={loading} className="w-full mt-4 bg-rzp-blue text-white font-bold uppercase tracking-widest text-xs py-3 rounded hover:bg-blue-700 transition-colors flex justify-center items-center">
                                {loading ? <Loader className="animate-spin" size={16} /> : 'CREATE & PROCESS PAYMENT'}
                            </button>
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
