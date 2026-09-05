import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatCurrency, formatPercent } from '../lib/format';
import { TrendingUp } from 'lucide-react';

export const Analytics = ({ metrics }: any) => {
    if (!metrics) return null;
    const m = metrics;

    const byWorkflow = Object.entries(m.by_case_type || {}).map(([name, data]: any) => ({
        name: name.replace(/_/g, ' '),
        at_risk: data.revenue_at_risk || 0,
        recovered: data.revenue_recovered || 0
    }));

    const byIntervention = Object.entries(m.by_intervention || {}).map(([name, data]: any) => ({
        name: name.replace(/_/g, ' '),
        recovered: data.recovered_inr || 0,
        count: data.attempted || 0
    })).filter(x => x.count > 0);

    const outcomesData = [
        { name: 'Recovered', value: m.payments_recovered, color: '#00BA88' },
        { name: 'Blocked', value: m.payments_blocked, color: '#E42C66' },
        { name: 'Escalated', value: m.payments_escalated, color: '#F4B740' },
        { name: 'Failed', value: m.payments_processed - m.payments_recovered - m.payments_blocked - m.payments_escalated, color: '#6A7280' }
    ].filter(x => x.value > 0);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <TrendingUp className="mr-3 text-rzp-blue" size={20} />
                        Analytics
                    </h2>
                    <p className="text-sm text-text-muted mt-1">Authoritative backend revenue metrics and recovery performance.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Revenue at Risk</div>
                    <div className="text-2xl font-bold font-mono text-text-main">{formatCurrency(m.revenue_at_risk_inr)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Attempted</div>
                    <div className="text-2xl font-bold font-mono text-text-main">{formatCurrency(m.revenue_attempted_inr)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Recovered</div>
                    <div className="text-2xl font-bold font-mono text-rzp-green">{formatCurrency(m.revenue_recovered_inr)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Blocked</div>
                    <div className="text-2xl font-bold font-mono text-rzp-red">{formatCurrency(m.revenue_blocked_inr)}</div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Recovery Rate</div>
                    <div className="text-2xl font-bold font-mono text-rzp-blue">{formatPercent(m.revenue_recovery_rate_pct)}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-border shadow-sm p-6 lg:col-span-2">
                    <h3 className="text-xs font-bold text-text-main uppercase tracking-wider mb-4">AI Triage Provenance</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-mono">
                        <div><div className="text-[10px] text-text-muted uppercase">Ambiguous cases triaged</div><div className="text-xl font-bold">{m.ai_triage_count ?? 'Not available'}</div></div>
                        <div><div className="text-[10px] text-text-muted uppercase">Fallback decisions</div><div className="text-xl font-bold">{m.ai_fallback_count ?? 'Not available'}</div></div>
                        <div><div className="text-[10px] text-text-muted uppercase">Live Gemini rate</div><div className="text-xl font-bold">{m.ai_live_rate_pct == null ? 'Not available' : `${m.ai_live_rate_pct}%`}</div></div>
                    </div>
                </div>
                <div className="bg-white border border-border shadow-sm p-6 h-[400px]">
                    <h3 className="text-xs font-bold text-text-main uppercase tracking-wider mb-6">Recovery by Workflow</h3>
                    {byWorkflow.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={byWorkflow} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB"/>
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6A7280' }}/>
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6A7280' }} tickFormatter={(val) => `₹${val/1000}k`}/>
                                <RechartsTooltip formatter={(val: number) => formatCurrency(val)} cursor={{ fill: '#F9FAFB' }}/>
                                <Legend wrapperStyle={{ fontSize: '10px' }}/>
                                <Bar dataKey="at_risk" name="At Risk" fill="#9CA3AF" radius={[2, 2, 0, 0]} />
                                <Bar dataKey="recovered" name="Recovered" fill="#00BA88" radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-sm font-mono text-text-muted">No workflow data available.</div>
                    )}
                </div>

                <div className="bg-white border border-border shadow-sm p-6 h-[400px]">
                    <h3 className="text-xs font-bold text-text-main uppercase tracking-wider mb-6">Execution Outcomes</h3>
                    {outcomesData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={outcomesData} cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={2} dataKey="value">
                                    {outcomesData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <RechartsTooltip formatter={(val: number) => `${val} cases`} />
                                <Legend wrapperStyle={{ fontSize: '10px' }}/>
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-sm font-mono text-text-muted">No outcome data available.</div>
                    )}
                </div>
            </div>
        </div>
    );
};
