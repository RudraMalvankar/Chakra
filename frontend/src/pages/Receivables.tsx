import { API_BASE } from '../services/api';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatExact } from '../lib/format';
import { FileText, Calendar, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { Badge } from '../components/ui/Badge';


export const Receivables = () => {
    const navigate = useNavigate();
    const [receivables, setReceivables] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [promiseDate, setPromiseDate] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);

    const fetchReceivables = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/receivables`);
            if (!res.ok) throw new Error(`Unable to load receivables (${res.status})`);
            const data = await res.json();
            if (!Array.isArray(data)) throw new Error('Receivables response was invalid');
            setReceivables(data);
            setActionError(null);
        } catch (e) {
            console.error(e);
            setReceivables([]);
            setActionError(e instanceof Error ? e.message : 'Unable to load receivables');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReceivables();
    }, []);

    const handleCreatePromise = async (id: string, amount: number, customer: string) => {
        if (!promiseDate) { setActionError('Choose a promised date first.'); return; }
        
        try {
            const res = await fetch(`${API_BASE}/api/receivables/promises`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receivable_id: id,
                    customer: customer,
                    amount: amount,
                    promised_date: promiseDate
                })
            });
            if (!res.ok) throw new Error('Unable to record promise');
            setActionError(null);
            setPromiseDate('');
            fetchReceivables();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Unable to record promise');
        }
    };

    const handleBreakPromise = async (recId: string, promiseId: string) => {
        try {
            const res = await fetch(`${API_BASE}/api/receivables/promises/${promiseId}/break`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ receivable_id: recId })
            });
            if (!res.ok) throw new Error('Unable to mark promise broken');
            fetchReceivables();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Unable to update promise');
        }
    };

    const selected = receivables.find(r => r.id === selectedId);

    const totalOutstanding = receivables.reduce((sum, r) => sum + (r.remaining_amount ?? r.amount), 0);
    const totalOverdue = receivables.filter(r => r.days_overdue > 0).reduce((sum, r) => sum + (r.remaining_amount ?? r.amount), 0);
    const totalPromises = receivables.filter(r => r.status === 'PROMISE_TO_PAY').reduce((sum, r) => sum + (r.remaining_amount ?? r.amount), 0);
    const atRisk = receivables.filter(r => r.risk === 'HIGH' || r.risk === 'CRITICAL').reduce((sum, r) => sum + (r.remaining_amount ?? r.amount), 0);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <FileText className="mr-3 text-rzp-blue" size={20} />
                        B2B Receivables & Promise-to-Pay
                    </h2>
                    <p className="text-sm text-text-muted mt-1">Manage outstanding invoices and track customer payment promises.</p>
                </div>
            </div>

            {actionError && <div className="bg-red-50 border border-red-200 text-rzp-red p-3 text-sm">{actionError}</div>}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Total Outstanding</div>
                    <div className="text-2xl font-bold text-text-main font-mono">{formatCurrency(totalOutstanding)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Overdue</div>
                    <div className="text-2xl font-bold text-orange-500 font-mono">{formatCurrency(totalOverdue)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">At Risk</div>
                    <div className="text-2xl font-bold text-rzp-red font-mono">{formatCurrency(atRisk)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Promises Due</div>
                    <div className="text-2xl font-bold text-rzp-blue font-mono">{formatCurrency(totalPromises)}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white border border-border shadow-sm flex flex-col h-[600px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Invoices & Receivables</h3>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-white border-b border-border text-text-muted sticky top-0">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Customer</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Invoice</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase text-right">Amount</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Due</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Risk</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading && <tr><td colSpan={6} className="px-6 py-8 text-center text-text-muted">Loading...</td></tr>}
                                {!loading && receivables.map((r: any) => (
                                    <tr 
                                        key={r.id} 
                                        onClick={() => setSelectedId(r.id)} 
                                        className={`cursor-pointer transition-colors ${selectedId === r.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="px-6 py-3 font-semibold text-text-main">{r.customer}</td>
                                        <td className="px-6 py-3 font-mono text-xs text-text-muted">{r.id}</td>
                                        <td className="px-6 py-3 text-right font-mono font-medium">{formatExact(r.amount)}</td>
                                        <td className="px-6 py-3 text-xs font-mono">
                                            {r.due_date} 
                                            {r.days_overdue > 0 && <span className="text-rzp-red ml-2">({r.days_overdue}d late)</span>}
                                        </td>
                                        <td className="px-6 py-3"><Badge status={r.risk}>{r.risk}</Badge></td>
                                        <td className="px-6 py-3"><Badge status={r.status}>{r.status}</Badge></td>
                                    </tr>
                                ))}
                                {!loading && receivables.length === 0 && (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-text-muted font-mono">
                                        No receivables have been ingested.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white border border-border shadow-sm flex flex-col h-[600px] overflow-auto">
                    {selected ? (
                        <>
                            <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Receivable Detail</h3>
                            </div>
                            <div className="p-6 space-y-6">
                                <div>
                                    <div className="text-2xl font-bold font-mono text-text-main mb-1">{formatExact(selected.amount)}</div>
                                    <div className="text-sm font-semibold text-text-muted">{selected.customer} <span className="font-mono font-normal">({selected.id})</span></div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4 text-sm font-mono border-y border-border py-4">
                                    <div>
                                        <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1 font-sans font-bold">Due Date</div>
                                        <div>{selected.due_date}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1 font-sans font-bold">Days Overdue</div>
                                        <div className={selected.days_overdue > 0 ? "text-rzp-red font-bold" : ""}>{selected.days_overdue}</div>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="text-[10px] text-text-muted uppercase tracking-widest mb-3 font-bold">Promises to Pay</h4>
                                    {selected.promises?.length === 0 ? (
                                        <div className="text-xs text-text-muted font-mono italic">No promises recorded.</div>
                                    ) : (
                                        <div className="space-y-3">
                                            {selected.promises?.map((p: any) => (
                                                <div key={p.id} className="p-3 border border-border rounded bg-gray-50 text-sm">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="font-mono font-bold">{formatExact(p.amount)}</span>
                                                        <Badge status={p.status}>{p.status}</Badge>
                                                    </div>
                                                    <div className="flex justify-between items-center text-xs text-text-muted font-mono">
                                                        <span>Due: {p.promised_date}</span>
                                                    </div>
                                                    {['UPCOMING', 'DUE_TODAY'].includes(p.status) && (
                                                        <div className="mt-3 pt-3 border-t border-border flex justify-end">
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); handleBreakPromise(selected.id, p.id); }}
                                                                className="text-[10px] font-bold uppercase tracking-widest text-rzp-red hover:underline"
                                                            >
                                                                Mark as Broken
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="pt-4 border-t border-border">
                                    <h4 className="text-[10px] text-text-muted uppercase tracking-widest mb-3 font-bold">Recovery Actions</h4>
                                    <div className="space-y-2">
                                        <button 
                                            disabled={!promiseDate}
                                            onClick={() => handleCreatePromise(selected.id, selected.remaining_amount ?? selected.amount, selected.customer)}
                                            className="w-full py-2 bg-rzp-blue text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-700 transition-colors"
                                        >
                                            Record Promise to Pay
                                        </button>
                                        <label className="block text-[10px] font-bold uppercase tracking-widest text-text-muted">Promised date
                                            <input type="date" value={promiseDate} onChange={e => setPromiseDate(e.target.value)} className="mt-1 w-full border border-border rounded px-2 py-2 font-mono text-xs" />
                                        </label>
                                        <button 
                                            onClick={() => navigate('/voice-recovery')}
                                            className="w-full py-2 bg-white border border-rzp-blue text-rzp-blue text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-50 transition-colors"
                                        >
                                            Initiate Voice Recovery
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-sm text-text-muted font-mono">
                            Select a receivable to view details
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
