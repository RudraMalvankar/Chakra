import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  User,
  Activity,
  AlertCircle,
  FileText,
  Radio,
  CheckCircle2,
  Sparkles,
  Volume2,
  VolumeX,
  Send,
  ExternalLink,
  Calendar,
} from "lucide-react";
import {
  startVoiceRecovery,
  getVoiceRecoveryStatus,
  startSimulatedVoiceCall,
  sendSimulatedVoiceTurn,
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

const SUGGESTED_RESPONSES = [
  { label: "Kal pakka pay kar dunga", intent: "Promise to Pay", icon: "📅" },
  { label: "Abhi WhatsApp pe link bhej do, main pay karta hoon", intent: "Pay Now", icon: "💳" },
  { label: "Yeh galat invoice amount hai, dispute raise karna hai", intent: "Dispute", icon: "⚠️" },
  { label: "Mujhe 3 din ka time aur chahiye please", intent: "Needs More Time", icon: "⏳" },
  { label: "Main abhi bilkul payment nahi kar sakta", intent: "Unwilling", icon: "🚫" },
];

export const VoiceRecovery: React.FC = () => {
  const [cases, setCases] = useState<any[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [callMethod, setCallMethod] = useState<"browser_gemini" | "twilio">("browser_gemini");
  const [toNumber, setToNumber] = useState<string>("+919876543210");

  const [status, setStatus] = useState<string>("idle");
  const [callSid, setCallSid] = useState<string>("");
  const [callMode, setCallMode] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [transcript, setTranscript] = useState<any[]>([]);
  const [intents, setIntents] = useState<any[]>([]);
  const [promise, setPromise] = useState<any>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  // In-browser dialog interactive states
  const [userInput, setUserInput] = useState<string>("");
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);

  const timerRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    getCases()
      .then((res) => {
        const allCases = res.cases || res || [];
        const openCases = allCases.filter((c: any) =>
          ["RECOVERY_PENDING", "PROMISE_BROKEN", "PROMISE_TO_PAY", "PAYMENT_FAILED", "FAILED"].includes(
            c.status
          )
        );
        setCases(openCases.length > 0 ? openCases : allCases);
        if (openCases.length > 0 && !selectedCaseId) {
          setSelectedCaseId(openCases[0].id);
        }
      })
      .catch((err) => console.error("Failed to load cases", err));
  }, []);

  const selectedCase = cases.find((c) => c.id === selectedCaseId);

  const isTerminal = TERMINAL_STATUSES.includes(status.toLowerCase());
  const isCallActive = status !== "idle" && !isTerminal && status !== "FAILED";

  // Speech synthesis helper for speaking AI responses aloud
  const speakText = (text: string) => {
    if (!audioEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "hi-IN";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error", e);
      setIsSpeaking(false);
    }
  };

  // Setup Speech Recognition (Mic)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "hi-IN";

        recognition.onresult = (event: any) => {
          const spoken = event.results[0][0].transcript;
          setUserInput(spoken);
          setIsListening(false);
        };

        recognition.onerror = () => {
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("Microphone recognition is not supported in this browser. You can type or click the quick responses below!");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      try {
        recognitionRef.current.start();
      } catch (e) {
        setIsListening(false);
      }
    }
  };

  const startRecovery = async () => {
    if (!selectedCaseId) {
      setError("Please select a recovery case.");
      return;
    }
    if (callMethod === "twilio" && !toNumber) {
      setError("Please enter a target phone number for Twilio.");
      return;
    }

    setError("");
    setTranscript([]);
    setIntents([]);
    setPromise(null);
    setGeneratedLink(null);
    setCallSid("");

    if (callMethod === "browser_gemini") {
      setStatus("IN_CALL");
      setCallMode("GEMINI 2.5 FLASH NATIVE AUDIO");
      setIsAiThinking(true);

      try {
        const res = await startSimulatedVoiceCall({
          case_id: selectedCaseId,
          amount: selectedCase?.amount_inr ?? 0,
          customer_name: selectedCase?.customer_name,
        });

        setIsAiThinking(false);
        setCallSid(res.call_sid);
        const greeting = res.greeting || "Namaste! Main Chakra se bol raha hoon. Aapke pending bill ke regarding call hai.";

        setTranscript([
          {
            speaker: "CHAKRA",
            text: greeting,
            timestamp: new Date().toISOString(),
          },
        ]);

        speakText(greeting);
      } catch (err: any) {
        setIsAiThinking(false);
        setError(err?.message || "Failed to initialize Gemini 2.5 voice dialog.");
        setStatus("FAILED");
      }
    } else {
      // Twilio Mode
      setStatus("CONNECTING");
      setCallMode("LIVE TWILIO");
      try {
        const res = await startVoiceRecovery({
          case_id: selectedCaseId,
          to_number: toNumber,
          amount: selectedCase?.amount_inr ?? 0,
          customer_name: selectedCase?.customer_name,
        });

        if (res.status === "error") {
          setError(res.message || "Failed to start Twilio call");
          setStatus("FAILED");
          return;
        }

        setCallSid(res.call_sid);
        setStatus("CALLING");
      } catch (err: any) {
        setError(err?.message || "Failed to connect to Twilio.");
        setStatus("FAILED");
      }
    }
  };

  const handleSendUtterance = async (utteranceText?: string) => {
    const textToSend = utteranceText || userInput;
    if (!textToSend.trim() || !isCallActive || isAiThinking) return;

    setUserInput("");
    setIsAiThinking(true);

    // 1. Append Customer speech to transcript
    const userMessage = {
      speaker: "CUSTOMER",
      text: textToSend,
      timestamp: new Date().toISOString(),
    };
    setTranscript((prev) => [...prev, userMessage]);

    try {
      // 2. Call backend Gemini 2.5 Flash turn evaluation
      const res = await sendSimulatedVoiceTurn({
        case_id: selectedCaseId,
        call_sid: callSid,
        user_speech: textToSend,
        amount: selectedCase?.amount_inr ?? 0,
        customer_name: selectedCase?.customer_name,
      });

      setIsAiThinking(false);

      // 3. Append AI response
      const aiMessage = {
        speaker: "CHAKRA",
        text: res.ai_response,
        timestamp: new Date().toISOString(),
      };
      setTranscript((prev) => [...prev, aiMessage]);

      // 4. Update intents and actions
      if (res.intent) {
        setIntents((prev) => [
          ...prev,
          {
            intent: res.intent,
            confidence: res.confidence,
            language: res.language,
            model_used: res.model_used,
          },
        ]);
      }
      if (res.promise) {
        setPromise(res.promise);
      }
      if (res.payment_link) {
        setGeneratedLink(res.payment_link);
      }

      // 5. Speak AI response aloud
      speakText(res.ai_response);
    } catch (err: any) {
      setIsAiThinking(false);
      const fallbackAi = {
        speaker: "CHAKRA",
        text: "Ji samajh gaya, humne aapki baat record kar li hai. Hamari team aapse jald sampark karegi.",
        timestamp: new Date().toISOString(),
      };
      setTranscript((prev) => [...prev, fallbackAi]);
      speakText(fallbackAi.text);
    }
  };

  const handleEndCall = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setStatus("completed");
  };

  // Poll Twilio status if in Twilio mode
  const pollStatus = async () => {
    if (callMethod !== "twilio" || !callSid || isTerminal) return;
    try {
      const data = await getVoiceRecoveryStatus(callSid);
      if (data.status && data.status !== "unknown") {
        setStatus(data.status.toUpperCase());
      }
      if (data.transcript && data.transcript.length > 0) setTranscript(data.transcript);
      if (data.intents && data.intents.length > 0) setIntents(data.intents);
      if (data.promise) setPromise(data.promise);
    } catch (err) {
      console.error("Polling error", err);
    }
  };

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (callMethod === "twilio" && callSid && !isTerminal) {
      timerRef.current = setInterval(pollStatus, 2000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callSid, status, callMethod]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, isAiThinking]);

  const latestIntent = intents.length > 0 ? intents[intents.length - 1] : null;

  return (
    <div className="p-6 h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-text-main tracking-tight uppercase flex items-center">
            <Mic className="mr-3 text-rzp-blue" size={28} />
            LIVE VOICE RECOVERY
          </h1>
          <p className="text-xs text-text-muted mt-1 font-mono">
            Autonomous Hinglish Voice Recovery • Twilio GSM & Gemini 2.5 Flash Native Audio
          </p>
        </div>

        <div className="flex items-center gap-3">
          {callMethod === "browser_gemini" && (
            <button
              onClick={() => setAudioEnabled(!audioEnabled)}
              title={audioEnabled ? "Mute Speech Synthesis" : "Unmute Speech Synthesis"}
              className={`p-2 rounded border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                audioEnabled
                  ? "bg-blue-50 border-blue-200 text-rzp-blue"
                  : "bg-gray-100 border-gray-300 text-gray-500"
              }`}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span>{audioEnabled ? "Audio Aloud: ON" : "Audio Aloud: OFF"}</span>
            </button>
          )}

          {callMode && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider ${
                callMode.includes("GEMINI")
                  ? "bg-purple-100 text-purple-900 border border-purple-300"
                  : "bg-green-100 text-green-900 border border-green-300"
              }`}
            >
              {callMode.includes("GEMINI") ? <Sparkles size={14} className="text-purple-600" /> : <Radio size={14} />}
              {callMode}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left Setup Column */}
        <div className="bg-white border border-border rounded shadow-sm p-6 flex flex-col space-y-5">
          {/* Method Switcher */}
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
              Select Call Engine
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setCallMethod("browser_gemini")}
                disabled={isCallActive}
                className={`py-2 px-2.5 rounded text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${
                  callMethod === "browser_gemini"
                    ? "bg-white text-purple-700 shadow-sm border border-purple-200"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <Sparkles size={14} className="text-purple-600" />
                <span>Gemini 2.5 Audio</span>
              </button>

              <button
                type="button"
                onClick={() => setCallMethod("twilio")}
                disabled={isCallActive}
                className={`py-2 px-2.5 rounded text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${
                  callMethod === "twilio"
                    ? "bg-white text-rzp-blue shadow-sm border border-blue-200"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <Phone size={14} />
                <span>Twilio Phone</span>
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1.5 font-mono">
              {callMethod === "browser_gemini"
                ? "Simulate real-time conversational audio dialog within browser using Gemini 2.5 Flash."
                : "Initiate outbound phone call to target mobile via Twilio voice network."}
            </p>
          </div>

          {/* Case Selection */}
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">
              Select Recovery Case
            </label>
            <select
              className="w-full border border-border p-2 rounded text-sm bg-white font-mono"
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              disabled={isCallActive}
            >
              <option value="">-- Choose Recovery Case --</option>
              {cases.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.id} - {c.customer_name || c.customer_id} ({formatCurrency(c.amount_inr || c.amount_at_risk || 0)})
                </option>
              ))}
            </select>
          </div>

          {/* Selected Case Preview */}
          {selectedCase && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-text-muted">Customer:</span>
                <span className="font-bold text-text-main">
                  {selectedCase.customer_name || selectedCase.customer_id}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Overdue Amount:</span>
                <span className="font-bold text-red-600">
                  {formatCurrency(selectedCase.amount_inr || selectedCase.amount_at_risk || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Status:</span>
                <span className="font-bold text-rzp-blue">{selectedCase.status}</span>
              </div>
            </div>
          )}

          {/* Twilio Phone Field (Only shown for Twilio mode) */}
          {callMethod === "twilio" && (
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
                disabled={isCallActive}
              />
              <div className="text-[10px] text-text-muted mt-1 font-mono">
                Must be verified in Twilio if using Trial credentials.
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded flex items-center">
              <AlertCircle size={16} className="mr-2 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            {!isCallActive ? (
              <button
                onClick={startRecovery}
                disabled={!selectedCaseId}
                className={`w-full py-3 text-white font-bold text-xs uppercase tracking-wider rounded transition-all shadow-sm flex items-center justify-center gap-2 ${
                  callMethod === "browser_gemini"
                    ? "bg-purple-700 hover:bg-purple-800 disabled:opacity-50"
                    : "bg-rzp-blue hover:bg-blue-700 disabled:opacity-50"
                }`}
              >
                {callMethod === "browser_gemini" ? (
                  <>
                    <Sparkles size={16} />
                    Start In-Browser AI Call (Gemini 2.5)
                  </>
                ) : (
                  <>
                    <Phone className="mr-1" size={16} />
                    Start Twilio Outbound Call
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleEndCall}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider rounded transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <PhoneOff size={16} />
                Hang Up / End Call
              </button>
            )}
          </div>

          {/* Call Metadata & Status Footer */}
          <div className="mt-auto pt-4 border-t border-border space-y-2">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-text-muted uppercase tracking-wider text-[10px]">Call Status</span>
              <span
                className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                  isCallActive
                    ? "bg-green-100 text-green-800 animate-pulse"
                    : isTerminal
                    ? "bg-gray-100 text-gray-800"
                    : "bg-blue-50 text-blue-600"
                }`}
              >
                {status}
              </span>
            </div>
            {callSid && (
              <div className="text-[10px] font-mono text-text-muted truncate">
                Session ID: {callSid}
              </div>
            )}
          </div>
        </div>

        {/* Right Conversation & Dialog Panel */}
        <div className="lg:col-span-2 bg-white border border-border rounded shadow-sm flex flex-col h-[650px] overflow-hidden">
          {/* Header Bar */}
          <div className="p-4 border-b border-border bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="text-rzp-blue" size={18} />
              <div>
                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">
                  Live Conversation View
                </h3>
                <p className="text-[10px] text-text-muted font-mono">
                  {callMethod === "browser_gemini"
                    ? "Gemini 2.5 Flash Native Audio Dialog Engine"
                    : "Twilio Telephony Audio Stream"}
                </p>
              </div>
            </div>

            {/* Audio Activity Wave Indicator */}
            {isCallActive && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className={`w-1 h-3 rounded-full ${isSpeaking ? "bg-purple-600 animate-bounce" : "bg-gray-300"}`} />
                  <span className={`w-1 h-5 rounded-full ${isSpeaking ? "bg-purple-600 animate-bounce delay-100" : "bg-gray-300"}`} />
                  <span className={`w-1 h-4 rounded-full ${isSpeaking ? "bg-purple-600 animate-bounce delay-200" : "bg-gray-300"}`} />
                  <span className={`w-1 h-2 rounded-full ${isSpeaking ? "bg-purple-600 animate-bounce" : "bg-gray-300"}`} />
                </div>
                <span className="text-[11px] font-mono font-bold text-purple-700">
                  {isSpeaking ? "AI Speaking..." : isAiThinking ? "Gemini Thinking..." : "Listening"}
                </span>
              </div>
            )}
          </div>

          {/* Transcript Scroll Area */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-gray-50/50">
            {transcript.length === 0 && status === "idle" && (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <div className="p-4 rounded-full bg-blue-50 text-rzp-blue mb-3">
                  <PhoneCall size={32} />
                </div>
                <p className="text-sm font-bold text-text-main mb-1">No Active Call</p>
                <p className="text-xs text-text-muted font-mono text-center max-w-sm">
                  Choose between in-browser Gemini 2.5 Flash AI Voice Call or Twilio Outbound, then click Start.
                </p>
              </div>
            )}

            {status === "CALLING" && transcript.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                <PhoneCall size={32} className="text-rzp-blue animate-pulse mb-3" />
                <p className="text-sm font-mono font-bold uppercase text-rzp-blue">
                  Connecting Outbound Call via Twilio...
                </p>
              </div>
            )}

            {/* Render Conversational Turns */}
            {transcript.map((t, i) => {
              const isChakra = t.speaker === "CHAKRA" || t.speaker === "AI";
              return (
                <div
                  key={i}
                  className={`flex flex-col ${isChakra ? "items-start" : "items-end"}`}
                >
                  <div className="text-[10px] font-bold text-text-muted mb-1 flex items-center gap-1.5 font-mono">
                    {isChakra ? (
                      <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-bold flex items-center gap-1">
                        <Sparkles size={10} /> CHAKRA (Gemini 2.5)
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold flex items-center gap-1">
                        <User size={10} /> CUSTOMER
                      </span>
                    )}
                    {t.timestamp && (
                      <span className="font-normal opacity-60">
                        {new Date(t.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div
                    className={`p-3.5 rounded-xl max-w-[85%] text-sm font-medium leading-relaxed shadow-sm ${
                      isChakra
                        ? "bg-white border border-purple-200 text-gray-900"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })}

            {isAiThinking && (
              <div className="flex items-center gap-2 text-xs font-mono text-purple-700 bg-purple-50 p-2.5 rounded-lg max-w-[200px] border border-purple-200 animate-pulse">
                <Sparkles size={14} className="animate-spin" />
                <span>Gemini 2.5 Flash thinking...</span>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>

          {/* Interactive Customer Turn Controls (Only shown for active in-browser call) */}
          {callMethod === "browser_gemini" && isCallActive && (
            <div className="p-3.5 bg-white border-t border-border space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1">
                  <User size={12} className="text-blue-600" />
                  Customer Speech Simulator:
                </span>
                <span className="text-[10px] text-text-muted font-mono">
                  Click quick response or speak via mic
                </span>
              </div>

              {/* Quick Response Chips */}
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_RESPONSES.map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendUtterance(chip.label)}
                    disabled={isAiThinking}
                    className="text-[11px] font-medium py-1 px-2.5 bg-gray-100 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 border border-gray-200 rounded-full transition-all text-left flex items-center gap-1 disabled:opacity-50"
                  >
                    <span>{chip.icon}</span>
                    <span>"{chip.label}"</span>
                  </button>
                ))}
              </div>

              {/* Speech Input Field with Mic */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={toggleMic}
                  title={isListening ? "Stop listening" : "Speak via Microphone"}
                  className={`p-2.5 rounded-lg border transition-colors ${
                    isListening
                      ? "bg-red-500 text-white border-red-600 animate-pulse"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-border"
                  }`}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>

                <input
                  type="text"
                  placeholder={isListening ? "Listening to your voice..." : "Type customer response or click quick chips above..."}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendUtterance()}
                  disabled={isAiThinking}
                  className="flex-1 border border-border px-3 py-2 rounded-lg text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                />

                <button
                  type="button"
                  onClick={() => handleSendUtterance()}
                  disabled={!userInput.trim() || isAiThinking}
                  className="px-4 py-2 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Send size={14} />
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}

          {/* AI Intent & Action Interpretation Bar */}
          {(latestIntent || promise || generatedLink) && (
            <div className="shrink-0 p-4 border-t border-border bg-gray-50/90 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center">
                  <FileText size={12} className="mr-1 text-purple-600" />
                  GEMINI 2.5 FLASH INTENT EXTRACTION
                </h4>
                {latestIntent?.model_used && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold">
                    Model: {latestIntent.model_used}
                  </span>
                )}
              </div>

              {latestIntent && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
                  <div className="bg-white p-2.5 rounded border border-border">
                    <div className="text-[10px] text-text-muted mb-0.5">DETECTED INTENT</div>
                    <div className="font-bold text-purple-700 uppercase">
                      {latestIntent.intent?.replace(/_/g, " ") || "UNKNOWN"}
                    </div>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-border">
                    <div className="text-[10px] text-text-muted mb-0.5">CONFIDENCE</div>
                    <div className="font-bold text-text-main">
                      {latestIntent.confidence != null
                        ? `${(latestIntent.confidence * 100).toFixed(0)}%`
                        : "N/A"}
                    </div>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-border">
                    <div className="text-[10px] text-text-muted mb-0.5">SPOKEN LANGUAGE</div>
                    <div className="font-bold text-text-main uppercase">
                      {latestIntent.language || "hi-IN (Hinglish)"}
                    </div>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-border">
                    <div className="text-[10px] text-text-muted mb-0.5">POLICY SAFETY</div>
                    <div className="font-bold text-green-700 uppercase">PASSED</div>
                  </div>
                </div>
              )}

              {/* Promise Banner */}
              {promise && (
                <div className="p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg font-mono text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                    <div>
                      <span className="font-bold uppercase mr-2">Promise to Pay Recorded:</span>
                      <span>
                        Amount: {formatCurrency(promise.amount_inr)} | Date: {promise.promised_date || "Tomorrow"}
                      </span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-green-200 text-green-900 rounded text-[10px] font-bold">
                    PROMISE CREATED
                  </span>
                </div>
              )}

              {/* Payment Link Banner */}
              {generatedLink && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg font-mono text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-blue-600 shrink-0" />
                    <div>
                      <span className="font-bold uppercase mr-2">Payment Link Dispatched:</span>
                      <a
                        href={generatedLink}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
                      >
                        {generatedLink} <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-blue-200 text-blue-900 rounded text-[10px] font-bold">
                    RECOVERY PENDING
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
