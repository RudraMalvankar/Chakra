import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatPercent, formatExact } from '../lib/format';
import { ArrowRight, Activity, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Badge } from '../components/ui/Badge';

export const CommandCenter = ({ metrics, auditLog, cases }: any) => {
    const navigate = useNavigate();
    if (!metrics) return null;
    
    const sortedEvents = [...auditLog].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 30);
    const m = metrics;
    
    const activeMissions = cases.filter((c: any) => c.status === 'PENDING' || c.status === 'RECOVERY_PENDING').slice(0, 10);

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="bg-white border border-border shadow-sm">
                <div className="p-6 border-b border-border bg-gray-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <Activity className="mr-3 text-rzp-blue" size={20} />
                        Command Center
                    </h2>
                    <div className="flex space-x-2">
                        <Badge status="INFO">LIVE OPERATIONS</Badge>
                    </div>
                </div>
                
                <div className="p-8 grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Revenue at Risk</div>
                        <div className="text-3xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_at_risk_inr)}</div>
                        <div className="text-xs text-text-muted mt-2 font-mono">{m.payments_processed} Cases</div>
                    </div>
                    <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Recovered</div>
                        <div className="text-3xl font-bold text-rzp-green font-mono">{formatCurrency(m.revenue_recovered_inr)}</div>
                        <div className="text-xs text-text-muted mt-2 font-mono">{m.payments_recovered} Cases</div>
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

            <div className="bg-white border border-border shadow-sm p-6">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-6">Recovery Funnel</h3>
                <div className="flex justify-between items-center px-4">
                    <div className="text-center w-1/4">
                        <div className="flex justify-center mb-3"><AlertTriangle className="text-text-main" size={24}/></div>
                        <div className="text-xl font-bold text-text-main font-mono">{formatCurrency(m.revenue_at_risk_inr)}</div>
                        <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">At Risk</div>
                    </div>
                    <ArrowRight className="text-gray-300" size={16} />
                    <div className="text-center w-1/4">
                        <div className="flex justify-center mb-3"><ShieldCheck className="text-rzp-blue" size={24}/></div>
                        <div className="text-xl font-bold text-rzp-blue font-mono">{formatCurrency(m.revenue_at_risk_inr - m.revenue_blocked_inr - m.revenue_escalated_inr)}</div>
                        <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Eligible</div>
                    </div>
                    <ArrowRight className="text-gray-300" size={16} />
                    <div className="text-center w-1/4">
                        <div className="flex justify-center mb-3"><Activity className="text-yellow-600" size={24}/></div>
                        <div className="text-xl font-bold text-yellow-600 font-mono">{formatCurrency(m.revenue_attempted_inr)}</div>
                        <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Attempted</div>
                    </div>
                    <ArrowRight className="text-gray-300" size={16} />
                    <div className="text-center w-1/4">
                        <div className="flex justify-center mb-3"><CheckCircle2 className="text-rzp-green" size={24}/></div>
                        <div className="text-xl font-bold text-rzp-green font-mono">{formatCurrency(m.revenue_recovered_inr)}</div>
                        <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Recovered</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white border border-border shadow-sm flex flex-col h-[500px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Active Recovery Missions</h3>
                        <button onClick={() => navigate('/cases/missions')} className="text-xs font-bold text-rzp-blue uppercase tracking-wider hover:underline">View All</button>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-white border-b border-border text-text-muted sticky top-0">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Mission ID</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Workflow</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase text-right">Amount</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Selected Action</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {activeMissions.length === 0 && (
                                    <tr><td colSpan={5} className="px-6 py-8 text-center text-text-muted font-mono text-sm">No active missions.</td></tr>
                                )}
                                {activeMissions.map((c: any) => (
                                    <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                                        <td className="px-6 py-3 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                        <td className="px-6 py-3 text-text-main text-xs uppercase font-mono">{c.type.replace(/_/g, ' ')}</td>
                                        <td className="px-6 py-3 text-right font-mono text-text-main font-medium">{formatExact(c.amount)}</td>
                                        <td className="px-6 py-3 font-mono text-xs text-text-muted">{c.agent?.selected_action || '-'}</td>
                                        <td className="px-6 py-3"><Badge status={c.status}>{c.status}</Badge></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white border border-border shadow-sm flex flex-col h-[500px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Live Activity Feed</h3>
                    </div>
                    <div className="divide-y divide-border overflow-y-auto flex-1 p-2">
                        {sortedEvents.map((ev: any, i: number) => (
                            <div key={i} className="px-4 py-3 hover:bg-gray-50 cursor-pointer rounded transition-colors" onClick={() => navigate(`/cases/${ev.payment_id}`)}>
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-xs font-bold text-text-main uppercase">{ev.event_type.replace(/_/g, ' ')}</span>
                                    <span className="text-[10px] text-text-light font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                </div>
                                <div className="text-xs font-mono text-text-muted mb-1 truncate">
                                    {ev.event_type === 'revenue_risk_assessed' ? `At Risk: ${formatCurrency(ev.details.revenue_at_risk_inr)}` : 
                                     ev.event_type === 'execution_outcome' ? `Result: ${ev.details.status}` : 
                                     ev.event_type === 'safety_check_completed' ? `Safety: ${ev.details.decision}` :
                                     (ev.details.decision || ev.details.effective_action || ev.details.status || "-")}
                                </div>
                                <div className="text-[10px] text-rzp-blue font-mono font-medium">Mission: {ev.payment_id.substring(0,8)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
