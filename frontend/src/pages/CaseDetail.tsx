import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCaseDetail } from '../services/api';
import { formatCurrency, formatExact } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { BrainCircuit, ShieldCheck, Zap, Activity } from 'lucide-react';

export const CaseDetail = ({ cases }: any) => {
    const { id } = useParams();
    const summary = cases.find((x: any) => x.id === id);
    const [detail, setDetail] = useState<any>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        setDetail(null);
        fetchCaseDetail(id)
            .then((response) => {
                const events = (response.events || []).map((event: any) => ({
                    ...event,
                    details: event.details || event.metadata || {},
                    timestamp: event.timestamp || event.created_at,
                }));
                const risk = response.risk || events.find((event: any) => event.event_type === 'revenue_risk_assessed')?.details || {};
                const safety = response.safety || events.find((event: any) => event.event_type === 'safety_check_completed')?.details || {};
                const latestDecision = response.decisions?.at(-1);
                setDetail({
                    ...response,
                    type: response.case?.type || response.case_type,
                    amount: response.case?.amount_at_risk ?? response.amount_at_risk,
                    last_updated: response.case?.created_at || response.created_at,
                    events,
                    risk,
                    safety,
                    agent: response.agent || (latestDecision ? {
                        selected_action: latestDecision.action,
                        candidate_actions: [{ ...latestDecision, expected_recovery_inr: latestDecision.expected_recovery }],
                    } : {}),
                    outcome: response.outcome || {},
                });
                setLoadError(null);
            })
            .catch((error) => setLoadError(error.message));
    }, [id]);
    const c = detail || summary;

    if (loadError) {
        return <div className="p-8 text-center text-text-muted font-mono">Unable to load case: {loadError}</div>;
    }
    if (!c) {
        return <div className="p-8 text-center text-text-muted font-mono">Loading case…</div>;
    }

    const triage = c.triage || c.ai || c.events.find((e: any) => e.event_type === 'ai_triage_completed')?.details || {};
    const risk = c.risk || {};
    const agent = c.agent || {};
    const safety = c.safety || {};
    const outcome = c.outcome || {};

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header section matching exact prompt format */}
            <div className="bg-white border border-border shadow-sm p-8">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="text-xs font-bold text-text-light uppercase tracking-widest mb-1">RECOVERY MISSION</div>
                        <h2 className="text-3xl font-bold font-mono text-rzp-blue mb-4">{c.id}</h2>
                        
                        <div className="flex space-x-6">
                            <div>
                                <div className="text-2xl font-bold font-mono text-text-main">{formatCurrency(c.amount)}</div>
                                <div className="text-[10px] font-bold text-text-muted uppercase mt-1">Amount at Risk</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold font-mono text-text-main uppercase">{c.type.replace(/_/g, ' ')}</div>
                                <div className="text-[10px] font-bold text-text-muted uppercase mt-1">Workflow</div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="text-right flex flex-col items-end">
                        <div className="text-[10px] font-bold text-text-muted uppercase mb-1">STATUS</div>
                        <Badge status={c.status} className="text-lg px-4 py-1">{c.status}</Badge>
                        <div className="text-xs text-text-light font-mono mt-4">Last updated: {new Date(c.last_updated).toLocaleString()}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    
                    {/* 1. AI Reasoning */}
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center">
                                <BrainCircuit className="text-purple-500 mr-3" size={18}/>
                                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">AI Reasoning & Classification</h3>
                            </div>
                            {(c.ai_used || triage.ai_used) && (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-800 rounded font-mono">
                                    {c.model_used || triage.model_used || "Model not available"}
                                    {(c.fallback_used || triage.fallback_used) ? " (FALLBACK)" : ""}
                                </span>
                            )}
                        </div>
                        <div className="p-6 font-mono text-sm space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-purple-50 border border-purple-100 rounded">
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Detected Failure Category</div>
                                    <div className="font-bold text-purple-700">{c.ai_classification || triage.classification || triage.category || 'DETERMINISTIC / NONE'}</div>
                                </div>
                                <div className="p-4 bg-purple-50 border border-purple-100 rounded">
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Confidence</div>
                                    <div className="font-bold text-purple-700">
                                        {(c.ai_confidence || triage.confidence) ? `${Math.round((c.ai_confidence || triage.confidence) * 100)}%` : 'Not available'}
                                    </div>
                                </div>
                            </div>
                            <div className="text-text-muted p-4 bg-gray-50 border border-border rounded text-xs">
                                <span className="font-bold text-text-main">AI Reasoning: </span>
                                {c.ai_reasoning || triage.reason || triage.summary || "No AI invocation needed (deterministic recovery route executed)."}
                            </div>
                        </div>
                    </div>

                    {/* 2. Deterministic Financial Decision */}
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center">
                            <Activity className="text-rzp-blue mr-3" size={18}/>
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Deterministic Financial Decision</h3>
                        </div>
                        <div className="p-6 font-mono text-sm space-y-6">
                            
                            <div className="grid grid-cols-3 gap-4 border-b border-border pb-6">
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Priority</div>
                                    <Badge status={risk.priority}>{risk.priority || 'UNKNOWN'}</Badge>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Fraud Risk</div>
                                    <div className="font-bold">{risk.fraud_risk || '-'}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Churn Risk</div>
                                    <div className="font-bold">{risk.churn_risk || '-'}</div>
                                </div>
                            </div>

                            <div>
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-4">Agent Candidate Evaluation</div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-gray-50 border-b border-border text-text-muted">
                                            <tr>
                                                <th className="px-4 py-2">Action</th>
                                                <th className="px-4 py-2 text-right">Base Prob</th>
                                                <th className="px-4 py-2 text-right">Modifier</th>
                                                <th className="px-4 py-2 text-right">Effective Prob</th>
                                                <th className="px-4 py-2 text-right">Expected Recovery</th>
                                                <th className="px-4 py-2">Selected</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {agent.candidate_actions?.map((cand: any, idx: number) => (
                                                <tr key={idx} className={cand.action === agent.selected_action ? 'bg-blue-50/50 font-bold' : ''}>
                                                    <td className="px-4 py-2">{cand.action}</td>
                                                    <td className="px-4 py-2 text-right">{cand.base_probability?.toFixed(2)}</td>
                                                    <td className="px-4 py-2 text-right text-text-muted">{cand.probability_modifier?.toFixed(2)}</td>
                                                    <td className="px-4 py-2 text-right">{cand.effective_probability?.toFixed(2)}</td>
                                                    <td className="px-4 py-2 text-right text-rzp-green">{formatExact(cand.expected_recovery_inr)}</td>
                                                    <td className="px-4 py-2">
                                                        {cand.action === agent.selected_action ? <span className="text-rzp-blue">✓ SELECTED</span> : ''}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 3. Safety Decision */}
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center">
                                <ShieldCheck className={safety.eligibility === 'ALLOWED' ? 'text-green-500 mr-3' : 'text-red-500 mr-3'} size={18}/>
                                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Safety Gate</h3>
                            </div>
                            <Badge status={safety.eligibility === 'ALLOWED' ? 'RECOVERED' : 'BLOCKED'}>{safety.eligibility || 'PENDING'}</Badge>
                        </div>
                        <div className="p-6 font-mono text-sm">
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-text-muted">Agent Proposed Action:</span>
                                <span className="font-bold">{agent.selected_action || 'Not available'}</span>
                            </div>
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-text-muted">Safety Policy Decision:</span>
                                <span className="font-bold">{safety.eligibility || 'Not available'}</span>
                            </div>
                            {(safety.eligibility !== 'ALLOWED' && safety.reason_code) && (
                                <div className="p-4 bg-red-50 border border-red-100 rounded text-red-800 text-xs">
                                    <div className="font-bold uppercase tracking-widest mb-1">Policy Enforcement</div>
                                    <div>{safety.reason_code}</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Timeline & Execution */}
                <div className="space-y-6">
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center">
                            <Zap className="text-yellow-500 mr-2" size={16}/>
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Execution Outcome</h3>
                        </div>
                        <div className="p-6">
                            {c.status === 'BLOCKED' ? (
                                <div>
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Status</div>
                                    <div className="font-mono text-rzp-red font-bold mb-4">BLOCKED</div>
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Recovered</div>
                                    <div className="font-mono text-xl text-text-muted">₹0.00</div>
                                </div>
                            ) : c.status === 'ESCALATED' ? (
                                <div>
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Status</div>
                                    <div className="font-mono text-orange-600 font-bold mb-4">ESCALATED</div>
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Recovered</div>
                                    <div className="font-mono text-xl text-text-muted">₹0.00</div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Provider Outcome</div>
                                        <div className="font-mono font-bold">{outcome.raw_response?.outcome || outcome.raw_response?.status || outcome.status || 'Not available'}</div>
                                    </div>
                                    <div className="pt-4 border-t border-border">
                                        <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Amount Recovered</div>
                                        <div className={`font-mono text-2xl font-bold ${outcome.recovered ? 'text-rzp-green' : 'text-text-main'}`}>
                                            {formatExact(outcome.amount_recovered_inr || 0)}
                                        </div>
                                    </div>
                                    
                                    {outcome.raw_response?.recovery_url && (
                                        <div className="pt-4">
                                            <a href={outcome.raw_response.recovery_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-rzp-blue uppercase tracking-wider hover:underline">
                                                Open Payment Link →
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Audit Timeline</h3>
                        </div>
                        <div className="p-6">
                            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[5px] before:h-full before:w-px before:bg-border">
                                {c.events.map((ev: any, i: number) => {
                                    // Custom labels for standard events to match the prompt exactly
                                    const labels: any = {
                                        "event_received": "EVENT RECEIVED",
                                        "context_built": "CONTEXT BUILT",
                                        "ai_triage_completed": "AI TRIAGE",
                                        "revenue_risk_assessed": "RISK ASSESSED",
                                        "agent_decision_proposed": "AGENT DECISION",
                                        "safety_check_completed": "SAFETY GATE",
                                        "execution_started": "EXECUTION",
                                        "execution_outcome": "PROVIDER OUTCOME",
                                        "recovery_verified": "RECOVERY VERIFIED"
                                    };
                                    
                                    const label = labels[ev.event_type] || ev.event_type.replace(/_/g, ' ').toUpperCase();
                                    
                                    return (
                                        <div key={i} className="relative flex items-start">
                                            <div className="w-3 h-3 rounded-full bg-white border-2 border-rzp-blue shrink-0 z-10 mt-1"></div>
                                            <div className="ml-4">
                                                <div className="text-[10px] font-mono text-text-muted mb-0.5">{new Date(ev.timestamp).toLocaleTimeString()}</div>
                                                <div className="text-xs font-bold text-text-main uppercase tracking-wider">{label}</div>
                                                <div className="text-xs font-mono text-text-muted mt-1 truncate w-full max-w-[200px]">
                                                    {ev.event_type === 'revenue_risk_assessed' ? `${formatCurrency(ev.details.revenue_at_risk_inr)}` : 
                                                     ev.event_type === 'execution_outcome' ? `${ev.details.status}` : 
                                                     ev.event_type === 'ai_triage_completed' ? `${ev.details.category}` : 
                                                     (ev.details.decision || ev.details.effective_action || "")}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
