import { API_BASE } from '../services/api';
import React, { useEffect, useState } from 'react';
import { PhoneCall, Mic, MicOff, Phone, Loader2 } from 'lucide-react';
import { formatCurrency } from '../lib/format';
import { Badge } from '../components/ui/Badge';


export const VoiceRecovery = () => {
    const [status, setStatus] = useState<'IDLE'|'CONNECTING'|'RINGING'|'IN_PROGRESS'|'COMPLETED'|'FAILED'>('IDLE');
    const [loading, setLoading] = useState(false);
    const [transcript, setTranscript] = useState<{speaker: string, text: string}[]>([]);
    const [intent, setIntent] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [receivables, setReceivables] = useState<any[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');

    useEffect(() => {
        fetch(`${API_BASE}/api/receivables`)
            .then((res) => res.ok ? res.json() : [])
            .then((items) => { setReceivables(items); if (items[0]) setSelectedId(items[0].id); })
            .catch(() => setReceivables([]));
    }, []);

    const selected = receivables.find((item) => item.id === selectedId);

    const startCall = async () => {
        setLoading(true);
        setStatus('CONNECTING');
        setTranscript([]);
        setIntent(null);
        setError(null);
        if (!selected) {
            setStatus('FAILED');
            setError('Select an ingested receivable before starting a call.');
            setLoading(false);
            return;
        }
        if (!phoneNumber.trim()) {
            setStatus('FAILED');
            setError('Enter the customer phone number before starting a call.');
            setLoading(false);
            return;
        }
        
        try {
            const res = await fetch(`${API_BASE}/api/receivables/voice/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receivable_id: selected.id,
                    phone_number: phoneNumber.trim()
                })
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
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <PhoneCall className="mr-3 text-rzp-blue" size={20} />
                        Voice Recovery
                    </h2>
                    <p className="text-sm text-text-muted mt-1">Autonomous phone recovery for high-value receivables.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white border border-border shadow-sm p-6 col-span-1 h-[600px] flex flex-col">
                    <h3 className="text-xs font-bold text-text-main uppercase tracking-wider border-b border-border pb-4 mb-4">Customer Details</h3>
                    
                    <div className="space-y-4 mb-8">
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Receivable</div>
                            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="w-full border border-border rounded px-2 py-2 font-mono text-xs" disabled={receivables.length === 0}>
                                {receivables.length === 0 && <option value="">No ingested receivables</option>}
                                {receivables.map((item) => <option key={item.id} value={item.id}>{item.invoice_id || item.id} — {item.customer}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Customer</div>
                            <div className="font-bold text-text-main">{selected?.customer || 'No receivable selected'}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Phone</div>
                            <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+91…" className="w-full border border-border rounded px-2 py-2 font-mono text-sm" />
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Amount</div>
                            <div className="font-mono text-2xl font-bold text-text-main">{selected ? formatCurrency(selected.remaining_amount ?? selected.amount) : 'Not available'}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Reason</div>
                            <div className="font-mono text-xs">{selected ? `Overdue Invoice (${selected.id})` : 'No receivable selected'}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Language</div>
                            <div className="font-mono text-xs">Hinglish (hi-IN)</div>
                        </div>
                    </div>

                    <div className="mt-auto">
                        <button 
                            onClick={startCall}
                            disabled={status !== 'IDLE' && status !== 'COMPLETED' && status !== 'FAILED'}
                            className="w-full py-3 bg-rzp-blue text-white font-bold uppercase tracking-widest rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex justify-center items-center"
                        >
                            {status === 'CONNECTING' ? <Loader2 className="animate-spin mr-2" size={18}/> : <Phone className="mr-2" size={18}/>}
                            {status === 'IDLE' || status === 'COMPLETED' || status === 'FAILED' ? 'CALL CUSTOMER' : 'CALL IN PROGRESS'}
                        </button>
                    </div>
                </div>

                <div className="col-span-2 bg-gray-50 border border-border shadow-sm h-[600px] flex flex-col">
                    <div className="px-6 py-4 border-b border-border bg-white flex justify-between items-center shrink-0">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Live Call Console</h3>
                        <Badge status={status}>{status}</Badge>
                    </div>
                    
                    <div className="flex-1 p-6 overflow-y-auto flex flex-col space-y-4">
                    {status === 'IDLE' && (
                            <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
                                Ready to initiate call
                            </div>
                        )}
                        {status === 'RINGING' && <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">Twilio accepted the call. Conversation updates will appear from provider callbacks.</div>}
                        {status === 'FAILED' && error && <div className="p-4 border border-red-200 bg-red-50 text-rzp-red font-mono text-sm">{error}</div>}
                        
                        {transcript.map((t, i) => (
                            <div key={i} className={`flex flex-col ${t.speaker === 'CUSTOMER' ? 'items-end' : 'items-start'}`}>
                                <div className="text-[10px] font-bold text-text-muted mb-1">{t.speaker}</div>
                                <div className={`p-3 rounded max-w-[70%] font-mono text-sm ${t.speaker === 'CUSTOMER' ? 'bg-white border border-border text-text-main' : 'bg-blue-50 border border-blue-100 text-rzp-blue'}`}>
                                    {t.text}
                                </div>
                            </div>
                        ))}
                    </div>

                    {intent && (
                        <div className="shrink-0 p-6 border-t border-border bg-white">
                            <div className="flex items-center mb-4">
                                <Mic className="text-purple-500 mr-2" size={18} />
                                <h4 className="text-xs font-bold text-text-main uppercase tracking-wider">AI Intent Detected</h4>
                            </div>
                            <div className="grid grid-cols-4 gap-4 p-4 bg-purple-50 border border-purple-100 rounded font-mono text-sm">
                                <div>
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Intent</div>
                                    <div className="font-bold text-purple-700">{intent.intent.replace(/_/g, ' ')}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Amount</div>
                                    <div className="font-bold text-purple-700">{formatCurrency(intent.amount)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Date</div>
                                    <div className="font-bold text-purple-700">{intent.promised_date}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1">Confidence</div>
                                    <div className="font-bold text-purple-700">{Math.round(intent.confidence * 100)}%</div>
                                </div>
                            </div>
                            <div className="mt-4 flex items-center justify-center">
                                <Badge status="RECOVERED" className="text-sm px-4 py-1">PROMISE RECORDED IN RECEIVABLES</Badge>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
