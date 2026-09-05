import React, { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../services/api';
import { formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Loader } from 'lucide-react';

interface BatchResponse {
    batch_id: string;
    status: string;
    requested_count: number;
    processed_count: number;
    recovered_count: number;
    revenue_at_risk_inr: number;
    revenue_attempted_inr: number;
    revenue_recovered_inr: number;
    revenue_blocked_inr: number;
    revenue_escalated_inr: number;
    pending_count: number;
    revenue_pending_inr: number;
    recovery_rate_pct: number;
}

export const Batch = () => {
    const [count, setCount] = useState(100);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [batchId, setBatchId] = useState<string | null>(null);
    const [batchStatus, setBatchStatus] = useState<string | null>(null);
    const [results, setResults] = useState<BatchResponse | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => {
        if (pollRef.current) clearInterval(pollRef.current);
    }, []);

    const runBatch = async () => {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(true);
        setProgress(0);
        setResults(null);
        setBatchId(null);
        setBatchStatus('INITIATING');

        try {
            const createRes = await fetch(`${API_BASE}/api/batches/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count, scenario: 'mixed' }),
            });
            if (!createRes.ok) {
                throw new Error('Failed to create batch on backend');
            }
            const batch = await createRes.json();
            setBatchId(batch.batch_id);
            setBatchStatus(batch.status);

            pollRef.current = setInterval(async () => {
                try {
                    const statusRes = await fetch(`${API_BASE}/api/batches/${batch.batch_id}`);
                    if (statusRes.ok) {
                        const statusData: BatchResponse = await statusRes.json();
                        setBatchStatus(statusData.status);
                        const pct = statusData.requested_count > 0
                            ? Math.round((statusData.processed_count / statusData.requested_count) * 100)
                            : 0;
                        setProgress(pct);

                        if (statusData.status === 'COMPLETED' || statusData.status === 'FAILED') {
                            if (pollRef.current) clearInterval(pollRef.current);
                            pollRef.current = null;
                            setRunning(false);
                            setResults(statusData);
                        }
                    }
                } catch {
                    // Continue polling
                }
            }, 1000);
        } catch {
            setRunning(false);
            setBatchStatus('ERROR');
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Batch Simulator</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Backend-controlled batch runner with Neon Postgres persistence</p>
                    </div>
                    <Badge status="INFO">SYNTHETIC BENCHMARK</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Number of Payments</label>
                        <select disabled={running} value={count} onChange={e => setCount(Number(e.target.value))} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                            <option value="100">100</option>
                            <option value="500">500</option>
                            <option value="1000">1,000</option>
                        </select>
                    </div>
                    {batchId && (
                        <div className="p-3 bg-gray-50 border border-border rounded flex flex-col justify-center">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Batch ID & Status</div>
                            <div className="text-xs font-mono font-bold text-text-main mt-0.5">{batchId} ({batchStatus})</div>
                        </div>
                    )}
                </div>

                <button onClick={runBatch} disabled={running} className="w-full bg-rzp-blue text-white font-bold uppercase tracking-widest text-xs py-3 rounded hover:bg-blue-700 transition-colors flex justify-center items-center">
                    {running ? <><Loader className="animate-spin mr-2" size={16} /> RUNNING {progress}% ({batchStatus})</> : 'RUN BATCH SIMULATION'}
                </button>
            </div>

            {results && (
                <div className="bg-white border border-border shadow-sm p-6">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Batch Benchmark Results</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Payments Processed</div>
                            <div className="text-xl font-bold font-mono text-text-main">{results.processed_count} / {results.requested_count}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Pending Revenue</div>
                            <div className="text-xl font-bold font-mono text-yellow-600">{formatCurrency(results.revenue_pending_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Revenue at Risk</div>
                            <div className="text-xl font-bold font-mono text-text-main">{formatCurrency(results.revenue_at_risk_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded border-l-4 border-l-rzp-green">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Recovered Revenue</div>
                            <div className="text-xl font-bold font-mono text-rzp-green">{formatCurrency(results.revenue_recovered_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Recovery Rate</div>
                            <div className="text-xl font-bold font-mono text-text-main">{results.recovery_rate_pct.toFixed(1)}%</div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Revenue Attempted</div>
                            <div className="text-xl font-bold font-mono text-text-main">{formatCurrency(results.revenue_attempted_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Blocked Revenue</div>
                            <div className="text-xl font-bold font-mono text-rzp-red">{formatCurrency(results.revenue_blocked_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Escalated Revenue</div>
                            <div className="text-xl font-bold font-mono text-orange-500">{formatCurrency(results.revenue_escalated_inr)}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
