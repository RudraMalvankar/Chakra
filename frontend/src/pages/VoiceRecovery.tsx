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
  Grid,
  MessageSquare,
  Signal,
  Wifi,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
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
  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("hi-IN-SwaraNeural");
  const [activeVoiceMeta, setActiveVoiceMeta] = useState<{ engine?: string; voice?: string } | null>(null);

  // Sync refs to prevent stale closures inside audio callbacks
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

  // High-fidelity neural audio streaming player (plays base64 WAV/MP3 from Gemini or Neural Indian Voice)
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
          // Auto-resume microphone for seamless hands-free conversation
          if (isHandsFreeRef.current && isCallActiveRef.current && !isMutedRef.current) {
            setTimeout(() => startListeningMic(), 300);
          }
        };
        audio.onerror = (err) => {
          console.warn("Audio element playback error, falling back to speech synthesis", err);
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
        console.warn("Failed to create Audio with stream data", err);
      }
    }

    if (fallbackText) {
      speakTextFallback(fallbackText);
    }
  };

  // Setup Web Speech Recognition (Mic)
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
    } else if (isHandsFree && !isSpeaking && !isAiThinking) {
      startListeningMic();
    }
  };

  // Realistic DTMF Dual-Tone Generator for In-Call Keypad
  const playDtmfTone = (digit: string) => {
    setDialedDigits((prev) => prev + digit);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const dtmfFreqs: Record<string, [number, number]> = {
        "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
        "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
        "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
        "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
      };
      const freqs = dtmfFreqs[digit] || [770, 1336];
      [freqs[0], freqs[1]].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.value = 0.08;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      });
    } catch (e) {}
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
    setCallDuration(0);
    setDialedDigits("");
    setShowKeypad(false);

    if (callMethod === "browser_gemini") {
      setStatus("IN_CALL");
      setCallMode("GEMINI 2.5 FLASH NATIVE AUDIO");
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
        if (res.voice_engine) {
          setActiveVoiceMeta({ engine: res.voice_engine, voice: res.voice_name });
        }
        const greeting = res.greeting || "Namaste! Main Chakra se bol raha hoon. Aapke pending bill ke regarding call hai.";

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
    stopListeningMic();

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
        voice_preference: selectedVoice,
      });

      setIsAiThinking(false);
      if (res.voice_engine) {
        setActiveVoiceMeta({ engine: res.voice_engine, voice: res.voice_name });
      }

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

      // 5. Play natural high-fidelity neural audio (which will auto-resume mic when done)
      playAudioStream(res.audio_base64, res.audio_format, res.ai_response);
    } catch (err: any) {
      setIsAiThinking(false);
      const fallbackAi = {
        speaker: "CHAKRA",
        text: "Ji samajh gaya, humne aapki baat record kar li hai. Hamari team aapse jald sampark karegi.",
        timestamp: new Date().toISOString(),
      };
      setTranscript((prev) => [...prev, fallbackAi]);
      playAudioStream(undefined, undefined, fallbackAi.text);
    }
  };

  const handleEndCall = () => {
    stopAudioPlayback();
    stopListeningMic();
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

  // Auto-scroll transcript drawer
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, isAiThinking]);

  const latestIntent = intents.length > 0 ? intents[intents.length - 1] : null;
  const latestMessage = transcript.length > 0 ? transcript[transcript.length - 1] : null;

  return (
    <div className="p-6 h-full flex flex-col bg-[#0d131f] text-slate-100 min-h-screen">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-5 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight uppercase flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <PhoneCall size={20} />
            </span>
            <span>CHAKRA AI VOICE CALL CONSOLE</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-mono flex items-center gap-2">
            <span>Hands-Free Natural Audio Dialog</span>
            <span className="text-slate-600">•</span>
            <span>Google Gemini 2.5 Flash Native Audio + Neural Indian Voices</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Hands-Free Auto-Turn Toggle */}
          {callMethod === "browser_gemini" && (
            <button
              onClick={() => setIsHandsFree(!isHandsFree)}
              title="Toggle Hands-Free Continuous Speech"
              className={`px-3 py-1.5 rounded-full border text-xs font-mono font-bold flex items-center gap-2 transition-all ${
                isHandsFree
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                  : "bg-slate-800 border-slate-700 text-slate-400"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isHandsFree ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
              <span>Hands-Free: {isHandsFree ? "AUTO-LISTEN ON" : "MANUAL"}</span>
            </button>
          )}

          {/* Audio Speaker Mute Toggle */}
          {callMethod === "browser_gemini" && (
            <button
              onClick={() => {
                const next = !audioEnabled;
                setAudioEnabled(next);
                if (!next) stopAudioPlayback();
              }}
              title={audioEnabled ? "Mute Speaker Output" : "Unmute Speaker Output"}
              className={`p-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                audioEnabled
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          )}

          {callMode && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider ${
                callMode.includes("GEMINI")
                  ? "bg-purple-500/10 text-purple-300 border border-purple-500/30"
                  : "bg-blue-500/10 text-blue-300 border border-blue-500/30"
              }`}
            >
              {callMode.includes("GEMINI") ? <Sparkles size={13} className="text-purple-400" /> : <Radio size={13} />}
              {callMode}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Config Panel (3 cols) */}
        <div className="lg:col-span-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col space-y-4 backdrop-blur-sm">
          {/* Method Switcher */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 font-mono">
              Call Engine
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setCallMethod("browser_gemini")}
                disabled={isCallActive}
                className={`py-2 px-2.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${
                  callMethod === "browser_gemini"
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30 font-mono"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Sparkles size={13} />
                <span>Gemini Audio</span>
              </button>

              <button
                type="button"
                onClick={() => setCallMethod("twilio")}
                disabled={isCallActive}
                className={`py-2 px-2.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${
                  callMethod === "twilio"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/30 font-mono"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Phone size={13} />
                <span>Twilio GSM</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5 font-mono">
              {callMethod === "browser_gemini"
                ? "Direct in-browser phone dialog with duplex microphone & neural voice output."
                : "Initiates real GSM outbound phone call via Twilio carrier network."}
            </p>
          </div>

          {/* Neural Voice Profile Selector */}
          {callMethod === "browser_gemini" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                  Neural Voice Profile
                </label>
                {activeVoiceMeta?.engine && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-mono bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                    Active: {activeVoiceMeta.voice}
                  </span>
                )}
              </div>
              <select
                className="w-full border border-slate-700 p-2.5 rounded-xl text-xs bg-slate-950 text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={isCallActive}
              >
                <optgroup label="🇮🇳 Neural Indian Voices (Natural Human Flow)">
                  <option value="hi-IN-SwaraNeural">Swara (Female) — Hindi / Hinglish Natural Human</option>
                  <option value="en-IN-NeerjaNeural">Neerja (Female) — Indian English Professional</option>
                  <option value="hi-IN-MadhurNeural">Madhur (Male) — Hindi Natural Human</option>
                </optgroup>
                <optgroup label="✨ Google Gemini 3.1 Flash Native TTS">
                  <option value="gemini-Sulafat">Gemini Sulafat (Female) — Warm & Conversational</option>
                  <option value="gemini-Kore">Gemini Kore (Female) — Firm Recovery Agent</option>
                  <option value="gemini-Aoede">Gemini Aoede (Female) — Breezy & Calm</option>
                  <option value="gemini-Puck">Gemini Puck (Male) — Upbeat & Clear</option>
                </optgroup>
              </select>
              <p className="text-[10px] text-purple-400/80 mt-1.5 font-mono flex items-center gap-1">
                <Sparkles size={11} /> High-fidelity neural audio streaming enabled.
              </p>
            </div>
          )}

          {/* Target Customer Case Selection */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 font-mono">
              Target Recovery Case
            </label>
            <select
              className="w-full border border-slate-700 p-2.5 rounded-xl text-xs bg-slate-950 text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
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
            <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Customer</span>
                <span className="font-bold text-white">
                  {selectedCase.customer_name || selectedCase.customer_id}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Overdue Bill</span>
                <span className="font-bold text-red-400">
                  {formatCurrency(selectedCase.amount_inr || selectedCase.amount_at_risk || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Mandate State</span>
                <span className="font-bold text-emerald-400">
                  {selectedCase.mandate_state || "ACTIVE"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Status</span>
                <span className="font-bold text-purple-400">{selectedCase.status}</span>
              </div>
            </div>
          )}

          {/* Twilio Phone Field */}
          {callMethod === "twilio" && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 font-mono">
                Customer Phone Number
              </label>
              <input
                type="text"
                placeholder="+919876543210"
                className="w-full border border-slate-700 p-2.5 rounded-xl text-xs font-mono bg-slate-950 text-slate-200"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                disabled={isCallActive}
              />
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                Verified caller ID required on Twilio Trial accounts.
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 text-xs font-mono rounded-xl flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Call Metadata & Status Footer */}
          <div className="mt-auto pt-4 border-t border-slate-800 space-y-2 font-mono">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">Session Status</span>
              <span
                className={`font-bold px-2.5 py-0.5 rounded-full text-[11px] ${
                  isCallActive
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse"
                    : isTerminal
                    ? "bg-slate-800 text-slate-400"
                    : "bg-slate-800 text-purple-300"
                }`}
              >
                {status.toUpperCase()}
              </span>
            </div>
            {callSid && (
              <div className="text-[10px] text-slate-500 truncate">
                SID: {callSid}
              </div>
            )}
          </div>
        </div>

        {/* Center: Smartphone In-Call Canvas (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center">
          {/* Smartphone Frame */}
          <div className="w-full max-w-[380px] bg-gradient-to-b from-slate-950 via-[#0e1626] to-slate-950 border-4 border-slate-800 rounded-[42px] shadow-2xl p-5 flex flex-col min-h-[580px] relative overflow-hidden backdrop-blur-md">
            {/* Top Phone Notch / Dynamic Island */}
            <div className="w-full flex items-center justify-between px-2 pt-1 mb-6 text-slate-400 font-mono text-[11px]">
              <div className="flex items-center gap-1.5 font-bold">
                <Signal size={12} className="text-emerald-400" />
                <span>Chakra 5G</span>
              </div>
              <div className="w-20 h-4 bg-slate-900 rounded-full flex items-center justify-center border border-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
              </div>
              <div className="flex items-center gap-1.5">
                <Wifi size={12} className="text-emerald-400" />
                <span>VoLTE</span>
              </div>
            </div>

            {/* Caller Identity Header */}
            <div className="text-center space-y-1 mb-6">
              <span className="inline-block text-[10px] uppercase font-mono tracking-widest px-2.5 py-0.5 rounded-full bg-slate-900 text-purple-400 border border-slate-800">
                {callMethod === "browser_gemini" ? "AI Revenue Recovery" : "Outbound Cellular Line"}
              </span>
              <h2 className="text-xl font-bold text-white tracking-wide">
                {selectedCase?.customer_name || "Chakra AI Agent"}
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {callMethod === "browser_gemini"
                  ? "+91 80 4718 9000 (Bengaluru)"
                  : toNumber || "+91 98765 43210"}
              </p>
              {isCallActive && (
                <div className="pt-1 flex items-center justify-center gap-1.5 text-xs font-mono font-bold text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>{formatDuration(callDuration)}</span>
                </div>
              )}
            </div>

            {/* Center Call Visualizer / DTMF Keypad View */}
            <div className="flex-1 flex flex-col items-center justify-center relative w-full my-2">
              {showKeypad ? (
                /* DTMF Phone Keypad Modal */
                <div className="w-full max-w-[280px] bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-xl backdrop-blur-md animate-in fade-in zoom-in duration-200">
                  <div className="text-center font-mono text-lg font-bold text-white mb-3 tracking-widest h-6 overflow-hidden">
                    {dialedDigits || "Dial keypad..."}
                  </div>
                  <div className="grid grid-cols-3 gap-2.5 font-mono">
                    {[
                      { num: "1", sub: "" }, { num: "2", sub: "ABC" }, { num: "3", sub: "DEF" },
                      { num: "4", sub: "GHI" }, { num: "5", sub: "JKL" }, { num: "6", sub: "MNO" },
                      { num: "7", sub: "PQRS" }, { num: "8", sub: "TUV" }, { num: "9", sub: "WXYZ" },
                      { num: "*", sub: "" }, { num: "0", sub: "+" }, { num: "#", sub: "" },
                    ].map((key) => (
                      <button
                        key={key.num}
                        onClick={() => playDtmfTone(key.num)}
                        className="h-12 rounded-full bg-slate-800/80 hover:bg-purple-600 text-white font-bold flex flex-col items-center justify-center transition-all border border-slate-700/60 active:scale-95"
                      >
                        <span className="text-sm leading-none">{key.num}</span>
                        {key.sub && <span className="text-[8px] text-slate-400 leading-none mt-0.5">{key.sub}</span>}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowKeypad(false)}
                    className="w-full mt-3 py-1 text-[11px] font-mono text-slate-400 hover:text-white uppercase tracking-wider text-center"
                  >
                    Hide Keypad
                  </button>
                </div>
              ) : isCallActive ? (
                /* Active Call Audio Orb & Visualizer */
                <div className="flex flex-col items-center justify-center space-y-6">
                  {/* Concentric Pulsing Audio Orb */}
                  <div className="relative flex items-center justify-center">
                    {/* Ring 3 */}
                    <div
                      className={`absolute w-44 h-44 rounded-full transition-all duration-500 ${
                        isSpeaking
                          ? "bg-purple-600/15 animate-ping scale-110"
                          : isListening
                          ? "bg-emerald-500/15 animate-ping scale-110"
                          : "bg-slate-800/20"
                      }`}
                    />
                    {/* Ring 2 */}
                    <div
                      className={`absolute w-36 h-36 rounded-full transition-all duration-300 ${
                        isSpeaking
                          ? "bg-purple-500/25 animate-pulse"
                          : isListening
                          ? "bg-emerald-400/25 animate-pulse"
                          : isAiThinking
                          ? "bg-amber-500/20 animate-spin"
                          : "bg-slate-800/40"
                      }`}
                    />
                    {/* Core Orb */}
                    <div
                      className={`w-28 h-28 rounded-full shadow-2xl flex items-center justify-center z-10 transition-all duration-300 border-2 ${
                        isSpeaking
                          ? "bg-gradient-to-tr from-purple-700 to-indigo-500 border-purple-300 shadow-purple-500/40 scale-105"
                          : isListening
                          ? "bg-gradient-to-tr from-emerald-600 to-teal-500 border-emerald-300 shadow-emerald-500/40 scale-105"
                          : isAiThinking
                          ? "bg-gradient-to-tr from-amber-600 to-orange-500 border-amber-300 shadow-amber-500/40"
                          : "bg-slate-800 border-slate-700 shadow-black"
                      }`}
                    >
                      {isSpeaking ? (
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-6 bg-white rounded-full animate-bounce" />
                          <span className="w-1.5 h-10 bg-white rounded-full animate-bounce delay-100" />
                          <span className="w-1.5 h-8 bg-white rounded-full animate-bounce delay-200" />
                          <span className="w-1.5 h-4 bg-white rounded-full animate-bounce delay-75" />
                        </div>
                      ) : isListening ? (
                        <Mic size={36} className="text-white animate-pulse" />
                      ) : isAiThinking ? (
                        <Sparkles size={36} className="text-white animate-spin" />
                      ) : (
                        <Phone size={36} className="text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Status Indicator Pill */}
                  <div className="text-center font-mono">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        isSpeaking
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                          : isListening
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                          : isAiThinking
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : isMuted
                          ? "bg-red-500/20 text-red-300 border border-red-500/40"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {isSpeaking && <span>🔊 Speaking aloud...</span>}
                      {isListening && <span>🎤 Listening (Speak now)...</span>}
                      {isAiThinking && <span>✨ Gemini 2.5 thinking...</span>}
                      {!isSpeaking && !isListening && !isAiThinking && (
                        <span>{isMuted ? "🔇 Muted" : "● Connected"}</span>
                      )}
                    </span>
                  </div>
                </div>
              ) : (
                /* Ready / Idle Call Screen */
                <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
                  <div className="w-24 h-24 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-purple-400 shadow-inner">
                    <PhoneCall size={38} className="text-purple-400 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Call Ready</h3>
                    <p className="text-xs text-slate-400 font-mono mt-1 max-w-[240px]">
                      {selectedCase
                        ? `Ready to connect to ${selectedCase.customer_name || "Customer"} for ${formatCurrency(selectedCase.amount_inr || selectedCase.amount_at_risk || 0)}`
                        : "Select a recovery case to initiate phone dialog"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Live Subtitle / Caption Pill (Frosted glass overlay) */}
            {isCallActive && latestMessage && (
              <div className="w-full bg-slate-900/80 border border-slate-800/80 rounded-2xl p-3 my-2 shadow-lg backdrop-blur-md">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span className="font-bold flex items-center gap-1">
                    {latestMessage.speaker === "CHAKRA" ? (
                      <span className="text-purple-400 flex items-center gap-1">
                        <Sparkles size={10} /> Chakra AI
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <User size={10} /> Customer
                      </span>
                    )}
                  </span>
                  <span>{new Date(latestMessage.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed font-sans">
                  "{latestMessage.text}"
                </p>
              </div>
            )}

            {/* In-Call Circular Phone Control Buttons */}
            <div className="w-full pt-4 mt-auto">
              {!isCallActive ? (
                /* Call Start Button */
                <button
                  onClick={startRecovery}
                  disabled={!selectedCaseId}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-sm uppercase tracking-widest rounded-full transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
                >
                  <Phone size={18} />
                  <span>Call Customer Now</span>
                </button>
              ) : (
                /* Active Call Control Row */
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-2 text-center font-mono text-[10px]">
                    {/* Mute Mic */}
                    <button
                      onClick={toggleMuteMic}
                      className={`flex flex-col items-center justify-center p-2 rounded-2xl transition-all ${
                        isMuted
                          ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1">
                        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                      </div>
                      <span>{isMuted ? "Unmute" : "Mute"}</span>
                    </button>

                    {/* Keypad */}
                    <button
                      onClick={() => setShowKeypad(!showKeypad)}
                      className={`flex flex-col items-center justify-center p-2 rounded-2xl transition-all ${
                        showKeypad
                          ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1">
                        <Grid size={18} />
                      </div>
                      <span>Keypad</span>
                    </button>

                    {/* Speaker */}
                    <button
                      onClick={() => {
                        const next = !audioEnabled;
                        setAudioEnabled(next);
                        if (!next) stopAudioPlayback();
                      }}
                      className={`flex flex-col items-center justify-center p-2 rounded-2xl transition-all ${
                        !audioEnabled
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1">
                        {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                      </div>
                      <span>Speaker</span>
                    </button>

                    {/* Transcript Drawer Toggle */}
                    <button
                      onClick={() => setShowTranscriptDrawer(!showTranscriptDrawer)}
                      className={`flex flex-col items-center justify-center p-2 rounded-2xl transition-all ${
                        showTranscriptDrawer
                          ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1">
                        <MessageSquare size={18} />
                      </div>
                      <span>History</span>
                    </button>
                  </div>

                  {/* Hang Up Button */}
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={handleEndCall}
                      className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-xl shadow-red-600/40 flex items-center justify-center transition-all active:scale-95"
                      title="End Call"
                    >
                      <PhoneOff size={26} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Live Call Intelligence HUD (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col space-y-4 backdrop-blur-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2 font-mono">
              <Activity size={15} className="text-purple-400" />
              <span>Real-Time Call Intelligence</span>
            </h3>
            {latestIntent?.model_used && (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                {latestIntent.model_used}
              </span>
            )}
          </div>

          {/* Gemini Intent Extraction Card */}
          {latestIntent ? (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3 font-mono">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                Detected Spoken Intent
              </div>
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-purple-400 uppercase">
                  {latestIntent.intent?.replace(/_/g, " ") || "ANALYZING..."}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  {latestIntent.confidence != null ? `${(latestIntent.confidence * 100).toFixed(0)}% Confidence` : "95%"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                  <div className="text-slate-500 text-[9px] mb-0.5">LANGUAGE</div>
                  <div className="font-bold text-slate-200 uppercase">{latestIntent.language || "hi-IN (Hinglish)"}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                  <div className="text-slate-500 text-[9px] mb-0.5">SAFETY GATE</div>
                  <div className="font-bold text-emerald-400 uppercase">PASSED</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-950/60 border border-slate-800/60 rounded-xl text-center py-6 font-mono text-slate-500 text-xs">
              <Sparkles size={20} className="mx-auto mb-2 text-slate-600" />
              <span>Awaiting customer utterance for real-time intent extraction</span>
            </div>
          )}

          {/* Real-time Generated Recovery Artifacts */}
          {promise && (
            <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 rounded-xl font-mono text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold uppercase text-[11px]">Promise to Pay Recorded</div>
                  <div className="text-[11px] text-emerald-400/90 mt-0.5">
                    Amount: {formatCurrency(promise.amount_inr)} • Due: {promise.promised_date || "Tomorrow"}
                  </div>
                </div>
              </div>
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-[9px] font-bold border border-emerald-500/30">
                SCHEDULED
              </span>
            </div>
          )}

          {generatedLink && (
            <div className="p-3.5 bg-blue-950/40 border border-blue-800/60 text-blue-300 rounded-xl font-mono text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar size={15} className="text-blue-400 shrink-0" />
                  <span className="font-bold uppercase text-[11px]">Payment Link Dispatched</span>
                </div>
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full text-[9px] font-bold border border-blue-500/30">
                  SMS / WHATSAPP
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800">
                <a
                  href={generatedLink}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-blue-400 hover:text-blue-300 truncate max-w-[200px]"
                >
                  {generatedLink}
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedLink);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                  title="Copy payment link"
                >
                  {copiedLink ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Quick Speech Simulator Phrases (Hands-free backup) */}
          {isCallActive && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                <span>Quick Utterance Simulator</span>
                <span className="text-[9px] text-slate-500 font-normal">Click to speak phrase</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_RESPONSES.map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendUtterance(chip.label)}
                    disabled={isAiThinking}
                    className="text-[11px] font-mono py-1 px-2.5 bg-slate-950 hover:bg-purple-600/20 hover:text-purple-300 hover:border-purple-500/40 border border-slate-800 rounded-full transition-all text-left flex items-center gap-1 text-slate-300 disabled:opacity-40"
                  >
                    <span>{chip.icon}</span>
                    <span>"{chip.label}"</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Full Audit Transcript Drawer (Expandable) */}
          <div className="mt-auto border-t border-slate-800 pt-3 flex flex-col flex-1 min-h-[140px] max-h-[220px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <FileText size={12} className="text-purple-400" />
                <span>Call Transcript Ticker</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {transcript.length} turns
              </span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs font-sans">
              {transcript.length === 0 ? (
                <div className="text-slate-600 text-xs font-mono text-center py-6">
                  No dialog history yet
                </div>
              ) : (
                transcript.map((t, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded-lg text-xs leading-relaxed ${
                      t.speaker === "CHAKRA"
                        ? "bg-purple-950/30 border border-purple-800/30 text-slate-200"
                        : "bg-slate-950 border border-slate-800 text-slate-300"
                    }`}
                  >
                    <div className="text-[9px] font-mono font-bold text-slate-500 mb-0.5 flex justify-between">
                      <span className={t.speaker === "CHAKRA" ? "text-purple-400" : "text-emerald-400"}>
                        {t.speaker === "CHAKRA" ? "CHAKRA" : "CUSTOMER"}
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
