import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Search, Filter } from 'lucide-react';
import { formatCurrency } from '../lib/format';

export const AuditLog = ({ auditLog }: any) => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [filterType, setFilterType] = useState('ALL');

    const filtered = auditLog.filter((ev: any) => {
        const matchesSearch = search === '' || ev.payment_id?.toLowerCase().includes(search.toLowerCase()) || ev.event_type?.toLowerCase().includes(search.toLowerCase());
        const matchesType = filterType === 'ALL' || ev.event_type === filterType;
        return matchesSearch && matchesType;
    }).sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-[calc(100vh-120px)] max-w-7xl mx-auto">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                    <List className="mr-3 text-rzp-blue" size={20} />
                    Audit Log
                </h2>
                <div className="flex space-x-4">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input 
                            type="text" 
                            placeholder="Search Case ID or Event..." 
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8 pr-4 py-1.5 border border-border rounded text-xs font-mono bg-white focus:outline-none focus:border-rzp-blue w-64" 
                        />
                    </div>
                    <div className="relative">
                        <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <select 
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="pl-8 pr-4 py-1.5 border border-border rounded text-xs font-mono bg-white focus:outline-none focus:border-rzp-blue appearance-none"
                        >
                            <option value="ALL">All Events</option>
                            <option value="event_received">Event Received</option>
                            <option value="context_built">Context Built</option>
                            <option value="ai_triage_completed">AI Triage</option>
                            <option value="revenue_risk_assessed">Risk Assessed</option>
                            <option value="agent_decision_proposed">Agent Decision</option>
                            <option value="safety_check_completed">Safety Gate</option>
                            <option value="execution_started">Execution Started</option>
                            <option value="execution_outcome">Provider Outcome</option>
                            <option value="recovery_verified">Recovery Verified</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Timestamp</th>
                            <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Case ID</th>
                            <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Event</th>
                            <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Details</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filtered.map((ev: any, i: number) => (
                            <tr key={i} onClick={() => navigate(`/cases/${ev.payment_id}`)} className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-6 py-3 font-mono text-xs text-text-muted">{new Date(ev.timestamp).toLocaleString()}</td>
                                <td className="px-6 py-3 font-mono font-medium text-rzp-blue">{ev.payment_id?.substring(0,8)}</td>
                                <td className="px-6 py-3 text-text-main text-xs font-bold uppercase tracking-wider">{ev.event_type.replace(/_/g, ' ')}</td>
                                <td className="px-6 py-3 font-mono text-xs text-text-muted max-w-xl truncate">
                                    {ev.event_type === 'revenue_risk_assessed' ? `Risk Assessed: ${formatCurrency(ev.details.revenue_at_risk_inr)}` : 
                                     ev.event_type === 'execution_outcome' ? `Outcome: ${ev.details.status}` : 
                                     (ev.details.decision || ev.details.effective_action || ev.details.status || JSON.stringify(ev.details).substring(0, 50) + '...')}
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 && (
                            <tr><td colSpan={4} className="px-6 py-8 text-center text-text-muted font-mono">No matching events found in audit log.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
