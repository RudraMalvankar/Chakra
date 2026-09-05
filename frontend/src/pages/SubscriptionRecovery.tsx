import React, { useState, useEffect } from 'react';
import { Badge } from '../components/ui/Badge';
import { RefreshCw, Pause, Play, XCircle, RotateCcw, AlertTriangle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const SubscriptionRecovery = ({ refresh }: any) => {
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [metrics, setMetrics] = useState<any>({});
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<any>(null);
    const [actionLoading, setActionLoading] = useState(false);

    const load = async () => {
        try {
            const [subsRes, metricsRes] = await Promise.all([
                fetch(`${API_BASE}/api/subscriptions`),
                fetch(`${API_BASE}/api/subscriptions/summary`),
            ]);
            if (subsRes.ok) setSubscriptions(await subsRes.json());
            if (metricsRes.ok) setMetrics(await metricsRes.json());
        } catch (e) {
            console.error('Failed to load subscriptions', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleAction = async (subId: string, action: string) => {
        setActionLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/subscriptions/${subId}/${action}`, { method: 'POST' });
            if (res.ok) {
                await load();
                setSelected(null);
            }
        } finally {
            setActionLoading(false);
        }
    };

    const statusColor = (s: string) => {
        switch (s) {
            case 'ACTIVE': return 'SUCCESS';
            case 'PAST_DUE': return 'WARNING';
            case 'PAUSED': return 'INFO';
            case 'CANCELLED': return 'FAILED';
            default: return 'INFO';
        }
    };

    const churnColor = (c: string) => {
        switch (c) {
            case 'HIGH': return 'text-rzp-red';
            case 'MEDIUM': return 'text-amber-600';
            default: return 'text-green-600';
        }
    };

    if (loading) return <div className="flex items-center justify-center h-64 text-text-muted font-mono text-sm">Loading subscriptions...</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Subscription Recovery</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Dunning management, pause/resume, lifecycle tracking</p>
                    </div>
                    <button onClick={load} className="flex items-center space-x-1 text-text-muted hover:text-text-main transition-colors">
                        <RefreshCw size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Refresh</span>
                    </button>
                </div>

                <div className="p-6 grid grid-cols-2 md:grid-cols-5 gap-4 border-b border-border">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-text-main">{metrics.total_subscriptions || 0}</div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Total</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{metrics.active || 0}</div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Active</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-bold text-amber-600">{metrics.past_due || 0}</div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Past Due</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{metrics.paused || 0}</div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Paused</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-bold text-rzp-red">{metrics.cancelled || 0}</div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Cancelled</div>
                    </div>
                </div>

                <div className="p-6">
                    {subscriptions.length === 0 ? (
                        <div className="text-center text-text-muted font-mono text-sm py-8">No subscriptions found. Create one via the API.</div>
                    ) : (
                        <div className="space-y-3">
                            {subscriptions.map((sub: any) => (
                                <div key={sub.id} className="border border-border rounded p-4 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelected(sub)}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-4">
                                            <div>
                                                <div className="font-mono text-sm font-bold text-text-main">{sub.external_subscription_id}</div>
                                                <div className="text-[10px] text-text-muted font-mono">{sub.customer_id} · {sub.frequency} · {sub.plan_id || 'N/A'}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-3">
                                            <div className={`text-[10px] font-bold uppercase ${churnColor(sub.churn_risk)}`}>
                                                {sub.churn_risk} CHURN
                                            </div>
                                            <Badge status={statusColor(sub.status)}>{sub.status}</Badge>
                                            <div className="text-right">
                                                <div className="font-mono text-sm font-bold text-text-main">₹{(sub.amount / 100).toLocaleString()}</div>
                                                <div className="text-[10px] text-text-muted font-mono">retry {sub.retry_count}/{sub.max_retries}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {selected && (
                <div className="bg-white border border-border shadow-sm">
                    <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                        <h3 className="text-sm font-bold text-text-main uppercase tracking-wider">Subscription Detail</h3>
                        <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-main">✕</button>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-mono">
                            <div><span className="text-text-muted">ID:</span> {selected.external_subscription_id}</div>
                            <div><span className="text-text-muted">Customer:</span> {selected.customer_id}</div>
                            <div><span className="text-text-muted">Amount:</span> ₹{(selected.amount / 100).toLocaleString()}</div>
                            <div><span className="text-text-muted">Status:</span> <Badge status={statusColor(selected.status)}>{selected.status}</Badge></div>
                            <div><span className="text-text-muted">Frequency:</span> {selected.frequency}</div>
                            <div><span className="text-text-muted">Churn Risk:</span> <span className={churnColor(selected.churn_risk)}>{selected.churn_risk}</span></div>
                            <div><span className="text-text-muted">Retries:</span> {selected.retry_count}/{selected.max_retries}</div>
                            <div><span className="text-text-muted">Grace Period:</span> {selected.grace_period_days} days</div>
                        </div>

                        <div className="flex gap-3 pt-4 border-t border-border">
                            {selected.status === 'ACTIVE' && (
                                <button onClick={() => handleAction(selected.external_subscription_id, 'pause')} disabled={actionLoading}
                                    className="flex items-center space-x-1 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold uppercase tracking-wider rounded hover:bg-amber-100 transition-colors">
                                    <Pause size={14} /> <span>Pause</span>
                                </button>
                            )}
                            {selected.status === 'PAUSED' && (
                                <button onClick={() => handleAction(selected.external_subscription_id, 'resume')} disabled={actionLoading}
                                    className="flex items-center space-x-1 px-4 py-2 bg-green-50 border border-green-200 text-green-700 text-xs font-bold uppercase tracking-wider rounded hover:bg-green-100 transition-colors">
                                    <Play size={14} /> <span>Resume</span>
                                </button>
                            )}
                            {selected.status !== 'CANCELLED' && (
                                <button onClick={() => handleAction(selected.external_subscription_id, 'cancel')} disabled={actionLoading}
                                    className="flex items-center space-x-1 px-4 py-2 bg-red-50 border border-red-200 text-rzp-red text-xs font-bold uppercase tracking-wider rounded hover:bg-red-100 transition-colors">
                                    <XCircle size={14} /> <span>Cancel</span>
                                </button>
                            )}
                            <button onClick={() => handleAction(selected.external_subscription_id, 'recover')} disabled={actionLoading}
                                className="flex items-center space-x-1 px-4 py-2 bg-rzp-blue text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-blue-700 transition-colors">
                                <RotateCcw size={14} /> <span>Recover</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
