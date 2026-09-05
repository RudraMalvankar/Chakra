import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  Phone,
  PhoneCall,
  PhoneOff,
  User,
  Activity,
  AlertCircle,
  FileText,
  Radio,
  CheckCircle2,
} from "lucide-react";
import {
  startVoiceRecovery,
  getVoiceRecoveryStatus,
  getCases,
} from "../services/api";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

const TERMINAL_STATUSES = [
  "completed",
  "failed",
  "busy",
  "no-answer",
  "canceled",
];

export const VoiceRecovery: React.FC = () => {
  const [cases, setCases] = useState<any[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [toNumber, setToNumber] = useState<string>("");

  const [status, setStatus] = useState<string>("idle");
  const [callSid, setCallSid] = useState<string>("");
  const [callMode, setCallMode] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [transcript, setTranscript] = useState<any[]>([]);
  const [intents, setIntents] = useState<any[]>([]);
  const [promise, setPromise] = useState<any>(null);

  const timerRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCases()
      .then((res) => {
        const allCases = res.cases || res || [];
        const openCases = allCases.filter((c: any) =>
          ["RECOVERY_PENDING", "PROMISE_BROKEN", "PROMISE_TO_PAY"].includes(
            c.status
          )
        );
        setCases(openCases);
      })
      .catch((err) => console.error("Failed to load cases", err));
  }, []);

  const selectedCase = cases.find((c) => c.id === selectedCaseId);

  const isTerminal = TERMINAL_STATUSES.includes(status.toLowerCase());
  const canStart =
    selectedCaseId &&
    toNumber &&
    (status === "idle" || isTerminal);

  const startRecovery = async () => {
    if (!selectedCaseId || !toNumber) {
      setError("Please select a case and enter a phone number.");
      return;
    }
    setError("");
    setStatus("CONNECTING");
    setTranscript([]);
    setIntents([]);
    setPromise(null);
    setCallSid("");
    setCallMode("");

    try {
      const res = await startVoiceRecovery({
        case_id: selectedCaseId,
        to_number: toNumber,
        amount: selectedCase?.amount_inr ?? 0,
        customer_name: selectedCase?.customer_name,
      });

      if (res.status === "error") {
        setError(res.message || "Failed to start call");
        setStatus("FAILED");
        return;
      }

      setCallSid(res.call_sid);
      setCallMode(res.mode === "live" ? "LIVE TWILIO" : "SIMULATION");
      setStatus("CALLING");
    } catch (err: any) {
      const detail = err?.message || "Failed to connect to Twilio.";
      setError(detail);
      setStatus("FAILED");
    }
  };

  const pollStatus = async () => {
    if (!callSid || isTerminal) return;

    try {
      const data = await getVoiceRecoveryStatus(callSid);
      if (data.status && data.status !== "unknown") {
        setStatus(data.status.toUpperCase());
      }
      if (data.transcript) setTranscript(data.transcript);
      if (data.intents) setIntents(data.intents);
      if (data.promise) setPromise(data.promise);
    } catch (err) {
      console.error("Polling error", err);
    }
  };

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (callSid && !isTerminal) {
      timerRef.current = setInterval(pollStatus, 2000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callSid, status]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const latestIntent =
    intents.length > 0 ? intents[intents.length - 1] : null;

  return (
    <div className="p-6 h-full flex flex-col bg-gray-50">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black text-text-main tracking-tight uppercase flex items-center">
          <Mic className="mr-3 text-rzp-blue" size={28} />
          LIVE VOICE RECOVERY
        </h1>
        {callMode && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider ${
              callMode === "LIVE TWILIO"
                ? "bg-green-100 text-green-800 border border-green-300"
                : "bg-yellow-100 text-yellow-800 border border-yellow-300"
            }`}
          >
            <Radio size={14} />
            {callMode}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Configuration Panel */}
        <div className="bg-white border border-border rounded shadow-sm p-6 flex flex-col space-y-6">
          <div>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">
              Setup Call
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">
                  Select Case
                </label>
                <select
                  className="w-full border border-border p-2 rounded text-sm"
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  disabled={!canStart && status !== "idle"}
                >
                  <option value="">-- Choose Recovery Case --</option>
                  {cases.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.id} - {c.customer_name} (
                      {formatCurrency(c.amount_inr)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedCase && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-text-muted">Customer:</span>
                    <span className="font-bold">
                      {selectedCase.customer_name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Outstanding:</span>
                    <span className="font-bold text-rzp-red">
                      {formatCurrency(selectedCase.amount_inr)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">
                  Target Phone Number
                </label>
                <input
                  type="text"
                  placeholder="+919876543210"
                  className="w-full border border-border p-2 rounded text-sm font-mono"
                  value={toNumber}
                  onChange={(e) => setToNumber(e.target.value)}
                  disabled={!canStart && status !== "idle"}
                />
                <div className="text-[10px] text-text-muted mt-1">
                  Must be verified in Twilio if using Trial account.
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold uppercase rounded flex items-center">
                  <AlertCircle size={16} className="mr-2 shrink-0" />
                  {error}
                </div>
              )}

              <button
                onClick={startRecovery}
                disabled={!canStart}
                className="w-full py-3 bg-rzp-blue hover:bg-blue-700 text-white font-bold text-sm uppercase tracking-wider rounded disabled:opacity-50 transition-colors flex items-center justify-center"
              >
                <Phone className="mr-2" size={18} />
                {isTerminal ? "Restart Voice Recovery" : "Start Voice Recovery"}
              </button>
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-border space-y-2">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-text-muted">Call Status</span>
              <span
                className={`font-bold px-2 py-1 rounded ${
                  isTerminal
                    ? "bg-gray-100 text-gray-800"
                    : status === "idle"
                    ? "bg-blue-50 text-blue-600"
                    : "bg-green-100 text-green-800"
                }`}
              >
                {status}
              </span>
            </div>
            {callSid && (
              <div className="text-[10px] font-mono text-text-muted truncate">
                SID: {callSid}
              </div>
            )}
          </div>
        </div>

        {/* Conversation Panel */}
        <div className="lg:col-span-2 bg-white border border-border rounded shadow-sm flex flex-col h-[600px] overflow-hidden">
          <div className="p-4 border-b border-border bg-gray-50 flex items-center justify-between">
            <h3 className="text-xs font-bold text-text-main uppercase tracking-wider flex items-center">
              <Activity className="mr-2 text-rzp-blue" size={16} />
              Live Conversation View
            </h3>
            {!isTerminal &&
            status !== "idle" &&
            status !== "CONNECTING" &&
            status !== "FAILED" ? (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
            ) : null}
          </div>

          <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-gray-50">
            {transcript.length === 0 && status === "idle" && (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <PhoneOff size={48} className="mb-4 opacity-20" />
                <p className="text-sm font-mono">
                  Start a call to see live transcript.
                </p>
              </div>
            )}

            {(status === "CALLING" || status === "CONNECTING") && transcript.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-text-muted">
                <div className="animate-pulse flex items-center mb-4">
                  <PhoneCall size={32} className="text-rzp-blue" />
                </div>
                <p className="text-sm font-mono font-bold uppercase">
                  {status}...
                </p>
              </div>
            )}

            {transcript.map((t, i) => (
              <div
                key={i}
                className={`flex flex-col ${
                  t.speaker === "CUSTOMER" ? "items-end" : "items-start"
                }`}
              >
                <div className="text-[10px] font-bold text-text-muted mb-1 flex items-center gap-1">
                  {t.speaker === "CUSTOMER" ? (
                    <User size={12} />
                  ) : (
                    <Mic size={12} />
                  )}
                  {t.speaker}
                  {t.timestamp && (
                    <span className="font-normal ml-2 opacity-60">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div
                  className={`p-3 rounded-lg max-w-[80%] font-medium text-sm ${
                    t.speaker === "CUSTOMER"
                      ? "bg-white border border-border text-text-main shadow-sm"
                      : "bg-blue-50 border border-blue-100 text-rzp-blue"
                  }`}
                >
                  {t.text}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>

          {/* AI Interpretation Panel */}
          {(latestIntent || promise) && (
            <div className="shrink-0 p-4 border-t border-border bg-white">
              <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3 flex items-center">
                <FileText size={12} className="mr-1" />
                AI INTERPRETATION
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
                {latestIntent && (
                  <>
                    <div>
                      <div className="text-text-muted mb-1">INTENT</div>
                      <div className="font-bold text-rzp-blue uppercase">
                        {latestIntent.intent?.replace(/_/g, " ") || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-muted mb-1">LANGUAGE</div>
                      <div className="font-bold uppercase">
                        {latestIntent.language || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-muted mb-1">CONFIDENCE</div>
                      <div className="font-bold">
                        {latestIntent.confidence != null
                          ? `${(latestIntent.confidence * 100).toFixed(0)}%`
                          : "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-muted mb-1">MODEL</div>
                      <div className="font-bold">
                        {latestIntent.model_used || "N/A"}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {promise && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded font-mono text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <div>
                    <div className="font-bold uppercase mb-0.5">
                      Promise Persisted
                    </div>
                    <div>
                      Amount: {formatCurrency(promise.amount_inr)} | Date:{" "}
                      {promise.promised_date || "TBD"} | Source: {promise.source}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
