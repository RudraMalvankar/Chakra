import { API_BASE, fetchHealth } from '../services/api';
import React, { useEffect, useState } from 'react';
import { PhoneCall, Mic, Phone, Loader2 } from 'lucide-react';
import { formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';

type Mode = 'twilio' | 'simulation';
type CallStatus = 'IDLE' | 'CONNECTING' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export const VoiceRecovery = () => {
    const [mode, setMode] = useState<Mode>('simulation');
    const [twilioConfigured, setTwilioConfigured] = useState<boolean | null>(null);
    const [status, setStatus] = useState<CallStatus>('IDLE');
    const [transcript, setTranscript] = useState<{ speaker: string; text: string }[]>([]);
    const [intent, setIntent] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [receivables, setReceivables] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [transcriptInput, setTranscriptInput] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const [creatingPromise, setCreatingPromise] = useState(false);
    const [promiseResult, setPromiseResult] = useState<any>(null);
    const [promiseError, setPromiseError] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${API_BASE}/api/receivables`)
            .then((res) => (res.ok ? res.json() : []))
            .then((items) => {
                setReceivables(Array.isArray(items) ? items : []);
                if (items?.[0]) setSelectedId(items[0].id);
            })
            .catch(() => setReceivables([]));
        fetchHealth()
            .then((h) => setTwilioConfigured(h.twilio === 'configured'))
            .catch(() => setTwilioConfigured(false));
    }, []);

    const selected = receivables.find((item) => item.id === selectedId);
    const canCreatePromise =
        intent?.intent === 'promise_to_pay' &&
        intent?.amount != null &&
        Number(intent.amount) > 0 &&
        Boolean(intent?.promised_date) &&
        Boolean(selected);

    const analyzeTranscript = async () => {
        if (!transcriptInput.trim()) return;
        setAnalyzing(true);
        setError(null);
        setPromiseResult(null);
        setPromiseError(null);
        try {
            const res = await fetch(`${API_BASE}/api/receivables/voice/intent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: transcriptInput.trim(), session_id: selectedId || undefined }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Intent analysis failed (${res.status})`);
            setTranscript((current) => [...current, { speaker: 'CUSTOMER', text: transcriptInput.trim() }]);
            setIntent(data);
            setTranscriptInput('');
            setStatus('COMPLETED');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Intent analysis failed');
            setStatus('FAILED');
        } finally {
            setAnalyzing(false);
        }
    };

    const createPromiseFromIntent = async () => {
        if (!canCreatePromise || !selected) return;
        setCreatingPromise(true);
        setPromiseError(null);
        try {
            const res = await fetch(`${API_BASE}/api/receivables/promises`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receivable_id: selected.id,
                    customer: selected.customer,
                    amount: Number(intent.amount),
                    promised_date: intent.promised_date,
                    notes: 'Created from browser voice simulation',
                    source: 'voice',
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Promise create failed (${res.status})`);
            setPromiseResult(data);
        } catch (e) {
            setPromiseError(e instanceof Error ? e.message : 'Unable to create promise');
        } finally {
            setCreatingPromise(false);
        }
    };

    const startCall = async () => {
        setStatus('CONNECTING');
        setTranscript([]);
        setIntent(null);
        setError(null);
        setPromiseResult(null);
        if (!twilioConfigured) {
            setStatus('FAILED');
            setError('TWILIO NOT CONFIGURED');
            return;
        }
        if (!selected) {
            setStatus('FAILED');
            setError('Select an ingested receivable before starting a call.');
            return;
        }
        if (!phoneNumber.trim()) {
            setStatus('FAILED');
            setError('Enter the customer phone number before starting a call.');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/receivables/voice/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receivable_id: selected.id,
                    phone_number: phoneNumber.trim(),
                }),
            });
            const data = await res.json();

            if (data.status === 'error') {
                setStatus('FAILED');
                setError(data.message || 'Call failed');
                return;
            }
            setStatus(data.status === 'success' ? 'RINGING' : 'FAILED');
            if (data.status !== 'success') setError(data.message || 'Provider did not accept the call');
        } catch (e) {
            console.error(e);
            setStatus('FAILED');
            setError(e instanceof Error ? e.message : 'Call failed');
        }
    };

    const confidenceLabel =
        intent?.confidence != null && Number.isFinite(Number(intent.confidence))
            ? `${Math.round(Number(intent.confidence) * 100)}%`
            : 'NOT AVAILABLE';

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <PhoneCall className="mr-3 text-rzp-blue" size={20} />
                        Voice Recovery
                    </h2>
                    <p className="text-sm text-text-muted mt-1">
                        Two modes: real Twilio calls, or browser transcript simulation (not a live phone call).
                    </p>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => { setMode('twilio'); setError(null); }}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border ${mode === 'twilio' ? 'bg-rzp-blue text-white border-rzp-blue' : 'bg-white text-text-muted border-border'}`}
                >
                    A) Real Twilio
                </button>
                <button
                    type="button"
                    onClick={() => { setMode('simulation'); setError(null); }}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border ${mode === 'simulation' ? 'bg-rzp-blue text-white border-rzp-blue' : 'bg-white text-text-muted border-border'}`}
                >
                    B) Browser Voice Simulation
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-border shadow-sm p-6 col-span-1 h-[600px] flex flex-col">
                    <h3 className="text-xs font-bold text-text-main uppercase tracking-wider border-b border-border pb-4 mb-4">Customer Details</h3>

                    <div className="space-y-4 mb-8">
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Receivable</div>
                            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="w-full border border-border rounded px-2 py-2 font-mono text-xs" disabled={receivables.length === 0}>
                                {receivables.length === 0 && <option value="">No ingested receivables</option>}
                                {receivables.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.invoice_id || item.id} — {item.customer}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Customer</div>
                            <div className="font-bold text-text-main">{selected?.customer || 'No receivable selected'}</div>
                        </div>
                        {mode === 'twilio' && (
                            <div>
                                <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Phone</div>
                                <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+91…" className="w-full border border-border rounded px-2 py-2 font-mono text-sm" />
                            </div>
                        )}
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Amount</div>
                            <div className="font-mono text-2xl font-bold text-text-main">
                                {selected ? formatCurrency(selected.remaining_amount ?? selected.amount) : 'Not available'}
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Language</div>
                            <div className="font-mono text-xs">Hinglish (hi-IN)</div>
                        </div>
                    </div>

                    {mode === 'twilio' && (
                        <div className="mt-auto space-y-3">
                            <div className="text-[10px] font-mono uppercase tracking-widest">
                                Twilio:{' '}
                                <span className={twilioConfigured ? 'text-rzp-green font-bold' : 'text-rzp-red font-bold'}>
                                    {twilioConfigured == null ? 'Checking…' : twilioConfigured ? 'Configured' : 'NOT CONFIGURED'}
                                </span>
                            </div>
                            <button
                                onClick={startCall}
                                disabled={!twilioConfigured || (status !== 'IDLE' && status !== 'COMPLETED' && status !== 'FAILED')}
                                className="w-full py-3 bg-rzp-blue text-white font-bold uppercase tracking-widest rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex justify-center items-center"
                            >
                                {status === 'CONNECTING' ? <Loader2 className="animate-spin mr-2" size={18} /> : <Phone className="mr-2" size={18} />}
                                {status === 'IDLE' || status === 'COMPLETED' || status === 'FAILED' ? 'Start real call' : 'Call in progress'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="col-span-2 bg-gray-50 border border-border shadow-sm h-[600px] flex flex-col">
                    <div className="px-6 py-4 border-b border-border bg-white flex justify-between items-center shrink-0">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">
                            {mode === 'twilio' ? 'Real Twilio console' : 'Browser simulation console — not a live phone call'}
                        </h3>
                        <Badge status={status}>{status}</Badge>
                    </div>

                    <div className="flex-1 p-6 overflow-y-auto flex flex-col space-y-4">
                        {mode === 'twilio' && status === 'IDLE' && (
                            <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm text-center px-6">
                                {twilioConfigured
                                    ? 'Ready to place a real Twilio call when credentials and webhook URL are set.'
                                    : 'TWILIO NOT CONFIGURED — set account SID, auth token, from-number, and webhook base URL.'}
                            </div>
                        )}
                        {mode === 'twilio' && status === 'RINGING' && (
                            <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
                                Twilio accepted the call. Conversation updates will appear from provider callbacks.
                            </div>
                        )}
                        {status === 'FAILED' && error && (
                            <div className="p-4 border border-red-200 bg-red-50 text-rzp-red font-mono text-sm">{error}</div>
                        )}

                        {transcript.map((t, i) => (
                            <div key={i} className={`flex flex-col ${t.speaker === 'CUSTOMER' ? 'items-end' : 'items-start'}`}>
                                <div className="text-[10px] font-bold text-text-muted mb-1">{t.speaker}</div>
                                <div
                                    className={`p-3 rounded max-w-[70%] font-mono text-sm ${
                                        t.speaker === 'CUSTOMER'
                                            ? 'bg-white border border-border text-text-main'
                                            : 'bg-blue-50 border border-blue-100 text-rzp-blue'
                                    }`}
                                >
                                    {t.text}
                                </div>
                            </div>
                        ))}

                        {mode === 'simulation' && (
                            <div className="mt-auto border border-dashed border-border bg-white p-4">
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
                                    Browser voice simulation — type or paste customer speech (not a live call)
                                </div>
                                <textarea
                                    value={transcriptInput}
                                    onChange={(e) => setTranscriptInput(e.target.value)}
                                    placeholder="Paste customer speech in Hindi, Hinglish, or English"
                                    className="w-full border border-border rounded p-2 font-mono text-sm min-h-20"
                                />
                                <button
                                    onClick={analyzeTranscript}
                                    disabled={analyzing || !transcriptInput.trim()}
                                    className="mt-2 px-4 py-2 bg-rzp-blue text-white rounded text-xs font-bold uppercase disabled:opacity-50"
                                >
                                    {analyzing ? 'Analyzing…' : 'Analyze voice intent'}
                                </button>
                            </div>
                        )}
                    </div>

                    {intent && mode === 'simulation' && (
                        <div className="shrink-0 p-6 border-t border-border bg-white space-y-4">
                            <div className="flex items-center mb-2">
                                <Mic className="text-rzp-blue mr-2" size={18} />
                                <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">Gemini voice intent result</h4>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 p-4 bg-gray-50 border border-border rounded font-mono text-sm">
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Intent</div>
                                    <div className="font-bold text-text-main">{String(intent.intent || '').replace(/_/g, ' ') || 'NOT AVAILABLE'}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Amount</div>
                                    <div className="font-bold text-text-main">
                                        {intent.amount != null ? formatCurrency(intent.amount) : 'NOT AVAILABLE'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Date</div>
                                    <div className="font-bold text-text-main">{intent.promised_date || 'NOT AVAILABLE'}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Confidence</div>
                                    <div className="font-bold text-text-main">{confidenceLabel}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Model</div>
                                    <div className="font-bold text-text-main">{intent.model_used || (intent.ai_used ? 'Gemini' : 'Fallback')}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">AI used</div>
                                    <div className="font-bold text-text-main">{intent.ai_used ? 'YES' : 'NO'}</div>
                                </div>
                            </div>

                            {canCreatePromise && (
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={createPromiseFromIntent}
                                        disabled={creatingPromise}
                                        className="px-4 py-2 bg-rzp-blue text-white rounded text-xs font-bold uppercase disabled:opacity-50"
                                    >
                                        {creatingPromise ? 'Creating promise…' : 'Create promise via backend'}
                                    </button>
                                    <span className="text-xs font-mono text-text-muted">Uses amount/date from Gemini intent only.</span>
                                </div>
                            )}
                            {promiseError && <div className="text-xs font-mono text-rzp-red">{promiseError}</div>}
                            {promiseResult && (
                                <div className="p-3 border border-border bg-gray-50 font-mono text-xs space-y-2">
                                    <div>
                                        Promise {promiseResult.id} · {promiseResult.status} · {formatCurrency(promiseResult.amount)} ·{' '}
                                        {promiseResult.promised_date}
                                    </div>
                                    {(promiseResult.audit_events || []).length > 0 && (
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">Audit events</div>
                                            {(promiseResult.audit_events || []).map((ev: any, i: number) => (
                                                <div key={i}>
                                                    {ev.event_type}
                                                    {ev.details?.source ? ` · source=${ev.details.source}` : ''}
                                                    {ev.details?.amount_inr != null ? ` · ₹${ev.details.amount_inr}` : ''}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="text-center text-xs font-mono text-text-muted">
                                Interpretation only — values come from the voice intent API, not simulated confidence or scripted replies.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
