import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../services/api';
import { Badge } from '../components/ui/Badge';
import { formatCurrency } from '../lib/format';
import {
  AlertTriangle,
  Clock,
  UserCheck,
  ShieldAlert,
  Search,
  Plus,
  ArrowRight,
  RefreshCw,
  X,
  FileText,
  DollarSign,
  PhoneCall,
  Mail,
} from 'lucide-react';

type Escalation = {
  id: string;
  case_id: string;
  reason: string;
  priority: string;
  severity: string;
  status: string;
  assigned_to?: string | null;
  sla_deadline?: string | null;
  created_at?: string | null;
  amount_at_risk_inr?: number;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  invoice_number?: string;
  days_overdue?: number;
};

type EscalationSummary = {
  open_count: number;
  high_priority_count: number;
  unassigned_count: number;
  sla_risk_count: number;
  unresolved_count: number;
  revenue_escalated_inr: number;
};

type EscalationState = {
  items: Escalation[];
  summary: EscalationSummary | null;
  error: string | null;
  loading: boolean;
};

type EscalationAction =
  | { type: 'loading' }
  | { type: 'loaded'; items: Escalation[]; summary: EscalationSummary }
  | { type: 'failed'; error: string };

function escalationReducer(state: EscalationState, action: EscalationAction): EscalationState {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: null };
    case 'loaded':
      return { items: action.items, summary: action.summary, error: null, loading: false };
    case 'failed':
      return { ...state, loading: false, error: action.error };
    default:
      return state;
  }
}

