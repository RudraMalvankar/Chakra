import React, { useState, useEffect } from 'react';
import { fetchMockPayments, retryMockPayment } from '../services/api';
import { formatExact } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Loader } from 'lucide-react';

export const Gateway = () => {
    const [payments, setPayments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        const data = await fetchMockPayments();
        setPayments(data);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, []);

    const handleRetry = async (id: string) => {
        setRetrying(id);
        try {
            await retryMockPayment(id);
            await load();
        } catch (e) {
            console.error(e);
        }
        setRetrying(null);
    };

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-[calc(100vh-80px)] max-w-7xl mx-auto">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center space-x-3">
                        <span>Mock Gateway Console</span>
                        <Badge status="INFO">SYNTHETIC ENVIRONMENT</Badge>
                    </h2>
                    <p className="text-[10px] font-mono text-text-muted mt-1 uppercase tracking-widest">Synthetic Payment Provider (Port 8002)</p>
                </div>
                <button onClick={load} className="px-4 py-2 border border-border rounded text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors">
                    Refresh
                </button>
            </div>
            
            <div className="overflow-auto flex-1">
                {loading ? (
                    <div className="flex h-full items-center justify-center text-text-muted"><Loader className="animate-spin" /></div>
                ) : payments.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm font-mono text-text-muted">No transactions found or mock gateway is offline (Port 8002).</div>
                ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0">
                            <tr>
                                <th className="px-6 py-3 font-semibold">Payment ID</th>
                                <th className="px-6 py-3 font-semibold">Customer</th>
                                <th className="px-6 py-3 font-semibold text-right">Amount</th>
                                <th className="px-6 py-3 font-semibold">Failure Reason</th>
                                <th className="px-6 py-3 font-semibold">Status</th>
                                <th className="px-6 py-3 font-semibold">Controls</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {payments.map(p => (
                                <tr key={p.payment_id} className="hover:bg-gray-50 text-xs font-mono">
                                    <td className="px-6 py-3 font-bold text-rzp-blue">{p.payment_id}</td>
                                    <td className="px-6 py-3 text-text-main">{p.customer_id}</td>
                                    <td className="px-6 py-3 text-right text-text-main">{formatExact(p.amount_inr)}</td>
                                    <td className="px-6 py-3 text-text-muted">{p.error_code || '-'}</td>
                                    <td className="px-6 py-3"><Badge status={p.status}>{p.status}</Badge></td>
                                    <td className="px-6 py-3">
                                        {p.status !== 'captured' && (
                                            <button 
                                                onClick={() => handleRetry(p.payment_id)}
                                                disabled={retrying === p.payment_id}
                                                className="px-3 py-1 border border-border rounded text-[10px] font-bold uppercase hover:bg-gray-100"
                                            >
                                                {retrying === p.payment_id ? 'Retrying...' : 'Force Retry'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
