import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatExact } from '../lib/format';

export const AuditLog = ({ auditLog }: any) => {
    const navigate = useNavigate();
    const sortedLog = [...auditLog].sort((a: any,b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return (
        <div className="bg-white border border-border shadow-sm h-[calc(100vh-120px)] flex flex-col max-w-7xl mx-auto">
            <div className="px-6 py-5 border-b border-border bg-gray-50 flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider">Audit Log</h2>
                    <p className="text-[10px] font-mono text-text-muted mt-1 uppercase tracking-widest">Append-Only Operational Log</p>
                </div>
                <div className="text-sm font-mono text-text-muted">{auditLog.length} events</div>
            </div>
            
            <div className="p-4 border-b border-border bg-white flex space-x-4 shrink-0">
                 <input type="text" placeholder="Search case ID..." className="border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-rzp-blue w-64 font-mono" />
                 <select className="border border-border rounded px-3 py-1.5 text-sm font-mono">
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
                        {sortedLog.map((ev: any, i: number) => (
                            <tr key={i} onClick={() => navigate(`/cases/${ev.payment_id}`)} className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-6 py-2 text-text-muted">{new Date(ev.timestamp).toISOString()}</td>
                                <td className="px-6 py-2 font-bold text-rzp-blue">{ev.payment_id.substring(0,8)}</td>
                                <td className="px-6 py-2 font-semibold text-text-main uppercase">{ev.event_type}</td>
                                <td className="px-6 py-2 text-text-muted uppercase">
                                    {ev.details.decision || ev.details.effective_action || ev.details.status || ev.details.case_type || '-'}
                                </td>
                                <td className="px-6 py-2 text-right font-bold text-text-main">
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
