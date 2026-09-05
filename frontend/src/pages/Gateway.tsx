import React, { useReducer, useState, useEffect } from 'react';
import { API_BASE, fetchProviderPayments, fetchConfig, ApiError } from '../services/api';
import { formatExact, formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Loader, Eye, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

type GatewayState = {
    payments: any[];
    loading: boolean;
    config: any;
    error: string | null;
};
type GatewayAction =
    | { type: 'loaded'; payments: any[]; config: any }
    | { type: 'failed'; error: string; config?: any }
    | { type: 'loading' };

function gatewayReducer(state: GatewayState, action: GatewayAction): GatewayState {
    if (action.type === 'loading') return { ...state, loading: true, error: null };
    if (action.type === 'failed') {
        return {
            payments: [],
            config: action.config ?? state.config,
            loading: false,
            error: action.error,
        };
    }
    return { payments: action.payments, config: action.config, loading: false, error: null };
}

export const Gateway = () => {
    const [{ payments, loading, config, error }, dispatch] = useReducer(gatewayReducer, {
        payments: [],
        loading: true,
        config: { mode: 'unavailable' },
        error: null,
    });
    const [retrying, setRetrying] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [selectedPayment, setSelectedPayment] = useState<any | null>(null);

    const load = async () => {
        dispatch({ type: 'loading' });
        setActionError(null);
        let cfg: any = { mode: 'unavailable', provider: 'unavailable' };
        try {
            cfg = await fetchConfig();
        } catch (e) {
            cfg = { mode: 'unavailable', provider: 'unavailable' };
        }
        try {
            const data = await fetchProviderPayments();
            dispatch({ type: 'loaded', payments: data, config: cfg });
        } catch (e) {
            const reason =
                e instanceof ApiError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : 'Unable to load provider payments';
            dispatch({
                type: 'failed',
                error: `Unable to load provider payments. Reason: ${reason}`,
                config: cfg,
            });
        }
    };

    useEffect(() => {
        load();
    }, []);

    const handleRetry = async (id: string) => {
        if (config.mode === 'unavailable' || config.provider === 'unavailable') {
            setActionError('RAZORPAY TEST MODE NOT CONFIGURED — retry is unsupported.');
            return;
        }
        setRetrying(id);
        setActionError(null);
        try {
            const res = await fetch(`${API_BASE}/api/payments/${id}/retry`, { method: 'POST' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || `Retry failed (${res.status})`);
            }
            const result = await res.json();
            if (result?.provider_result?.status === 'unsupported' || result?.status === 'unsupported') {
                setActionError('Provider retry is unsupported for this payment method.');
            }
            await load();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Retry request failed');
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
                ) : config.mode === 'synthetic' ? (
                    <Badge status="INFO">EXPLICIT SYNTHETIC MODE</Badge>
                ) : (
                    <Badge status="FAILED">RAZORPAY TEST MODE NOT CONFIGURED</Badge>
                )}
            </div>

            {(error || actionError) && (
                <div className="bg-red-50 border border-red-200 text-rzp-red p-4 text-sm font-mono flex justify-between items-center gap-4">
                    <span>{error || actionError}</span>
                    {error && (
                        <button onClick={load} className="underline font-bold uppercase text-xs tracking-wider whitespace-nowrap">
                            Retry
                        </button>
                    )}
                </div>
            )}

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
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Method</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Failure Reason</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Created</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-text-muted text-sm font-mono">
                                        Loading provider state...
                                    </td>
                                </tr>
                            ) : error ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-rzp-red text-sm font-mono">
                                        Gateway unavailable.
                                    </td>
                                </tr>
                            ) : payments.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-text-muted text-sm font-mono">
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
                                            {formatExact((p.amount ?? 0) / 100)} {p.currency}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-text-main">
                                            {p.customer_id || p.contact || p.email || 'NOT AVAILABLE'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge status={p.status === 'captured' ? 'SUCCESS' : p.status === 'failed' ? 'FAILED' : 'INFO'}>
                                                {p.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-text-muted">
                                            {p.method || 'NOT AVAILABLE'}
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-text-muted">
                                            {p.error_code || p.error_description || '—'}
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-text-muted">
                                            {p.created_at
                                                ? new Date(p.created_at * 1000).toLocaleString()
                                                : 'NOT AVAILABLE'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setSelectedPayment(p)}
                                                    className="px-2 py-1 bg-blue-50 border border-blue-200 text-rzp-blue text-[10px] font-bold uppercase rounded hover:bg-blue-100 flex items-center gap-1 transition-colors"
                                                    title="View complete payment payload & audit trace"
                                                >
                                                    <Eye size={12} />
                                                    View
                                                </button>
                                                {p.status === 'failed' && config.mode === 'synthetic' && (
                                                    <button
                                                        onClick={() => handleRetry(p.id)}
                                                        disabled={retrying === p.id}
                                                        className="text-xs bg-gray-100 hover:bg-gray-200 text-text-main px-3 py-1 rounded font-mono font-bold transition-colors disabled:opacity-50 flex items-center"
                                                    >
                                                        {retrying === p.id ? <Loader className="animate-spin mr-1" size={12} /> : 'Synthetic Retry'}
                                                    </button>
                                                )}
                                                {p.status === 'failed' && config.mode === 'test' && (
                                                    <span className="text-[10px] font-mono text-text-muted uppercase">
                                                        No generic retry
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Gateway Payment Details Modal */}
            {selectedPayment && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto border border-border">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center sticky top-0 bg-white">
                            <div>
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Gateway Transaction Details</div>
                                <h3 className="text-base font-bold font-mono text-text-main flex items-center gap-2 mt-0.5">
                                    {selectedPayment.id}
                                    <Badge status={selectedPayment.status === 'captured' ? 'SUCCESS' : selectedPayment.status === 'failed' ? 'FAILED' : 'INFO'}>
                                        {selectedPayment.status}
                                    </Badge>
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedPayment(null)}
                                className="text-text-muted hover:text-text-main p-1 rounded-md hover:bg-gray-100"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-xs font-mono">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Amount</div>
                                    <div className="text-sm font-bold text-text-main mt-0.5">
                                        {formatExact((selectedPayment.amount ?? 0) / 100)} {selectedPayment.currency || 'INR'}
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Method</div>
                                    <div className="text-xs font-bold text-text-main mt-0.5 uppercase">
                                        {selectedPayment.method || 'N/A'}
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Order Reference</div>
                                    <div className="text-[11px] font-bold text-text-main mt-0.5 truncate">
                                        {selectedPayment.order_id || 'N/A'}
                                    </div>
                                </div>
                                <div className="p-3 bg-gray-50 rounded border border-border">
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Provider</div>
                                    <div className="text-xs font-bold text-rzp-blue mt-0.5 uppercase">
                                        {config.mode === 'test' ? 'RAZORPAY TEST' : 'SYNTHETIC GATEWAY'}
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-gray-50 rounded border border-border space-y-2">
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Customer & Contact Information</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                    <div><span className="text-text-muted">Customer ID:</span> <span className="font-bold">{selectedPayment.customer_id || 'NOT AVAILABLE'}</span></div>
                                    <div><span className="text-text-muted">Email:</span> <span className="font-bold">{selectedPayment.email || 'NOT AVAILABLE'}</span></div>
                                    <div><span className="text-text-muted">Contact:</span> <span className="font-bold">{selectedPayment.contact || 'NOT AVAILABLE'}</span></div>
                                    <div><span className="text-text-muted">Created:</span> <span className="font-bold">{selectedPayment.created_at ? new Date(selectedPayment.created_at * 1000).toLocaleString() : 'N/A'}</span></div>
                                </div>
                            </div>

                            {(selectedPayment.error_code || selectedPayment.error_description || selectedPayment.error_reason) && (
                                <div className="p-4 bg-red-50 rounded border border-red-200 space-y-2">
                                    <div className="text-[10px] font-bold text-rzp-red uppercase tracking-wider">Error & Failure Diagnostics</div>
                                    <div className="space-y-1 text-xs">
                                        {selectedPayment.error_code && (
                                            <div><span className="text-text-muted">Error Code:</span> <span className="font-bold text-rzp-red">{selectedPayment.error_code}</span></div>
                                        )}
                                        {selectedPayment.error_description && (
                                            <div><span className="text-text-muted">Description:</span> <span className="font-bold text-text-main">{selectedPayment.error_description}</span></div>
                                        )}
                                        {selectedPayment.error_reason && (
                                            <div><span className="text-text-muted">Reason:</span> <span className="font-bold text-text-main">{selectedPayment.error_reason}</span></div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Raw Provider Payload</div>
                                <pre className="p-3 bg-gray-900 text-green-400 rounded text-[11px] overflow-x-auto max-h-48">
                                    {JSON.stringify(selectedPayment, null, 2)}
                                </pre>
                            </div>

                            <div className="pt-4 border-t border-border flex justify-between items-center">
                                <Link
                                    to={`/cases/${selectedPayment.id}`}
                                    className="px-4 py-2 bg-rzp-blue hover:bg-blue-700 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                                >
                                    <ExternalLink size={13} />
                                    Investigate Recovery Case
                                </Link>
                                <button
                                    onClick={() => setSelectedPayment(null)}
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
