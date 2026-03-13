"use client";

/**
 * useSession — Core session hook managing the WebSocket connection to the backend.
 *
 * Responsibilities:
 *  - WebSocket lifecycle (connect / disconnect / reconnect with exponential backoff)
 *  - Sending text, images, and audio chunks to the backend
 *  - Receiving whiteboard commands, transcripts, audio, and status updates
 *  - Browser TTS for text-mode tutor responses (Live API handles voice-mode audio)
 *  - Voice commands (undo, clear, zoom, goto question)
 *  - Heartbeat monitoring (kills stale connections after 120s silence)
 *  - Thinking timeout (auto-cancels spinner after 90s)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "@/lib/config";
import type {
  WhiteboardCommand,
  TranscriptEntry,
  ServerMessage,
} from "@/lib/types";
import { useMicrophone } from "./useMicrophone";
import { useAudioPlayer } from "./useAudioPlayer";

const TYPO_RULES: Array<[RegExp, string]> = Object.entries({
  deravitive: "derivative", derivitive: "derivative", dervative: "derivative",
  intergral: "integral", intergrate: "integrate", integerate: "integrate",
  multipley: "multiply", multipication: "multiplication",
  equasion: "equation", equaton: "equation",
  algebera: "algebra", algebre: "algebra",
  trigonmetry: "trigonometry", trignometry: "trigonometry",
  calclus: "calculus", calculis: "calculus",
  coefficent: "coefficient", coefficeint: "coefficient",
  asymtote: "asymptote",
  logarithim: "logarithm", logrithm: "logarithm",
  polinomial: "polynomial", polynominal: "polynomial",
  factorise: "factorize", simplfy: "simplify",
  whats: "what's", hows: "how's", thats: "that's",
}).map(([wrong, right]) => [new RegExp(`\\b${wrong}\\b`, "gi"), right]);

function normalizeInput(text: string): string {
  let result = text;
  for (const [re, replacement] of TYPO_RULES) result = result.replace(re, replacement);
  return result;
}

// ── Student-friendly error messages ──
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource exhausted"))
    return "The tutor is taking a short break — too many requests. Try again in a few seconds! ☕";
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("high demand"))
    return "The AI tutor is busy right now. Try again in a moment! 🤔";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("connect"))
    return "Check your internet connection and try again 🌐";
  if (lower.includes("1011") || lower.includes("1008") || lower.includes("internal"))
    return "The voice connection dropped — reconnecting automatically... 🔄";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The request took too long. Try a shorter question! ⏱️";
  // Pass through if already friendly or short
  if (raw.length < 100) return raw;
  return "Something went wrong. Try sending your question again! 🔁";
}

// ── Thinking timeout — prevents infinite spinner ──
const THINKING_TIMEOUT_MS = 90_000;

// ── WebSocket heartbeat ──
// Check every 30s if we've received ANY message recently.
// Only kill the connection if there's been absolute silence for 120s.
const HEARTBEAT_CHECK_MS = 30_000;
const HEARTBEAT_DEAD_MS = 120_000;

export function useSession() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const pendingAutoSpeakRef = useRef(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const micActiveRef = useRef(false);
  const micInitializedRef = useRef(false); // [Fix 3] Lazy mic init

  // Auto-mic: open the mic automatically after the AI finishes responding
  // [Fix 5] Default to OFF — most users type, not talk
  const autoMicRef = useRef(false);

  // [Fix 1] Thinking timeout ref
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // [Fix 2] Heartbeat refs
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageAtRef = useRef(Date.now()); // tracks last message from server

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [serverSpeaking, setServerSpeaking] = useState(false);
  const serverSpeakingRef = useRef(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "reconnecting" | "failed">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [whiteboardCommands, setWhiteboardCommands] = useState<WhiteboardCommand[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [voiceCommand, setVoiceCommand] = useState<{ cmd: string; arg?: string } | null>(null);
  const [autoMicEnabled, setAutoMicEnabled] = useState(false); // [Fix 5] Default OFF

  const { playChunk, stop: stopAudio } = useAudioPlayer();

  // ── [Fix 1] Thinking timeout management ──
  const clearThinkingTimeout = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }, []);

  const startThinkingWithTimeout = useCallback(() => {
    setIsThinking(true);
    clearThinkingTimeout();
    thinkingTimerRef.current = setTimeout(() => {
      setIsThinking(false);
      setErrorMessage("The tutor took too long to respond. Try sending your question again! ⏱️");
      setTimeout(() => setErrorMessage(null), 6000);
    }, THINKING_TIMEOUT_MS);
  }, [clearThinkingTimeout]);

  const clearThinking = useCallback(() => {
    setIsThinking(false);
    clearThinkingTimeout();
  }, [clearThinkingTimeout]);

  // ── Show error toast helper ──
  const showError = useCallback((msg: string) => {
    setErrorMessage(friendlyError(msg));
    setTimeout(() => setErrorMessage(null), 6000);
  }, []);

  const stopBrowserSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    pendingAutoSpeakRef.current = false;
    activeUtteranceRef.current = null;
    window.speechSynthesis.cancel();
    setTtsSpeaking(false);
  }, []);

  // Open the mic after the AI finishes speaking (auto-mic mode).
  const openMicIfAutoEnabled = useCallback(() => {
    if (!autoMicRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (micActiveRef.current) return;
    micActiveRef.current = true;
    setIsListening(true);
  }, []);

  const speakText = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    window.speechSynthesis.cancel();

    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.rate = 1;
      utterance.pitch = 1;

      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en")) ||
        voices.find((v) => v.lang.startsWith("en-US")) ||
        voices.find((v) => v.lang.startsWith("en")) ||
        null;
      if (voice) utterance.voice = voice;

      let watchdog: ReturnType<typeof setInterval> | null = null;

      utterance.onstart = () => {
        setTtsSpeaking(true);
        watchdog = setInterval(() => {
          if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        }, 5000);
      };

      const cleanup = (interrupted: boolean) => {
        if (watchdog) clearInterval(watchdog);
        if (activeUtteranceRef.current === utterance) {
          activeUtteranceRef.current = null;
          setTtsSpeaking(false);
          if (!interrupted) openMicIfAutoEnabled();
        }
      };

      utterance.onend = () => cleanup(false);
      utterance.onerror = (e) => {
        if (e.error !== "interrupted") console.warn("TTS error:", e.error);
        cleanup(e.error === "interrupted");
      };

      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      const handler = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", handler);
        doSpeak();
      };
      window.speechSynthesis.addEventListener("voiceschanged", handler);
      setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", handler);
        if (!activeUtteranceRef.current) doSpeak();
      }, 1000);
    } else {
      doSpeak();
    }
  }, [openMicIfAutoEnabled]);

  const sendAudioChunk = useCallback(
    (base64: string) => {
      if (micActiveRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "audio", payload: { data: base64 } }),
        );
      }
    },
    [],
  );

  const { start: startMic, stop: stopMic } = useMicrophone(sendAudioChunk);

  const addTranscript = useCallback(
    (role: "user" | "tutor", text: string) => {
      setTranscript((prev) => [
        ...prev,
        { role, text, timestamp: Date.now() },
      ]);
      if (role === "user") {
        const t = text.toLowerCase().trim();
        if (/\b(clear|erase)\s*(the\s*)?(board|whiteboard|canvas)\b/.test(t)) {
          setVoiceCommand({ cmd: "clear" });
        } else if (/\bzoom\s*in\b/.test(t)) {
          setVoiceCommand({ cmd: "zoom_in" });
        } else if (/\bzoom\s*out\b/.test(t)) {
          setVoiceCommand({ cmd: "zoom_out" });
        } else if (/\b(go\s*to|show|scroll\s*to)\s*q(?:uestion)?\s*(\d+)\b/.test(t)) {
          const m = t.match(/\b(?:go\s*to|show|scroll\s*to)\s*q(?:uestion)?\s*(\d+)\b/);
          if (m) setVoiceCommand({ cmd: "goto_q", arg: m[1] });
        } else if (/\bundo\b/.test(t)) {
          setVoiceCommand({ cmd: "undo" });
        }
      }
    },
    [],
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);

        // [Fix 2] ANY message from server = connection is alive
        lastMessageAtRef.current = Date.now();

        switch (msg.type) {
          case "pong":
            // Heartbeat response — already tracked above via lastMessageAtRef
            break;
          case "whiteboard":
            clearThinking();
            setWhiteboardCommands((prev) => [
              ...prev,
              msg.payload as unknown as WhiteboardCommand,
            ]);
            break;
          case "transcript": {
            clearThinking();
            const role = (msg.payload.role as "user" | "tutor") || "tutor";
            const text = msg.payload.text as string;
            if (role === "tutor" && typeof text === "string" && text.trim()) {
              // Always speak tutor text via browser TTS (unless Live API audio is active)
              if (pendingAutoSpeakRef.current || !serverSpeakingRef.current) {
                pendingAutoSpeakRef.current = false;
                speakText(text);
              }
            }
            addTranscript(role, text);
            break;
          }
          case "status":
            if (msg.payload.speaking !== undefined) {
              const s = msg.payload.speaking as boolean;
              setServerSpeaking(s);
              serverSpeakingRef.current = s;
            }
            if (msg.payload.listening !== undefined)
              setIsListening(msg.payload.listening as boolean);
            if (msg.payload.connected !== undefined)
              setIsConnected(msg.payload.connected as boolean);
            if (msg.payload.reconnecting) {
              // Gemini is reconnecting; UI already shows status via isConnected
            }
            if (msg.payload.reconnected) {
              // [Fix 7] Show reconnect success toast
              setErrorMessage("Reconnected! Your session continues. 🔄");
              setTimeout(() => setErrorMessage(null), 3000);
            }
            if (msg.payload.interrupted) {
              stopAudio();
              stopBrowserSpeech();
              clearThinking();
            }
            if (msg.payload.turn_complete) {
              clearThinking();
              // For voice responses (Live API), open mic after audio buffer drains.
              if (!pendingAutoSpeakRef.current) {
                setTimeout(() => openMicIfAutoEnabled(), 800);
              }
            }
            if (msg.payload.error) {
              pendingAutoSpeakRef.current = false;
              stopBrowserSpeech();
              clearThinking();
              showError(msg.payload.error as string);
            }
            break;
          case "audio":
            clearThinking();
            // [Fix 11] Cancel browser TTS when Live API audio arrives
            stopBrowserSpeech();
            if (msg.payload.data) {
              playChunk(msg.payload.data as string);
            }
            break;
          case "error":
            pendingAutoSpeakRef.current = false;
            stopBrowserSpeech();
            clearThinking();
            showError(typeof msg.payload === "string" ? msg.payload : "Something went wrong — please try again.");
            break;
        }
      } catch (err) {
        console.error("Failed to parse server message:", err);
      }
    },
    [addTranscript, clearThinking, openMicIfAutoEnabled, playChunk, showError, speakText, stopAudio, stopBrowserSpeech],
  );

  // ── [Fix 2] Activity-based heartbeat ──
  // Instead of strict ping/pong, track when we last received ANY message.
  // Only send a ping if we haven't heard from the server in a while.
  // Only kill the connection if there's been absolute silence.
  const startHeartbeat = useCallback(() => {
    stopHeartbeatRef.current?.();
    lastMessageAtRef.current = Date.now();
    heartbeatIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const silenceMs = Date.now() - lastMessageAtRef.current;
      if (silenceMs > HEARTBEAT_DEAD_MS) {
        // No message for 45s — connection is truly dead
        console.warn(`No server activity for ${Math.round(silenceMs / 1000)}s — reconnecting`);
        wsRef.current.close();
      } else if (silenceMs > HEARTBEAT_CHECK_MS * 0.8) {
        // Getting close to timeout — send a ping to check
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_CHECK_MS);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);
  // Store in ref so startHeartbeat can call it without circular dep
  const stopHeartbeatRef = useRef(stopHeartbeat);
  stopHeartbeatRef.current = stopHeartbeat;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    intentionalDisconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const attemptConnect = () => {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus("connected");
        reconnectAttemptRef.current = 0;
        // [Fix 3] DON'T start mic here — lazy init on first talk
        // [Fix 2] Start heartbeat
        startHeartbeat();

        // [Fix 7] Show reconnect toast if this was a reconnect
        if (micInitializedRef.current) {
          // Not the first connect — this is a reconnect
          setErrorMessage("Reconnected! Your session continues. 🔄");
          setTimeout(() => setErrorMessage(null), 3000);
        }
      };
      ws.onclose = () => {
        setIsConnected(false);
        setIsListening(false);
        setServerSpeaking(false);
        setTtsSpeaking(false);
        clearThinking();
        micActiveRef.current = false;
        stopAudio();
        stopBrowserSpeech();
        stopHeartbeat();
        if (!intentionalDisconnectRef.current && reconnectAttemptRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 16000);
          reconnectAttemptRef.current += 1;
          setConnectionStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(attemptConnect, delay);
        } else if (reconnectAttemptRef.current >= 5) {
          setConnectionStatus("failed");
        }
      };
      ws.onmessage = handleMessage;
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    };

    attemptConnect();
  }, [clearThinking, handleMessage, startHeartbeat, stopAudio, stopBrowserSpeech, stopHeartbeat]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptRef.current = 0;
    micActiveRef.current = false;
    stopMic();
    stopAudio();
    stopBrowserSpeech();
    stopHeartbeat();
    clearThinking();
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus("idle");
    micInitializedRef.current = false;
  }, [clearThinking, stopAudio, stopBrowserSpeech, stopHeartbeat, stopMic]);

  // [Fix 3] Lazy mic initialization — only start mic on first talk
  const ensureMicStarted = useCallback(() => {
    if (!micInitializedRef.current) {
      micInitializedRef.current = true;
      startMic();
    }
  }, [startMic]);

  const startTalking = useCallback(() => {
    ensureMicStarted(); // [Fix 3]
    micActiveRef.current = true;
    pendingAutoSpeakRef.current = false;
    setIsListening(true);
    stopAudio();
    stopBrowserSpeech();
  }, [ensureMicStarted, stopAudio, stopBrowserSpeech]);

  const stopTalking = useCallback(() => {
    micActiveRef.current = false;
    setIsListening(false);
    startThinkingWithTimeout(); // [Fix 1] Use timeout version
  }, [startThinkingWithTimeout]);

  const toggleAutoMic = useCallback(() => {
    setAutoMicEnabled((prev) => {
      const next = !prev;
      autoMicRef.current = next;
      // If turning on, ensure mic is initialized
      if (next) ensureMicStarted();
      // If turning off, stop any active auto-mic listening
      if (!next && micActiveRef.current) {
        micActiveRef.current = false;
        setIsListening(false);
      }
      return next;
    });
  }, [ensureMicStarted]);

  useEffect(() => {
    if (!isConnected) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        startTalking();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        stopTalking();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [isConnected, startTalking, stopTalking]);

  const send = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, payload }));
      }
    },
    [],
  );

  const sendImage = useCallback(
    (base64: string, text = "") => {
      const cleaned = normalizeInput(text);
      micActiveRef.current = false;
      setIsListening(false);
      pendingAutoSpeakRef.current = true;
      stopAudio();
      stopBrowserSpeech();
      send("image", { data: base64, text: cleaned });
      if (cleaned) {
        setWhiteboardCommands((prev) => [
          ...prev,
          {
            id: `qh-${Date.now()}`,
            action: "question_header",
            params: { text: cleaned },
          },
        ]);
      }
      addTranscript("user", cleaned ? `📷 ${cleaned}` : "📷 Uploaded an image");
      startThinkingWithTimeout(); // [Fix 1]
    },
    [addTranscript, send, startThinkingWithTimeout, stopAudio, stopBrowserSpeech],
  );

  const interrupt = useCallback(() => {
    micActiveRef.current = false;
    setIsListening(false);
    pendingAutoSpeakRef.current = false;
    stopAudio();
    stopBrowserSpeech();
    clearThinking();
    send("interrupt", {});
    addTranscript("user", "✋ Stopped the tutor");
  }, [addTranscript, clearThinking, send, stopAudio, stopBrowserSpeech]);

  const sendText = useCallback(
    (text: string, imageBase64?: string) => {
      const cleaned = normalizeInput(text);
      if (imageBase64) {
        sendImage(imageBase64, cleaned);
        return;
      }
      if (!cleaned.trim()) return;

      micActiveRef.current = false;
      setIsListening(false);
      pendingAutoSpeakRef.current = true;
      stopAudio();
      stopBrowserSpeech();
      setWhiteboardCommands((prev) => [
        ...prev,
        {
          id: `qh-${Date.now()}`,
          action: "question_header",
          params: { text: cleaned },
        },
      ]);
      send("text", { text: cleaned });
      addTranscript("user", cleaned);
      startThinkingWithTimeout(); // [Fix 1]
    },
    [addTranscript, send, sendImage, startThinkingWithTimeout, stopAudio, stopBrowserSpeech],
  );

  useEffect(() => {
    return () => {
      stopBrowserSpeech();
      stopMic();
      stopHeartbeat();
      clearThinkingTimeout();
      wsRef.current?.close();
    };
  }, [clearThinkingTimeout, stopBrowserSpeech, stopHeartbeat, stopMic]);

  return {
    isConnected,
    isListening,
    isSpeaking: serverSpeaking || ttsSpeaking,
    isThinking,
    connectionStatus,
    errorMessage,
    connect,
    disconnect,
    sendImage,
    sendText,
    startTalking,
    stopTalking,
    interrupt,
    whiteboardCommands,
    setWhiteboardCommands,
    transcript,
    setTranscript,
    voiceCommand,
    setVoiceCommand,
    autoMicEnabled,
    toggleAutoMic,
  };
}
