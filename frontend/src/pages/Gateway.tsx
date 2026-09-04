import React, { useState, useEffect } from 'react';
import { fetchMockPayments, retryMockPayment, fetchConfig } from '../services/api';
import { formatExact } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Loader } from 'lucide-react';

export const Gateway = () => {
    const [payments, setPayments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState<string | null>(null);
    const [config, setConfig] = useState<any>({ mode: 'synthetic' });

    const load = async () => {
        setLoading(true);
        const data = await fetchMockPayments();
        setPayments(data);
        const cfg = await fetchConfig();
        setConfig(cfg);
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
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-text-main">Payment Operations</h1>
                    <p className="text-sm text-text-muted mt-1 font-mono">
                        Direct connection to provider events
                    </p>
                </div>
                {config.mode === 'test' ? (
                    <Badge status="SUCCESS">RAZORPAY TEST MODE</Badge>
                ) : (
                    <Badge status="INFO">SYNTHETIC GATEWAY</Badge>
                )}
            </div>

            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                    <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">Gateway State</h2>
                    <button onClick={load} className="text-xs font-mono text-rzp-blue hover:underline">
                        Refresh
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border bg-gray-50/50">
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Payment ID / Order ID</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Customer</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Failure Reason</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading && payments.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-text-muted text-sm font-mono">
                                        Loading provider state...
                                    </td>
                                </tr>
                            ) : payments.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-text-muted text-sm font-mono">
                                        No payments found in provider.
                                    </td>
                                </tr>
                            ) : (
                                payments.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-mono text-xs text-text-main font-bold">{p.id}</div>
                                            <div className="font-mono text-[10px] text-text-muted mt-1">{p.order_id || 'N/A'}</div>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-sm text-text-main">
                                            {formatExact(p.amount / 100)} {p.currency}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-text-main">
                                            {p.customer_id || p.contact || p.email || 'Unknown'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge status={p.status === 'captured' ? 'SUCCESS' : p.status === 'failed' ? 'FAILED' : 'INFO'}>
                                                {p.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-text-muted">
                                            {p.error_code || p.error_description || '-'}
                                        </td>
                                        <td className="px-6 py-4">
                                            {p.status === 'failed' && config.mode !== 'test' && (
                                                <button
                                                    onClick={() => handleRetry(p.id)}
                                                    disabled={retrying === p.id}
                                                    className="text-xs bg-gray-100 hover:bg-gray-200 text-text-main px-3 py-1 rounded font-mono font-bold transition-colors disabled:opacity-50 flex items-center"
                                                >
                                                    {retrying === p.id ? <Loader className="animate-spin mr-1" size={12} /> : 'Simulate Capture'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
