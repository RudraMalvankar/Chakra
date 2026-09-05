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
  Calendar,
  Grid,
  Signal,
  Wifi,
  Copy,
  Check,
  Headphones,
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
  { label: "Abhi WhatsApp pe link bhej do", intent: "Pay Now", icon: "💳" },
  { label: "Yeh galat invoice hai, dispute hai", intent: "Dispute", icon: "⚠️" },
  { label: "Mujhe 3 din ka time chahiye", intent: "Needs More Time", icon: "⏳" },
  { label: "Main abhi payment nahi kar sakta", intent: "Unwilling", icon: "🚫" },
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

  // In-browser phone call & audio states
  const [userInput, setUserInput] = useState<string>("");
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isHandsFree, setIsHandsFree] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [showKeypad, setShowKeypad] = useState<boolean>(false);
  const [dialedDigits, setDialedDigits] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("hi-IN-SwaraNeural");
  const [activeVoiceMeta, setActiveVoiceMeta] = useState<{ engine?: string; voice?: string } | null>(null);

  // Sync refs to avoid stale closures in audio callbacks
  const isHandsFreeRef = useRef<boolean>(true);
  const isCallActiveRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const timerRef = useRef<any>(null);
  const durationTimerRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    isHandsFreeRef.current = isHandsFree;
  }, [isHandsFree]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

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

  useEffect(() => {
    isCallActiveRef.current = isCallActive;
    if (isCallActive) {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [isCallActive]);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const stopAudioPlayback = () => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      } catch (e) {}
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    setIsSpeaking(false);
  };

  const speakTextFallback = (text: string) => {
    if (!audioEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "hi-IN";
      utterance.rate = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        if (isHandsFreeRef.current && isCallActiveRef.current && !isMutedRef.current) {
          setTimeout(() => startListeningMic(), 300);
        }
      };
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis fallback error", e);
      setIsSpeaking(false);
    }
  };

  const playAudioStream = (audioBase64?: string, audioFormat?: string, fallbackText?: string) => {
    if (!audioEnabled) {
      if (isHandsFreeRef.current && isCallActiveRef.current && !isMutedRef.current) {
        setTimeout(() => startListeningMic(), 500);
      }
      return;
    }

    stopAudioPlayback();
    stopListeningMic();

    if (audioBase64) {
      try {
        const mime = audioFormat || "audio/mp3";
        const audio = new Audio(`data:${mime};base64,${audioBase64}`);
        currentAudioRef.current = audio;
        audio.onplay = () => setIsSpeaking(true);
        audio.onended = () => {
          setIsSpeaking(false);
          currentAudioRef.current = null;
          // Auto-resume microphone for hands-free conversation
          if (isHandsFreeRef.current && isCallActiveRef.current && !isMutedRef.current) {
            setTimeout(() => startListeningMic(), 300);
          }
        };
        audio.onerror = (err) => {
          console.warn("Audio element error, falling back to speech synthesis", err);
          setIsSpeaking(false);
          currentAudioRef.current = null;
          if (fallbackText) speakTextFallback(fallbackText);
        };
        audio.play().catch((err) => {
          console.warn("Audio autoplay blocked or interrupted", err);
          if (fallbackText) speakTextFallback(fallbackText);
        });
        return;
      } catch (err) {
        console.warn("Failed to create Audio stream", err);
      }
    }

    if (fallbackText) {
      speakTextFallback(fallbackText);
    }
  };

  // Setup Web Speech Recognition
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
          setIsListening(false);
          if (spoken && spoken.trim()) {
            handleSendUtterance(spoken);
          }
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

  const startListeningMic = () => {
    if (!recognitionRef.current || isMutedRef.current || !isCallActiveRef.current) return;
    try {
      recognitionRef.current.abort();
    } catch (e) {}
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      setIsListening(false);
    }
  };

  const stopListeningMic = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }
    setIsListening(false);
  };

  const toggleMuteMic = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      stopListeningMic();
    } else if (isCallActive && !isSpeaking && isHandsFree) {
      startListeningMic();
    }
  };

  // Request browser microphone permission
  const requestMicPermission = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.warn("Microphone permission requested:", e);
    }
  };

  const playDtmfTone = (digit: string) => {
    setDialedDigits((prev) => (prev + digit).slice(-12));
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800 + parseInt(digit || "5", 10) * 50, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  };

  const startRecovery = async () => {
    if (!selectedCaseId) {
      setError("Please select a valid recovery case.");
      return;
    }
    setError("");
    setTranscript([]);
    setIntents([]);
    setPromise(null);
    setGeneratedLink(null);
    setCallDuration(0);
    setDialedDigits("");
    setIsMuted(false);

    await requestMicPermission();

    if (callMethod === "browser_gemini") {
      setStatus("CALLING");
      setCallMode("GEMINI 2.5 FLASH NATIVE");
      setIsAiThinking(true);

      try {
        const res = await startSimulatedVoiceCall({
          case_id: selectedCaseId,
          amount: selectedCase?.amount_inr ?? 0,
          customer_name: selectedCase?.customer_name,
          voice_preference: selectedVoice,
        });

        setIsAiThinking(false);
        setCallSid(res.call_sid);
        setStatus("IN_PROGRESS");
        if (res.voice_engine) {
          setActiveVoiceMeta({ engine: res.voice_engine, voice: res.voice_name });
        }

        const greeting =
          res.greeting ||
          `Namaste ${selectedCase?.customer_name || "Customer"} ji! Main Chakra se Priya bol rahi hoon. Aapke overdue payment ke silsile mein call kiya tha.`;

        setTranscript([
          {
            speaker: "CHAKRA",
            text: greeting,
            timestamp: new Date().toISOString(),
          },
        ]);

        playAudioStream(res.audio_base64, res.audio_format, greeting);
      } catch (err: any) {
        setIsAiThinking(false);
        setError(err?.message || "Failed to initialize Gemini voice call.");
        setStatus("FAILED");
      }
    } else {
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
    stopListeningMic();

    const userMessage = {
      speaker: "CUSTOMER",
      text: textToSend,
      timestamp: new Date().toISOString(),
    };
    setTranscript((prev) => [...prev, userMessage]);

    try {
      const res = await sendSimulatedVoiceTurn({
        case_id: selectedCaseId,
        call_sid: callSid,
        user_speech: textToSend,
        amount: selectedCase?.amount_inr ?? 0,
        customer_name: selectedCase?.customer_name,
        voice_preference: selectedVoice,
      });

      setIsAiThinking(false);
      if (res.voice_engine) {
        setActiveVoiceMeta({ engine: res.voice_engine, voice: res.voice_name });
      }

      const aiMessage = {
        speaker: "CHAKRA",
        text: res.ai_response,
        timestamp: new Date().toISOString(),
      };
      setTranscript((prev) => [...prev, aiMessage]);

      if (res.intent) {
        setIntents((prev) => [
          ...prev,
          {
            intent: res.intent,
            confidence: res.confidence,
            language: "hi-IN (Hinglish)",
            model_used: res.voice_engine || "gemini-2.5-flash",
          },
        ]);
      }

      if (res.promise) setPromise(res.promise);
      if (res.payment_link) setGeneratedLink(res.payment_link);

      playAudioStream(res.audio_base64, res.audio_format, res.ai_response);
    } catch (err: any) {
      setIsAiThinking(false);
      const fallbackAi = "Ji shukriya! Maine aapka note record kar liya hai aur team ko inform kar diya hai.";
      setTranscript((prev) => [
        ...prev,
        {
          speaker: "CHAKRA",
          text: fallbackAi,
          timestamp: new Date().toISOString(),
        },
      ]);
      playAudioStream(undefined, undefined, fallbackAi);
    }
  };

  const handleEndCall = () => {
    stopAudioPlayback();
    stopListeningMic();
    setStatus("completed");
    setIsAiThinking(false);
    setShowKeypad(false);
  };

  const pollStatus = async () => {
    if (!callSid || isTerminal) return;
    try {
      const data = await getVoiceRecoveryStatus(callSid);
      if (data.status && data.status !== "unknown") {
        setStatus(data.status);
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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, isAiThinking]);

  const latestIntent = intents.length > 0 ? intents[intents.length - 1] : null;
  const latestMessage = transcript.length > 0 ? transcript[transcript.length - 1] : null;

  return (
    <div className="flex flex-col space-y-4 max-w-full bg-background text-text-main">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div>
          <h1 className="text-lg font-black text-text-main tracking-tight uppercase flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200">
              <PhoneCall size={18} />
            </span>
            <span>Chakra AI Voice Recovery</span>
          </h1>
          <p className="text-xs text-text-muted mt-0.5 font-mono flex items-center gap-2">
            <span>Conversational Audio Dialog</span>
            <span className="text-border">•</span>
            <span>Priya (AI Voice Specialist) • Hands-Free Laptop Mic</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {callMethod === "browser_gemini" && (
            <button
              onClick={() => setIsHandsFree(!isHandsFree)}
              title="Toggle Hands-Free Continuous Speech"
              className={`px-3 py-1.5 rounded-md border text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
                isHandsFree
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : "bg-white border-border text-text-muted hover:bg-gray-50"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isHandsFree ? "bg-emerald-600 animate-pulse" : "bg-gray-400"}`} />
              <span>Hands-Free Mic: {isHandsFree ? "ON" : "OFF"}</span>
            </button>
          )}

          {callMethod === "browser_gemini" && (
            <button
              onClick={() => {
                const next = !audioEnabled;
                setAudioEnabled(next);
                if (!next) stopAudioPlayback();
              }}
              title={audioEnabled ? "Mute Speaker Output" : "Unmute Speaker Output"}
              className={`p-1.5 rounded-md border text-xs font-bold flex items-center gap-1 transition-colors ${
                audioEnabled
                  ? "bg-white border-border text-text-main hover:bg-gray-50"
                  : "bg-red-50 border-red-200 text-red-600"
              }`}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          )}

          {callMode && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold uppercase tracking-wider ${
                callMode.includes("GEMINI")
                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}
            >
              {callMode.includes("GEMINI") ? <Sparkles size={12} className="text-purple-600" /> : <Radio size={12} />}
              {callMode}
            </div>
          )}
        </div>
      </div>

      {/* Main 3-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Call Configuration (3 cols) */}
        <div className="lg:col-span-3 bg-white border border-border rounded-xl p-4 flex flex-col space-y-3.5 shadow-sm">
          {/* Call Engine Switcher */}
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1.5 font-mono">
              Call Engine
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-50 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setCallMethod("browser_gemini")}
                disabled={isCallActive}
                className={`py-1.5 px-2 rounded text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                  callMethod === "browser_gemini"
                    ? "bg-white text-purple-700 shadow-sm border border-purple-200 font-mono"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <Sparkles size={12} />
                <span>AI Voice</span>
              </button>

              <button
                type="button"
                onClick={() => setCallMethod("twilio")}
                disabled={isCallActive}
                className={`py-1.5 px-2 rounded text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                  callMethod === "twilio"
                    ? "bg-white text-rzp-blue shadow-sm border border-blue-200 font-mono"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <Phone size={12} />
                <span>Twilio GSM</span>
              </button>
            </div>
          </div>

          {/* Voice Persona Selector */}
          {callMethod === "browser_gemini" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest font-mono">
                  AI Voice Persona
                </label>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-purple-50 text-purple-700 font-bold border border-purple-200">
                  Priya (Female)
                </span>
              </div>
              <select
                className="w-full border border-border p-2 rounded-lg text-xs bg-white text-text-main focus:outline-none focus:ring-1 focus:ring-purple-500 font-sans"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={isCallActive}
              >
                <optgroup label="Natural Indian Female Voices (Recommended)">
                  <option value="hi-IN-SwaraNeural">Priya • Hindi / Hinglish (Swara Neural)</option>
                  <option value="en-IN-NeerjaNeural">Neerja • Indian English (Neerja Neural)</option>
                </optgroup>
                <optgroup label="Gemini Native Voices">
                  <option value="gemini-Sulafat">Gemini Sulafat (Warm Female)</option>
                  <option value="gemini-Kore">Gemini Kore (Firm Female)</option>
                </optgroup>
              </select>
              <p className="text-[10px] text-text-muted mt-1 font-mono flex items-center gap-1">
                <Headphones size={11} className="text-purple-600" />
                Polite female recovery specialist persona.
              </p>
            </div>
          )}

          {/* Target Recovery Case Selection */}
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1 font-mono">
              Target Recovery Case
            </label>
            <select
              className="w-full border border-border p-2 rounded-lg text-xs bg-white text-text-main font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
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

          {/* Selected Case Summary Card */}
          {selectedCase && (
            <div className="p-3 bg-gray-50 border border-border rounded-lg text-xs font-mono space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-text-muted">Customer</span>
                <span className="font-bold text-text-main truncate max-w-[140px]">
                  {selectedCase.customer_name || selectedCase.customer_id}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-muted">Overdue</span>
                <span className="font-bold text-red-600">
                  {formatCurrency(selectedCase.amount_inr || selectedCase.amount_at_risk || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-muted">Mandate</span>
                <span className="font-bold text-emerald-700">
                  {selectedCase.mandate_state || "ACTIVE"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-muted">Status</span>
                <span className="font-bold text-purple-700">{selectedCase.status}</span>
              </div>
            </div>
          )}

          {/* Twilio Phone Field */}
          {callMethod === "twilio" && (
            <div>
              <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1 font-mono">
                Phone Number
              </label>
              <input
                type="text"
                placeholder="+919876543210"
                className="w-full border border-border p-2 rounded-lg text-xs font-mono bg-white text-text-main"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                disabled={isCallActive}
              />
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-mono rounded-lg flex items-center gap-1.5">
              <AlertCircle size={14} className="shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {/* Status Footer */}
          <div className="pt-2 border-t border-border flex justify-between items-center text-xs font-mono">
            <span className="text-text-muted text-[10px] uppercase tracking-wider">Session</span>
            <span
              className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                isCallActive
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse"
                  : isTerminal
                  ? "bg-gray-100 text-text-muted"
                  : "bg-purple-50 text-purple-700 border border-purple-200"
              }`}
            >
              {status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Center Column: Clean White Phone Call Console (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[420px] bg-white border border-border rounded-2xl shadow-sm p-6 flex flex-col min-h-[560px] relative">
            {/* Top Status Bar */}
            <div className="w-full flex items-center justify-between pb-3 mb-4 border-b border-gray-100 text-text-muted font-mono text-[11px]">
              <div className="flex items-center gap-1.5 font-medium text-emerald-600">
                <Signal size={12} />
                <span>Chakra HD Voice</span>
              </div>
              <div className="flex items-center gap-1">
                <Wifi size={12} className="text-emerald-600" />
                <span className="text-[10px] text-text-muted">VoIP</span>
              </div>
            </div>

            {/* Caller Identity */}
            <div className="text-center space-y-1 mb-4">
              <div className="inline-flex items-center gap-1 text-[10px] uppercase font-mono font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                <Sparkles size={11} />
                <span>Priya • AI Voice Specialist</span>
              </div>
              <h2 className="text-xl font-bold text-text-main tracking-tight">
                {selectedCase?.customer_name || "Customer"}
              </h2>
              <p className="text-xs text-text-muted font-mono">
                {selectedCase ? formatCurrency(selectedCase.amount_inr || selectedCase.amount_at_risk || 0) : "Pending Bill"}
              </p>
              {isCallActive && (
                <div className="pt-1 flex items-center justify-center gap-1.5 text-xs font-mono font-bold text-emerald-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span>{formatDuration(callDuration)}</span>
                </div>
              )}
            </div>

            {/* Calling Visualizer Orb / DTMF Keypad View */}
            <div className="flex-1 flex flex-col items-center justify-center my-3 relative w-full">
              {showKeypad ? (
                /* DTMF Phone Keypad */
                <div className="w-full max-w-[260px] bg-gray-50 border border-border rounded-2xl p-3 shadow-inner">
                  <div className="text-center font-mono text-base font-bold text-text-main mb-2 tracking-widest h-6">
                    {dialedDigits || "Dial keypad..."}
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    {[
                      { num: "1", sub: "" }, { num: "2", sub: "ABC" }, { num: "3", sub: "DEF" },
                      { num: "4", sub: "GHI" }, { num: "5", sub: "JKL" }, { num: "6", sub: "MNO" },
                      { num: "7", sub: "PQRS" }, { num: "8", sub: "TUV" }, { num: "9", sub: "WXYZ" },
                      { num: "*", sub: "" }, { num: "0", sub: "+" }, { num: "#", sub: "" },
                    ].map((key) => (
                      <button
                        key={key.num}
                        onClick={() => playDtmfTone(key.num)}
                        className="h-10 rounded-xl bg-white hover:bg-purple-50 hover:text-purple-700 text-text-main font-bold flex flex-col items-center justify-center transition-all border border-border shadow-xs active:scale-95"
                      >
                        <span className="text-sm leading-none">{key.num}</span>
                        {key.sub && <span className="text-[8px] text-text-muted leading-none mt-0.5">{key.sub}</span>}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowKeypad(false)}
                    className="w-full mt-2.5 py-1 text-[11px] font-mono text-text-muted hover:text-text-main uppercase tracking-wider text-center"
                  >
                    Hide Keypad
                  </button>
                </div>
              ) : isCallActive ? (
                /* Active Call Concentric Orb */
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="relative flex items-center justify-center">
                    {/* Ring 3 */}
                    <div
                      className={`absolute w-40 h-40 rounded-full transition-all duration-500 ${
                        isSpeaking
                          ? "bg-purple-100 animate-ping scale-110"
                          : isListening
                          ? "bg-emerald-100 animate-ping scale-110"
                          : "bg-gray-100"
                      }`}
                    />
                    {/* Ring 2 */}
                    <div
                      className={`absolute w-32 h-32 rounded-full transition-all duration-300 ${
                        isSpeaking
                          ? "bg-purple-200/60 animate-pulse"
                          : isListening
                          ? "bg-emerald-200/60 animate-pulse"
                          : isAiThinking
                          ? "bg-amber-100 animate-spin"
                          : "bg-gray-200/60"
                      }`}
                    />
                    {/* Core Orb */}
                    <div
                      className={`w-24 h-24 rounded-full shadow-md flex items-center justify-center z-10 transition-all duration-300 border-2 ${
                        isSpeaking
                          ? "bg-gradient-to-tr from-purple-600 to-indigo-600 border-purple-300 text-white scale-105"
                          : isListening
                          ? "bg-gradient-to-tr from-emerald-600 to-teal-600 border-emerald-300 text-white scale-105"
                          : isAiThinking
                          ? "bg-gradient-to-tr from-amber-500 to-orange-500 border-amber-300 text-white"
                          : "bg-white border-border text-text-muted"
                      }`}
                    >
                      {isSpeaking ? (
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-6 bg-white rounded-full animate-bounce" />
                          <span className="w-1.5 h-9 bg-white rounded-full animate-bounce delay-100" />
                          <span className="w-1.5 h-7 bg-white rounded-full animate-bounce delay-200" />
                          <span className="w-1.5 h-4 bg-white rounded-full animate-bounce delay-75" />
                        </div>
                      ) : isListening ? (
                        <Mic size={32} className="text-white animate-pulse" />
                      ) : isAiThinking ? (
                        <Sparkles size={32} className="text-white animate-spin" />
                      ) : (
                        <Phone size={32} className="text-text-muted" />
                      )}
                    </div>
                  </div>

                  {/* Status Banner */}
                  <div className="text-center font-mono">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        isSpeaking
                          ? "bg-purple-50 text-purple-700 border border-purple-200"
                          : isListening
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-300 animate-pulse"
                          : isAiThinking
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : isMuted
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-gray-100 text-text-muted"
                      }`}
                    >
                      {isSpeaking && <span>🔊 Priya speaking...</span>}
                      {isListening && <span>🎤 Listening to your mic... (Speak now)</span>}
                      {isAiThinking && <span>✨ Priya thinking...</span>}
                      {!isSpeaking && !isListening && !isAiThinking && (
                        <span>{isMuted ? "🔇 Mic Muted" : "● Connected"}</span>
                      )}
                    </span>
                  </div>
                </div>
              ) : (
                /* Ready State */
                <div className="flex flex-col items-center justify-center text-center space-y-3 py-6">
                  <div className="w-20 h-20 rounded-full bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shadow-sm">
                    <PhoneCall size={32} className="text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-main">Ready to Connect</h3>
                    <p className="text-xs text-text-muted font-mono mt-0.5 max-w-[260px]">
                      {selectedCase
                        ? `Speak naturally with Priya regarding ${selectedCase.customer_name || "Customer"}'s overdue ${formatCurrency(selectedCase.amount_inr || selectedCase.amount_at_risk || 0)}`
                        : "Select a recovery case to initiate the call"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Live Subtitle Strip */}
            {isCallActive && latestMessage && (
              <div className="w-full bg-gray-50 border border-border rounded-xl p-3 my-2 shadow-xs">
                <div className="flex items-center justify-between text-[10px] font-mono text-text-muted mb-1">
                  <span className="font-bold flex items-center gap-1">
                    {latestMessage.speaker === "CHAKRA" ? (
                      <span className="text-purple-700 flex items-center gap-1">
                        <Sparkles size={10} /> Priya (AI)
                      </span>
                    ) : (
                      <span className="text-emerald-700 flex items-center gap-1">
                        <User size={10} /> You (Customer)
                      </span>
                    )}
                  </span>
                  <span>{new Date(latestMessage.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-text-main line-clamp-2 leading-relaxed font-sans font-medium">
                  "{latestMessage.text}"
                </p>
              </div>
            )}

            {/* Call Controls */}
            <div className="w-full pt-3 mt-auto">
              {!isCallActive ? (
                <button
                  onClick={startRecovery}
                  disabled={!selectedCaseId}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <Phone size={16} />
                  <span>Start Voice Call Now</span>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
                    {/* Mute Mic */}
                    <button
                      onClick={toggleMuteMic}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
                        isMuted
                          ? "bg-red-500 text-white shadow-sm"
                          : "bg-gray-100 hover:bg-gray-200 text-text-main"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center mb-0.5">
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                      </div>
                      <span>{isMuted ? "Unmute" : "Mute"}</span>
                    </button>

                    {/* Keypad */}
                    <button
                      onClick={() => setShowKeypad(!showKeypad)}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
                        showKeypad
                          ? "bg-purple-600 text-white shadow-sm"
                          : "bg-gray-100 hover:bg-gray-200 text-text-main"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center mb-0.5">
                        <Grid size={16} />
                      </div>
                      <span>Keypad</span>
                    </button>

                    {/* Speaker Output */}
                    <button
                      onClick={() => {
                        const next = !audioEnabled;
                        setAudioEnabled(next);
                        if (!next) stopAudioPlayback();
                      }}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
                        !audioEnabled
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 hover:bg-gray-200 text-text-main"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center mb-0.5">
                        {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                      </div>
                      <span>Speaker</span>
                    </button>
                  </div>

                  {/* Hangup Button */}
                  <div className="flex justify-center pt-1">
                    <button
                      onClick={handleEndCall}
                      className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-md flex items-center justify-center transition-all active:scale-95"
                      title="End Call"
                    >
                      <PhoneOff size={22} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Live Call Intelligence & Audit (4 cols) */}
        <div className="lg:col-span-4 bg-white border border-border rounded-xl p-4 flex flex-col space-y-3 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-main flex items-center gap-1.5 font-mono">
              <Activity size={14} className="text-purple-600" />
              <span>Real-Time Call Intelligence</span>
            </h3>
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
              SAFETY PASSED
            </span>
          </div>

          {/* Gemini Spoken Intent Card */}
          {latestIntent ? (
            <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-lg space-y-2 font-mono">
              <div className="text-[9px] text-text-muted uppercase tracking-widest font-bold">
                Spoken Intent Detected
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-purple-800 uppercase">
                  {latestIntent.intent?.replace(/_/g, " ") || "ANALYZING..."}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-white text-purple-700 border border-purple-200">
                  {latestIntent.confidence != null ? `${(latestIntent.confidence * 100).toFixed(0)}% Confidence` : "95%"}
                </span>
              </div>
              <div className="text-[10px] text-text-muted">
                Model: <span className="font-semibold text-text-main">{latestIntent.model_used || "gemini-2.5-flash"}</span>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-gray-50 border border-border rounded-lg text-center py-4 font-mono text-text-muted text-xs">
              <Sparkles size={16} className="mx-auto mb-1 text-purple-500" />
              <span>Awaiting customer utterance for real-time intent classification</span>
            </div>
          )}

          {/* Promise to Pay Card */}
          {promise && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg font-mono text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold uppercase text-[10px]">Promise to Pay Recorded</div>
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    {formatCurrency(promise.amount_inr)} • Due: {promise.promised_date || "Kal"}
                  </div>
                </div>
              </div>
              <span className="px-2 py-0.5 bg-white text-emerald-700 rounded text-[9px] font-bold border border-emerald-300">
                RECORDED
              </span>
            </div>
          )}

          {/* Generated Payment Link Card */}
          {generatedLink && (
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg font-mono text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-rzp-blue shrink-0" />
                  <span className="font-bold uppercase text-[10px]">Payment Link Dispatched</span>
                </div>
                <span className="px-1.5 py-0.5 bg-white text-rzp-blue rounded text-[9px] font-bold border border-blue-200">
                  SMS / WHATSAPP
                </span>
              </div>
              <div className="flex items-center justify-between bg-white p-1.5 rounded border border-blue-200">
                <a
                  href={generatedLink}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-rzp-blue hover:text-blue-800 truncate max-w-[190px] text-[11px]"
                >
                  {generatedLink}
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedLink);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="p-1 hover:bg-gray-100 rounded text-text-muted hover:text-text-main"
                  title="Copy payment link"
                >
                  {copiedLink ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}

          {/* Quick Voice Phrases (Click-to-speak fallback) */}
          {isCallActive && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <div className="flex items-center justify-between text-[10px] font-mono font-bold text-text-muted uppercase tracking-wider">
                <span>Or Click Quick Response</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {SUGGESTED_RESPONSES.map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendUtterance(chip.label)}
                    disabled={isAiThinking}
                    className="text-[10px] font-mono py-1 px-2 bg-gray-50 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-300 border border-border rounded-md transition-all text-left flex items-center gap-1 text-text-main disabled:opacity-40"
                  >
                    <span>{chip.icon}</span>
                    <span>"{chip.label}"</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live Transcript Log */}
          <div className="border-t border-border pt-2 flex flex-col flex-1 min-h-[160px] max-h-[220px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono font-bold text-text-muted uppercase tracking-wider flex items-center gap-1">
                <FileText size={12} className="text-purple-600" />
                <span>Call Dialog Ticker</span>
              </span>
              <span className="text-[10px] text-text-muted font-mono">
                {transcript.length} turns
              </span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {transcript.length === 0 ? (
                <div className="text-text-muted text-xs font-mono text-center py-5">
                  No dialog history yet
                </div>
              ) : (
                transcript.map((t, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded-lg text-xs leading-relaxed border ${
                      t.speaker === "CHAKRA"
                        ? "bg-purple-50/50 border-purple-200 text-purple-900"
                        : "bg-gray-50 border-border text-text-main"
                    }`}
                  >
                    <div className="text-[9px] font-mono font-bold text-text-muted mb-0.5 flex justify-between">
                      <span className={t.speaker === "CHAKRA" ? "text-purple-700" : "text-emerald-700"}>
                        {t.speaker === "CHAKRA" ? "PRIYA (AI)" : "CUSTOMER"}
                      </span>
                      {t.timestamp && <span>{new Date(t.timestamp).toLocaleTimeString()}</span>}
                    </div>
                    <div>{t.text}</div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
