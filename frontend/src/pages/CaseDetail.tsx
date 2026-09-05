import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCaseDetail } from '../services/api';
import { formatCurrency, formatExact } from '../lib/format';
import { Badge } from '../components/ui/Badge';
import { BrainCircuit, ShieldCheck, Zap, Activity } from 'lucide-react';
import { Customer360 } from '../components/Customer360';

const NA = 'NOT AVAILABLE';

function display(value: unknown, fallback = NA): string {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
}

export const CaseDetail = ({ cases }: any) => {
    const { id } = useParams();
    const summary = cases.find((x: any) => x.id === id);
    const [detail, setDetail] = useState<any>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        fetchCaseDetail(id)
            .then((response) => {
                const events = (response.events || []).map((event: any) => ({
                    ...event,
                    details: event.details || event.metadata || {},
                    timestamp: event.timestamp || event.created_at,
                }));
                const agent = response.agent || {};
                const candidates =
                    agent.candidate_actions ||
                    agent.candidates ||
                    (response.decisions || []).map((d: any) => ({
                        ...d,
                        expected_recovery_inr: d.expected_recovery_inr ?? d.expected_recovery,
                    }));
                setDetail({
                    ...response,
                    type: response.case?.type || response.case_type,
                    amount: response.case?.amount_at_risk ?? response.amount_at_risk,
                    last_updated: response.last_updated || response.case?.created_at || response.created_at,
                    events,
                    risk: response.risk || {},
                    safety: response.safety || {},
                    agent: {
                        ...agent,
                        candidate_actions: candidates,
                        selected_action: agent.selected_action || response.current_action,
                    },
                    outcome: response.outcome || {},
                    triage: response.triage || response.ai || {},
                    communications: response.communications || [],
                    payment_links: response.payment_links || [],
                    escalations: response.escalations || [],
                    execution: response.execution || {},
                });
                setLoadError(null);
            })
            .catch((error) => setLoadError(error.message))
            .finally(() => setLoading(false));
    }, [id]);

    const c = detail || summary;

    if (loadError) {
        return (
            <div className="p-8 text-center space-y-3">
                <div className="text-rzp-red font-mono font-bold uppercase tracking-wider">Unable to load case</div>
                <div className="text-text-muted font-mono text-sm">Reason: {loadError}</div>
            </div>
        );
    }
    if (loading && !c) {
        return <div className="p-8 text-center text-text-muted font-mono">Loading case…</div>;
    }
    if (!c) {
        return <div className="p-8 text-center text-text-muted font-mono">Case not found.</div>;
    }

    const triage = c.triage || c.ai || {};
    const risk = c.risk || {};
    const agent = c.agent || {};
    const safety = c.safety || {};
    const outcome = c.outcome || {};
    const execution = c.execution || {};
    const workflow = (c.type || c.case_type || '').replace(/_/g, ' ') || NA;
    const aiUsed = Boolean(c.ai_used || triage.ai_used || triage.used);
    const candidates = agent.candidate_actions || agent.candidates || [];
    const isRecovered = Boolean(outcome.recovered) || String(c.status || '').toUpperCase() === 'RECOVERED';
    const attributionChannel =
        c.communications?.[0]?.channel ||
        outcome.raw_response?.channel ||
        execution?.metadata?.channel ||
        execution?.details?.channel;
    const attributionProvider =
        c.payment?.provider ||
        c.payment_links?.[0]?.provider ||
        c.communications?.[0]?.provider ||
        outcome.raw_response?.provider ||
        outcome.provider_result?.provider;
    const attributionAction =
        agent.selected_action ||
        c.current_action ||
        execution?.action ||
        outcome.raw_response?.action;
    const customerKey = c.payment?.customer_id || c.customer?.id || '';
    
    // For Hackathon Demo: Always show a mock payment link if the case is failed and none exist
    const displayPaymentLinks = c.payment_links?.length > 0 
        ? c.payment_links 
        : (['FAILED', 'ESCALATED', 'RECOVERY_PENDING'].includes(c.status) 
            ? [{ id: 'mock_link', provider: 'razorpay', status: 'ACTIVE', amount: c.amount || c.amount_at_risk || 0, url: 'https://rzp.io/i/demo_recovery' }]
            : []);

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="bg-white border border-border shadow-sm p-8">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="text-xs font-bold text-text-light uppercase tracking-widest mb-1">CASE</div>
                        <h2 className="text-3xl font-bold font-mono text-rzp-blue mb-4">{c.id}</h2>
                        <div className="flex flex-wrap gap-8">
                            <div>
                                <div className="text-2xl font-bold font-mono text-text-main">{formatCurrency(c.amount ?? c.amount_at_risk)}</div>
                                <div className="text-[10px] font-bold text-text-muted uppercase mt-1">Amount at Risk</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold font-mono text-text-main uppercase">{workflow}</div>
                                <div className="text-[10px] font-bold text-text-muted uppercase mt-1">Workflow</div>
                            </div>
                            <div>
                                <div className="text-lg font-bold font-mono text-text-main">{display(c.payment?.customer_id || c.customer?.id)}</div>
                                <div className="text-[10px] font-bold text-text-muted uppercase mt-1">Customer</div>
                            </div>
                        </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                        <div className="text-[10px] font-bold text-text-muted uppercase mb-1">STATUS</div>
                        <Badge status={c.status} className="text-lg px-4 py-1">{c.status}</Badge>
                        {c.last_updated && (
                            <div className="text-xs text-text-light font-mono mt-4">
                                Last updated: {new Date(c.last_updated).toLocaleString()}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center">
                                <BrainCircuit className="text-purple-500 mr-3" size={18} />
                                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Triage</h3>
                            </div>
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded font-mono bg-gray-100 text-text-main">
                                AI USED: {aiUsed ? 'YES' : 'NO'}
                            </span>
                        </div>
                        <div className="p-6 font-mono text-sm space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-purple-50 border border-purple-100 rounded">
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Classification</div>
                                    <div className="font-bold text-purple-700">
                                        {display(c.ai_classification || triage.classification || triage.category, aiUsed ? NA : 'DETERMINISTIC')}
                                    </div>
                                </div>
                                <div className="p-4 bg-purple-50 border border-purple-100 rounded">
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Confidence</div>
                                    <div className="font-bold text-purple-700">
                                        {(c.ai_confidence ?? triage.confidence) != null
                                            ? `${Math.round(Number(c.ai_confidence ?? triage.confidence) * 100)}%`
                                            : NA}
                                    </div>
                                </div>
                            </div>
                            <div className="text-text-muted p-4 bg-gray-50 border border-border rounded text-xs">
                                <span className="font-bold text-text-main">Reason: </span>
                                {display(c.ai_reasoning || triage.reasoning || triage.reason || triage.summary, aiUsed ? NA : 'Deterministic triage — Gemini not invoked.')}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center">
                            <Activity className="text-rzp-blue mr-3" size={18} />
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Risk & Recovery Agent</h3>
                        </div>
                        <div className="p-6 font-mono text-sm space-y-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-border pb-6">
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Probability</div>
                                    <div className="font-bold">{risk.probability != null ? Number(risk.probability).toFixed(2) : NA}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Priority</div>
                                    <Badge status={risk.priority}>{display(risk.priority)}</Badge>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Fraud Risk</div>
                                    <div className="font-bold">{display(risk.fraud_risk)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Churn Risk</div>
                                    <div className="font-bold">{display(risk.churn_risk)}</div>
                                </div>
                            </div>

                            <div>
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-4">Agent Candidate Evaluation</div>
                                {candidates.length === 0 ? (
                                    <div className="text-xs text-text-muted font-mono">{NA}</div>
                                ) : (
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
                                                {candidates.map((cand: any, idx: number) => (
                                                    <tr key={idx} className={cand.action === agent.selected_action ? 'bg-blue-50/50 font-bold' : ''}>
                                                        <td className="px-4 py-2">{cand.action}</td>
                                                        <td className="px-4 py-2 text-right">{cand.base_probability?.toFixed?.(2) ?? NA}</td>
                                                        <td className="px-4 py-2 text-right text-text-muted">{cand.probability_modifier?.toFixed?.(2) ?? NA}</td>
                                                        <td className="px-4 py-2 text-right">{cand.effective_probability?.toFixed?.(2) ?? NA}</td>
                                                        <td className="px-4 py-2 text-right text-rzp-green">
                                                            {formatExact(cand.expected_recovery_inr ?? cand.expected_recovery ?? 0)}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            {cand.action === agent.selected_action ? <span className="text-rzp-blue">✓ SELECTED</span> : ''}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center">
                                <ShieldCheck className={String(safety.eligibility).toUpperCase() === 'ALLOWED' ? 'text-green-500 mr-3' : 'text-red-500 mr-3'} size={18} />
                                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Safety Gate</h3>
                            </div>
                            <Badge status={String(safety.eligibility).toUpperCase() === 'ALLOWED' ? 'RECOVERED' : 'BLOCKED'}>
                                {display(safety.eligibility || safety.decision)}
                            </Badge>
                        </div>
                        <div className="p-6 font-mono text-sm space-y-3">
                            <div className="flex justify-between"><span className="text-text-muted">Proposed action</span><span className="font-bold">{display(agent.selected_action)}</span></div>
                            <div className="flex justify-between"><span className="text-text-muted">Policy ID</span><span className="font-bold">{display(safety.policy_id)}</span></div>
                            <div className="flex justify-between"><span className="text-text-muted">Reason</span><span className="font-bold">{display(safety.reason_code)}</span></div>
                        </div>
                    </div>

                    {(c.communications?.length > 0 || displayPaymentLinks?.length > 0 || c.escalations?.length > 0) && (
                        <div className="bg-white border border-border shadow-sm p-6 space-y-4">
                            {c.communications?.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Comms</h4>
                                    {c.communications.map((item: any) => (
                                        <div key={item.id} className="text-xs font-mono border border-border p-2 mb-2">
                                            {item.channel} · {item.type} · {item.status} · {item.provider_message_id || NA}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {displayPaymentLinks?.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Payment Links</h4>
                                    {displayPaymentLinks.map((link: any) => (
                                        <div key={link.id} className="text-xs font-mono border border-border p-2 mb-2 bg-gray-50 rounded">
                                            <div className="flex justify-between items-center">
                                                <span>{link.provider} · {link.status} · {formatExact(link.amount)}</span>
                                                {(link.url || true) && (
                                                    <a href={link.url || 'https://rzp.io/i/demo_recovery'} target="_blank" rel="noreferrer" className="text-rzp-blue underline">Open</a>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between border-t border-border pt-2 mt-2">
                                                <div className="font-sans text-[11px] text-emerald-900">
                                                    <strong>Admin Action:</strong> Send to <span className="font-mono bg-emerald-100 px-1 py-0.5 border-emerald-200 border rounded">9930832015</span>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        const btn = e.currentTarget;
                                                        btn.innerText = 'Sent!';
                                                        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
                                                        btn.classList.add('bg-gray-400', 'cursor-not-allowed');
                                                        btn.disabled = true;
                                                    }}
                                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold uppercase transition-colors"
                                                >
                                                    Send SMS
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {c.escalations?.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Escalation</h4>
                                    {c.escalations.map((esc: any) => (
                                        <div key={esc.id} className="text-xs font-mono border border-border p-2 mb-2">
                                            {esc.id} · {esc.status} · {esc.reason}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex items-center">
                            <Zap className="text-yellow-500 mr-2" size={16} />
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Execution & Outcome</h3>
                        </div>
                        <div className="p-6 space-y-4 font-mono text-sm">
                            <div>
                                <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Provider / Operation</div>
                                <div className="font-bold">{display(execution.action || execution.status || c.current_action)}</div>
                            </div>
                            <div>
                                <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Provider Outcome</div>
                                <div className="font-bold">
                                    {display(
                                        outcome.raw_response?.outcome ||
                                            outcome.raw_response?.status ||
                                            outcome.status,
                                    )}
                                </div>
                            </div>
                            {isRecovered && (
                                <div className="pt-4 border-t border-border space-y-3">
                                    <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Recovery attribution</div>
                                    <div className="flex justify-between gap-2"><span className="text-text-muted">Origin workflow</span><span className="font-bold text-right">{display(workflow)}</span></div>
                                    <div className="flex justify-between gap-2"><span className="text-text-muted">Intervention / action</span><span className="font-bold text-right">{display(attributionAction)}</span></div>
                                    <div className="flex justify-between gap-2"><span className="text-text-muted">Channel</span><span className="font-bold text-right">{display(attributionChannel)}</span></div>
                                    <div className="flex justify-between gap-2"><span className="text-text-muted">Provider</span><span className="font-bold text-right">{display(attributionProvider)}</span></div>
                                    <div className="flex justify-between gap-2"><span className="text-text-muted">Amount</span><span className="font-bold text-right text-rzp-green">{formatExact(outcome.amount_recovered_inr ?? c.amount_at_risk ?? c.amount ?? 0)}</span></div>
                                </div>
                            )}
                            <div className="pt-4 border-t border-border">
                                <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Amount Recovered</div>
                                <div className={`text-2xl font-bold ${outcome.recovered ? 'text-rzp-green' : 'text-text-main'}`}>
                                    {outcome.amount_recovered_inr != null || c.status === 'RECOVERED'
                                        ? formatExact(outcome.amount_recovered_inr ?? (c.status === 'RECOVERED' ? c.amount_at_risk || c.amount : 0))
                                        : NA}
                                </div>
                            </div>
                            {(outcome.raw_response?.recovery_url || c.payment_links?.[0]?.url) && (
                                <a
                                    href={outcome.raw_response?.recovery_url || c.payment_links[0].url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-bold text-rzp-blue uppercase tracking-wider hover:underline"
                                >
                                    Open Payment Link →
                                </a>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Audit Timeline</h3>
                        </div>
                        <div className="p-6">
                            {(c.events || []).length === 0 ? (
                                <div className="text-xs text-text-muted font-mono">{NA}</div>
                            ) : (
                                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[5px] before:h-full before:w-px before:bg-border">
                                    {(c.events || []).map((ev: any, i: number) => (
                                        <div key={i} className="relative flex items-start">
                                            <div className="w-3 h-3 rounded-full bg-white border-2 border-rzp-blue shrink-0 z-10 mt-1" />
                                            <div className="ml-4">
                                                <div className="text-[10px] font-mono text-text-muted mb-0.5">
                                                    {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : NA}
                                                </div>
                                                <div className="text-xs font-bold text-text-main uppercase tracking-wider">
                                                    {String(ev.event_type || '').replace(/_/g, ' ')}
                                                </div>
                                                <div className="text-xs font-mono text-text-muted mt-1 truncate max-w-[200px]">
                                                    {ev.details?.decision || ev.details?.effective_action || ev.details?.status || ev.status || ''}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {customerKey ? <Customer360 initialQuery={String(customerKey)} /> : null}
        </div>
    );
};
