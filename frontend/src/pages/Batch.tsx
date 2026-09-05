import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../services/api';
import { formatCurrency, formatExact } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Loader } from 'lucide-react';

interface BatchResponse {
    batch_id: string;
    status: string;
    scenario: string;
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

interface BatchCaseDetail {
    sequence: number;
    case_id: string;
    batch_id: string;
    status: string;
    error: string | null;
    amount: number;
    case_type: string | null;
    current_action: string | null;
    risk_probability: number | null;
    ai_used: boolean | null;
    ai_classification: string | null;
    ai_confidence: number | null;
    ai_reasoning: string | null;
    selected_action: string | null;
    decision_confidence: number | null;
    expected_recovery: number | null;
    safety_eligibility: string | null;
    safety_reason_code: string | null;
    events: any[];
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300;
const POLL_TIMEOUT_MS = MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS;

export const Batch = () => {
    const [count, setCount] = useState(100);
    const [scenario, setScenario] = useState('mixed');
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [batchId, setBatchId] = useState<string | null>(null);
    const [batchStatus, setBatchStatus] = useState<string | null>(null);
    const [results, setResults] = useState<BatchResponse | null>(null);
    const [liveProgress, setLiveProgress] = useState<BatchResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [batchCases, setBatchCases] = useState<BatchCaseDetail[]>([]);
    const [casesLoading, setCasesLoading] = useState(false);
    const [showCases, setShowCases] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const attemptsRef = useRef(0);

    const clearPoll = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    useEffect(() => () => clearPoll(), []);

    const failWith = (message: string) => {
        clearPoll();
        setRunning(false);
        setBatchStatus('ERROR');
        setError(message);
    };

    const fetchBatchCases = async (bid: string) => {
        setCasesLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/batches/${bid}/cases?limit=200`);
            if (res.ok) {
                const data = await res.json();
                setBatchCases(data);
            }
        } catch (e) {
            console.error('Failed to fetch batch cases:', e);
        }
        setCasesLoading(false);
    };

    const runBatch = async () => {
        clearPoll();
        attemptsRef.current = 0;
        setRunning(true);
        setProgress(0);
        setResults(null);
        setLiveProgress(null);
        setBatchId(null);
        setBatchStatus('INITIATING');
        setError(null);
        setBatchCases([]);
        setShowCases(false);

        try {
            const createRes = await fetch(`${API_BASE}/api/batches/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count, scenario }),
            });
            if (!createRes.ok) {
                const detail = await createRes.text().catch(() => '');
                throw new Error(detail || `Failed to create batch (${createRes.status})`);
            }
            const batch = await createRes.json();
            setBatchId(batch.batch_id);
            setBatchStatus(batch.status);

            const startedAt = Date.now();
            pollRef.current = setInterval(async () => {
                attemptsRef.current += 1;
                if (attemptsRef.current > MAX_POLL_ATTEMPTS || Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    failWith(`Batch polling timed out after ${MAX_POLL_ATTEMPTS}s.`);
                    return;
                }
                try {
                    const statusRes = await fetch(`${API_BASE}/api/batches/${batch.batch_id}`);
                    if (!statusRes.ok) {
                        const detail = await statusRes.text().catch(() => '');
                        failWith(detail || `Batch status request failed (${statusRes.status})`);
                        return;
                    }
                    const statusData: BatchResponse = await statusRes.json();
                    setBatchStatus(statusData.status);
                    setLiveProgress(statusData);
                    const pct = statusData.requested_count > 0
                        ? Math.round((statusData.processed_count / statusData.requested_count) * 100)
                        : 0;
                    setProgress(pct);

                    if (statusData.status === 'COMPLETED' || statusData.status === 'FAILED') {
                        clearPoll();
                        setRunning(false);
                        setResults(statusData);
                        fetchBatchCases(batch.batch_id);
                        if (statusData.status === 'FAILED') {
                            setError('Batch completed with FAILED status on the backend.');
                        }
                    }
                } catch (e) {
                    failWith(e instanceof Error ? e.message : 'Batch status polling failed');
                }
            }, POLL_INTERVAL_MS);
        } catch (e) {
            failWith(e instanceof Error ? e.message : 'Failed to start batch');
        }
    };

    const display = results || liveProgress;

    const statusCounts = batchCases.reduce((acc, c) => {
        acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Batch Simulator</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Backend-controlled batch runner with Neon Postgres persistence</p>
                    </div>
                    <Badge status="INFO">SYNTHETIC BENCHMARK</Badge>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div>
                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Number of Payments</label>
                        <select disabled={running} value={count} onChange={e => setCount(Number(e.target.value))} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                            <option value={100}>100</option>
                            <option value={500}>500</option>
                            <option value={1000}>1,000</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Scenario</label>
                        <select disabled={running} value={scenario} onChange={e => setScenario(e.target.value)} className="w-full border border-border rounded px-3 py-2 font-mono text-sm focus:border-rzp-blue focus:outline-none bg-white">
                            <option value="mixed">Mixed (all failure types)</option>
                            <option value="insufficient_funds">Insufficient Funds</option>
                            <option value="payment_timed_out">Payment Timed Out</option>
                            <option value="expired_card">Expired Card</option>
                            <option value="card_declined">Card Declined</option>
                            <option value="mandate_revoked">Mandate Revoked</option>
                            <option value="fraud_suspected">Fraud Suspected</option>
                        </select>
                    </div>
                    {batchId && (
                        <div className="p-3 bg-gray-50 border border-border rounded flex flex-col justify-center">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Batch ID & Status</div>
                            <div className="text-xs font-mono font-bold text-text-main mt-0.5">{batchId} ({batchStatus})</div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mb-4 bg-red-50 border border-red-200 text-rzp-red p-3 text-sm font-mono flex justify-between items-center gap-4">
                        <span>{error}</span>
                        <button type="button" onClick={runBatch} disabled={running} className="underline font-bold uppercase tracking-wider text-xs whitespace-nowrap">Retry</button>
                    </div>
                )}

                <button onClick={runBatch} disabled={running} className="w-full bg-rzp-blue text-white font-bold uppercase tracking-widest text-xs py-3 rounded hover:bg-blue-700 transition-colors flex justify-center items-center">
                    {running ? <><Loader className="animate-spin mr-2" size={16} /> RUNNING {progress}% ({batchStatus})</> : 'RUN BATCH SIMULATION'}
                </button>

                {running && liveProgress && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                        <div>Processed: {liveProgress.processed_count}/{liveProgress.requested_count}</div>
                        <div>Recovered: {liveProgress.recovered_count}</div>
                        <div>Pending: {liveProgress.pending_count}</div>
                        <div>Rate: {Number(liveProgress.recovery_rate_pct || 0).toFixed(1)}%</div>
                    </div>
                )}
            </div>

            {display && (
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Batch Benchmark Results</h3>
                        <Link to="/cases" className="text-xs font-bold text-rzp-blue uppercase tracking-wider hover:underline">View All Cases</Link>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Payments Processed</div>
                            <div className="text-xl font-bold font-mono text-text-main">{display.processed_count} / {display.requested_count}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Revenue at Risk</div>
                            <div className="text-xl font-bold font-mono text-text-main">{formatCurrency(display.revenue_at_risk_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded border-l-4 border-l-rzp-green">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Recovered Revenue</div>
                            <div className="text-xl font-bold font-mono text-rzp-green">{formatCurrency(display.revenue_recovered_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Recovery Rate</div>
                            <div className="text-xl font-bold font-mono text-text-main">{Number(display.recovery_rate_pct || 0).toFixed(1)}%</div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Revenue Attempted</div>
                            <div className="text-xl font-bold font-mono text-text-main">{formatCurrency(display.revenue_attempted_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Pending Revenue</div>
                            <div className="text-xl font-bold font-mono text-yellow-600">{formatCurrency(display.revenue_pending_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Blocked Revenue</div>
                            <div className="text-xl font-bold font-mono text-rzp-red">{formatCurrency(display.revenue_blocked_inr)}</div>
                        </div>
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Escalated Revenue</div>
                            <div className="text-xl font-bold font-mono text-orange-500">{formatCurrency(display.revenue_escalated_inr)}</div>
                        </div>
                    </div>
                </div>
            )}

            {display && batchCases.length > 0 && (
                <div className="bg-white border border-border shadow-sm">
                    <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                        <div>
                            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Per-Case Details</h3>
                            <div className="flex gap-3 mt-2 text-[10px] font-mono">
                                {Object.entries(statusCounts).map(([status, cnt]) => (
                                    <span key={status} className="flex items-center gap-1">
                                        <Badge status={status}>{status}</Badge>
                                        <span className="text-text-muted">{cnt}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                        <button onClick={() => { setShowCases(!showCases); if (!showCases && batchCases.length === 0 && batchId) fetchBatchCases(batchId); }} className="text-xs font-mono text-rzp-blue hover:underline font-bold uppercase tracking-wider">
                            {showCases ? 'Hide Cases' : `Show ${display.processed_count} Cases`}
                        </button>
                    </div>

                    {showCases && (
                        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 font-semibold text-[10px]">#</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Case ID</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Type</th>
                                        <th className="px-4 py-2 font-semibold text-[10px] text-right">Amount</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Status</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Agent Decision</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Safety</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">AI Triage</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Risk</th>
                                        <th className="px-4 py-2 font-semibold text-[10px]">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {batchCases.map((c) => (
                                        <tr key={c.sequence} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 font-mono text-[10px] text-text-muted">{c.sequence}</td>
                                            <td className="px-4 py-2 font-mono text-[10px] text-rzp-blue">{c.case_id?.substring(0, 16) || '-'}</td>
                                            <td className="px-4 py-2 text-[10px] uppercase">{c.case_type?.replace(/_/g, ' ') || '-'}</td>
                                            <td className="px-4 py-2 text-right font-mono text-[10px]">{c.amount > 0 ? formatExact(c.amount) : '-'}</td>
                                            <td className="px-4 py-2"><Badge status={c.status}>{c.status}</Badge></td>
                                            <td className="px-4 py-2 font-mono text-[10px]">
                                                {c.selected_action || '-'}
                                                {c.expected_recovery != null && c.expected_recovery > 0 && (
                                                    <span className="text-rzp-green ml-1">({formatExact(c.expected_recovery)})</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-[10px]">
                                                {c.safety_eligibility || '-'}
                                                {c.safety_reason_code && (
                                                    <span className="text-text-muted block text-[9px]">{c.safety_reason_code}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-[10px]">
                                                {c.ai_used ? (
                                                    <span className="text-purple-600">
                                                        {c.ai_classification || 'AI'}
                                                        {c.ai_confidence != null && ` (${(c.ai_confidence * 100).toFixed(0)}%)`}
                                                    </span>
                                                ) : (
                                                    <span className="text-text-muted">deterministic</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-[10px]">
                                                {c.risk_probability != null ? `${(c.risk_probability * 100).toFixed(0)}%` : '-'}
                                            </td>
                                            <td className="px-4 py-2">
                                                {c.case_id && (
                                                    <Link to={`/cases/${c.case_id}`} className="text-rzp-blue text-[10px] font-bold hover:underline">
                                                        Trace →
                                                    </Link>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
