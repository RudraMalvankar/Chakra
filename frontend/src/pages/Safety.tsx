import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPercent } from '../lib/format';

export const Safety = ({ cases, metrics }: any) => {
    const navigate = useNavigate();
    const safetyEvents = cases.filter((c: any) => c.safety).map((c: any) => ({...c.safety, id: c.id, timestamp: c.last_updated})).sort((a: any,b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 50);
    
    const processed = metrics?.payments_processed || 1;
    const blockedRate = ((metrics?.payments_blocked || 0) / processed) * 100;

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white border border-border shadow-sm p-6 text-center">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Safety Decisions</div>
                    <div className="text-3xl font-mono text-text-main">{processed}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6 text-center">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Allowed</div>
                    <div className="text-3xl font-mono text-green-600">{processed - (metrics?.payments_blocked||0) - (metrics?.payments_escalated||0)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6 text-center">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Blocked</div>
                    <div className="text-3xl font-mono text-red-600">{metrics?.payments_blocked || 0}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6 text-center">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Block Rate</div>
                    <div className="text-3xl font-mono text-text-main">{formatPercent(blockedRate)}</div>
                </div>
            </div>
            
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Enforced Policy Controls</h2>
                </div>
                <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {['Fraud Protection', 'Mandate Validation', 'Retry Limits', 'AFA Enforcement', 'Intervention Budget', 'Idempotency', 'Escalation Rules', 'Stopping Rules'].map(rule => (
                        <div key={rule} className="flex flex-col justify-between p-3 border border-border rounded bg-gray-50 h-20">
                            <span className="text-xs font-semibold text-text-main uppercase">{rule}</span>
                            <span className="text-[10px] font-bold text-rzp-blue uppercase tracking-widest">Enforced</span>
                        </div>
                    ))}
                </div>
            </div>
            
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-4 border-b border-border bg-gray-50">
                    <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Recent Safety Decisions</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-gray-50 border-b border-border text-text-muted">
                            <tr>
                                <th className="px-6 py-3 font-semibold">Timestamp</th>
                                <th className="px-6 py-3 font-semibold">Case</th>
                                <th className="px-6 py-3 font-semibold">Decision</th>
                                <th className="px-6 py-3 font-semibold">Eligibility</th>
                                <th className="px-6 py-3 font-semibold">Reason Code</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {safetyEvents.map((s: any, i: number) => (
                                <tr key={i} onClick={() => navigate(`/cases/${s.id}`)} className="hover:bg-gray-50 cursor-pointer text-xs font-mono">
                                    <td className="px-6 py-3 text-text-muted">{new Date(s.timestamp).toLocaleTimeString()}</td>
                                    <td className="px-6 py-3 font-bold text-rzp-blue">{s.id.substring(0,8)}</td>
                                    <td className="px-6 py-3 uppercase">{s.decision || '-'}</td>
                                    <td className="px-6 py-3 uppercase">
                                        {s.eligibility === 'ALLOWED' && <span className="text-green-600 font-bold">ALLOWED</span>}
                                        {(s.eligibility === 'BLOCKED' || s.decision === 'BLOCK') && <span className="text-red-600 font-bold">BLOCKED</span>}
                                        {(s.eligibility === 'ESCALATED' || s.decision === 'ESCALATE') && <span className="text-orange-500 font-bold">ESCALATED</span>}
                                    </td>
                                    <td className="px-6 py-3 text-text-muted">{s.reason_code || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