export const Escalations: React.FC = () => {
  const navigate = useNavigate();
  const [{ items, summary, error, loading }, dispatch] = useReducer(escalationReducer, {
    items: [],
    summary: null,
    error: null,
    loading: true,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  // Manual Escalation Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCaseId, setNewCaseId] = useState('');
  const [newReason, setNewReason] = useState('CUSTOMER_DISPUTE');
  const [newPriority, setNewPriority] = useState('HIGH');
  const [newNotes, setNewNotes] = useState('');
  const [submittingModal, setSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    dispatch({ type: 'loading' });
    try {
      const [queue, stats] = await Promise.all([
        fetch(`${API_BASE}/api/escalations`),
        fetch(`${API_BASE}/api/escalations/summary`),
      ]);
      if (!queue.ok || !stats.ok) throw new Error('Backend returned an escalation error');
      const itemsData = await queue.json();
      const statsData = await stats.json();
      dispatch({ type: 'loaded', items: itemsData, summary: statsData });
    } catch (err) {
      dispatch({
        type: 'failed',
        error: err instanceof Error ? err.message : 'Unable to load escalations',
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateEscalation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaseId.trim()) {
      setModalError('Case ID or Invoice # is required');
      return;
    }
    setSubmittingModal(true);
    setModalError(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: newCaseId.trim(),
          reason: newReason,
          priority: newPriority,
          severity: newPriority,
          notes: newNotes.trim() || undefined,
          actor: 'operator',
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to create escalation');
      }
      setShowCreateModal(false);
      setNewCaseId('');
      setNewNotes('');
      await load();
    } catch (err: any) {
      setModalError(err.message || 'Error creating escalation');
    } finally {
      setSubmittingModal(false);
    }
  };

  // Helper for SLA time remaining
  const formatSlaRemaining = (deadline?: string | null) => {
    if (!deadline) return null;
    try {
      const target = new Date(deadline).getTime();
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        return { label: 'SLA BREACHED', urgent: true, breached: true };
      }
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const urgent = hours < 4;
      return {
        label: `${hours}h ${mins}m left`,
        urgent,
        breached: false,
      };
    } catch {
      return null;
    }
  };

  const filteredItems = items.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      item.case_id.toLowerCase().includes(q) ||
      item.reason.toLowerCase().includes(q) ||
      (item.customer_name && item.customer_name.toLowerCase().includes(q)) ||
      (item.assigned_to && item.assigned_to.toLowerCase().includes(q)) ||
      (item.invoice_number && item.invoice_number.toLowerCase().includes(q));

    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'ACTIVE'
        ? !['RESOLVED', 'CLOSED', 'UNRECOVERABLE'].includes(item.status)
        : item.status === statusFilter;

    const matchesPriority =
      priorityFilter === 'ALL' ? true : item.priority === priorityFilter;

    return matchesQuery && matchesStatus && matchesPriority;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white border border-border shadow-sm p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold uppercase tracking-wider text-text-main">
                Escalation & Dispute Center
              </h1>
              <p className="text-sm text-text-muted mt-0.5">
                Human-in-the-loop recovery queue for cases automation cannot safely continue.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-text-main border border-border text-xs font-bold uppercase tracking-wider rounded flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-rzp-blue hover:bg-blue-700 text-white border border-blue-800 text-xs font-bold uppercase tracking-wider rounded flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus size={14} />
            <span>Manual Escalation</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>Error loading escalations: {error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-border p-5 rounded-lg shadow-sm">
          <div className="flex items-center justify-between text-xs text-text-muted uppercase font-mono font-semibold">
            <span>Open Escalations</span>
            <AlertTriangle size={15} className="text-amber-500" />
          </div>
          <div className="font-mono text-2xl font-bold mt-2 text-text-main">
            {summary?.open_count ?? 0}
          </div>
          <div className="text-[11px] text-text-muted mt-1 font-mono">
            {summary?.unassigned_count ?? 0} unassigned
          </div>
        </div>

        <div className="bg-white border border-border p-5 rounded-lg shadow-sm">
          <div className="flex items-center justify-between text-xs text-text-muted uppercase font-mono font-semibold">
            <span>High / Critical</span>
            <ShieldAlert size={15} className="text-red-500" />
          </div>
          <div className="font-mono text-2xl font-bold mt-2 text-red-600">
            {summary?.high_priority_count ?? 0}
          </div>
          <div className="text-[11px] text-text-muted mt-1 font-mono">Requires urgent review</div>
        </div>

        <div className="bg-white border border-border p-5 rounded-lg shadow-sm">
          <div className="flex items-center justify-between text-xs text-text-muted uppercase font-mono font-semibold">
            <span>SLA At Risk (&lt;4h)</span>
            <Clock size={15} className="text-amber-500" />
          </div>
          <div className="font-mono text-2xl font-bold mt-2 text-amber-600">
            {summary?.sla_risk_count ?? 0}
          </div>
          <div className="text-[11px] text-text-muted mt-1 font-mono">Approaching deadline</div>
        </div>

        <div className="bg-white border border-border p-5 rounded-lg shadow-sm">
          <div className="flex items-center justify-between text-xs text-text-muted uppercase font-mono font-semibold">
            <span>Revenue at Risk</span>
            <DollarSign size={15} className="text-emerald-600" />
          </div>
          <div className="font-mono text-2xl font-bold mt-2 text-emerald-700">
            {summary ? formatCurrency(summary.revenue_escalated_inr) : '₹0'}
          </div>
          <div className="text-[11px] text-text-muted mt-1 font-mono">Total active exposure</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-border p-4 rounded-lg shadow-sm flex flex-col md:flex-row gap-3 justify-between items-center">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by case, customer, reason, owner..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-border rounded text-xs focus:bg-white focus:outline-none focus:border-rzp-blue transition-colors font-mono"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          {/* Status Tabs */}
          <div className="flex items-center border border-border rounded bg-gray-50 p-0.5 text-xs font-mono">
            {['ALL', 'ACTIVE', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold uppercase transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-rzp-blue shadow-xs font-bold'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Priority Select */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-gray-50 border border-border rounded text-xs font-mono focus:outline-none focus:border-rzp-blue"
          >
            <option value="ALL">All Priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </div>

      {/* Escalation Queue Table */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-gray-50/50 flex justify-between items-center">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-text-muted">
            Escalation Queue ({filteredItems.length} cases)
          </span>
          <span className="text-[11px] text-text-muted font-mono">Click any row to open full case dossier</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-border font-mono uppercase text-text-muted text-[11px]">
              <tr>
                <th className="p-3.5">Case / Customer</th>
                <th className="p-3.5">Amount at Risk</th>
                <th className="p-3.5">Escalation Reason</th>
                <th className="p-3.5">Priority</th>
                <th className="p-3.5">SLA Target</th>
                <th className="p-3.5">Specialist</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-text-muted font-mono">
                    <div className="max-w-xs mx-auto space-y-2">
                      <ShieldAlert size={28} className="mx-auto text-text-muted/60" />
                      <p className="font-semibold text-text-main">No escalations matching filter</p>
                      <p className="text-[11px]">All compliance and recovery cases are running within normal parameters.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const sla = formatSlaRemaining(item.sla_deadline);
                  const isResolved = ['RESOLVED', 'CLOSED', 'UNRECOVERABLE'].includes(item.status);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/escalations/${item.id}`)}
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                    >
                      {/* Case & Customer */}
                      <td className="p-3.5 font-mono">
                        <div className="font-bold text-rzp-blue group-hover:underline flex items-center gap-1.5">
                          <span>{item.case_id}</span>
                        </div>
                        <div className="text-[11px] text-text-muted mt-0.5">
                          {item.customer_name || 'Customer'} {item.invoice_number ? `· #${item.invoice_number}` : ''}
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="p-3.5 font-mono font-bold text-text-main">
                        {formatCurrency(item.amount_at_risk_inr || 0)}
                        {item.days_overdue ? (
                          <div className="text-[10px] text-red-600 font-normal">
                            {item.days_overdue}d overdue
                          </div>
                        ) : null}
                      </td>

                      {/* Reason */}
                      <td className="p-3.5">
                        <span className="inline-block px-2 py-0.5 bg-gray-100 text-text-main rounded text-[10px] font-mono font-semibold uppercase border border-border">
                          {item.reason.replace(/_/g, ' ')}
                        </span>
                      </td>

                      {/* Priority */}
                      <td className="p-3.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                            item.priority === 'CRITICAL'
                              ? 'bg-red-50 text-red-700 border-red-300'
                              : item.priority === 'HIGH'
                              ? 'bg-amber-50 text-amber-700 border-amber-300'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {item.priority}
                        </span>
                      </td>

                      {/* SLA */}
                      <td className="p-3.5 font-mono">
                        {isResolved ? (
                          <span className="text-[11px] text-emerald-600 font-semibold">Completed</span>
                        ) : sla ? (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                              sla.breached
                                ? 'bg-red-100 text-red-800 border-red-300'
                                : sla.urgent
                                ? 'bg-amber-100 text-amber-800 border-amber-300'
                                : 'bg-gray-100 text-text-main border-gray-300'
                            }`}
                          >
                            <Clock size={11} />
                            <span>{sla.label}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted">Standard</span>
                        )}
                      </td>

                      {/* Specialist */}
                      <td className="p-3.5 font-mono">
                        {item.assigned_to ? (
                          <div className="flex items-center gap-1.5 text-text-main">
                            <div className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-[10px] font-bold">
                              {item.assigned_to.charAt(0).toUpperCase()}
                            </div>
                            <span className="truncate max-w-[120px]">{item.assigned_to}</span>
                          </div>
                        ) : (
                          <span className="text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-[10px]">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3.5">
                        <Badge status={item.status}>{item.status}</Badge>
                      </td>

                      {/* Action */}
                      <td className="p-3.5 text-right font-mono">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/escalations/${item.id}`);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-rzp-blue hover:text-white text-rzp-blue border border-rzp-blue rounded text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-all"
                        >
                          <span>Open Dossier</span>
                          <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Escalation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-border rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-purple-50 text-purple-700 rounded border border-purple-200">
                  <ShieldAlert size={16} />
                </div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-main">
                  Create Manual Escalation
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-text-muted hover:text-text-main p-1"
              >
                <X size={16} />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs font-mono">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateEscalation} className="space-y-3.5 text-xs font-mono">
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                  Case ID / Invoice Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-2024-001 or pay_998822"
                  value={newCaseId}
                  onChange={(e) => setNewCaseId(e.target.value)}
                  className="w-full p-2 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                    Escalation Reason
                  </label>
                  <select
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    className="w-full p-2 bg-gray-50 border border-border rounded focus:outline-none focus:border-rzp-blue"
                  >
                    <option value="CUSTOMER_DISPUTE">Customer Dispute</option>
                    <option value="HARD_COMPLIANCE_BLOCK">Hard Compliance Block</option>
                    <option value="BROKEN_OR_AT_RISK_PROMISE">Broken / Overdue Promise</option>
                    <option value="EXHAUSTED_RETRIES">Exhausted Max Retries</option>
                    <option value="MANUAL_OPERATOR_ESCALATION">Manual Operator Review</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                    Priority Level
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full p-2 bg-gray-50 border border-border rounded focus:outline-none focus:border-rzp-blue"
                  >
                    <option value="CRITICAL">Critical (2h SLA)</option>
                    <option value="HIGH">High (4h SLA)</option>
                    <option value="MEDIUM">Medium (24h SLA)</option>
                    <option value="LOW">Low (48h SLA)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                  Directive & Case Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Explain why this case requires manual intervention or specialist attention..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full p-2 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-sans text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-border rounded text-text-muted hover:text-text-main font-bold uppercase text-[11px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="px-4 py-2 bg-rzp-blue text-white rounded font-bold uppercase text-[11px] hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {submittingModal ? 'Creating...' : 'Create Escalation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
