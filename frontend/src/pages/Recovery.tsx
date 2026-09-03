import React from 'react';
import { formatExact, formatPercent } from '../lib/format';

export const Recovery = ({ metrics }: any) => {
    if (!metrics) return null;
    const byInt = metrics.by_intervention || {};
    const sortedInts = Object.keys(byInt).sort((a,b) => byInt[b].recovered_inr - byInt[a].recovered_inr);
    
    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Recovery Interventions</h2>
                    <p className="text-sm text-text-muted mt-1">Which recovery actions actually recover money?</p>
                </div>
                
                <div className="p-6">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Recovery Actions</h3>
                    <div className="border border-border rounded overflow-hidden">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-gray-50 border-b border-border text-text-muted">
                                <tr>
                                    <th className="px-6 py-3 font-semibold">Intervention</th>
                                    <th className="px-6 py-3 font-semibold text-right">Attempted</th>
                                    <th className="px-6 py-3 font-semibold text-right">Succeeded</th>
                                    <th className="px-6 py-3 font-semibold text-right">Success Rate</th>
                                    <th className="px-6 py-3 font-semibold text-right">Recovered Revenue</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border font-mono">
                                {sortedInts.map(k => {
                                    const stat = byInt[k];
                                    const rate = stat.attempted > 0 ? (stat.succeeded / stat.attempted) * 100 : 0;
                                    return (
                                        <tr key={k} className="hover:bg-gray-50 text-xs">
                                            <td className="px-6 py-3 font-bold text-text-main uppercase">{k}</td>
                                            <td className="px-6 py-3 text-right">{stat.attempted}</td>
                                            <td className="px-6 py-3 text-right text-rzp-green">{stat.succeeded}</td>
                                            <td className="px-6 py-3 text-right">{formatPercent(rate)}</td>
                                            <td className="px-6 py-3 text-right font-bold text-text-main">{formatExact(stat.recovered_inr)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="p-6 border-t border-border">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Control Outcomes</h3>
                    <div className="flex space-x-6">
                        <div className="bg-gray-50 border border-border p-4 rounded w-64">
                            <div className="text-xs text-text-muted uppercase mb-1">Block Executions</div>
                            <div className="text-xl font-mono text-rzp-red font-bold">{metrics.payments_blocked}</div>
                            <div className="text-xs text-text-muted mt-2">Revenue: {formatExact(metrics.revenue_blocked_inr)}</div>
                        </div>
                        <div className="bg-gray-50 border border-border p-4 rounded w-64">
                            <div className="text-xs text-text-muted uppercase mb-1">Escalate Executions</div>
                            <div className="text-xl font-mono text-orange-500 font-bold">{metrics.payments_escalated}</div>
                            <div className="text-xs text-text-muted mt-2">Revenue: {formatExact(metrics.revenue_escalated_inr)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
