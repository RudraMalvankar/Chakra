import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { formatExact } from '../lib/format';

export const Cases = ({ cases }: any) => {
    const navigate = useNavigate();
    const [statusFilter, setStatusFilter] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    
    const filteredCases = cases.filter((c: any) => {
        if (statusFilter !== 'All' && c.status !== statusFilter) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return (c.id?.toLowerCase().includes(q) ||
                c.case_type?.toLowerCase().includes(q) ||
                c.current_action?.toLowerCase().includes(q));
        }
        return true;
    }).sort((a: any, b: any) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-[calc(100vh-120px)] max-w-7xl mx-auto">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">All Cases</h2>
                <span className="text-xs font-mono text-text-muted">{filteredCases.length} cases</span>
            </div>
            
            <div className="p-4 border-b border-border flex items-center space-x-4 text-sm bg-white shrink-0">
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white font-mono text-xs">
                    <option value="All">All Statuses</option>
                    <option value="PENDING">PENDING</option>
                    <option value="RECOVERY_PENDING">RECOVERY_PENDING</option>
                    <option value="RECOVERED">RECOVERED</option>
                    <option value="FAILED">FAILED</option>
                    <option value="BLOCKED">BLOCKED</option>
                    <option value="ESCALATED">ESCALATED</option>
                </select>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by ID, type, or action..."
                    className="border border-border rounded px-3 py-1.5 bg-white font-mono text-xs flex-1"
                />
            </div>

            <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0">
                        <tr>
                            <th className="px-6 py-3 font-semibold text-[10px]">Case</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">Workflow</th>
                            <th className="px-6 py-3 font-semibold text-[10px] text-right">Amount</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">Priority</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">Selected Action</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">Safety</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">AI</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">Outcome</th>
                            <th className="px-6 py-3 font-semibold text-[10px]">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filteredCases.map((c: any) => {
                            const isBatch = c.id?.startsWith('case_b_');
                            return (
                                <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                                    <td className="px-6 py-2 font-mono font-medium text-rzp-blue">
                                        <span className="text-[10px]">{c.id?.substring(0, 12)}</span>
                                        {isBatch && <span className="ml-1 text-[9px] text-purple-600 font-bold">BATCH</span>}
                                    </td>
                                    <td className="px-6 py-2 text-text-main text-[10px] uppercase">{(c.type || c.case_type || '').replace(/_/g, ' ')}</td>
                                    <td className="px-6 py-2 text-right font-mono text-[10px]">{formatExact(c.amount)}</td>
                                    <td className="px-6 py-2"><Badge status={c.risk?.priority}>{c.risk?.priority || 'UNKNOWN'}</Badge></td>
                                    <td className="px-6 py-2 font-mono text-[10px] text-text-muted">{c.agent?.selected_action || c.current_action || '-'}</td>
                                    <td className="px-6 py-2 text-[10px] font-mono">{c.safety?.eligibility || '-'}</td>
                                    <td className="px-6 py-2 text-[10px] font-mono">
                                        {c.ai?.used ? <span className="text-purple-600">AI</span> : '-'}
                                    </td>
                                    <td className="px-6 py-2 text-[10px] font-mono">{c.outcome?.status || '-'}</td>
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
