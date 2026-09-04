import React, { useState, useEffect } from 'react';
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

export const PromiseToPay = () => {
    const [promises, setPromises] = useState<Promise[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadPromises();
    }, []);

    const loadPromises = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/receivables/promises`);
            if (res.ok) {
                const data = await res.json();
                setPromises(data);
            }
        } catch (err) {
            console.error('Failed to load promises:', err);
        } finally {
            setLoading(false);
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
