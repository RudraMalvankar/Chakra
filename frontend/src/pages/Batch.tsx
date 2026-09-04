import React, { useState } from 'react';
import { simulatePayment, fetchMetrics } from '../services/api';
import { formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { Loader } from 'lucide-react';

const SCENARIOS = ['payment_timed_out', 'insufficient_funds', 'card_declined', 'mandate_revoked', 'fraud_suspected'];

export const Batch = () => {
    const [count, setCount] = useState(100);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState<any>(null);

    const runBatch = async () => {
        setRunning(true);
        setProgress(0);
        setResults(null);
        
        let success = 0;
        let fail = 0;

        // Generate synthetic payments and process
        for (let i = 0; i < count; i++) {
            const failure_reason = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
            const amount_inr = Math.floor(Math.random() * 10000) + 500;
            const churn_risk = Math.random() > 0.8 ? 'HIGH' : 'LOW';
            const fraud_risk = failure_reason === 'fraud_suspected' ? 'HIGH' : 'LOW';
            const method = Math.random() > 0.5 ? 'UPI' : 'CARD';
            
            try {
                await simulatePayment({
                    case_type: 'PAYMENT_FAILURE',
                    amount_inr,
                    failure_reason,
                    mandate_state: 'ACTIVE',
                    customer_id: `batch_cust_${i}`,
                    method,
                    churn_risk,
                    fraud_risk
                });
                success++;
            } catch (_err) {
                fail++;
            }
            setProgress(Math.round(((i + 1) / count) * 100));
        }

        // Fetch authoritative metrics after batch
        const metrics = await fetchMetrics();
        setResults(metrics);
        setRunning(false);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Batch Simulator</h2>
                        <p className="text-xs text-text-muted mt-1 font-mono">Run high-volume synthetic scenarios through Chakra pipeline</p>
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
                </div>

                <button onClick={runBatch} disabled={running} className="w-full bg-rzp-blue text-white font-bold uppercase tracking-widest text-xs py-3 rounded hover:bg-blue-700 transition-colors flex justify-center items-center">
                    {running ? <><Loader className="animate-spin mr-2" size={16} /> RUNNING {progress}%</> : 'RUN BATCH SIMULATION'}
                </button>
            </div>

            {results && (
                <div className="bg-white border border-border shadow-sm p-6">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Batch Benchmark Results</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-gray-50 border border-border rounded">
                            <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Payments Processed</div>
                            <div className="text-xl font-bold font-mono text-text-main">{results.payments_processed}</div>
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
                            <div className="text-xl font-bold font-mono text-text-main">{(results.revenue_recovery_rate_pct * 100).toFixed(1)}%</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
