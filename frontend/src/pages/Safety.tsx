import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Shield, Lock, AlertTriangle } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { formatCurrency } from '../lib/format';

export const Safety = ({ cases }: any) => {
    const navigate = useNavigate();
    
    // Sort recent decisions
    const recentDecisions = cases.filter((c: any) => c.safety != null).sort((a: any, b: any) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()).slice(0, 15);

    const rules = [
        { name: "Maximum Retry Attempts", value: "3 per month", type: "CAP" },
        { name: "Fraud Threshold", value: "Strict (Block High)", type: "RISK" },
        { name: "Mandate Revoked Policy", value: "Hard Stop (BLOCK)", type: "COMPLIANCE" },
        { name: "Repeated Failure Policy", value: "Escalate after 3 fails", type: "ESCALATION" },
        { name: "Monthly Recovery Budget", value: "₹50,000", type: "BUDGET" },
        { name: "AFA Payment Links", value: "Enabled (<₹5000)", type: "CAP" },
        { name: "Stopping Rule: Dispute", value: "Hard Stop (ESCALATE)", type: "COMPLIANCE" }
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <Shield className="mr-3 text-rzp-blue" size={20} />
                        Safety & Policies
                    </h2>
                    <p className="text-sm text-text-muted mt-1">Deterministic financial controls that cannot be overridden by AI.</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 p-3 rounded flex items-center">
                    <Lock className="text-rzp-blue mr-2" size={16} />
                    <span className="text-xs font-bold text-text-main uppercase tracking-widest">AI OVERRIDE: DISABLED</span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white border border-border shadow-sm flex flex-col h-[600px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Active Policies</h3>
                    </div>
                    <div className="p-6 space-y-4 overflow-auto flex-1">
                        {rules.map((r, i) => (
                            <div key={i} className="pb-4 border-b border-border last:border-0 last:pb-0">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-text-main text-sm">{r.name}</span>
                                    <Badge status={r.type === 'COMPLIANCE' ? 'CRITICAL' : r.type === 'RISK' ? 'HIGH' : 'LOW'} className="text-[10px]">{r.type}</Badge>
                                </div>
                                <div className="font-mono text-sm text-text-muted">{r.value}</div>
                            </div>
                        ))}
                        
                        <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded flex items-start">
                            <AlertTriangle className="text-rzp-blue mr-3 shrink-0 mt-0.5" size={16} />
                            <div className="text-xs text-rzp-blue">
                                <span className="font-bold uppercase tracking-widest block mb-1">Architecture Note</span>
                                The Safety Gate executes deterministically after the AI Triage and Recovery Agent. It evaluates the agent's proposed action against these hardcoded rules.
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white border border-border shadow-sm flex flex-col h-[600px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Recent Safety Decisions</h3>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-white border-b border-border text-text-muted sticky top-0">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Case</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Proposed Action</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Safety Decision</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {recentDecisions.map((c: any) => (
                                    <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                                        <td className="px-6 py-3 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                        <td className="px-6 py-3 font-mono text-xs">{c.agent?.selected_action || '-'}</td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center">
                                                {c.safety?.eligibility === 'ALLOWED' && <ShieldCheck className="text-green-500 mr-2" size={14} />}
                                                {(c.safety?.eligibility === 'BLOCKED' || c.safety?.decision === 'BLOCK') && <ShieldAlert className="text-red-500 mr-2" size={14} />}
                                                {(c.safety?.eligibility === 'ESCALATED' || c.safety?.decision === 'ESCALATE') && <ShieldAlert className="text-orange-500 mr-2" size={14} />}
                                                <span className={`text-xs font-bold uppercase tracking-wider ${
                                                    c.safety?.eligibility === 'ALLOWED' ? 'text-green-600' :
                                                    (c.safety?.eligibility === 'BLOCKED' || c.safety?.decision === 'BLOCK') ? 'text-red-600' : 'text-orange-600'
                                                }`}>
                                                    {c.safety?.eligibility || c.safety?.decision}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 font-mono text-xs text-text-muted max-w-[200px] truncate" title={c.safety?.reason_code}>
                                            {c.safety?.reason_code || '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
