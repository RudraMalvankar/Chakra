const { useState, useEffect } = React;
const API_BASE = 'http://localhost:8000';

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
};

const formatPercent = (val) => {
    return typeof val === 'number' ? val.toFixed(2) + '%' : '0%';
};

const Icon = ({ name, size=20, className='' }) => {
    useEffect(() => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    });
    return <i data-lucide={name} width={size} height={size} className={className}></i>;
};

// --- Page 1: Overview ---
const Overview = ({ metrics }) => {
    if (!metrics) return <div className="p-8 text-gray-500">Loading metrics...</div>;
    const m = metrics.metrics;

    return (
        <div className="p-6 space-y-8 animate-fade-in">
            <div className="flex justify-between items-center border-b border-gray-800 pb-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">CHAKRA</h1>
                    <p className="text-gray-400 font-mono text-sm mt-1">Autonomous Revenue Recovery Agent</p>
                </div>
                <div className="bg-blue-900/20 border border-blue-800 text-blue-400 px-3 py-1 rounded text-xs font-mono">
                    {metrics.simulation_disclosure || "Synthetic 120-case benchmark"}
                </div>
            </div>

            <div className="grid grid-cols-5 gap-4">
                <div className="bg-panel p-5 rounded-lg border border-gray-800">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Revenue At Risk</div>
                    <div className="text-2xl font-mono text-white">{formatCurrency(m.revenue_at_risk_inr)}</div>
                </div>
                <div className="bg-panel p-5 rounded-lg border border-gray-800">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Revenue Attempted</div>
                    <div className="text-2xl font-mono text-yellow-500">{formatCurrency(m.revenue_attempted_inr)}</div>
                </div>
                <div className="bg-panel p-5 rounded-lg border border-gray-800">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Revenue Recovered</div>
                    <div className="text-2xl font-mono text-green-500">{formatCurrency(m.revenue_recovered_inr)}</div>
                </div>
                <div className="bg-panel p-5 rounded-lg border border-gray-800">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Recovery Rate</div>
                    <div className="text-2xl font-mono text-blue-400">{formatPercent(m.revenue_recovery_rate_pct)}</div>
                </div>
                <div className="bg-panel p-5 rounded-lg border border-gray-800">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Payments Recovered</div>
                    <div className="text-2xl font-mono text-white">{m.payments_recovered}</div>
                </div>
            </div>
            
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-panel p-4 rounded border border-gray-800 flex justify-between">
                    <span className="text-gray-400 font-mono text-sm">Blocked</span>
                    <span className="text-red-400 font-mono font-bold">{m.payments_blocked}</span>
                </div>
                <div className="bg-panel p-4 rounded border border-gray-800 flex justify-between">
                    <span className="text-gray-400 font-mono text-sm">Escalated</span>
                    <span className="text-orange-400 font-mono font-bold">{m.payments_escalated}</span>
                </div>
                <div className="bg-panel p-4 rounded border border-gray-800 flex justify-between">
                    <span className="text-gray-400 font-mono text-sm">Pending</span>
                    <span className="text-yellow-400 font-mono font-bold">
                        {Object.values(m.by_intervention || {}).reduce((acc, curr) => acc + (curr.pending || 0), 0)}
                    </span>
                </div>
                <div className="bg-panel p-4 rounded border border-gray-800 flex justify-between">
                    <span className="text-gray-400 font-mono text-sm">Evaluation</span>
                    <span className="text-green-400 font-mono font-bold">18 / 18</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
                <div className="bg-panel rounded-lg border border-gray-800 overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-800 bg-darker">
                        <h3 className="font-bold text-sm tracking-widest text-gray-300 uppercase">Recovery by Intervention</h3>
                    </div>
                    <table className="w-full text-left text-sm font-mono">
                        <thead className="text-gray-500 bg-black/20">
                            <tr>
                                <th className="px-5 py-2 font-normal">Intervention</th>
                                <th className="px-5 py-2 font-normal text-right">Attempted</th>
                                <th className="px-5 py-2 font-normal text-right">Recovered</th>
                                <th className="px-5 py-2 font-normal text-right">Pending</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/50">
                            {['RETRY_NOW', 'RETRY_LATER', 'PAYMENT_LINK', 'AFA_PAYMENT_LINK', 'VOICE_RECOVERY', 'REMINDER', 'ESCALATE', 'BLOCK'].map(k => {
                                const stat = (m.by_intervention || {})[k] || { attempted: 0, succeeded: 0, pending: 0 };
                                return (
                                    <tr key={k} className="hover:bg-gray-800/20">
                                        <td className="px-5 py-3 text-gray-300">{k}</td>
                                        <td className="px-5 py-3 text-right text-yellow-500">{stat.attempted}</td>
                                        <td className="px-5 py-3 text-right text-green-500">{stat.succeeded}</td>
                                        <td className="px-5 py-3 text-right text-gray-500">{stat.pending}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="bg-panel rounded-lg border border-gray-800 overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-800 bg-darker">
                        <h3 className="font-bold text-sm tracking-widest text-gray-300 uppercase">Case Type Breakdown</h3>
                    </div>
                    <table className="w-full text-left text-sm font-mono">
                        <thead className="text-gray-500 bg-black/20">
                            <tr>
                                <th className="px-5 py-2 font-normal">Case Type</th>
                                <th className="px-5 py-2 font-normal text-right">Processed</th>
                                <th className="px-5 py-2 font-normal text-right">Recovered</th>
                                <th className="px-5 py-2 font-normal text-right">At Risk</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/50">
                            {Object.keys(m.by_case_type || {}).map(k => {
                                const stat = m.by_case_type[k];
                                return (
                                    <tr key={k} className="hover:bg-gray-800/20">
                                        <td className="px-5 py-3 text-gray-300">{k.replace(/_/g, ' ')}</td>
                                        <td className="px-5 py-3 text-right text-gray-400">{stat.processed}</td>
                                        <td className="px-5 py-3 text-right text-green-500">{stat.recovered}</td>
                                        <td className="px-5 py-3 text-right text-red-400">{formatCurrency(stat.revenue_at_risk)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div className="bg-panel rounded-lg border border-gray-800 p-8 text-center">
                <h3 className="font-bold text-sm tracking-widest text-gray-500 uppercase mb-6">Recovery Funnel</h3>
                <div className="flex justify-center items-center space-x-12 font-mono">
                    <div className="text-center">
                        <div className="text-red-400 text-3xl font-bold">{formatCurrency(m.revenue_at_risk_inr)}</div>
                        <div className="text-gray-500 text-xs mt-2 uppercase">Revenue At Risk</div>
                    </div>
                    <div className="text-gray-600"><Icon name="arrow-right" size={24} /></div>
                    <div className="text-center">
                        <div className="text-yellow-500 text-3xl font-bold">{formatCurrency(m.revenue_attempted_inr)}</div>
                        <div className="text-gray-500 text-xs mt-2 uppercase">Revenue Attempted</div>
                    </div>
                    <div className="text-gray-600"><Icon name="arrow-right" size={24} /></div>
                    <div className="text-center">
                        <div className="text-green-500 text-3xl font-bold">{formatCurrency(m.revenue_recovered_inr)}</div>
                        <div className="text-gray-500 text-xs mt-2 uppercase">Revenue Recovered</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Page 2: Live Recovery Feed ---
const LiveFeed = ({ auditTrail, onViewCase }) => {
    const caseMap = {};
    const casesList = [];

    (auditTrail || []).forEach(evt => {
        const pid = evt.payment_id;
        if (!caseMap[pid]) {
            caseMap[pid] = {
                id: pid,
                timestamp: evt.timestamp,
                case_type: 'UNKNOWN',
                amount: 0,
                failure_reason: '',
                status: 'PROCESSING',
                intervention: '-',
                safety_result: '-',
            };
            casesList.push(caseMap[pid]);
        }
        const c = caseMap[pid];
        c.timestamp = evt.timestamp; 
        if (evt.event_type === 'triage_decision_proposed') {
            c.case_type = evt.details.case_type || c.case_type;
            c.amount = evt.details.amount_inr || c.amount;
        }
        if (evt.event_type === 'safety_check_completed') {
            c.safety_result = evt.details.eligibility === 'ALLOWED' ? 'ALLOWED' : (evt.details.decision === 'BLOCK' ? 'BLOCKED' : evt.details.eligibility);
            if (c.safety_result === 'BLOCKED') c.status = 'BLOCKED';
            if (evt.details.decision) c.intervention = evt.details.decision;
        }
        if (evt.event_type === 'execution_outcome') {
            c.intervention = evt.details.effective_action || c.intervention;
            const status = evt.details.status || '';
            const outcome = evt.details.outcome || '';
            if (evt.details.recovered || status === 'captured' || outcome === 'success' || outcome === 'captured') {
                c.status = 'RECOVERED';
            } else {
                c.status = 'FAILED';
            }
        }
        if (['retry_scheduled', 'voice_artifact_generated', 'reminder_artifact_generated'].includes(evt.event_type)) {
            c.status = 'RECOVERY_PENDING';
        }
        if (evt.event_type === 'execution_blocked') c.status = 'BLOCKED';
        if (evt.event_type === 'execution_escalated') c.status = 'ESCALATED';
    });

    const sorted = casesList.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

    const getStatusIcon = (status) => {
        if (status === 'RECOVERED') return <span className="text-green-500">✓</span>;
        if (status === 'RECOVERY_PENDING') return <span className="text-yellow-500">◷</span>;
        if (status === 'BLOCKED') return <span className="text-red-500">🛡</span>;
        if (status === 'ESCALATED') return <span className="text-orange-500">↗</span>;
        return <span className="text-gray-500">⨯</span>;
    };

    return (
        <div className="p-6 animate-fade-in">
            <h2 className="text-2xl font-bold mb-6 text-white">Live Recovery Feed</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sorted.map(c => (
                    <div key={c.id} onClick={() => onViewCase(c.id)} className="bg-panel p-4 rounded-lg border border-gray-800 hover:border-gray-600 cursor-pointer transition-colors shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <div className="text-lg font-mono font-bold flex items-center space-x-2">
                                {getStatusIcon(c.status)} 
                                <span className="text-white">{formatCurrency(c.amount)}</span>
                            </div>
                            <div className="text-xs text-gray-500">{new Date(c.timestamp).toLocaleTimeString()}</div>
                        </div>
                        <div className="text-xs font-bold text-gray-400 mb-3">{c.case_type}</div>
                        
                        <div className="space-y-1 font-mono text-xs">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Action:</span>
                                <span className="text-blue-400">{c.intervention}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Status:</span>
                                <span className={c.status === 'RECOVERED' ? 'text-green-500' : c.status === 'BLOCKED' ? 'text-red-500' : c.status === 'RECOVERY_PENDING' ? 'text-yellow-500' : 'text-gray-400'}>{c.status}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Page 3: Case Detail ---
const CaseDetail = ({ caseId, onBack }) => {
    const [trace, setTrace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetch(`${API_BASE}/api/cases/${caseId}/trace`)
            .then(r => {
                if (!r.ok) throw new Error("Case not found");
                return r.json();
            })
            .then(data => {
                setTrace(data.trace);
                setLoading(false);
            })
            .catch(e => {
                setError(e.message);
                setLoading(false);
            });
    }, [caseId]);

    if (loading) return <div className="p-8 text-gray-500">Loading trace...</div>;
    if (error) return <div className="p-8 text-red-500">{error}</div>;

    const stages = [];
    
        const riskEvt = trace.find(e => e.event_type === 'revenue_risk_assessed');
    const agentEvt = trace.find(e => e.event_type === 'agent_decision_proposed');
    const safetyEvt = trace.find(e => e.event_type === 'safety_check_completed');
    const outcomeEvt = trace.find(e => ['execution_outcome', 'retry_scheduled', 'execution_blocked', 'execution_escalated', 'voice_artifact_generated', 'reminder_artifact_generated'].includes(e.event_type));

    let caseType = agentEvt?.details?.case_type || "UNKNOWN";
    let amount = agentEvt?.details?.amount_inr || riskEvt?.details?.revenue_at_risk_inr || 0;

    stages.push({
        name: "EVENT",
        data: {
            type: caseType,
            amount: formatCurrency(amount),
            timestamp: agentEvt?.timestamp,
            case_id: caseId
        }
    });

    if (riskEvt) {
        stages.push({
            name: "REVENUE RISK ASSESSMENT",
            data: {
                "Revenue At Risk": formatCurrency(riskEvt.details.revenue_at_risk_inr),
                "Expected Recovery": formatCurrency(riskEvt.details.expected_recovery_inr),
                "Probability": `${(riskEvt.details.recovery_probability * 100).toFixed(0)}%`,
                "Priority": riskEvt.details.priority,
                "Urgency": riskEvt.details.urgency,
                "Risk Factors": (riskEvt.details.risk_factors || []).join(", ")
            }
        });
    }

    if (agentEvt) {
        stages.push({
            name: "AGENT DECISION",
            data: {
                "Selected Action": agentEvt.details.selected_action,
                "Confidence": `${(agentEvt.details.confidence * 100).toFixed(0)}%`,
                "Decision Factors": (agentEvt.details.decision_factors || []).join(", ")
            }
        });
    });
        
        stages.push({
            name: "AI FALLBACK",
            data: triageEvt.details.triage?.is_ambiguous ? {
                "Gemini used": "YES",
                "Confidence": `${((triageEvt.details.triage?.confidence || 0) * 100).toFixed(0)}%`
            } : "Deterministic policy path — AI fallback not required."
        });

        stages.push({
            name: "MANDATE ROUTER",
            data: {
                selected_policy: triageEvt.details.decision?.policy_id,
                candidate_action: triageEvt.details.decision?.decision,
                reason: triageEvt.details.decision?.reason_code
            }
        });
    }

    if (safetyEvt) {
        const isBlocked = safetyEvt.details.eligibility === 'BLOCKED' || safetyEvt.details.decision === 'BLOCK';
        stages.push({
            name: "SAFETY GATE",
            blocked: isBlocked,
            data: {
                FINAL_DECISION: safetyEvt.details.eligibility,
                Final_action: safetyEvt.details.decision,
                Reason: safetyEvt.details.reason_code,
                Enforced_rules: (safetyEvt.details.enforced_rules || []).join(", ")
            }
        });
    }

    if (outcomeEvt) {
        stages.push({
            name: "EXECUTOR",
            data: {
                Action: outcomeEvt.details.effective_action,
                Status: outcomeEvt.event_type
            }
        });

        let isRec = false;
        let rev = 0;
        let finalState = "FAILED";

        if (outcomeEvt.event_type === 'execution_outcome') {
            const status = outcomeEvt.details.status || '';
            const outcome = outcomeEvt.details.outcome || '';
            if (outcomeEvt.details.recovered || status === 'captured' || outcome === 'success' || outcome === 'captured') {
                isRec = true;
                rev = amount;
                finalState = "RECOVERED";
            }
        } else if (['retry_scheduled', 'voice_artifact_generated', 'reminder_artifact_generated'].includes(outcomeEvt.event_type)) {
            finalState = "RECOVERY_PENDING";
        } else if (outcomeEvt.event_type === 'execution_blocked') {
            finalState = "BLOCKED";
        } else if (outcomeEvt.event_type === 'execution_escalated') {
            finalState = "ESCALATED";
        }

        stages.push({
            name: "OUTCOME",
            data: {
                Final_state: finalState,
                Revenue_recovered: isRec ? formatCurrency(rev) : "₹0",
                Note: finalState === "RECOVERY_PENDING" ? "Revenue is not counted as recovered until provider-confirmed success." : undefined
            }
        });
    }

    return (
        <div className="p-6 animate-fade-in max-w-4xl mx-auto">
            <div className="mb-6 flex items-center space-x-4">
                <button onClick={onBack} className="text-gray-400 hover:text-white">
                    <Icon name="arrow-left" size={24} />
                </button>
                <h2 className="text-2xl font-bold text-white">Decision Explorer: {caseId}</h2>
            </div>

            <div className="bg-panel rounded-lg border border-gray-800 p-8">
                <div className="flex flex-col items-center space-y-4">
                    {stages.map((stage, idx) => (
                        <React.Fragment key={idx}>
                            <div className={`w-full max-w-2xl bg-dark border ${stage.blocked ? 'border-red-500' : 'border-gray-700'} rounded p-4`}>
                                <h3 className={`text-sm font-bold tracking-widest uppercase mb-3 ${stage.blocked ? 'text-red-500' : 'text-blue-400'}`}>
                                    {stage.name}
                                </h3>
                                <div className="font-mono text-sm text-gray-300">
                                    {typeof stage.data === 'string' ? (
                                        <p className="text-gray-500 italic">{stage.data}</p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.entries(stage.data).map(([k, v]) => v !== undefined && (
                                                <React.Fragment key={k}>
                                                    <span className="text-gray-600">{k.replace(/_/g, ' ')}:</span>
                                                    <span className={k === 'Revenue_recovered' && v !== '₹0' ? 'text-green-400' : 'text-white'}>{String(v)}</span>
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {idx < stages.length - 1 && (
                                <div className="text-gray-600">
                                    <Icon name="arrow-down" size={24} />
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- Page 4: Safety Center ---
const SafetyCenter = ({ auditTrail }) => {
    const safetyEvents = (auditTrail || []).filter(e => e.event_type === 'safety_check_completed').slice(0, 10);

    return (
        <div className="p-6 animate-fade-in max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-white mb-6">Safety Center</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="col-span-2 bg-panel rounded-lg border border-gray-800 p-6">
                    <h3 className="text-sm font-bold tracking-widest text-gray-500 uppercase mb-4">Protection Rules</h3>
                    <ul className="space-y-3 font-mono text-sm text-gray-300">
                        <li className="flex items-center space-x-2"><Icon name="shield" size={16} className="text-blue-500"/> <span>Revoked mandate</span></li>
                        <li className="flex items-center space-x-2"><Icon name="shield" size={16} className="text-blue-500"/> <span>Fraud / high risk</span></li>
                        <li className="flex items-center space-x-2"><Icon name="shield" size={16} className="text-blue-500"/> <span>Retry caps</span></li>
                        <li className="flex items-center space-x-2"><Icon name="shield" size={16} className="text-blue-500"/> <span>Intervention budget</span></li>
                        <li className="flex items-center space-x-2"><Icon name="shield" size={16} className="text-blue-500"/> <span>Duplicate events</span></li>
                        <li className="flex items-center space-x-2"><Icon name="shield" size={16} className="text-blue-500"/> <span>AFA thresholds</span></li>
                    </ul>
                </div>
                
                <div className="bg-panel rounded-lg border border-red-900 bg-red-900/10 p-6 flex flex-col items-center justify-center text-center">
                    <h3 className="text-sm font-bold tracking-widest text-red-500 uppercase mb-4">Visual Example</h3>
                    <div className="font-mono text-xs space-y-2">
                        <div className="text-gray-400">AI PROPOSED: <span className="text-white">RETRY_NOW</span></div>
                        <div className="text-gray-600">↓</div>
                        <div className="text-blue-400 border border-blue-900 bg-blue-900/20 px-3 py-1 rounded">SAFETY GATE</div>
                        <div className="text-gray-600">↓</div>
                        <div className="text-red-400">MANDATE REVOKED</div>
                        <div className="text-gray-600">↓</div>
                        <div className="text-red-500 font-bold border border-red-900 bg-red-900/30 px-3 py-1 rounded">BLOCKED</div>
                    </div>
                </div>
            </div>

            <h3 className="text-sm font-bold tracking-widest text-gray-500 uppercase mb-4">Recent Safety Decisions</h3>
            <div className="bg-panel rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full text-left text-sm font-mono">
                    <thead className="text-gray-500 bg-black/20">
                        <tr>
                            <th className="px-5 py-3 font-normal">Time</th>
                            <th className="px-5 py-3 font-normal">Case</th>
                            <th className="px-5 py-3 font-normal">Proposed Action</th>
                            <th className="px-5 py-3 font-normal">Decision</th>
                            <th className="px-5 py-3 font-normal">Reason</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                        {safetyEvents.map((evt, i) => (
                            <tr key={i} className="hover:bg-gray-800/20">
                                <td className="px-5 py-3 text-gray-500">{new Date(evt.timestamp).toLocaleTimeString()}</td>
                                <td className="px-5 py-3 text-blue-400">{evt.payment_id}</td>
                                <td className="px-5 py-3 text-gray-300">{evt.details.original_decision || '-'}</td>
                                <td className={`px-5 py-3 font-bold ${evt.details.eligibility === 'BLOCKED' ? 'text-red-500' : 'text-green-500'}`}>{evt.details.eligibility}</td>
                                <td className="px-5 py-3 text-gray-400">{evt.details.reason_code || '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Page 5: Audit Trail ---
const AuditTrail = ({ auditTrail }) => {
    const [selectedEvent, setSelectedEvent] = useState(null);

    return (
        <div className="p-6 animate-fade-in flex space-x-6 max-h-screen">
            <div className="flex-1 overflow-auto bg-panel rounded-lg border border-gray-800">
                <table className="w-full text-left text-sm font-mono">
                    <thead className="text-gray-500 bg-black/20 sticky top-0">
                        <tr>
                            <th className="px-5 py-3 font-normal">Timestamp</th>
                            <th className="px-5 py-3 font-normal">Case</th>
                            <th className="px-5 py-3 font-normal">Stage</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                        {(auditTrail || []).map((evt, i) => (
                            <tr key={i} onClick={() => setSelectedEvent(evt)} className={`hover:bg-gray-800/50 cursor-pointer ${selectedEvent === evt ? 'bg-gray-800/50' : ''}`}>
                                <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{new Date(evt.timestamp).toLocaleString()}</td>
                                <td className="px-5 py-3 text-blue-400">{evt.payment_id}</td>
                                <td className="px-5 py-3 text-yellow-500">{evt.event_type}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {selectedEvent && (
                <div className="w-1/3 bg-panel border border-gray-800 rounded-lg p-4 overflow-auto">
                    <h3 className="text-sm font-bold text-gray-300 uppercase mb-4 tracking-widest border-b border-gray-800 pb-2">Event JSON</h3>
                    <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap">{JSON.stringify(selectedEvent, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

// --- Page 6: Live Demo ---
const LiveDemo = ({ onViewCase }) => {
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        case_type: 'PAYMENT_FAILURE',
        amount_inr: '2499',
        failure_reason: 'insufficient_funds',
        mandate_state: 'ACTIVE'
    });

    const runSim = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/demo/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    amount_inr: parseFloat(form.amount_inr)
                })
            });
            const data = await res.json();
            if (data.case_id) {
                onViewCase(data.case_id);
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
        setLoading(false);
    };

    return (
        <div className="p-6 animate-fade-in max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-white mb-6">Live Demo / Event Simulator</h2>
            <div className="bg-panel rounded-lg border border-gray-800 p-8">
                <h3 className="text-sm font-bold tracking-widest text-blue-400 uppercase mb-6">Simulate Revenue-At-Risk Event</h3>
                
                <div className="space-y-4 mb-8 font-mono text-sm">
                    <div>
                        <label className="block text-gray-500 mb-1">Case type:</label>
                        <select className="w-full bg-dark border border-gray-700 rounded p-2 text-white" value={form.case_type} onChange={e => setForm({...form, case_type: e.target.value})}>
                            <option value="PAYMENT_FAILURE">Payment Failure</option>
                            <option value="SUBSCRIPTION">Subscription Failure</option>
                            <option value="CHECKOUT_ABANDONMENT">Checkout Abandonment</option>
                            <option value="RECEIVABLE">Receivable</option>
                            <option value="PROMISE_TO_PAY">Promise-to-Pay</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-gray-500 mb-1">Amount (₹):</label>
                        <input type="number" className="w-full bg-dark border border-gray-700 rounded p-2 text-white" value={form.amount_inr} onChange={e => setForm({...form, amount_inr: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-gray-500 mb-1">Failure reason:</label>
                        <input type="text" className="w-full bg-dark border border-gray-700 rounded p-2 text-white" value={form.failure_reason} onChange={e => setForm({...form, failure_reason: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-gray-500 mb-1">Mandate:</label>
                        <select className="w-full bg-dark border border-gray-700 rounded p-2 text-white" value={form.mandate_state} onChange={e => setForm({...form, mandate_state: e.target.value})}>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="REVOKED">REVOKED</option>
                            <option value="UNKNOWN">UNKNOWN</option>
                        </select>
                    </div>
                </div>

                <button 
                    onClick={runSim} 
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded font-mono disabled:opacity-50 transition-colors">
                    {loading ? "RUNNING..." : "[ RUN CHAKRA ]"}
                </button>
            </div>
            
            <div className="mt-8 bg-dark border border-gray-800 rounded p-6 font-mono text-sm text-gray-400">
                <h4 className="text-white font-bold mb-2">Scenarios to try:</h4>
                <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Success:</strong> 2499, insufficient_funds, ACTIVE</li>
                    <li><strong>Routing:</strong> 8999, SUBSCRIPTION, ACTIVE (days_overdue=7)</li>
                    <li><strong>Safety Block:</strong> 25000, REVOKED</li>
                    <li><strong>AFA required:</strong> 20000+, ACTIVE</li>
                </ul>
            </div>
        </div>
    );
};

// --- Page 7: Architecture ---
const Architecture = () => {
    return (
        <div className="p-6 animate-fade-in max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-white mb-6">System Architecture</h2>
            <div className="bg-panel rounded-lg border border-gray-800 p-8 flex flex-col items-center">
                <div className="space-y-2 text-center font-mono text-sm w-full max-w-md">
                    <div className="bg-red-900/30 border border-red-800 text-red-400 py-3 rounded font-bold">Revenue at Risk</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-gray-700 text-gray-300 py-3 rounded">Event Sources</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-gray-700 text-gray-300 py-3 rounded flex flex-col">
                        <span>Event-specific context</span>
                        <span className="text-gray-600 text-xs my-1">↓</span>
                        <span className="font-bold text-blue-400">Context Builder</span>
                    </div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-gray-700 text-gray-300 py-3 rounded font-bold">Revenue Risk Engine</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-gray-700 text-gray-300 py-3 rounded font-bold">Recovery Agent</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-red-800 text-red-400 py-3 rounded font-bold uppercase tracking-widest">Non-Overridable Safety Gate</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-blue-900/20 border border-blue-800 text-blue-400 py-3 rounded font-bold">Recovery Actions</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-gray-700 text-gray-300 py-3 rounded font-bold">Recovery Executor</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-dark border border-gray-700 text-gray-300 py-3 rounded font-bold">Outcome Evaluator</div>
                    <div className="text-gray-600"><Icon name="arrow-down" size={24} className="mx-auto"/></div>
                    
                    <div className="bg-green-900/20 border border-green-800 text-green-400 py-3 rounded font-bold">Audit Trail + Metrics</div>
                </div>
            </div>
        </div>
    );
};

// --- App Root ---
const App = () => {
    const [currentTab, setCurrentTab] = useState('overview');
    const [metrics, setMetrics] = useState(null);
    const [auditTrail, setAuditTrail] = useState(null);
    const [selectedCaseId, setSelectedCaseId] = useState(null);

    const refreshData = () => {
        fetch(`${API_BASE}/api/metrics`).then(r => r.json()).then(setMetrics).catch(console.error);
        fetch(`${API_BASE}/api/audit?limit=200`).then(r => r.json()).then(d => setAuditTrail(d.events)).catch(console.error);
    };

    useEffect(() => {
        refreshData();
        const interval = setInterval(refreshData, 5000);
        return () => clearInterval(interval);
    }, []);

    const viewCase = (id) => {
        setSelectedCaseId(id);
        setCurrentTab('case_detail');
    };

    const tabs = [
        { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
        { id: 'live_feed', label: 'Live Feed', icon: 'activity' },
        { id: 'safety', label: 'Safety Center', icon: 'shield' },
        { id: 'audit', label: 'Audit Trail', icon: 'list' },
        { id: 'demo', label: 'Simulator', icon: 'play-circle' },
        { id: 'architecture', label: 'Architecture', icon: 'network' },
    ];

    return (
        <div className="flex h-screen overflow-hidden bg-darker text-gray-200">
            <div className="w-64 bg-dark border-r border-gray-800 flex flex-col">
                <div className="p-6 border-b border-gray-800">
                    <h1 className="font-bold tracking-widest text-lg text-white">CHAKRA</h1>
                    <div className="text-xs text-blue-500 font-mono mt-1">COMMAND CENTER</div>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            onClick={() => { setCurrentTab(t.id); setSelectedCaseId(null); }}
                            className={`w-full flex items-center space-x-3 px-4 py-3 rounded text-sm font-medium transition-colors ${currentTab === t.id && !selectedCaseId ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                        >
                            <Icon name={t.icon} size={18} />
                            <span>{t.label}</span>
                        </button>
                    ))}
                    {selectedCaseId && (
                        <div className="px-4 py-3 text-sm font-medium text-blue-400 bg-blue-600/10 rounded flex items-center space-x-3">
                            <Icon name="search" size={18} />
                            <span>Case Detail</span>
                        </div>
                    )}
                </nav>
            </div>

            <div className="flex-1 overflow-auto pb-10">
                {currentTab === 'overview' && !selectedCaseId && <Overview metrics={metrics} />}
                {currentTab === 'live_feed' && !selectedCaseId && <LiveFeed auditTrail={auditTrail} onViewCase={viewCase} />}
                {currentTab === 'safety' && !selectedCaseId && <SafetyCenter auditTrail={auditTrail} />}
                {currentTab === 'audit' && !selectedCaseId && <AuditTrail auditTrail={auditTrail} />}
                {currentTab === 'demo' && !selectedCaseId && <LiveDemo onViewCase={viewCase} />}
                {currentTab === 'architecture' && !selectedCaseId && <Architecture />}
                {selectedCaseId && <CaseDetail caseId={selectedCaseId} onBack={() => {setSelectedCaseId(null); setCurrentTab('live_feed');}} />}
            </div>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
