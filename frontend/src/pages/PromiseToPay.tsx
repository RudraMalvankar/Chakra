import React, { useReducer, useEffect, useState } from 'react';
import { API_BASE, sendPromiseReminder, sendPromiseEmail, dispatchPromiseReminders } from '../services/api';
import { formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Handshake, MessageSquare, Send, CheckCircle2, AlertCircle, Clock, Mail, Eye, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Promise {
    id: string;
    receivable_id: string;
    customer_name: string;
    promised_amount: number;
    promise_date: string;
    status: string;
    source: string;
    notes: string | null;
    created_at: string;
}

type PromiseState = { promises: Promise[]; loading: boolean; loadError: string | null };
type PromiseAction =
    | { type: 'loaded'; promises: Promise[] }
    | { type: 'failed'; message: string };

function promiseReducer(state: PromiseState, action: PromiseAction): PromiseState {
    if (action.type === 'loaded') return { promises: action.promises, loading: false, loadError: null };
    return { promises: [], loading: false, loadError: action.message };
}

export const PromiseToPay = () => {
    const [{ promises, loading, loadError }, dispatch] = useReducer(promiseReducer, {
        promises: [], loading: true, loadError: null,
    });

    const [activeRemindPromise, setActiveRemindPromise] = useState<Promise | null>(null);
    const [remindPhone, setRemindPhone] = useState('+919930832015');
    const [remindTiming, setRemindTiming] = useState<'auto' | 'before' | 'due' | 'after'>('auto');
    const [remindSending, setRemindSending] = useState(false);
    const [emailSendingId, setEmailSendingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [batchSending, setBatchSending] = useState(false);
    const [selectedPromise, setSelectedPromise] = useState<Promise | null>(null);

    const handleSendEmailReminder = async (promise: Promise) => {
        setEmailSendingId(promise.id);
        setFeedback(null);
        try {
            const res = await sendPromiseEmail(promise.id);
            if (res.status === 'sent') {
                setFeedback({
                    type: 'success',
                    message: `Twilio email dispatched to ${res.to || 'rudracmalvankar@gmail.com'}! Operation: ${res.provider_message_id || 'OK'}`,
                });
            } else {
                setFeedback({
                    type: 'error',
                    message: `Email failed: ${res.message || 'Error'}`,
                });
            }
        } catch (e: any) {
            setFeedback({ type: 'error', message: `Email error: ${e.message || 'Error'}` });
        } finally {
            setEmailSendingId(null);
        }
    };

    async function loadPromises() {
        try {
            const res = await fetch(`${API_BASE}/api/receivables/promises`);
            if (res.ok) {
                const data = await res.json();
                dispatch({ type: 'loaded', promises: data });
            } else {
                dispatch({ type: 'failed', message: `Unable to load promises (${res.status})` });
            }
        } catch (err) {
            console.error('Failed to load promises:', err);
            dispatch({ type: 'failed', message: 'Unable to load promises' });
        }
    }

    useEffect(() => {
        loadPromises();
    }, []);

    const handleSendReminder = async () => {
        if (!activeRemindPromise || !remindPhone) return;
        setRemindSending(true);
        setFeedback(null);
        try {
            const res = await sendPromiseReminder(activeRemindPromise.id, {
                phone_number: remindPhone,
                timing: remindTiming,
            });
            if (res.status === 'success') {
                const sid = res.provider_result?.provider_message_id || 'OK';
                setFeedback({
                    type: 'success',
                    message: `Twilio SMS dispatched! SID: ${sid} (${res.timing} reminder sent to ${remindPhone})`,
                });
                setActiveRemindPromise(null);
            } else {
                setFeedback({
                    type: 'error',
                    message: `Failed: ${res.provider_result?.message || 'Could not send SMS'}`,
                });
            }
        } catch (e: any) {
            setFeedback({ type: 'error', message: `Error: ${e.message || 'Network error'}` });
        } finally {
            setRemindSending(false);
        }
    };

    const handleBatchReminders = async () => {
        setBatchSending(true);
        setFeedback(null);
        try {
            const res = await dispatchPromiseReminders({ default_phone: remindPhone });
            setFeedback({
                type: 'success',
                message: `Automated scan complete: ${res.reminders_dispatched} reminder(s) sent out of ${res.total_scanned} active promises.`,
            });
            loadPromises();
        } catch (e: any) {
            setFeedback({ type: 'error', message: `Batch dispatch failed: ${e.message || 'Error'}` });
        } finally {
            setBatchSending(false);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'FULFILLED': return <Badge status="SUCCESS">FULFILLED</Badge>;
            case 'BROKEN': return <Badge status="DANGER">BROKEN</Badge>;
            case 'DUE_TODAY': return <Badge status="WARNING">DUE TODAY</Badge>;
            case 'UPCOMING': return <Badge status="INFO">UPCOMING</Badge>;
            case 'ESCALATED': return <Badge status="DANGER">ESCALATED</Badge>;
            default: return <Badge status="INFO">{status}</Badge>;
        }
    };

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-sm font-mono text-text-muted">Loading promises...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="bg-white border border-border shadow-sm p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                            <Handshake className="mr-3 text-rzp-blue" size={20} />
                            Promise-to-Pay Tracker
                        </h2>
                        <p className="text-sm text-text-muted mt-1">
                            Track customer payment promises, trigger Twilio SMS reminders, and handle escalations.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            disabled={batchSending}
                            onClick={handleBatchReminders}
                            className="px-3 py-2 bg-rzp-blue hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                            <Send size={14} />
                            {batchSending ? 'Dispatching...' : 'Dispatch Due SMS Reminders'}
                        </button>
                        <Badge status="INFO">{promises.length} PROMISES</Badge>
                    </div>
                </div>
            </div>

            {/* Feedback alert */}
            {feedback && (
                <div className={`p-4 rounded border text-xs font-mono flex items-center gap-2 ${
                    feedback.type === 'success'
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                    {feedback.type === 'success' ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertCircle size={16} className="shrink-0" />}
                    <span>{feedback.message}</span>
                </div>
            )}

            {loadError && <div className="bg-red-50 border border-red-200 text-rzp-red p-3 text-sm font-mono">{loadError}</div>}

            {/* Reminder Modal/Drawer */}
            {activeRemindPromise && (
                <div className="bg-white border-2 border-rzp-blue rounded p-5 shadow-md space-y-4">
                    <div className="flex justify-between items-center border-b border-border pb-3">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-text-main flex items-center gap-2">
                            <MessageSquare size={16} className="text-rzp-blue" />
                            Send Twilio SMS Reminder — {activeRemindPromise.customer_name} ({formatCurrency(activeRemindPromise.promised_amount)})
                        </h3>
                        <button onClick={() => setActiveRemindPromise(null)} className="text-text-muted hover:text-text-main font-bold text-sm">✕</button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                                Target Phone Number
                            </label>
                            <input
                                type="text"
                                value={remindPhone}
                                onChange={e => setRemindPhone(e.target.value)}
                                placeholder="+919930832015"
                                className="w-full border border-border rounded p-2 font-mono text-xs"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                                Reminder Timing
                            </label>
                            <select
                                value={remindTiming}
                                onChange={e => setRemindTiming(e.target.value as any)}
                                className="w-full border border-border rounded p-2 text-xs"
                            >
                                <option value="auto">Auto-detect from date ({activeRemindPromise.promise_date})</option>
                                <option value="before">1 Day Before (Due Tomorrow)</option>
                                <option value="due">Due Today</option>
                                <option value="after">1 Day After / Overdue (Due Yesterday)</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                        <button
                            onClick={() => setActiveRemindPromise(null)}
                            className="px-3 py-1.5 border border-border text-xs font-bold uppercase tracking-wider rounded text-text-muted hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            disabled={remindSending || !remindPhone}
                            onClick={handleSendReminder}
                            className="px-4 py-1.5 bg-rzp-blue hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                            <Send size={14} />
                            {remindSending ? 'Sending via Twilio...' : 'Send SMS Reminder'}
                        </button>
                    </div>
                </div>
            )}

            {/* Promises Table */}
            {promises.length === 0 ? (
                <div className="bg-white border border-border shadow-sm p-12 text-center">
                    <Handshake size={48} className="mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-bold text-text-main uppercase tracking-wider mb-2">No Promises Yet</h3>
                    <p className="text-sm text-text-muted">Create promises via the Receivables page or Voice Recovery workflow.</p>
                </div>
            ) : (
                <div className="bg-white border border-border shadow-sm">
                    <div className="border border-border rounded overflow-hidden">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-gray-50 border-b border-border text-text-muted">
                                <tr>
                                    <th className="px-6 py-3 font-semibold">Customer</th>
                                    <th className="px-6 py-3 font-semibold text-right">Amount</th>
                                    <th className="px-6 py-3 font-semibold">Promise Date</th>
                                    <th className="px-6 py-3 font-semibold">Status</th>
                                    <th className="px-6 py-3 font-semibold">Source</th>
                                    <th className="px-6 py-3 font-semibold">Created</th>
                                    <th className="px-6 py-3 font-semibold text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border font-mono">
                                {promises.map(p => (
                                    <tr key={p.id} className="hover:bg-gray-50 text-xs">
                                        <td className="px-6 py-3 font-bold text-text-main">{p.customer_name}</td>
                                        <td className="px-6 py-3 text-right">{formatCurrency(p.promised_amount)}</td>
                                        <td className="px-6 py-3">{p.promise_date}</td>
                                        <td className="px-6 py-3">{getStatusBadge(p.status)}</td>
                                        <td className="px-6 py-3 text-text-muted uppercase">{p.source}</td>
                                        <td className="px-6 py-3 text-text-muted">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                                {/* Inspect details button */}
                                                <button
                                                    onClick={() => setSelectedPromise(p)}
                                                    className="px-2 py-1 bg-gray-50 border border-gray-200 text-[10px] font-bold text-text-main uppercase hover:bg-gray-100 flex items-center gap-1 rounded transition-colors whitespace-nowrap"
                                                    title="View Promise and Invoice Details"
                                                >
                                                    <Eye size={11} />
                                                    Details
                                                </button>

                                                {/* Remind via SMS button available for any non-terminal promise */}
                                                {!['FULFILLED', 'ESCALATED'].includes(p.status) && (
                                                    <>
                                                        <button
                                                            onClick={() => setActiveRemindPromise(p)}
                                                            className="px-2 py-1 bg-blue-50 border border-blue-200 text-[10px] font-bold text-rzp-blue uppercase hover:bg-blue-100 flex items-center gap-1 rounded transition-colors whitespace-nowrap"
                                                            title="Send SMS reminder through Twilio"
                                                        >
                                                            <MessageSquare size={11} />
                                                            SMS
                                                        </button>
                                                        <button
                                                            disabled={emailSendingId === p.id}
                                                            onClick={(e) => { e.stopPropagation(); handleSendEmailReminder(p); }}
                                                            className="px-2 py-1 bg-purple-50 border border-purple-200 text-[10px] font-bold text-purple-700 uppercase hover:bg-purple-100 flex items-center gap-1 rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                                                            title="Send Email reminder via Twilio Comms API"
                                                        >
                                                            <Mail size={11} />
                                                            {emailSendingId === p.id ? 'Sending...' : 'Email'}
                                                        </button>
                                                    </>
                                                )}

                                                {['UPCOMING', 'DUE_TODAY'].includes(p.status) && (
                                                    <>
                                                        <button 
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                try {
                                                                    await fetch(`${API_BASE}/api/receivables/promises/${p.id}/fulfill`, {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ actual_amount: p.promised_amount, provider: 'razorpay_test', reference: `pay_${Date.now()}` }),
                                                                    });
                                                                    loadPromises();
                                                                } catch (e) { alert('Failed to fulfill'); }
                                                            }}
                                                            className="px-2 py-1 bg-green-50 border border-green-200 text-[10px] font-bold text-green-700 uppercase hover:bg-green-100 rounded whitespace-nowrap"
                                                        >
                                                            Fulfill
                                                        </button>
                                                        <button 
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                try {
                                                                    await fetch(`${API_BASE}/api/receivables/promises/${p.id}/break`, { method: 'POST' });
                                                                    loadPromises();
                                                                } catch (e) { alert('Failed to break'); }
                                                            }}
                                                            className="px-2 py-1 bg-red-50 border border-red-200 text-[10px] font-bold text-rzp-red uppercase hover:bg-red-100 rounded whitespace-nowrap"
                                                        >
                                                            Break
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Promise Detail Modal / Drawer */}
            {selectedPromise && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[85vh] overflow-y-auto border border-border">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center sticky top-0 bg-white">
                            <div>
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Promise Inspection</div>
                                <h3 className="text-base font-bold font-mono text-text-main flex items-center gap-2 mt-0.5">
                                    {selectedPromise.customer_name}
                                    {getStatusBadge(selectedPromise.status)}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedPromise(null)}
                                className="text-text-muted hover:text-text-main p-1 rounded-md hover:bg-gray-100"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-xs font-mono">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Promised Amount</div>
                                    <div className="text-sm font-bold text-text-main mt-0.5">
                                        {formatCurrency(selectedPromise.promised_amount)}
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Target Date</div>
                                    <div className="text-xs font-bold text-text-main mt-0.5">
                                        {selectedPromise.promise_date}
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Origin Source</div>
                                    <div className="text-xs font-bold text-rzp-blue mt-0.5 uppercase">
                                        {selectedPromise.source || 'MANUAL'}
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-gray-50 rounded border border-border space-y-2">
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Associated Receivable & References</div>
                                <div className="space-y-1.5 text-xs">
                                    <div><span className="text-text-muted">Receivable ID:</span> <span className="font-bold text-text-main">{selectedPromise.receivable_id}</span></div>
                                    <div><span className="text-text-muted">Promise ID:</span> <span className="font-bold text-text-main">{selectedPromise.id}</span></div>
                                    <div><span className="text-text-muted">Created:</span> <span className="font-bold text-text-main">{selectedPromise.created_at ? new Date(selectedPromise.created_at).toLocaleString() : 'N/A'}</span></div>
                                    {selectedPromise.notes && (
                                        <div><span className="text-text-muted">Notes:</span> <span className="font-bold text-text-main">{selectedPromise.notes}</span></div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-border flex justify-between items-center">
                                <Link
                                    to="/receivables"
                                    className="px-4 py-2 bg-rzp-blue hover:bg-blue-700 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                                >
                                    <ExternalLink size={13} />
                                    Open Invoices / Receivables
                                </Link>
                                <button
                                    onClick={() => setSelectedPromise(null)}
                                    className="px-4 py-2 border border-border text-text-muted hover:bg-gray-50 rounded text-xs font-bold uppercase tracking-wider"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
