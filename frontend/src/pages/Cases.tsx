import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { formatExact } from '../lib/format';

export const Cases = ({ cases }: any) => {
    const navigate = useNavigate();
    const [statusFilter, setStatusFilter] = useState('All');
    
    const filteredCases = cases.filter((c: any) => {
        if (statusFilter !== 'All' && c.status !== statusFilter) return false;
        return true;
    }).sort((a: any, b: any) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

    return (
        <div className="bg-white border border-border shadow-sm flex flex-col h-[calc(100vh-120px)] max-w-7xl mx-auto">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">All Cases</h2>
            </div>
            
            <div className="p-4 border-b border-border flex items-center space-x-4 text-sm bg-white shrink-0">
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-border rounded px-3 py-1.5 bg-white font-mono">
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
                    <thead className="bg-gray-50 border-b border-border text-text-muted sticky top-0">
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
                        {filteredCases.map((c: any) => (
                            <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-6 py-2 font-mono font-medium text-rzp-blue">{c.id.substring(0,8)}</td>
                                <td className="px-6 py-2 text-text-main text-xs uppercase">{c.type.replace(/_/g, ' ')}</td>
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
