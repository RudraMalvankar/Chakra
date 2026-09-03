import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { formatExact, formatCurrency, formatPercent } from '../lib/format';
import { ArrowLeft, AlertCircle } from 'lucide-react';

export const CaseDetail = ({ cases }: any) => {
    const { id } = useParams();
    const navigate = useNavigate();
    const c = cases.find((x: any) => x.id === id);
    
    if (!c) return <div className="p-8 text-center text-text-muted font-mono">Case {id} not found or awaiting processing.</div>;

    const risk = c.risk || {};
    const agent = c.agent || {};
    const safety = c.safety || {};
    const outcome = c.outcome || {};
    const rankedCands = [...(agent.candidate_actions || [])].sort((a: any, b: any) => b.score - a.score);

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            <button onClick={() => navigate('/cases')} className="text-text-muted hover:text-text-main flex items-center space-x-1 text-sm font-medium transition-colors mb-2">
                <ArrowLeft size={16} /> <span className="uppercase tracking-widest text-[10px] font-bold">Back to cases</span>
            </button>

            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-start">
                <div>
                    <div className="flex items-center space-x-3 mb-2">
                        <h2 className="text-xl font-bold text-text-main font-mono tracking-wider">CASE #{c.id.substring(0,8).toUpperCase()}</h2>
                        <Badge status={c.status}>{c.status}</Badge>
                    </div>
                    <div className="text-sm font-medium text-text-muted uppercase tracking-wider">{c.type.replace(/_/g, ' ')}</div>
                </div>
                <div className="flex space-x-8 text-right">
                    <div>
                        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1">Recovery Prob</div>
                        <div className="text-xl font-mono text-text-main">{(risk.recovery_probability * 100 || 0).toFixed(0)}%</div>
                    </div>
                    <div>
                        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1">Expected Recovery</div>
                        <div className="text-xl font-bold font-mono text-rzp-green">{formatExact(risk.expected_recovery_inr)}</div>
                    </div>
                    <div>
                        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1">Revenue at Risk</div>
                        <div className="text-2xl font-bold font-mono text-text-main">{formatExact(c.amount)}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white border border-border shadow-sm p-6">
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Why is this at risk?</h3>
                        <ul className="space-y-2">
                            {(risk.risk_factors || []).map((f: string, i: number) => (
                                <li key={i} className="flex items-start space-x-3 text-sm text-text-main">
                                    <AlertCircle size={16} className="text-rzp-red mt-0.5 shrink-0" />
                                    <span>{f}</span>
                                </li>
                            ))}
                            {(!risk.risk_factors || risk.risk_factors.length === 0) && <li className="text-sm text-text-muted font-mono">{risk.reason || "No specific factors identified."}</li>}
                        </ul>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Recovery Decision</h3>
                            <div className="text-xs font-mono text-text-muted">Confidence: {formatPercent((agent.confidence||0)*100)}</div>
                        </div>
                        <div className="p-6">
                            <div className="mb-6 flex justify-between items-end">
                                <div>
                                    <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Selected Action</div>
                                    <div className="text-lg font-bold text-text-main font-mono border border-gray-200 bg-gray-50 px-3 py-1 rounded">
                                        {agent.selected_action || "PENDING"}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Expected Recovery</div>
                                    <div className="text-lg font-bold text-rzp-green font-mono">
                                        {formatExact(agent.candidate_actions?.find((ca: any) => ca.action === agent.selected_action)?.expected_recovery_inr)}
                                    </div>
                                </div>
                            </div>
                            
                            <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3">Candidate Interventions</h4>
                            <div className="overflow-x-auto border border-border rounded">
                                <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                                    <thead className="bg-gray-50 border-b border-border text-text-muted">
                                        <tr>
                                            <th className="px-4 py-2 font-normal">Rank</th>
                                            <th className="px-4 py-2 font-normal">Action</th>
                                            <th className="px-4 py-2 font-normal text-right">Base Prob</th>
                                            <th className="px-4 py-2 font-normal text-right">Modifier</th>
                                            <th className="px-4 py-2 font-normal text-right">Eff. Prob</th>
                                            <th className="px-4 py-2 font-normal text-right">Exp. Recovery</th>
                                            <th className="px-4 py-2 font-normal">Eligibility</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {rankedCands.map((cand: any, i: number) => (
                                            <tr key={i} className={cand.action === agent.selected_action ? "bg-blue-50/50" : ""}>
                                                <td className="px-4 py-2 text-text-muted">{i+1}</td>
                                                <td className={`px-4 py-2 font-bold ${cand.action === agent.selected_action ? 'text-rzp-blue' : 'text-text-main'}`}>
                                                    {cand.action} {cand.action === agent.selected_action && "✓"}
                                                </td>
                                                <td className="px-4 py-2 text-right">{cand.base_probability?.toFixed(2)}</td>
                                                <td className="px-4 py-2 text-right">{cand.probability_modifier?.toFixed(2)}</td>
                                                <td className="px-4 py-2 text-right font-medium">{cand.effective_probability?.toFixed(2)}</td>
                                                <td className="px-4 py-2 text-right text-rzp-green font-bold">{formatExact(cand.expected_recovery_inr)}</td>
                                                <td className="px-4 py-2">
                                                    {cand.eligible ? <span className="text-green-600">Yes</span> : <span className="text-red-500">No</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Safety Gate</h3>
                            {safety.eligibility === 'ALLOWED' && <span className="text-xs font-bold text-green-600 uppercase">ALLOWED</span>}
                            {(safety.eligibility === 'BLOCKED' || safety.decision === 'BLOCK') && <span className="text-xs font-bold text-red-600 uppercase">BLOCKED</span>}
                            {(safety.eligibility === 'ESCALATED' || safety.decision === 'ESCALATE') && <span className="text-xs font-bold text-orange-500 uppercase">ESCALATED</span>}
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-text-muted">Agent Proposal</span>
                                <span className="font-mono text-text-main font-medium">{agent.selected_action || '-'}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-text-muted">Safety Decision</span>
                                <span className="font-mono text-text-main font-medium">{safety.eligibility || '-'}</span>
                            </div>
                            {(safety.eligibility !== 'ALLOWED' && safety.reason_code) && (
                                <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded text-xs text-red-800 font-mono">
                                    Reason: {safety.reason_code}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Execution</h3>
                        </div>
                        <div className="p-6">
                            {c.status === 'BLOCKED' ? (
                                <div>
                                    <div className="text-sm text-text-muted mb-1">Execution Blocked</div>
                                    <div className="text-xs font-mono text-rzp-red mb-4">{safety.reason_code}</div>
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Recovered Amount</div>
                                    <div className="font-mono font-bold text-xl text-text-muted">₹0</div>
                                </div>
                            ) : c.status === 'ESCALATED' ? (
                                <div>
                                    <div className="text-sm text-text-muted mb-1">Execution Escalated</div>
                                    <div className="text-xs font-mono text-orange-600 mb-4">{safety.reason_code}</div>
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Recovered Amount</div>
                                    <div className="font-mono font-bold text-xl text-text-muted">₹0</div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-text-muted">Execution Status</span>
                                        <span className="font-mono text-text-main uppercase">{outcome.status || '-'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-text-muted">Provider Outcome</span>
                                        <span className="font-mono text-text-main uppercase">{outcome.raw_response?.outcome || outcome.raw_response?.status || outcome.status || '-'}</span>
                                    </div>
                                    <div className="pt-3 border-t border-border">
                                        <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Recovered Amount</div>
                                        <div className={`font-mono text-2xl font-bold ${outcome.recovered ? 'text-rzp-green' : 'text-text-muted'}`}>
                                            {formatExact(outcome.amount_recovered_inr || 0)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Audit Timeline</h3>
                        </div>
                        <div className="p-6">
                            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-[5px] before:h-full before:w-px before:bg-border">
                                {c.events.map((ev: any, i: number) => (
                                    <div key={i} className="relative flex items-start">
                                        <div className="w-3 h-3 rounded-full bg-white border-2 border-rzp-blue shrink-0 z-10 mt-1"></div>
                                        <div className="ml-4">
                                            <div className="text-[10px] font-mono text-text-muted mb-0.5">{new Date(ev.timestamp).toLocaleTimeString()}</div>
                                            <div className="text-xs font-bold text-text-main uppercase">{ev.event_type.replace(/_/g, ' ')}</div>
                                            <div className="text-xs font-mono text-text-muted mt-0.5 truncate w-48">
                                                {ev.event_type === 'revenue_risk_assessed' ? `${formatCurrency(ev.details.revenue_at_risk_inr)}` : 
                                                 ev.event_type === 'execution_outcome' ? `${ev.details.status}` : 
                                                 (ev.details.decision || ev.details.effective_action || "")}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
