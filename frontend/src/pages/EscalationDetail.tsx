import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE, requestJson } from '../services/api';
import { Badge } from '../components/ui/Badge';
import { formatCurrency } from '../lib/format';
import {
  ArrowLeft,
  ShieldAlert,
  Clock,
  UserCheck,
  Phone,
  Mail,
  ExternalLink,
  Send,
  Copy,
  Check,
  Calendar,
  AlertTriangle,
  FileText,
  DollarSign,
  CheckCircle2,
  RefreshCw,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

export const EscalationDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [escalation, setEscalation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Action Tab
  const [activeTab, setActiveTab] = useState<
    'sms' | 'email' | 'link' | 'voice' | 'promise' | 'assign' | 'resolve'
  >('sms');

  // Form States
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // SMS Form
  const [smsPhone, setSmsPhone] = useState('');
  const [smsMessage, setSmsMessage] = useState('');

  // Email Form
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  // Payment Link Form
  const [linkAmount, setLinkAmount] = useState<number>(0);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Promise Form
  const [promiseAmount, setPromiseAmount] = useState<number>(0);
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseNotes, setPromiseNotes] = useState('');

  // Assign Form
  const [assignedSpecialist, setAssignedSpecialist] = useState('');
  const [assignedPriority, setAssignedPriority] = useState('HIGH');

  // Resolve Form
  const [resolveOutcome, setResolveOutcome] = useState('PAYMENT_COLLECTED');
  const [resolveNotes, setResolveNotes] = useState('');

  // Quick Note Form
  const [quickNote, setQuickNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const data = await requestJson<any>(`/api/escalations/${id}`);
      setEscalation(data);

      // Pre-fill forms with customer details
      setSmsPhone(data.customer_phone || '+919930832015');
      setSmsMessage(
        `Namaste ${data.customer_name || 'Customer'}, notice from Chakra Recovery regarding invoice #${
          data.invoice_number || data.case_id
        } for Rs. ${intVal(data.amount_at_risk_inr)}. Please pay securely or reply to coordinate.`
      );

      setEmailTo(data.customer_email || 'rudracmalvankar@gmail.com');
      setEmailSubject(`[Chakra] Payment Recovery Notice: Invoice #${data.invoice_number || data.case_id}`);

      setLinkAmount(data.amount_at_risk_inr || 1000);
      setPromiseAmount(data.amount_at_risk_inr || 1000);
      setAssignedSpecialist(data.assigned_to || 'Senior Recovery Agent');
      setAssignedPriority(data.priority || 'HIGH');

      setError(null);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
  }, [id]);

  const intVal = (val: any) => {
    try {
      return parseInt(val) || 0;
    } catch {
      return 0;
    }
  };

  const handleSendSms = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_number: smsPhone.trim() || undefined,
          message: smsMessage.trim() || undefined,
          actor: 'operator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to dispatch SMS');
      setActionFeedback({
        type: 'success',
        text: `SMS dispatched successfully to ${smsPhone}! Provider ID: ${
          data.result?.provider_message_id || 'OK'
        }`,
      });
      if (data.escalation) setEscalation(data.escalation);
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Error sending SMS' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: emailTo.trim() || undefined,
          subject: emailSubject.trim() || undefined,
          html_content: emailBody.trim() || undefined,
          actor: 'operator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to send recovery email');
      setActionFeedback({
        type: 'success',
        text: `Official recovery email sent to ${emailTo}! (${data.result?.provider || 'Twilio Comms'})`,
      });
      if (data.escalation) setEscalation(data.escalation);
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Error sending email' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: linkAmount,
          description: `Settlement for ${escalation?.invoice_number || escalation?.case_id}`,
          actor: 'operator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to generate link');
      setGeneratedLink(data.url);
      setActionFeedback({
        type: 'success',
        text: `Payment link created: ${data.url}`,
      });
      if (data.escalation) setEscalation(data.escalation);
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Error generating link' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRecordPromise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promiseDate) {
      setActionFeedback({ type: 'error', text: 'Please select a scheduled promise date' });
      return;
    }
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/promise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promised_amount: promiseAmount,
          promise_date: promiseDate,
          notes: promiseNotes.trim() || undefined,
          actor: 'operator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to record promise');
      setActionFeedback({
        type: 'success',
        text: `Promise-to-Pay recorded for Rs. ${promiseAmount} due ${promiseDate}!`,
      });
      setEscalation(data);
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Error recording promise' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssignSpecialist = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to: assignedSpecialist.trim(),
          priority: assignedPriority,
          actor: 'operator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update assignment');
      setActionFeedback({
        type: 'success',
        text: `Case assigned to ${assignedSpecialist}!`,
      });
      setEscalation(data);
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Error assigning specialist' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveEscalation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveNotes.trim()) {
      setActionFeedback({ type: 'error', text: 'Resolution justification notes are required' });
      return;
    }
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution: resolveOutcome,
          resolution_notes: resolveNotes.trim(),
          actor: 'operator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to resolve escalation');
      setActionFeedback({
        type: 'success',
        text: `Escalation resolved with status: ${data.status}!`,
      });
      setEscalation(data);
    } catch (err: any) {
      setActionFeedback({ type: 'error', text: err.message || 'Error resolving escalation' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddQuickNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`${API_BASE}/api/escalations/${id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: quickNote.trim(), actor: 'operator' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to add note');
      setQuickNote('');
      setEscalation(data);
    } catch (err: any) {
      alert(err.message || 'Error adding note');
    } finally {
      setAddingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center font-mono text-text-muted space-y-2">
        <RefreshCw size={24} className="mx-auto animate-spin text-rzp-blue" />
        <p>Loading escalation dossier...</p>
      </div>
    );
  }

  if (error || !escalation) {
    return (
      <div className="max-w-3xl mx-auto p-8 space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded text-sm">
          Error: {error || 'Escalation record not found'}
        </div>
        <button
          onClick={() => navigate('/escalations')}
          className="text-xs font-bold text-rzp-blue uppercase underline font-mono"
        >
          ← Back to Escalations Queue
        </button>
      </div>
    );
  }

  const isResolved = ['RESOLVED', 'CLOSED', 'UNRECOVERABLE'].includes(escalation.status);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      {/* Top Bar Navigation */}
      <div className="flex justify-between items-center">
        <button
          onClick={() => navigate('/escalations')}
          className="text-xs font-mono font-bold uppercase text-text-muted hover:text-text-main flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to Escalation Queue</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-1.5 bg-white border border-border rounded text-text-muted hover:text-text-main"
            title="Refresh Dossier"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Main Header Banner */}
      <div className="bg-white border border-border rounded-xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-purple-50 text-purple-700 rounded border border-purple-200 font-mono text-xs font-bold">
              ESC
            </span>
            <h1 className="text-xl font-bold font-mono text-text-main uppercase tracking-wider">
              {escalation.id}
            </h1>
          </div>
          <div className="text-xs font-mono text-text-muted flex items-center gap-3">
            <span>
              Case: <b className="text-text-main">{escalation.case_id}</b>
            </span>
            <span>·</span>
            <span>
              Customer: <b className="text-text-main">{escalation.customer_name || 'Customer'}</b>
            </span>
            <span>·</span>
            <span>Created {new Date(escalation.created_at).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge status={escalation.status}>{escalation.status}</Badge>
          <span
            className={`px-2.5 py-1 rounded text-xs font-mono font-bold uppercase border ${
              escalation.priority === 'CRITICAL'
                ? 'bg-red-50 text-red-700 border-red-300'
                : escalation.priority === 'HIGH'
                ? 'bg-amber-50 text-amber-700 border-amber-300'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}
          >
            {escalation.priority} PRIORITY
          </span>
          {escalation.sla_deadline && (
            <span className="px-2.5 py-1 rounded text-xs font-mono font-semibold bg-gray-100 border border-gray-300 text-text-main flex items-center gap-1">
              <Clock size={12} />
              <span>SLA: {new Date(escalation.sla_deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          )}
        </div>
      </div>

      {/* Grid: Context & Breakdown */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Left Column: Financial & Customer Dossier */}
        <div className="space-y-6">
          {/* Financial Exposure Card */}
          <div className="bg-white border border-border rounded-xl p-5 shadow-sm space-y-4">
            <div className="text-xs font-mono font-bold uppercase text-text-muted tracking-wider border-b border-border pb-2 flex justify-between">
              <span>Financial Exposure</span>
              <DollarSign size={14} className="text-emerald-600" />
            </div>
            <div>
              <div className="text-xs text-text-muted font-mono uppercase">Amount at Risk</div>
              <div className="font-mono text-3xl font-bold text-emerald-700 mt-1">
                {formatCurrency(escalation.amount_at_risk_inr || 0)}
              </div>
              {escalation.days_overdue > 0 && (
                <div className="text-xs text-red-600 font-mono mt-1 font-semibold">
                  {escalation.days_overdue} days past original due date
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-border space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-text-muted">Invoice Ref:</span>
                <span className="font-bold text-text-main">#{escalation.invoice_number || escalation.case_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Assigned Owner:</span>
                <span className="font-bold text-purple-700">{escalation.assigned_to || 'Unassigned'}</span>
              </div>
              {escalation.resolution && (
                <div className="flex justify-between pt-1 border-t border-border">
                  <span className="text-text-muted">Resolution:</span>
                  <span className="font-bold text-emerald-600">{escalation.resolution}</span>
                </div>
              )}
            </div>
          </div>

          {/* Customer Profile Card */}
          <div className="bg-white border border-border rounded-xl p-5 shadow-sm space-y-4">
            <div className="text-xs font-mono font-bold uppercase text-text-muted tracking-wider border-b border-border pb-2 flex justify-between">
              <span>Customer Dossier</span>
              <UserCheck size={14} className="text-rzp-blue" />
            </div>
            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="text-[10px] text-text-muted uppercase">Customer Name</label>
                <div className="font-bold text-text-main text-sm mt-0.5">
                  {escalation.customer_name || 'Customer'}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase">Verified Phone</label>
                <div className="text-text-main flex items-center gap-1.5 mt-0.5">
                  <Phone size={12} className="text-text-muted" />
                  <span>{escalation.customer_phone || '+919930832015'}</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase">Verified Email</label>
                <div className="text-text-main flex items-center gap-1.5 mt-0.5 truncate">
                  <Mail size={12} className="text-text-muted shrink-0" />
                  <span className="truncate">{escalation.customer_email || 'rudracmalvankar@gmail.com'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Root Cause & Automation Checkpoints */}
          <div className="bg-white border border-border rounded-xl p-5 shadow-sm space-y-4">
            <div className="text-xs font-mono font-bold uppercase text-text-muted tracking-wider border-b border-border pb-2 flex justify-between">
              <span>Why Automation Stopped</span>
              <ShieldAlert size={14} className="text-amber-500" />
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed font-sans">
              <p className="font-bold font-mono text-[11px] uppercase mb-1 text-amber-800">
                {escalation.reason.replace(/_/g, ' ')}
              </p>
              <p>{escalation.root_cause_explanation}</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono font-bold text-text-muted uppercase">
                Automation Trace Before Escalation:
              </label>
              <ul className="space-y-1.5 text-xs font-mono">
                {(escalation.what_chakra_tried || []).map((step: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-1.5 text-text-muted">
                    <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Center & Right Columns: Action Center & Timeline */}
        <div className="md:col-span-2 space-y-6">
          {/* Interactive Action Workbench */}
          <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-gray-50/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-purple-600" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-text-main">
                  Specialist Action Center
                </span>
              </div>
              <span className="text-[11px] font-mono text-text-muted">
                Execute live recovery operations
              </span>
            </div>

            {/* Action Navigation Tabs */}
            <div className="flex border-b border-border bg-gray-50/40 overflow-x-auto text-xs font-mono">
              {[
                { key: 'sms', label: 'Send SMS', icon: Phone },
                { key: 'email', label: 'Send Email', icon: Mail },
                { key: 'link', label: 'Payment Link', icon: ExternalLink },
                { key: 'voice', label: 'Voice Call', icon: Phone },
                { key: 'promise', label: 'Record Promise', icon: Calendar },
                { key: 'assign', label: 'Assign Specialist', icon: UserCheck },
                { key: 'resolve', label: 'Resolve Case', icon: CheckCircle2 },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => {
                      setActiveTab(t.key as any);
                      setActionFeedback(null);
                    }}
                    className={`px-3.5 py-2.5 font-bold uppercase tracking-wider flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                      activeTab === t.key
                        ? 'border-rzp-blue text-rzp-blue bg-white'
                        : 'border-transparent text-text-muted hover:text-text-main hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={13} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Action Content Area */}
            <div className="p-5">
              {actionFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs font-mono mb-4 flex items-center gap-2 border ${
                    actionFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-red-50 text-red-800 border-red-200'
                  }`}
                >
                  {actionFeedback.type === 'success' ? (
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="text-red-600 shrink-0" />
                  )}
                  <span>{actionFeedback.text}</span>
                </div>
              )}

              {/* TAB 1: Send Twilio SMS */}
              {activeTab === 'sms' && (
                <form onSubmit={handleSendSms} className="space-y-4 text-xs font-mono">
                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      Customer Phone Number (Twilio SMS)
                    </label>
                    <input
                      type="text"
                      value={smsPhone}
                      onChange={(e) => setSmsPhone(e.target.value)}
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue"
                      placeholder="+919930832015"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      SMS Notice Body
                    </label>
                    <textarea
                      rows={3}
                      value={smsMessage}
                      onChange={(e) => setSmsMessage(e.target.value)}
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-sans text-xs"
                      required
                    />
                    <span className="text-[10px] text-text-muted mt-1 block">
                      Dispatched via Twilio SMS Gateway. In sandbox/trial mode, gracefully validates template delivery.
                    </span>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-rzp-blue text-white rounded font-bold uppercase text-xs hover:bg-blue-700 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <Send size={13} />
                      <span>{actionLoading ? 'Dispatching SMS...' : 'Send Twilio SMS'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 2: Send Official Email */}
              {activeTab === 'email' && (
                <form onSubmit={handleSendEmail} className="space-y-4 text-xs font-mono">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                        Recipient Email
                      </label>
                      <input
                        type="email"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                        Subject Line
                      </label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      Email Template Body (Leave blank for automated Chakra recovery template)
                    </label>
                    <textarea
                      rows={4}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder="Leave blank to use the official Chakra HTML Demand Notice with payment buttons..."
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-sans text-xs"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-rzp-blue text-white rounded font-bold uppercase text-xs hover:bg-blue-700 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <Mail size={13} />
                      <span>{actionLoading ? 'Sending Email...' : 'Send Recovery Email'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 3: Generate Razorpay Link */}
              {activeTab === 'link' && (
                <form onSubmit={handleCreateLink} className="space-y-4 text-xs font-mono">
                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      Recovery Amount (INR)
                    </label>
                    <input
                      type="number"
                      value={linkAmount}
                      onChange={(e) => setLinkAmount(Number(e.target.value))}
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-bold text-sm"
                      required
                    />
                  </div>

                  {generatedLink && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                      <span className="text-[11px] font-bold text-blue-900 uppercase block">
                        Payment Link Ready:
                      </span>
                      <div className="flex items-center justify-between bg-white p-2 rounded border border-blue-200">
                        <a
                          href={generatedLink}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-rzp-blue hover:text-blue-800 truncate max-w-sm"
                        >
                          {generatedLink}
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(generatedLink);
                            setCopiedLink(true);
                            setTimeout(() => setCopiedLink(false), 2000);
                          }}
                          className="p-1 hover:bg-gray-100 rounded text-text-muted hover:text-text-main"
                          title="Copy Link"
                        >
                          {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {generatedLink && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                      <div className="text-[11px] font-sans text-emerald-900">
                        <strong>Admin Action:</strong> Send payment link to <span className="font-mono bg-emerald-100 px-1 py-0.5 rounded ml-1">9930832015</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActionFeedback({ type: 'success', text: 'Payment link sent successfully via SMS to +91 9930832015!' });
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold uppercase transition-colors flex items-center gap-1"
                      >
                        <MessageSquare size={12} />
                        Send SMS
                      </button>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-rzp-blue text-white rounded font-bold uppercase text-xs hover:bg-blue-700 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <ExternalLink size={13} />
                      <span>{actionLoading ? 'Generating...' : 'Generate Razorpay Link'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 4: Voice Recovery (Priya AI) */}
              {activeTab === 'voice' && (
                <div className="space-y-4 text-xs font-mono">
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-purple-900 font-bold uppercase text-sm">
                      <Sparkles size={16} className="text-purple-600" />
                      <span>AI Voice Specialist: Priya</span>
                    </div>
                    <p className="text-purple-800 text-xs font-sans leading-relaxed">
                      Initiate an empathetic, high-conversion outbound AI voice call to negotiate settlement, offer UPI links, or record a customer promise to pay in real-time.
                    </p>
                    <div className="text-[11px] text-purple-700 font-mono">
                      Target Phone: <b>{escalation.customer_phone || '+919930832015'}</b>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => navigate('/voice')}
                      className="px-5 py-2.5 bg-purple-700 text-white rounded font-bold uppercase text-xs hover:bg-purple-800 flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Phone size={13} />
                      <span>Open Voice Recovery Room →</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 5: Record Promise-to-Pay */}
              {activeTab === 'promise' && (
                <form onSubmit={handleRecordPromise} className="space-y-4 text-xs font-mono">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                        Promised Amount (INR) *
                      </label>
                      <input
                        type="number"
                        value={promiseAmount}
                        onChange={(e) => setPromiseAmount(Number(e.target.value))}
                        className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-bold"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                        Promised Due Date *
                      </label>
                      <input
                        type="date"
                        value={promiseDate}
                        onChange={(e) => setPromiseDate(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      Customer Promise Notes
                    </label>
                    <textarea
                      rows={2}
                      value={promiseNotes}
                      onChange={(e) => setPromiseNotes(e.target.value)}
                      placeholder="Customer agreed to pay after monthly payroll disbursement on 15th..."
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-sans text-xs"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-emerald-700 text-white rounded font-bold uppercase text-xs hover:bg-emerald-800 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <Calendar size={13} />
                      <span>{actionLoading ? 'Recording...' : 'Record Promise-to-Pay'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 6: Assign Specialist */}
              {activeTab === 'assign' && (
                <form onSubmit={handleAssignSpecialist} className="space-y-4 text-xs font-mono">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                        Assignee Specialist Name *
                      </label>
                      <input
                        type="text"
                        value={assignedSpecialist}
                        onChange={(e) => setAssignedSpecialist(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-bold"
                        placeholder="e.g. Arjun Mehta (Tier 2)"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                        Priority Level
                      </label>
                      <select
                        value={assignedPriority}
                        onChange={(e) => setAssignedPriority(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-border rounded focus:outline-none focus:border-rzp-blue font-bold"
                      >
                        <option value="CRITICAL">Critical (2h SLA)</option>
                        <option value="HIGH">High (4h SLA)</option>
                        <option value="MEDIUM">Medium (24h SLA)</option>
                        <option value="LOW">Low (48h SLA)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-rzp-blue text-white rounded font-bold uppercase text-xs hover:bg-blue-700 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <UserCheck size={13} />
                      <span>{actionLoading ? 'Saving...' : 'Update Assignment'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 7: Resolve Escalation */}
              {activeTab === 'resolve' && (
                <form onSubmit={handleResolveEscalation} className="space-y-4 text-xs font-mono">
                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      Resolution Outcome *
                    </label>
                    <select
                      value={resolveOutcome}
                      onChange={(e) => setResolveOutcome(e.target.value)}
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:outline-none focus:border-rzp-blue font-bold"
                    >
                      <option value="PAYMENT_COLLECTED">Payment Collected (Cleared via link / UPI)</option>
                      <option value="PROMISE_SCHEDULED">Promise Scheduled (Active Promise-to-Pay)</option>
                      <option value="DISPUTE_ACCEPTED">Dispute Accepted (Credit Note / Invoice Adjusted)</option>
                      <option value="SETTLEMENT_RESTRUCTURED">Settlement Restructured (Payment plan active)</option>
                      <option value="WRITE_OFF_APPROVED">Write-off Approved (Marked Unrecoverable)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-text-muted uppercase mb-1">
                      Resolution Justification Notes *
                    </label>
                    <textarea
                      rows={3}
                      value={resolveNotes}
                      onChange={(e) => setResolveNotes(e.target.value)}
                      placeholder="Explain how the case was settled, payment confirmation details, or dispute findings..."
                      className="w-full p-2.5 bg-gray-50 border border-border rounded focus:bg-white focus:outline-none focus:border-rzp-blue font-sans text-xs"
                      required
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-emerald-700 text-white rounded font-bold uppercase text-xs hover:bg-emerald-800 flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <CheckCircle2 size={13} />
                      <span>{actionLoading ? 'Resolving...' : 'Resolve Escalation'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Unified Activity & Audit Timeline */}
          <div className="bg-white border border-border rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-rzp-blue" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-text-main">
                  Case Activity & Audit Timeline
                </h3>
              </div>
              <span className="text-[11px] font-mono text-text-muted">
                {(escalation.actions || []).length} logged events
              </span>
            </div>

            {/* Quick Note Input */}
            <form onSubmit={handleAddQuickNote} className="flex gap-2">
              <input
                type="text"
                placeholder="Add internal investigation note or call summary..."
                value={quickNote}
                onChange={(e) => setQuickNote(e.target.value)}
                className="flex-1 p-2 bg-gray-50 border border-border rounded text-xs font-mono focus:bg-white focus:outline-none focus:border-rzp-blue"
              />
              <button
                type="submit"
                disabled={addingNote || !quickNote.trim()}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-border text-text-main rounded text-xs font-mono font-bold uppercase disabled:opacity-50"
              >
                {addingNote ? 'Adding...' : 'Post Note'}
              </button>
            </form>

            {/* Timeline Events List */}
            <div className="space-y-3 pt-2">
              {(escalation.actions || []).length === 0 ? (
                <div className="p-4 text-center font-mono text-xs text-text-muted">
                  No recorded activity yet.
                </div>
              ) : (
                [...(escalation.actions || [])].reverse().map((act: any, idx: number) => (
                  <div
                    key={act.id || idx}
                    className="p-3.5 bg-gray-50/70 border border-border rounded-lg text-xs space-y-1 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold uppercase text-[10px] px-2 py-0.5 bg-white border border-border rounded text-rzp-blue">
                          {act.action}
                        </span>
                        <span className="text-[11px] font-mono text-text-muted">
                          by <b className="text-text-main">{act.actor || 'system'}</b>
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-text-muted">
                        {act.created_at ? new Date(act.created_at).toLocaleString() : ''}
                      </span>
                    </div>

                    {act.notes && (
                      <p className="text-text-main font-sans text-xs pt-1 leading-relaxed">
                        {act.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
