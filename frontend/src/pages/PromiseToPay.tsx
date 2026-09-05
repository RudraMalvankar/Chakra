import React, { useReducer, useEffect } from 'react';
import { API_BASE } from '../services/api';
import { formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Handshake } from 'lucide-react';

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
            <div className="max-w-5xl mx-auto space-y-6">
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-sm font-mono text-text-muted">Loading promises...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                            <Handshake className="mr-3 text-rzp-blue" size={20} />
                            Promise-to-Pay Tracker
                        </h2>
                        <p className="text-sm text-text-muted mt-1">Track customer payment promises and broken promise escalations.</p>
                    </div>
                    <Badge status="INFO">{promises.length} PROMISES</Badge>
                </div>
            </div>
            {loadError && <div className="bg-red-50 border border-red-200 text-rzp-red p-3 text-sm">{loadError}</div>}

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
                                    <th className="px-6 py-3 font-semibold">Action</th>
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
                                        <td className="px-6 py-3">{['UPCOMING', 'DUE_TODAY'].includes(p.status) && (
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        try {
                                                            await fetch(`${API_BASE}/api/receivables/promises/${p.id}/fulfill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actual_amount: p.promised_amount }) });
                                                            loadPromises();
                                                        } catch (e) { alert('Failed to fulfill'); }
                                                    }}
                                                    className="px-2 py-1 bg-gray-100 border text-[10px] font-bold text-rzp-blue uppercase hover:bg-gray-200"
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
                                                    className="px-2 py-1 bg-gray-100 border text-[10px] font-bold text-rzp-red uppercase hover:bg-gray-200"
                                                >
                                                    Break
                                                </button>
                                            </div>
                                        )}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
