import React from 'react';
import { Badge } from '../components/ui/Badge';
import { formatExact } from '../lib/format';

export const Analytics = ({ metrics }: any) => {
    if (!metrics) return null;
    const m = metrics.by_case_type || {};
    
    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Recovery by Workflow</h2>
                    <Badge status="INFO">SYNTHETIC BENCHMARK</Badge>
                </div>
                <div className="p-8 space-y-8">
                    {Object.entries(m).map(([type, stats]: [string, any]) => {
                        const rate = stats.at_risk > 0 ? (stats.recovered_inr / stats.at_risk) * 100 : 0;
                        return (
                            <div key={type}>
                                <div className="flex justify-between items-end mb-2">
                                    <div>
                                        <div className="text-sm font-bold text-text-main uppercase">{type.replace(/_/g, ' ')}</div>
                                        <div className="text-xs text-text-muted mt-1">{stats.processed} cases processed</div>
                                    </div>
                                    <div className="text-right">
                                        <span className="font-mono font-bold text-rzp-green mr-2">{formatExact(stats.recovered_inr)}</span>
                                        <span className="text-text-muted text-xs font-mono">/ {formatExact(stats.at_risk)}</span>
                                    </div>
                                </div>
                                <div className="w-full bg-gray-100 h-2 relative overflow-hidden rounded">
                                    <div className="bg-rzp-blue h-2 absolute left-0 top-0 transition-all duration-500 rounded" style={{ width: `${rate}%` }}></div>
                                </div>
                                <div className="text-[10px] font-mono text-text-muted mt-1 text-right">{rate.toFixed(1)}% recovery rate</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
