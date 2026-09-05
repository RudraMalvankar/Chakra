import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE, requestJson } from '../services/api';
import { Badge } from '../components/ui/Badge';
import { formatCurrency } from '../lib/format';

export const EscalationDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [escalation, setEscalation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await requestJson<any>(`/api/escalations/${id}`);
      setEscalation(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
  }, [id]);

  if (loading) return <div className="p-6">Loading escalation...</div>;
  if (error) return <div className="p-6 text-rzp-red">Error: {error}</div>;
  if (!escalation) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white border border-border p-6 shadow-sm flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-wider mb-2 text-rzp-blue">Escalation {escalation.id}</h2>
          <p className="text-sm font-mono text-text-muted">Case: {escalation.case_id}</p>
        </div>
        <div className="flex gap-2">
          <Badge status={escalation.status}>{escalation.status}</Badge>
          <Badge status={escalation.priority}>{escalation.priority}</Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white border border-border p-6 space-y-4 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted border-b pb-2">Details</h3>
          <div><label className="text-xs text-text-muted uppercase">Reason</label><div className="font-mono mt-1">{escalation.reason}</div></div>
          <div><label className="text-xs text-text-muted uppercase">Policy Check</label><div className="font-mono mt-1">{escalation.policy_id || 'N/A'}</div></div>
          <div><label className="text-xs text-text-muted uppercase">Assigned To</label><div className="font-mono mt-1">{escalation.assigned_to || 'Unassigned'}</div></div>
          <div><label className="text-xs text-text-muted uppercase">Amount at Risk</label><div className="font-mono mt-1 text-lg">{formatCurrency(escalation.amount_at_risk_inr || 0)}</div></div>
        </div>

        <div className="bg-white border border-border p-6 space-y-4 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted border-b pb-2">Human Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="px-4 py-2 bg-gray-100 border text-xs font-bold uppercase" onClick={() => alert('Assign UI')}>Assign</button>
            <button className="px-4 py-2 bg-gray-100 border text-xs font-bold uppercase" onClick={() => alert('Send SMS UI')}>Send SMS</button>
            <button className="px-4 py-2 bg-gray-100 border text-xs font-bold uppercase" onClick={() => alert('Voice Call UI')}>Voice Call</button>
            <button className="px-4 py-2 bg-gray-100 border text-xs font-bold uppercase" onClick={() => alert('Payment Link UI')}>Create Link</button>
            <button className="px-4 py-2 bg-rzp-blue text-white border text-xs font-bold uppercase" onClick={() => alert('Resolve UI')}>Resolve</button>
          </div>
        </div>
      </div>
    </div>
  );
};
