const { useState } = React;

// --- Page 1: Command Center ---
const CommandCenter = ({ metrics, auditLog, cases, onViewCase }) => {
    if (!metrics) return null;
    
    const sortedEvents = [...auditLog].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 15);
    const m = metrics;
    
    const opportunities = cases.filter(c => c.status === 'PENDING' || c.status === 'RECOVERY_PENDING').length;
    const highPriority = cases.filter(c => c.risk?.priority === 'HIGH').length;

    return (
        <div className="space-y-6">
            <div className="bg-white border border-border shadow-sm">
                <div className="p-6 border-b border-border bg-gray-50">
                    <h2 className="text-lg font-bold text-text-main">REVENUE RECOVERY</h2>
                </div>
                
                <div className="p-8 grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Revenue at Risk</div>
                        <div className="text-3xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_at_risk_inr)}</div>
                    </div>
                    <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Recovered</div>
                        <div className="text-3xl font-bold text-rzp-green font-mono">{formatCurrency(m.revenue_recovered_inr)}</div>
                    </div>
                    <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Recovery Rate</div>
                        <div className="text-3xl font-bold text-rzp-blue font-mono">{formatPercent(m.revenue_recovery_rate_pct)}</div>
                    </div>
                    <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Expected Recovery</div>
                        <div className="text-3xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_attempted_inr)}</div>
                    </div>
                </div>
                
                <div className="grid grid-cols-4 border-t border-border bg-gray-50 text-sm">
                    <div className="p-4 border-r border-border text-center">
                        <span className="text-text-muted mr-2">Recovery Attempted</span>
                        <span className="font-mono font-medium">{formatCurrency(m.revenue_attempted_inr)}</span>
                    </div>
                    <div className="p-4 border-r border-border text-center">
                        <span className="text-text-muted mr-2">Blocked</span>
                        <span className="font-mono font-medium text-rzp-red">{formatCurrency(m.revenue_blocked_inr)}</span>
                    </div>
                    <div className="p-4 border-r border-border text-center">
                        <span className="text-text-muted mr-2">Escalated</span>
                        <span className="font-mono font-medium text-orange-500">{formatCurrency(m.revenue_escalated_inr)}</span>
                    </div>
                    <div className="p-4 text-center">
                        <span className="text-text-muted mr-2">Interventions Succeeded</span>
                        <span className="font-mono font-medium text-rzp-green">{m.payments_recovered}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white border border-border shadow-sm p-6">
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-6">Recovery Funnel</h3>
                        <div className="flex justify-between items-center px-4">
                            <div className="text-center w-1/4">
                                <div className="text-xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_at_risk_inr)}</div>
                                <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">At Risk</div>
                            </div>
                            <Icon name="arrow-right" className="text-gray-300" size={16} />
                            <div className="text-center w-1/4">
                                <div className="text-xl font-bold text-rzp-blue font-mono">{formatCurrency(m.revenue_at_risk_inr - m.revenue_blocked_inr - m.revenue_escalated_inr)}</div>
                                <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Eligible</div>
                            </div>
                            <Icon name="arrow-right" className="text-gray-300" size={16} />
                            <div className="text-center w-1/4">
                                <div className="text-xl font-bold text-yellow-600 font-mono">{formatCurrency(m.revenue_attempted_inr)}</div>
                                <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Attempted</div>
                            </div>
                            <Icon name="arrow-right" className="text-gray-300" size={16} />
                            <div className="text-center w-1/4">
                                <div className="text-xl font-bold text-rzp-green font-mono">{formatCurrency(m.revenue_recovered_inr)}</div>
                                <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Recovered</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Live Activity</h3>
                        </div>
                        <div className="divide-y divide-border h-80 overflow-y-auto">
                            {sortedEvents.map((ev, i) => (
                                <div key={i} className="px-6 py-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between" onClick={() => onViewCase(ev.payment_id)}>
                                    <div className="flex items-center space-x-4">
                                        <span className="text-xs text-text-light w-20 font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                        <span className="text-sm font-medium text-rzp-blue w-24 font-mono">{ev.payment_id.substring(0,8)}</span>
                                        <span className="text-sm text-text-main w-56 truncate">{ev.event_type.replace(/_/g, ' ')}</span>
                                    </div>
                                    <div className="text-sm font-mono text-text-muted truncate w-48 text-right">
                                        {ev.event_type === 'revenue_risk_assessed' ? `${formatCurrency(ev.details.revenue_at_risk_inr)}` : 
                                         ev.event_type === 'execution_outcome' ? `${ev.details.status}` : 
                                         (ev.details.decision || ev.details.effective_action || ev.details.status || "-")}
                                    </div>
                                </div>
                            ))}
                            {sortedEvents.length === 0 && (
                                <div className="p-8 text-center text-text-muted text-sm">No activity recorded yet.</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Operational Summary</h3>
                        </div>
                        <div className="divide-y divide-border">
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer">
                                <span className="text-sm text-text-main">Recovery Opportunities</span>
                                <span className="font-mono font-semibold">{opportunities}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer">
                                <span className="text-sm text-text-main">High Priority Cases</span>
                                <span className="font-mono font-semibold text-rzp-red">{highPriority}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer">
                                <span className="text-sm text-text-main">Successful Recoveries</span>
                                <span className="font-mono font-semibold text-rzp-green">{m.payments_recovered}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer">
                                <span className="text-sm text-text-main">Blocked Cases</span>
                                <span className="font-mono font-semibold text-rzp-red">{m.payments_blocked}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer">
                                <span className="text-sm text-text-main">Escalated Cases</span>
                                <span className="font-mono font-semibold text-orange-500">{m.payments_escalated}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Page 2: Opportunities ---
const Opportunities = ({ cases, onViewCase }) => {
    const [priorityFilter, setPriorityFilter] = useState('All');
    const [workflowFilter, setWorkflowFilter] = useState('All');
    const [search, setSearch] = useState('');

    const opps = cases.filter(c => {
        if (priorityFilter !== 'All' && c.risk?.priority !== priorityFilter) return false;
        if (workflowFilter !== 'All' && c.type !== workflowFilter) return false;
        if (search && !c.id.includes(search)) return false;
        return c.status === 'PENDING' || c.status === 'RECOVERY_PENDING' || !c.outcome; // Only active cases conceptually
    }).sort((a,b) => {
        const expA = a.agent?.candidate_actions?.find(ca => ca.action === a.agent.selected_action)?.expected_recovery_inr || 0;
        const expB = b.agent?.candidate_actions?.find(ca => ca.action === b.agent.selected_action)?.expected_recovery_inr || 0;
        return expB - expA;
    });

    const totalAtRisk = opps.reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalExpected = opps.reduce((sum, c) => sum + (c.agent?.candidate_actions?.find(ca => ca.action === c.agent.selected_action)?.expected_recovery_inr || 0), 0);

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-full">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Recovery Opportunities</h2>
                </div>
                <div className="flex space-x-6 text-sm">
                    <div>
                        <span className="text-text-muted mr-2">Opportunities</span>
                        <span className="font-mono font-semibold text-text-main">{opps.length}</span>
                    </div>
                    <div>
                        <span className="text-text-muted mr-2">At Risk</span>
                        <span className="font-mono font-semibold text-rzp-red">{formatCurrency(totalAtRisk)}</span>
                    </div>
                    <div>
                        <span className="text-text-muted mr-2">Expected</span>
                        <span className="font-mono font-semibold text-rzp-green">{formatCurrency(totalExpected)}</span>
                    </div>
                </div>
            </div>
            
            <div className="p-4 border-b border-border flex items-center space-x-4 text-sm bg-white">
                <input type="text" placeholder="Search case ID..." value={search} onChange={e => setSearch(e.target.value)} className="border border-border rounded px-3 py-1.5 focus:outline-none focus:border-rzp-blue w-64" />
                <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white">
                    <option value="All">All Priorities</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                </select>
                <select value={workflowFilter} onChange={e => setWorkflowFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white">
                    <option value="All">All Workflows</option>
                    <option value="PAYMENT_FAILURE">PAYMENT_FAILURE</option>
                    <option value="SUBSCRIPTION">SUBSCRIPTION</option>
                    <option value="CHECKOUT_ABANDONMENT">CHECKOUT_ABANDONMENT</option>
                    <option value="RECEIVABLE">RECEIVABLE</option>
                    <option value="PROMISE_TO_PAY">PROMISE_TO_PAY</option>
                </select>
            </div>

            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted">
                        <tr>
                            <th className="px-6 py-3 font-semibold">Priority</th>
                            <th className="px-6 py-3 font-semibold">Case</th>
                            <th className="px-6 py-3 font-semibold">Workflow</th>
                            <th className="px-6 py-3 font-semibold text-right">Revenue at Risk</th>
                            <th className="px-6 py-3 font-semibold text-right">Probability</th>
                            <th className="px-6 py-3 font-semibold text-right">Expected Recovery</th>
                            <th className="px-6 py-3 font-semibold">Recommended Action</th>
                            <th className="px-6 py-3 font-semibold">Safety</th>
                            <th className="px-6 py-3 font-semibold">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {opps.map(c => {
                            const exp = c.agent?.candidate_actions?.find(ca => ca.action === c.agent.selected_action)?.expected_recovery_inr;
                            const prob = c.risk?.recovery_probability || 0;
                            return (
                                <tr key={c.id} onClick={() => onViewCase(c.id)} className="hover:bg-gray-50 cursor-pointer">
                                    <td className="px-6 py-2"><Badge status={c.risk?.priority}>{c.risk?.priority || 'UNKNOWN'}</Badge></td>
                                    <td className="px-6 py-2 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                    <td className="px-6 py-2 text-text-main text-xs">{c.type.replace(/_/g, ' ')}</td>
                                    <td className="px-6 py-2 text-right font-mono text-text-main">{formatExact(c.amount)}</td>
                                    <td className="px-6 py-2 text-right font-mono text-text-muted">{formatPercent(prob * 100)}</td>
                                    <td className="px-6 py-2 text-right font-mono font-semibold text-rzp-green">{formatExact(exp)}</td>
                                    <td className="px-6 py-2 font-mono text-xs text-text-muted">{c.agent?.selected_action || '-'}</td>
                                    <td className="px-6 py-2 text-xs">
                                        {c.safety?.eligibility === 'ALLOWED' && <span className="text-green-600 font-bold">ALLOWED</span>}
                                        {(c.safety?.eligibility === 'BLOCKED' || c.safety?.decision === 'BLOCK') && <span className="text-red-600 font-bold">BLOCKED</span>}
                                    </td>
                                    <td className="px-6 py-2"><Badge status={c.status}>{c.status}</Badge></td>
                                </tr>
                            );
                        })}
                        {opps.length === 0 && <tr><td colSpan="9" className="p-8 text-center text-text-muted">No opportunities found matching filters.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Page 3: Cases (All Cases) ---
const Cases = ({ cases, onViewCase }) => {
    const [statusFilter, setStatusFilter] = useState('All');
    
    const filteredCases = cases.filter(c => {
        if (statusFilter !== 'All' && c.status !== statusFilter) return false;
        return true;
    }).sort((a,b) => new Date(b.last_updated) - new Date(a.last_updated));

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-full">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">All Cases</h2>
            </div>
            
            <div className="p-4 border-b border-border flex items-center space-x-4 text-sm bg-white">
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white">
                    <option value="All">All Statuses</option>
                    <option value="PENDING">PENDING</option>
                    <option value="RECOVERY_PENDING">RECOVERY_PENDING</option>
                    <option value="RECOVERED">RECOVERED</option>
                    <option value="FAILED">FAILED</option>
                    <option value="BLOCKED">BLOCKED</option>
                    <option value="ESCALATED">ESCALATED</option>
                </select>
            </div>

            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted">
                        <tr>
                            <th className="px-6 py-3 font-semibold">Case</th>
                            <th className="px-6 py-3 font-semibold">Workflow</th>
                            <th className="px-6 py-3 font-semibold text-right">Amount</th>
                            <th className="px-6 py-3 font-semibold">Priority</th>
                            <th className="px-6 py-3 font-semibold">Selected Action</th>
                            <th className="px-6 py-3 font-semibold">Safety Decision</th>
                            <th className="px-6 py-3 font-semibold">Outcome</th>
                            <th className="px-6 py-3 font-semibold">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filteredCases.map(c => (
                            <tr key={c.id} onClick={() => onViewCase(c.id)} className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-6 py-2 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                <td className="px-6 py-2 text-text-main text-xs">{c.type.replace(/_/g, ' ')}</td>
                                <td className="px-6 py-2 text-right font-mono">{formatExact(c.amount)}</td>
                                <td className="px-6 py-2"><Badge status={c.risk?.priority}>{c.risk?.priority || 'UNKNOWN'}</Badge></td>
                                <td className="px-6 py-2 font-mono text-xs text-text-muted">{c.agent?.selected_action || '-'}</td>
                                <td className="px-6 py-2 text-xs font-mono">{c.safety?.eligibility || '-'}</td>
                                <td className="px-6 py-2 text-xs font-mono">{c.outcome?.status || '-'}</td>
                                <td className="px-6 py-2"><Badge status={c.status}>{c.status}</Badge></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Page 4: Case Detail ---
const CaseDetail = ({ caseData, onBack }) => {
    if (!caseData) return null;
    const c = caseData;
    const risk = c.risk || {};
    const agent = c.agent || {};
    const safety = c.safety || {};
    const outcome = c.outcome || {};

    const rankedCands = [...(agent.candidate_actions || [])].sort((a,b) => b.score - a.score);

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            <button onClick={onBack} className="text-text-muted hover:text-text-main flex items-center space-x-1 text-sm font-medium transition-colors mb-2">
                <Icon name="arrow-left" size={16} /> <span>Back to cases</span>
            </button>

            {/* Header */}
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
                
                {/* Left Column - Decision Flow */}
                <div className="lg:col-span-2 space-y-6">
                    
                    {/* Why at risk? */}
                    <div className="bg-white border border-border shadow-sm p-6">
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Why is this at risk?</h3>
                        <ul className="space-y-2">
                            {(risk.risk_factors || []).map((f, i) => (
                                <li key={i} className="flex items-start space-x-3 text-sm text-text-main">
                                    <Icon name="alert-circle" size={16} className="text-rzp-red mt-0.5 shrink-0" />
                                    <span>{f}</span>
                                </li>
                            ))}
                            {(!risk.risk_factors || risk.risk_factors.length === 0) && <li className="text-sm text-text-muted font-mono">{risk.reason || "No specific factors identified."}</li>}
                        </ul>
                    </div>

                    {/* Agent Decision */}
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
                                        {formatExact(agent.candidate_actions?.find(ca => ca.action === agent.selected_action)?.expected_recovery_inr)}
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
                                        {rankedCands.map((cand, i) => (
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

                {/* Right Column - Safety, Execution, Timeline */}
                <div className="space-y-6">
                    
                    {/* Safety Gate */}
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Safety Gate</h3>
                            {safety.eligibility === 'ALLOWED' && <span className="text-xs font-bold text-green-600">ALLOWED</span>}
                            {(safety.eligibility === 'BLOCKED' || safety.decision === 'BLOCK') && <span className="text-xs font-bold text-red-600">BLOCKED</span>}
                            {(safety.eligibility === 'ESCALATED' || safety.decision === 'ESCALATE') && <span className="text-xs font-bold text-orange-500">ESCALATED</span>}
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

                    {/* Execution */}
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
                                        <span className="font-mono text-text-main">{outcome.status || '-'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-text-muted">Provider Outcome</span>
                                        <span className="font-mono text-text-main">{outcome.raw_response?.outcome || outcome.raw_response?.status || outcome.status || '-'}</span>
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

                    {/* Audit Timeline */}
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Audit Timeline</h3>
                        </div>
                        <div className="p-6">
                            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-[5px] before:h-full before:w-px before:bg-border">
                                {c.events.map((ev, i) => (
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

// --- Page 5: Recovery ---
const Recovery = ({ metrics }) => {
    if (!metrics) return null;
    const byInt = metrics.by_intervention || {};
    
    // Sort by recovered desc
    const sortedInts = Object.keys(byInt).sort((a,b) => byInt[b].recovered_inr - byInt[a].recovered_inr);
    
    return (
        <div className="space-y-6 max-w-5xl">
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
                                            <td className="px-6 py-3 font-bold text-text-main">{k}</td>
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

// --- Page 6: Safety Center ---
const SafetyCenter = ({ cases, metrics, onViewCase }) => {
    const safetyEvents = cases.filter(c => c.safety).map(c => ({...c.safety, id: c.id, timestamp: c.last_updated})).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 50);
    
    const processed = metrics?.payments_processed || 1;
    const blockedRate = ((metrics?.payments_blocked || 0) / processed) * 100;

    return (
        <div className="space-y-6 max-w-6xl">
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
                <div className="px-6 py-5 border-b border-border bg-gray-50">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Enforced Policy Controls</h2>
                </div>
                <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {['Fraud Protection', 'Mandate Validation', 'Retry Limits', 'AFA Enforcement', 'Intervention Budget', 'Idempotency', 'Escalation Rules', 'Stopping Rules'].map(rule => (
                        <div key={rule} className="flex flex-col justify-between p-3 border border-border rounded bg-gray-50 h-20">
                            <span className="text-xs font-semibold text-text-main">{rule}</span>
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
                            {safetyEvents.map((s, i) => (
                                <tr key={i} onClick={() => onViewCase(s.id)} className="hover:bg-gray-50 cursor-pointer text-xs font-mono">
                                    <td className="px-6 py-3 text-text-muted">{new Date(s.timestamp).toLocaleTimeString()}</td>
                                    <td className="px-6 py-3 font-bold text-rzp-blue">{s.id.substring(0,8)}</td>
                                    <td className="px-6 py-3">{s.decision || '-'}</td>
                                    <td className="px-6 py-3">
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

// --- Page 7: Analytics ---
const Analytics = ({ metrics }) => {
    if (!metrics) return null;
    const m = metrics.by_case_type || {};
    
    return (
        <div className="space-y-6 max-w-5xl">
            <div className="bg-white border border-border shadow-sm">
                <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Recovery by Workflow</h2>
                    <Badge status="INFO">SYNTHETIC BENCHMARK</Badge>
                </div>
                <div className="p-8 space-y-8">
                    {Object.entries(m).map(([type, stats]) => {
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
                                        <span className="text-text-muted text-xs">/ {formatExact(stats.at_risk)}</span>
                                    </div>
                                </div>
                                <div className="w-full bg-gray-100 h-2 relative overflow-hidden">
                                    <div className="bg-rzp-blue h-2 absolute left-0 top-0 transition-all duration-500" style={{ width: `${rate}%` }}></div>
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

// --- Page 8: Audit Log ---
const AuditLog = ({ auditLog, onViewCase }) => {
    const sortedLog = [...auditLog].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return (
        <div className="bg-white border border-border shadow-sm h-full flex flex-col">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Audit Log</h2>
                    <p className="text-[10px] font-mono text-text-muted mt-1 uppercase tracking-widest">Append-Only Operational Log</p>
                </div>
                <div className="text-sm font-mono text-text-muted">{auditLog.length} events</div>
            </div>
            
            <div className="p-4 border-b border-border bg-white flex space-x-4">
                 <input type="text" placeholder="Search case ID..." className="border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-rzp-blue w-64" />
                 <select className="border border-border rounded px-3 py-1.5 text-sm">
                     <option>All Event Types</option>
                 </select>
            </div>

            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-xs whitespace-nowrap font-mono">
                    <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0">
                        <tr>
                            <th className="px-6 py-3 font-semibold">Timestamp</th>
                            <th className="px-6 py-3 font-semibold">Case</th>
                            <th className="px-6 py-3 font-semibold">Event</th>
                            <th className="px-6 py-3 font-semibold">Action / Status</th>
                            <th className="px-6 py-3 font-semibold text-right">Amount / Score</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedLog.map((ev, i) => (
                            <tr key={i} onClick={() => onViewCase(ev.payment_id)} className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-6 py-2 text-text-muted">{new Date(ev.timestamp).toISOString()}</td>
                                <td className="px-6 py-2 font-bold text-rzp-blue">{ev.payment_id.substring(0,8)}</td>
                                <td className="px-6 py-2 font-semibold text-text-main">{ev.event_type}</td>
                                <td className="px-6 py-2 text-text-muted">
                                    {ev.details.decision || ev.details.effective_action || ev.details.status || ev.details.case_type || '-'}
                                </td>
                                <td className="px-6 py-2 text-right">
                                    {ev.details.revenue_at_risk_inr ? formatExact(ev.details.revenue_at_risk_inr) : 
                                     ev.details.amount_recovered_inr ? formatExact(ev.details.amount_recovered_inr) : 
                                     ev.details.confidence ? ev.details.confidence.toFixed(2) : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
