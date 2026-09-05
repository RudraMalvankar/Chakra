import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../services/api';
import { Badge } from '../components/ui/Badge';
import { formatCurrency } from '../lib/format';

type Escalation = {
  id: string;
  case_id: string;
  reason: string;
  priority: string;
  status: string;
  assigned_to?: string | null;
  created_at?: string | null;
};

export const Escalations = () => {
  const [items, setItems] = useState<Escalation[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [queue, stats] = await Promise.all([
        fetch(`${API_BASE}/api/escalations/`),
        fetch(`${API_BASE}/api/escalations/summary`),
      ]);
      if (!queue.ok || !stats.ok) throw new Error('Backend returned an escalation error');
      setItems(await queue.json());
      setSummary(await stats.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load escalations');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const advance = async (item: Escalation, status: string) => {
    setUpdating(item.id);
    try {
      const response = await fetch(`${API_BASE}/api/escalations/${item.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          actor: 'operator',
          assigned_to: status === 'ASSIGNED' ? 'operator' : undefined,
          resolution: status === 'RESOLVED' ? 'operator_action_complete' : undefined,
        }),
      });
      if (!response.ok) throw new Error(`Transition failed (${response.status})`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update escalation');
    } finally {
      setUpdating(null);
    }
  };

  const nextAction = (status: string) => ({
    OPEN: ['ASSIGNED', 'Assign'],
    ASSIGNED: ['IN_PROGRESS', 'Start'],
    IN_PROGRESS: ['RESOLVED', 'Resolve'],
    CUSTOMER_CONTACTED: ['RESOLVED', 'Resolve'],
    ACTION_TAKEN: ['RESOLVED', 'Resolve'],
  } as Record<string, string[]>)[status];

  return <div className="max-w-7xl mx-auto space-y-6">
    <div className="bg-white border border-border shadow-sm p-6 flex justify-between">
      <div><h2 className="text-lg font-bold uppercase tracking-wider">Escalation Center</h2><p className="text-sm text-text-muted mt-1">Human queue for cases automation cannot safely continue.</p></div>
      <button onClick={load} className="text-xs font-bold text-rzp-blue uppercase">Refresh</button>
    </div>
    {error ? <div className="bg-white border border-red-200 text-rzp-red p-6">Unable to load escalations: {error}</div> : <>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white border border-border p-5"><div className="text-xs text-text-muted uppercase">Open escalations</div><div className="font-mono text-2xl">{summary?.open_count ?? 'Not available'}</div></div>
        <div className="bg-white border border-border p-5"><div className="text-xs text-text-muted uppercase">High priority</div><div className="font-mono text-2xl">{summary?.high_priority_count ?? 'Not available'}</div></div>
        <div className="bg-white border border-border p-5"><div className="text-xs text-text-muted uppercase">Revenue escalated</div><div className="font-mono text-2xl">{summary ? formatCurrency(summary.revenue_escalated_inr) : 'Not available'}</div></div>
      </div>
      <div className="bg-white border border-border overflow-auto">
        <table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="p-4">Case</th><th className="p-4">Reason</th><th className="p-4">Priority</th><th className="p-4">Owner</th><th className="p-4">Status</th><th className="p-4">Action</th></tr></thead>
        <tbody>{items.length ? items.map(item => { const action = nextAction(item.status); return <tr key={item.id} className="border-t border-border"><td className="p-4 font-mono text-rzp-blue">{item.case_id}</td><td className="p-4">{item.reason}</td><td className="p-4"><Badge status={item.priority}>{item.priority}</Badge></td><td className="p-4">{item.assigned_to || 'Unassigned'}</td><td className="p-4"><Badge status={item.status}>{item.status}</Badge></td><td className="p-4">{action && <button disabled={updating === item.id} onClick={() => advance(item, action[0])} className="text-xs font-bold text-rzp-blue disabled:opacity-50">{updating === item.id ? 'Updating…' : action[1]}</button>}</td></tr>; }) : <tr><td colSpan={6} className="p-8 text-center text-text-muted">No escalations.</td></tr>}</tbody></table>
      </div>
    </>}
  </div>;
};
