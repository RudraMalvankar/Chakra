import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatExact, formatPercent } from '../lib/format';

export const Opportunities = ({ cases }: any) => {
    const navigate = useNavigate();
    const [priorityFilter, setPriorityFilter] = useState('All');
    const [workflowFilter, setWorkflowFilter] = useState('All');
    const [search, setSearch] = useState('');

    const opps = cases.filter((c: any) => {
        if (priorityFilter !== 'All' && c.risk?.priority !== priorityFilter) return false;
        if (workflowFilter !== 'All' && c.type !== workflowFilter) return false;
        if (search && !c.id.includes(search)) return false;
        return c.status === 'PENDING' || c.status === 'RECOVERY_PENDING' || !c.outcome;
    }).sort((a: any, b: any) => {
        const expA = a.agent?.candidate_actions?.find((ca: any) => ca.action === a.agent.selected_action)?.expected_recovery_inr || 0;
        const expB = b.agent?.candidate_actions?.find((ca: any) => ca.action === b.agent.selected_action)?.expected_recovery_inr || 0;
        return expB - expA;
    });

    const totalAtRisk = opps.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
    const totalExpected = opps.reduce((sum: number, c: any) => sum + (c.agent?.candidate_actions?.find((ca: any) => ca.action === c.agent.selected_action)?.expected_recovery_inr || 0), 0);

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-[calc(100vh-120px)] max-w-7xl mx-auto">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Recovery Opportunities</h2>
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
            
            <div className="p-4 border-b border-border flex items-center space-x-4 text-sm bg-white shrink-0">
                <input type="text" placeholder="Search case ID..." value={search} onChange={e => setSearch(e.target.value)} className="border border-border rounded px-3 py-1.5 focus:outline-none focus:border-rzp-blue w-64 font-mono" />
                <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white font-mono">
                    <option value="All">All Priorities</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                </select>
                <select value={workflowFilter} onChange={e => setWorkflowFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white font-mono">
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
                    <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0">
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
                        {opps.map((c: any) => {
                            const exp = c.agent?.candidate_actions?.find((ca: any) => ca.action === c.agent.selected_action)?.expected_recovery_inr;
                            const prob = c.risk?.recovery_probability || 0;
                            return (
                                <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                                    <td className="px-6 py-2"><Badge status={c.risk?.priority}>{c.risk?.priority || 'UNKNOWN'}</Badge></td>
                                    <td className="px-6 py-2 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                    <td className="px-6 py-2 text-text-main text-xs uppercase">{c.type.replace(/_/g, ' ')}</td>
                                    <td className="px-6 py-2 text-right font-mono text-text-main">{formatExact(c.amount)}</td>
                                    <td className="px-6 py-2 text-right font-mono text-text-muted">{formatPercent(prob * 100)}</td>
                                    <td className="px-6 py-2 text-right font-mono font-semibold text-rzp-green">{formatExact(exp)}</td>
                                    <td className="px-6 py-2 font-mono text-xs text-text-muted">{c.agent?.selected_action || '-'}</td>
                                    <td className="px-6 py-2 text-xs">
                                        {c.safety?.eligibility === 'ALLOWED' && <span className="text-green-600 font-bold uppercase">ALLOWED</span>}
                                        {(c.safety?.eligibility === 'BLOCKED' || c.safety?.decision === 'BLOCK') && <span className="text-red-600 font-bold uppercase">BLOCKED</span>}
                                    </td>
                                    <td className="px-6 py-2"><Badge status={c.status}>{c.status}</Badge></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
