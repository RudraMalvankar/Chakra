const { useState, useEffect, useMemo } = React;

const API_BASE = 'http://localhost:8001';

// --- Helpers ---
const formatCurrency = (val) => {
    if (val === undefined || val === null) return "₹0";
    if (val >= 1000000) return `₹${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
    return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const formatExact = (val) => `₹${(val||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatPercent = (val) => {
    if (val === undefined || val === null) return "0%";
    return `${val.toFixed(2)}%`;
};
const Icon = ({ name, size = 20, className = "" }) => {
    const iconHtml = lucide.icons[name]?.toSvg({ width: size, height: size, class: className }) || '';
    return <span dangerouslySetInnerHTML={{ __html: iconHtml }} className={`inline-flex items-center justify-center ${className}`} />;
};

const Badge = ({ children, status }) => {
    let colors = "bg-gray-100 text-gray-700 border-gray-200";
    if (status === 'SUCCESS' || status === 'RECOVERED' || status === 'APPROVED') colors = "bg-rzp-greenLight text-green-700 border-green-200";
    if (status === 'WARNING' || status === 'PENDING' || status === 'MEDIUM') colors = "bg-yellow-50 text-yellow-700 border-yellow-200";
    if (status === 'DANGER' || status === 'BLOCKED' || status === 'FAILED') colors = "bg-rzp-redLight text-red-700 border-red-200";
    if (status === 'INFO' || status === 'ESCALATED') colors = "bg-blue-50 text-rzp-blue border-blue-200";
    
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${colors} flex items-center w-fit`}>
            {children}
        </span>
    );
};

// --- Data Service Hooks ---
const useChakraData = () => {
    const [rawMetrics, setRawMetrics] = useState(null);
    const [rawAuditLog, setRawAuditLog] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Live Demo State
    const [demoMode, setDemoMode] = useState(false);
    const [demoIndex, setDemoIndex] = useState(0);

    const metrics = useMemo(() => {
        if (!rawMetrics) return null;
        if (!demoMode) return rawMetrics;
        // In demo mode, we just pass rawMetrics but realistically we should recompute.
        // For simplicity and to avoid re-implementing the entire metrics engine in JS, 
        // we'll still pass rawMetrics for the high level numbers, but the audit trail/cases will build progressively.
        return rawMetrics;
    }, [rawMetrics, demoMode, demoIndex]);

    const auditLog = useMemo(() => {
        if (!demoMode) return rawAuditLog;
        return rawAuditLog.slice(0, demoIndex);
    }, [rawAuditLog, demoMode, demoIndex]);

    useEffect(() => {
        if (demoMode && demoIndex < rawAuditLog.length) {
            const timer = setTimeout(() => setDemoIndex(i => i + 1), 300); // Replay speed
            return () => clearTimeout(timer);
        }
    }, [demoMode, demoIndex, rawAuditLog.length]);

    const refresh = () => {
        Promise.all([
            fetch(`${API_BASE}/api/metrics`).then(r => r.json()),
            fetch(`${API_BASE}/api/audit?limit=2000`).then(r => r.json())
        ]).then(([m, a]) => {
            setRawMetrics(m);
            setRawAuditLog(a.events || []);
            setLoading(false);
            setError(null);
        }).catch(err => {
            console.error(err);
            setError("Unable to load live recovery data.");
            setLoading(false);
        });
    };

    useEffect(() => {
        refresh();
        const int = setInterval(refresh, 5000);
        return () => clearInterval(int);
    }, []);

    // Derived: parsed cases
    const cases = useMemo(() => {
        const caseMap = {};
        const getOrAdd = (id) => {
            if (!caseMap[id]) caseMap[id] = { id, events: [], amount: 0, status: 'PENDING', type: 'UNKNOWN', risk: null, agent: null, safety: null, outcome: null };
            return caseMap[id];
        };
        
        [...auditLog].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(ev => {
            const c = getOrAdd(ev.payment_id);
            c.events.push(ev);
            c.last_updated = ev.timestamp;
            
            if (ev.event_type === 'revenue_risk_assessed') {
                c.risk = ev.details;
                c.amount = ev.details.revenue_at_risk_inr;
            } else if (ev.event_type === 'agent_decision_proposed') {
                c.agent = ev.details;
                c.type = ev.details.case_type || c.type;
            } else if (ev.event_type === 'safety_check_completed') {
                c.safety = ev.details;
                if (ev.details.decision === 'BLOCK' || ev.details.eligibility === 'BLOCKED') c.status = 'BLOCKED';
                else if (ev.details.decision === 'ESCALATE' || ev.details.eligibility === 'ESCALATED') c.status = 'ESCALATED';
            } else if (ev.event_type === 'execution_outcome') {
                c.outcome = ev.details;
                if (ev.details.recovered) c.status = 'RECOVERED';
                else c.status = 'FAILED';
            } else if (ev.event_type === 'execution_blocked') {
                c.status = 'BLOCKED';
            } else if (ev.event_type === 'execution_escalated') {
                c.status = 'ESCALATED';
            }
        });
        
        return Object.values(caseMap).sort((a,b) => {
            const expectedA = a.agent?.candidate_actions?.find(ca => ca.action === a.agent.selected_action)?.expected_recovery_inr || 0;
            const expectedB = b.agent?.candidate_actions?.find(ca => ca.action === b.agent.selected_action)?.expected_recovery_inr || 0;
            return expectedB - expectedA;
        });
    }, [auditLog]);

    return { metrics, auditLog, cases, loading, error, demoMode, setDemoMode, setDemoIndex };
};

// --- Page: Command Center ---
const CommandCenter = ({ metrics, auditLog, onViewCase }) => {
    if (!metrics) return null;
    const m = metrics.metrics;
    
    const sortedEvents = [...auditLog].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 15);

    return (
        <div className="space-y-6">
            <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b border-border bg-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-text-main">Revenue Recovery Command Center</h2>
                        <p className="text-sm text-text-muted mt-1">Detect. Decide. Recover. Prove.</p>
                    </div>
                </div>
                
                <div className="p-8 grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div>
                        <div className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-1">Revenue at Risk</div>
                        <div className="text-4xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_at_risk_inr)}</div>
                        <div className="text-sm text-text-muted mt-2">from {m.payments_processed} failed transactions</div>
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-1">Recovered</div>
                        <div className="text-4xl font-bold text-rzp-green font-mono">{formatCurrency(m.revenue_recovered_inr)}</div>
                        <div className="text-sm text-text-muted mt-2">from {m.payments_recovered} successful interventions</div>
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-1">Recovery Rate</div>
                        <div className="text-4xl font-bold text-rzp-blue font-mono">{formatPercent(m.revenue_recovery_rate_pct)}</div>
                        <div className="text-sm text-text-muted mt-2">of total at-risk value</div>
                    </div>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                            <span className="text-sm text-text-muted">Expected Recovery</span>
                            <span className="font-mono font-semibold text-text-main">{formatCurrency(m.revenue_recovery_attempted_inr)}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                            <span className="text-sm text-text-muted">Blocked by Safety</span>
                            <span className="font-mono font-semibold text-rzp-red">{formatCurrency(m.revenue_blocked_inr)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-text-muted">Escalated</span>
                            <span className="font-mono font-semibold text-orange-500">{formatCurrency(m.revenue_escalated_inr)}</span>
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 p-6 border-t border-border">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Recovery Funnel</h3>
                    <div className="flex justify-between items-center px-8">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_at_risk_inr)}</div>
                            <div className="text-xs text-text-muted mt-1 uppercase">At Risk</div>
                        </div>
                        <Icon name="chevron-right" className="text-gray-300" />
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600 font-mono">{formatCurrency(m.revenue_at_risk_inr - m.revenue_blocked_inr - m.revenue_escalated_inr)}</div>
                            <div className="text-xs text-text-muted mt-1 uppercase">Eligible</div>
                        </div>
                        <Icon name="chevron-right" className="text-gray-300" />
                        <div className="text-center">
                            <div className="text-2xl font-bold text-yellow-600 font-mono">{formatCurrency(m.revenue_recovery_attempted_inr)}</div>
                            <div className="text-xs text-text-muted mt-1 uppercase">Attempted</div>
                        </div>
                        <Icon name="chevron-right" className="text-gray-300" />
                        <div className="text-center">
                            <div className="text-2xl font-bold text-rzp-green font-mono">{formatCurrency(m.revenue_recovered_inr)}</div>
                            <div className="text-xs text-text-muted mt-1 uppercase">Recovered</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white border border-border rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-border flex justify-between items-center">
                    <h3 className="font-semibold text-text-main">Live Recovery Activity</h3>
                    <Badge status="INFO">SYNTHETIC STREAM</Badge>
                </div>
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                    {sortedEvents.map((ev, i) => (
                        <div key={i} className="px-6 py-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between" onClick={() => onViewCase(ev.payment_id)}>
                            <div className="flex items-center space-x-4">
                                <span className="text-xs text-text-light w-20 font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                <span className="text-sm font-medium text-text-main w-24 font-mono">{ev.payment_id.substring(0,8)}</span>
                                <span className="text-sm text-text-muted flex items-center space-x-2 w-48">
                                    {ev.event_type === 'revenue_risk_assessed' && <><Icon name="alert-triangle" size={14} className="text-yellow-500"/><span>Risk Assessed</span></>}
                                    {ev.event_type === 'agent_decision_proposed' && <><Icon name="cpu" size={14} className="text-blue-500"/><span>Agent Decision</span></>}
                                    {ev.event_type === 'safety_check_completed' && <><Icon name="shield" size={14} className="text-indigo-500"/><span>Safety Gate</span></>}
                                    {ev.event_type === 'execution_outcome' && <><Icon name="check-circle" size={14} className="text-green-500"/><span>Outcome</span></>}
                                    {ev.event_type === 'execution_blocked' && <><Icon name="x-circle" size={14} className="text-red-500"/><span>Blocked</span></>}
                                    {ev.event_type === 'execution_escalated' && <><Icon name="corner-up-right" size={14} className="text-orange-500"/><span>Escalated</span></>}
                                </span>
                            </div>
                            <div className="text-sm font-mono text-text-main">
                                {ev.event_type === 'revenue_risk_assessed' ? `${formatCurrency(ev.details.revenue_at_risk_inr)} at risk` : 
                                 ev.event_type === 'execution_outcome' ? `${ev.details.status}` : 
                                 (ev.details.decision || ev.details.effective_action || "")}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- Page: Opportunities ---
const Opportunities = ({ cases, onViewCase }) => {
    return (
        <div className="bg-white border border-border rounded-lg shadow-sm flex flex-col h-full">
            <div className="px-6 py-5 border-b border-border">
                <h2 className="text-xl font-bold text-text-main">Recovery Opportunities</h2>
                <p className="text-sm text-text-muted mt-1">Revenue at risk ranked by expected recoverable value.</p>
            </div>
            
            <div className="p-4 border-b border-border bg-gray-50 flex items-center space-x-4">
                <select className="border border-border rounded px-3 py-1.5 text-sm bg-white text-text-main">
                    <option>All Priorities</option>
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                </select>
                <select className="border border-border rounded px-3 py-1.5 text-sm bg-white text-text-main">
                    <option>All Workflows</option>
                    <option>PAYMENT_FAILURE</option>
                    <option>CHECKOUT_ABANDONMENT</option>
                </select>
            </div>

            <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted font-semibold">
                        <tr>
                            <th className="px-6 py-3 font-medium">Priority</th>
                            <th className="px-6 py-3 font-medium">Case</th>
                            <th className="px-6 py-3 font-medium">Workflow</th>
                            <th className="px-6 py-3 font-medium text-right">Revenue at Risk</th>
                            <th className="px-6 py-3 font-medium text-right">Probability</th>
                            <th className="px-6 py-3 font-medium text-right">Expected Recovery</th>
                            <th className="px-6 py-3 font-medium">Recommended Action</th>
                            <th className="px-6 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {cases.map(c => {
                            const exp = c.agent?.candidate_actions?.find(ca => ca.action === c.agent.selected_action)?.expected_recovery_inr;
                            const prob = c.risk?.recovery_probability || 0;
                            return (
                                <tr key={c.id} onClick={() => onViewCase(c.id)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                                    <td className="px-6 py-3">
                                        <Badge status={c.risk?.priority}>{c.risk?.priority || 'UNKNOWN'}</Badge>
                                    </td>
                                    <td className="px-6 py-3 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                    <td className="px-6 py-3 text-text-main">{c.type.replace(/_/g, ' ')}</td>
                                    <td className="px-6 py-3 text-right font-mono text-text-main">{formatExact(c.amount)}</td>
                                    <td className="px-6 py-3 text-right font-mono text-text-main">{formatPercent(prob * 100)}</td>
                                    <td className="px-6 py-3 text-right font-mono font-semibold text-rzp-green">{formatExact(exp)}</td>
                                    <td className="px-6 py-3 text-text-main">{c.agent?.selected_action || '-'}</td>
                                    <td className="px-6 py-3"><Badge status={c.status}>{c.status}</Badge></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Page: Case Detail ---
const CaseDetail = ({ caseData, onBack }) => {
    if (!caseData) return null;
    const c = caseData;
    const risk = c.risk || {};
    const agent = c.agent || {};
    const safety = c.safety || {};
    const outcome = c.outcome || {};

    const selectedCand = agent.candidate_actions?.find(ca => ca.action === agent.selected_action) || {};
    const rankedCands = [...(agent.candidate_actions || [])].sort((a,b) => b.score - a.score);

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-12">
            <button onClick={onBack} className="text-text-muted hover:text-text-main flex items-center space-x-1 text-sm font-medium transition-colors">
                <Icon name="arrow-left" size={16} /> <span>Back to cases</span>
            </button>

            {/* Header */}
            <div className="bg-white border border-border rounded-lg shadow-sm p-6 flex justify-between items-start">
                <div>
                    <div className="flex items-center space-x-3 mb-2">
                        <h2 className="text-2xl font-bold text-text-main font-mono">CASE #{c.id.substring(0,8).toUpperCase()}</h2>
                        <Badge status={c.status}>{c.status}</Badge>
                    </div>
                    <div className="text-text-muted font-medium">{c.type.replace(/_/g, ' ')}</div>
                </div>
                <div className="text-right">
                    <div className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-1">Revenue at Risk</div>
                    <div className="text-3xl font-bold font-mono text-text-main">{formatExact(c.amount)}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Left Column */}
                <div className="lg:col-span-2 space-y-6">
                    
                    {/* Revenue Risk */}
                    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-border bg-gray-50"><h3 className="font-semibold text-text-main text-sm uppercase tracking-wide">Revenue Risk</h3></div>
                        <div className="p-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                <div>
                                    <div className="text-xs text-text-muted mb-1">Recovery Probability</div>
                                    <div className="font-mono font-medium">{(risk.recovery_probability * 100).toFixed(0)}%</div>
                                </div>
                                <div>
                                    <div className="text-xs text-text-muted mb-1">Expected Recovery</div>
                                    <div className="font-mono font-medium text-rzp-green">{formatExact(risk.expected_recovery_inr)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-text-muted mb-1">Priority</div>
                                    <Badge status={risk.priority}>{risk.priority}</Badge>
                                </div>
                                <div>
                                    <div className="text-xs text-text-muted mb-1">Urgency</div>
                                    <Badge status={risk.urgency}>{risk.urgency}</Badge>
                                </div>
                            </div>
                            
                            <div className="pt-4 border-t border-gray-100">
                                <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Why is this at risk?</h4>
                                <ul className="space-y-2">
                                    {(risk.risk_factors || []).map((f, i) => (
                                        <li key={i} className="flex items-start space-x-2 text-sm text-text-main">
                                            <Icon name="info" size={16} className="text-blue-500 mt-0.5 shrink-0" />
                                            <span>{f}</span>
                                        </li>
                                    ))}
                                    {(!risk.risk_factors || risk.risk_factors.length === 0) && <li className="text-sm text-text-muted">{risk.reason}</li>}
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Agent Decision */}
                    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                            <h3 className="font-semibold text-text-main text-sm uppercase tracking-wide">Agent Decision</h3>
                            <div className="text-sm font-mono text-rzp-blue">Confidence: {formatPercent((agent.confidence||0)*100)}</div>
                        </div>
                        <div className="p-6">
                            <div className="mb-6">
                                <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Recommended Action</div>
                                <div className="text-xl font-bold text-rzp-blue font-mono bg-blue-50 px-4 py-2 rounded border border-blue-100 inline-block">
                                    {agent.selected_action}
                                </div>
                            </div>
                            
                            <div className="mb-6">
                                <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Why this action?</h4>
                                <ul className="space-y-2">
                                    {(agent.decision_factors || []).map((f, i) => (
                                        <li key={i} className="flex items-start space-x-2 text-sm text-text-main">
                                            <Icon name="check" size={16} className="text-green-500 mt-0.5 shrink-0" />
                                            <span>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="pt-4 border-t border-gray-100">
                                <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Candidate Interventions</h4>
                                <div className="space-y-3">
                                    {rankedCands.map((cand, i) => (
                                        <div key={i} className={`p-4 rounded border ${cand.action === agent.selected_action ? 'border-rzp-blue bg-blue-50' : 'border-border bg-white'} ${!cand.eligible ? 'opacity-60 bg-gray-50' : ''}`}>
                                            <div className="flex justify-between items-center mb-3">
                                                <div className="font-mono font-bold text-text-main flex items-center space-x-2">
                                                    <span>{cand.action}</span>
                                                    {cand.action === agent.selected_action && <Icon name="check-circle" size={16} className="text-rzp-blue" />}
                                                </div>
                                                {!cand.eligible && <Badge status="BLOCKED">Blocked</Badge>}
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                                                <div><div className="text-text-muted mb-0.5">Base Prob</div><div>{formatPercent((cand.base_probability||0)*100)}</div></div>
                                                <div><div className="text-text-muted mb-0.5">Modifier</div><div>{(cand.probability_modifier||1).toFixed(2)}x</div></div>
                                                <div><div className="text-text-muted mb-0.5">Score</div><div>{(cand.score||0).toFixed(2)}</div></div>
                                                <div><div className="text-text-muted mb-0.5">Exp. Recovery</div><div className="font-bold text-rzp-green">{formatExact(cand.expected_recovery_inr)}</div></div>
                                            </div>
                                            <div className="text-xs text-text-muted mt-3 italic">"{cand.reason}"</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    
                    {/* Safety Gate */}
                    <div className={`bg-white border ${c.status === 'BLOCKED' ? 'border-red-300' : 'border-border'} rounded-lg shadow-sm overflow-hidden`}>
                        <div className={`px-6 py-4 border-b flex justify-between items-center ${c.status === 'BLOCKED' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-border'}`}>
                            <h3 className="font-semibold text-text-main text-sm uppercase tracking-wide">Safety Gate</h3>
                            {safety.eligibility === 'ALLOWED' && <Badge status="APPROVED">✓ APPROVED</Badge>}
                            {(safety.eligibility === 'BLOCKED' || safety.decision === 'BLOCK') && <Badge status="BLOCKED">✕ BLOCKED</Badge>}
                            {(safety.eligibility === 'ESCALATED' || safety.decision === 'ESCALATE') && <Badge status="ESCALATED">↗ ESCALATED</Badge>}
                        </div>
                        <div className="p-6">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-text-muted">Agent proposal</span>
                                    <span className="font-mono text-text-main font-medium">{agent.selected_action || '-'}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-text-muted">Safety decision</span>
                                    <span className="font-mono text-text-main font-medium">{safety.eligibility || '-'}</span>
                                </div>
                                {(safety.eligibility !== 'ALLOWED' && safety.reason_code) && (
                                    <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded text-sm text-red-800 font-mono">
                                        Reason: {safety.reason_code}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Execution Outcome */}
                    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="font-semibold text-text-main text-sm uppercase tracking-wide">Outcome</h3>
                        </div>
                        <div className="p-6">
                            {c.status === 'BLOCKED' ? (
                                <div className="text-center py-4">
                                    <div className="text-red-500 mb-2"><Icon name="shield-alert" size={32} className="mx-auto" /></div>
                                    <h4 className="font-bold text-text-main mb-1">Execution Blocked</h4>
                                    <p className="text-sm text-text-muted">No money moved.</p>
                                    <div className="mt-4 font-mono font-bold text-xl text-text-muted">₹0</div>
                                </div>
                            ) : c.status === 'ESCALATED' ? (
                                <div className="text-center py-4">
                                    <div className="text-orange-500 mb-2"><Icon name="corner-up-right" size={32} className="mx-auto" /></div>
                                    <h4 className="font-bold text-text-main mb-1">Execution Escalated</h4>
                                    <p className="text-sm text-text-muted">Routed to manual review.</p>
                                    <div className="mt-4 font-mono font-bold text-xl text-text-muted">₹0</div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-text-muted">Execution</span>
                                        <span className="font-mono text-text-main">{outcome.status || '-'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-text-muted">Provider</span>
                                        <span className="font-mono text-text-main">{outcome.raw_response?.outcome || outcome.raw_response?.status || outcome.status || '-'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm pt-3 border-t border-gray-100">
                                        <span className="text-text-muted font-medium">Recovered</span>
                                        <span className={`font-mono text-xl font-bold ${outcome.recovered ? 'text-rzp-green' : 'text-text-muted'}`}>
                                            {formatExact(outcome.amount_recovered_inr || 0)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Timeline */}
                    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="font-semibold text-text-main text-sm uppercase tracking-wide">Case Timeline</h3>
                        </div>
                        <div className="p-6">
                            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gray-100">
                                {c.events.map((ev, i) => (
                                    <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                                        <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-white bg-blue-100 text-blue-600 shadow shrink-0 z-10">
                                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                        </div>
                                        <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 rounded border border-gray-100 bg-gray-50 ml-4 md:ml-0 md:mr-6 md:odd:mr-0 md:odd:ml-6">
                                            <div className="flex justify-between space-x-2 mb-1">
                                                <span className="font-medium text-xs text-text-main">{ev.event_type.replace(/_/g, ' ').toUpperCase()}</span>
                                                <span className="text-xs text-text-muted font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
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

// --- Page: Recovery ---
const Recovery = ({ metrics }) => {
    if (!metrics) return null;
    const byInt = metrics.metrics.by_intervention || {};
    
    return (
        <div className="bg-white border border-border rounded-lg shadow-sm">
            <div className="px-6 py-5 border-b border-border">
                <h2 className="text-xl font-bold text-text-main">Recovery by Intervention</h2>
                <p className="text-sm text-text-muted mt-1">Performance of individual recovery workflows.</p>
            </div>
            <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50 border-b border-border text-text-muted font-semibold">
                    <tr>
                        <th className="px-6 py-3 font-medium">Intervention</th>
                        <th className="px-6 py-3 font-medium text-right">Attempted</th>
                        <th className="px-6 py-3 font-medium text-right">Succeeded</th>
                        <th className="px-6 py-3 font-medium text-right">Recovered Revenue</th>
                        <th className="px-6 py-3 font-medium text-right">Success Rate</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {['PAYMENT_LINK', 'AFA_PAYMENT_LINK', 'RETRY_NOW', 'RETRY_LATER', 'VOICE_RECOVERY', 'REMINDER'].map(k => {
                        const stat = byInt[k] || { attempted: 0, succeeded: 0, revenue_recovered_inr: 0 };
                        const rate = stat.attempted > 0 ? (stat.succeeded / stat.attempted) * 100 : 0;
                        return (
                            <tr key={k} className="hover:bg-gray-50">
                                <td className="px-6 py-3 font-mono font-medium text-text-main">{k}</td>
                                <td className="px-6 py-3 text-right">{stat.attempted}</td>
                                <td className="px-6 py-3 text-right text-rzp-green">{stat.succeeded}</td>
                                <td className="px-6 py-3 text-right font-mono">{formatExact(stat.revenue_recovered_inr)}</td>
                                <td className="px-6 py-3 text-right font-mono">{formatPercent(rate)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

// --- Page: Safety ---
const SafetyCenter = ({ cases }) => {
    const safetyEvents = cases.filter(c => c.safety).map(c => c.safety).slice(0, 50);
    
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border border-border rounded-lg shadow-sm">
                    <div className="px-6 py-5 border-b border-border">
                        <h2 className="text-xl font-bold text-text-main">Safety Center</h2>
                        <p className="text-sm text-text-muted mt-1">Deterministic controls governing autonomous recovery.</p>
                    </div>
                    <div className="p-6 grid grid-cols-2 gap-4">
                        {['Fraud Protection', 'Mandate Validation', 'Retry Limits', 'AFA Enforcement', 'Intervention Budget', 'Idempotency', 'Escalation Rules', 'Stopping Rules'].map(rule => (
                            <div key={rule} className="flex justify-between items-center p-3 border border-border rounded bg-gray-50">
                                <span className="text-sm font-medium text-text-main">{rule}</span>
                                <Badge status="SUCCESS">ACTIVE</Badge>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            
            <div className="bg-white border border-border rounded-lg shadow-sm">
                <div className="px-6 py-4 border-b border-border">
                    <h3 className="font-semibold text-text-main">Recent Safety Decisions</h3>
                </div>
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted font-semibold">
                        <tr>
                            <th className="px-6 py-3 font-medium">Status</th>
                            <th className="px-6 py-3 font-medium">Action</th>
                            <th className="px-6 py-3 font-medium">Reason</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {safetyEvents.map((s, i) => (
                            <tr key={i}>
                                <td className="px-6 py-3">
                                    <Badge status={s.eligibility === 'ALLOWED' ? 'SUCCESS' : (s.eligibility === 'BLOCKED' || s.decision === 'BLOCK' ? 'BLOCKED' : 'ESCALATED')}>
                                        {s.eligibility === 'ALLOWED' ? '✓ APPROVED' : (s.eligibility === 'BLOCKED' || s.decision === 'BLOCK' ? '✕ BLOCKED' : '↗ ESCALATED')}
                                    </Badge>
                                </td>
                                <td className="px-6 py-3 font-mono">{s.decision || '-'}</td>
                                <td className="px-6 py-3 font-mono text-text-muted">{s.reason_code || '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Page: Analytics ---
const Analytics = ({ metrics }) => {
    if (!metrics) return null;
    const m = metrics.metrics;
    
    return (
        <div className="space-y-6">
            <div className="bg-white border border-border rounded-lg shadow-sm">
                <div className="px-6 py-5 border-b border-border">
                    <h2 className="text-xl font-bold text-text-main">Recovery by Workflow</h2>
                    <Badge status="INFO" className="mt-2">SYNTHETIC BENCHMARK</Badge>
                </div>
                <div className="p-6">
                    <div className="space-y-4 max-w-3xl">
                        {Object.entries(m.by_case_type || {}).map(([type, stats]) => (
                            <div key={type}>
                                <div className="flex justify-between text-sm font-medium mb-1">
                                    <span>{type.replace(/_/g, ' ')}</span>
                                    <span>{formatExact(stats.revenue_recovered)} / {formatExact(stats.revenue_at_risk)}</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-4 relative overflow-hidden">
                                    <div className="bg-rzp-green h-4 absolute left-0 top-0" style={{ width: `${(stats.revenue_recovered / stats.revenue_at_risk) * 100}%` }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Page: Audit Log ---
const AuditLog = ({ auditLog, onViewCase }) => {
    return (
        <div className="bg-white border border-border rounded-lg shadow-sm h-full flex flex-col">
            <div className="px-6 py-5 border-b border-border">
                <h2 className="text-xl font-bold text-text-main">System Audit Trail</h2>
                <p className="text-sm text-text-muted mt-1">Append-only cryptographic operational log.</p>
            </div>
            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted font-semibold sticky top-0">
                        <tr>
                            <th className="px-6 py-3 font-medium">Timestamp</th>
                            <th className="px-6 py-3 font-medium">Case</th>
                            <th className="px-6 py-3 font-medium">Event</th>
                            <th className="px-6 py-3 font-medium">Action/Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {[...auditLog].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map((ev, i) => (
                            <tr key={i} onClick={() => onViewCase(ev.payment_id)} className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-6 py-2 font-mono text-text-muted">{new Date(ev.timestamp).toISOString()}</td>
                                <td className="px-6 py-2 font-mono text-rzp-blue">{ev.payment_id.substring(0,8)}</td>
                                <td className="px-6 py-2">{ev.event_type}</td>
                                <td className="px-6 py-2 font-mono text-text-muted text-xs">
                                    {ev.details.decision || ev.details.effective_action || ev.details.status || '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- App Root ---
const App = () => {
    const { metrics, auditLog, cases, loading, error, demoMode, setDemoMode, setDemoIndex } = useChakraData();
    const [currentTab, setCurrentTab] = useState('Command Center');
    const [selectedCaseId, setSelectedCaseId] = useState(null);

    const tabs = ['Command Center', 'Opportunities', 'Cases', 'Recovery', 'Safety', 'Analytics', 'Audit Log'];

    if (loading) return <div className="flex h-screen items-center justify-center bg-background text-text-main">Loading Chakra Command Center...</div>;
    if (error) return (
        <div className="flex h-screen items-center justify-center bg-background flex-col">
            <div className="text-red-500 mb-4"><Icon name="alert-triangle" size={48} /></div>
            <h2 className="text-xl font-bold text-text-main mb-2">Backend unavailable</h2>
            <p className="text-text-muted mb-4">{error}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-text-main text-white rounded font-medium">Retry</button>
        </div>
    );

    const viewCase = (id) => {
        setSelectedCaseId(id);
    };

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r border-border flex flex-col shrink-0">
                <div className="p-6 border-b border-border">
                    <h1 className="font-bold tracking-widest text-xl text-text-main">CHAKRA</h1>
                </div>
                <nav className="flex-1 py-4 flex flex-col">
                    {tabs.map(t => (
                        <button
                            key={t}
                            onClick={() => { setCurrentTab(t); setSelectedCaseId(null); }}
                            className={`w-full text-left px-6 py-2.5 text-sm font-medium transition-colors ${currentTab === t && !selectedCaseId ? 'text-rzp-blue bg-blue-50 border-r-2 border-rzp-blue' : 'text-text-muted hover:bg-gray-50 hover:text-text-main border-r-2 border-transparent'}`}
                        >
                            {t}
                        </button>
                    ))}
                </nav>
                <div className="p-6 border-t border-border">
                    <Badge status="INFO"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-2 animate-pulse"></span>SYNTHETIC DEMO</Badge>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Topbar */}
                <header className="h-16 bg-white border-b border-border flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
                    <div className="flex items-center">
                        {selectedCaseId ? (
                            <div className="flex items-center text-sm font-medium text-text-muted">
                                <span className="cursor-pointer hover:text-text-main" onClick={() => setSelectedCaseId(null)}>Opportunities</span>
                                <Icon name="chevron-right" size={16} className="mx-2" />
                                <span className="text-text-main font-mono">{selectedCaseId.substring(0,8)}</span>
                            </div>
                        ) : (
                            <h2 className="text-lg font-semibold text-text-main">{currentTab}</h2>
                        )}
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="relative">
                            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input type="text" placeholder="Search cases..." className="pl-9 pr-4 py-1.5 border border-border rounded text-sm bg-gray-50 focus:bg-white focus:outline-none focus:border-rzp-blue focus:ring-1 focus:ring-rzp-blue transition-colors w-64" />
                        </div>
                        <div className="w-px h-6 bg-border"></div>
                        <button 
                            onClick={() => { setDemoMode(!demoMode); setDemoIndex(0); }}
                            className={`flex items-center space-x-2 text-sm font-medium px-3 py-1.5 border rounded transition-colors ${demoMode ? 'bg-blue-50 border-rzp-blue text-rzp-blue' : 'bg-gray-50 border-border text-text-muted hover:bg-gray-100'}`}
                        >
                            <span className={`w-2 h-2 rounded-full ${demoMode ? 'bg-rzp-blue animate-pulse' : 'bg-gray-400'}`}></span>
                            <span>{demoMode ? 'LIVE DEMO ●' : 'LIVE DEMO'}</span>
                        </button>
                        <div className="flex items-center space-x-2 text-sm text-text-muted font-medium bg-gray-50 px-3 py-1.5 border border-border rounded">
                            <span>Synthetic</span>
                        </div>
                        <button className="text-text-muted hover:text-text-main p-1.5 rounded hover:bg-gray-100 transition-colors">
                            <Icon name="settings" size={20} />
                        </button>
                    </div>
                </header>

                {/* Main Scrollable Area */}
                <main className="flex-1 overflow-y-auto p-6 bg-background">
                    {selectedCaseId ? (
                        <CaseDetail caseData={cases.find(c => c.id === selectedCaseId)} onBack={() => setSelectedCaseId(null)} />
                    ) : (
                        <>
                            {currentTab === 'Command Center' && <CommandCenter metrics={metrics} auditLog={auditLog} onViewCase={viewCase} />}
                            {currentTab === 'Opportunities' && <Opportunities cases={cases} onViewCase={viewCase} />}
                            {currentTab === 'Cases' && <Opportunities cases={cases} onViewCase={viewCase} />}
                            {currentTab === 'Recovery' && <Recovery metrics={metrics} />}
                            {currentTab === 'Safety' && <SafetyCenter cases={cases} />}
                            {currentTab === 'Analytics' && <Analytics metrics={metrics} />}
                            {currentTab === 'Audit Log' && <AuditLog auditLog={auditLog} onViewCase={viewCase} />}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
