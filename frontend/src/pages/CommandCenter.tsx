import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatPercent } from '../lib/format';
import { ArrowRight } from 'lucide-react';

export const CommandCenter = ({ metrics, auditLog, cases }: any) => {
    const navigate = useNavigate();
    if (!metrics) return null;
    
    const sortedEvents = [...auditLog].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 15);
    const m = metrics;
    
    const opportunities = cases.filter((c: any) => c.status === 'PENDING' || c.status === 'RECOVERY_PENDING').length;
    const highPriority = cases.filter((c: any) => c.risk?.priority === 'HIGH').length;

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="bg-white border border-border shadow-sm">
                <div className="p-6 border-b border-border bg-gray-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Revenue Recovery</h2>
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
                            <ArrowRight className="text-gray-300" size={16} />
                            <div className="text-center w-1/4">
                                <div className="text-xl font-bold text-rzp-blue font-mono">{formatCurrency(m.revenue_at_risk_inr - m.revenue_blocked_inr - m.revenue_escalated_inr)}</div>
                                <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Eligible</div>
                            </div>
                            <ArrowRight className="text-gray-300" size={16} />
                            <div className="text-center w-1/4">
                                <div className="text-xl font-bold text-yellow-600 font-mono">{formatCurrency(m.revenue_attempted_inr)}</div>
                                <div className="text-[10px] text-text-muted mt-2 uppercase font-semibold">Attempted</div>
                            </div>
                            <ArrowRight className="text-gray-300" size={16} />
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
                            {sortedEvents.map((ev: any, i: number) => (
                                <div key={i} className="px-6 py-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between" onClick={() => navigate(`/cases/${ev.payment_id}`)}>
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
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white border border-border shadow-sm">
                        <div className="px-6 py-4 border-b border-border bg-gray-50 flex justify-between items-center">
                            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Operational Summary</h3>
                        </div>
                        <div className="divide-y divide-border">
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/opportunities')}>
                                <span className="text-sm text-text-main">Recovery Opportunities</span>
                                <span className="font-mono font-semibold">{opportunities}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/opportunities')}>
                                <span className="text-sm text-text-main">High Priority Cases</span>
                                <span className="font-mono font-semibold text-rzp-red">{highPriority}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/cases')}>
                                <span className="text-sm text-text-main">Successful Recoveries</span>
                                <span className="font-mono font-semibold text-rzp-green">{m.payments_recovered}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/safety')}>
                                <span className="text-sm text-text-main">Blocked Cases</span>
                                <span className="font-mono font-semibold text-rzp-red">{m.payments_blocked}</span>
                            </div>
                            <div className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/safety')}>
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
