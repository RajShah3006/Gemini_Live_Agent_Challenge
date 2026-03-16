"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "@/lib/config";
import type {
  WhiteboardCommand,
  TranscriptEntry,
  ServerMessage,
} from "@/lib/types";
import { useMicrophone } from "./useMicrophone";
import { useAudioPlayer } from "./useAudioPlayer";

// Pre-compiled typo corrections (avoids creating 30+ regex per keystroke)
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

  // Track when the AI has asked the student a question — next input continues same page
  const awaitingAnswerRef = useRef(false);

  // [Fix 1] Thinking timeout ref
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // [Fix 2] Heartbeat refs
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageAtRef = useRef(Date.now()); // tracks last message from server

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "reconnecting" | "failed">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [whiteboardCommands, setWhiteboardCommands] = useState<
    WhiteboardCommand[]
  >([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [voiceCommand, setVoiceCommand] = useState<{ cmd: string; arg?: string } | null>(null);
  const [autoMicEnabled, setAutoMicEnabled] = useState(false);

  const { playChunk, stop: stopAudio } = useAudioPlayer();

  const stopBrowserSpeech = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeUtteranceRef.current) {
      activeUtteranceRef.current = null;
    }
  }, []);

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

  const { isRecording, start: startMic, stop: stopMic } =
    useMicrophone(sendAudioChunk);

  const clearThinking = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setIsThinking(false);
  }, []);

  const addTranscript = useCallback(
    (role: "user" | "tutor", text: string) => {
      setTranscript((prev) => [
        ...prev,
        { role, text, timestamp: Date.now() },
      ]);
      // Detect voice commands from user speech
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
        switch (msg.type) {
          case "whiteboard":
            setIsThinking(false);
            setWhiteboardCommands((prev) => [
              ...prev,
              msg.payload as unknown as WhiteboardCommand,
            ]);
            break;
          case "transcript":
            addTranscript(
              (msg.payload.role as "user" | "tutor") || "tutor",
              msg.payload.text as string,
            );
            break;
          case "status":
            if (msg.payload.speaking !== undefined)
              setIsSpeaking(msg.payload.speaking as boolean);
            if (msg.payload.listening !== undefined)
              setIsListening(msg.payload.listening as boolean);
            // Ignore backend Gemini-level connected/reconnecting — WS onopen/onclose handles our connection status
            if (msg.payload.reconnected) {
              console.log("[SESSION] Gemini auto-reconnected successfully");
            }
            if (msg.payload.reconnecting) {
              console.log("[SESSION] Gemini reconnecting (internal)...");
            }
            // Flush audio queue on interruption
            if (msg.payload.interrupted) {
              stopAudio();
              setIsThinking(false);
            }
            if (msg.payload.turn_complete) {
              setIsThinking(false);
            }
            if (msg.payload.awaiting_answer) {
              // AI asked the student a question — next input stays on same page
              awaitingAnswerRef.current = true;
            }
            if (msg.payload.error) {
              setErrorMessage(msg.payload.error as string);
              setTimeout(() => setErrorMessage(null), 6000);
            }
            break;
          case "audio":
            setIsThinking(false);
            if (msg.payload.data) {
              playChunk(msg.payload.data as string);
            }
            break;
          case "error":
            console.error("Server error:", msg.payload);
            setErrorMessage(typeof msg.payload === "string" ? msg.payload : "Something went wrong — please try again.");
            setTimeout(() => setErrorMessage(null), 6000);
            break;
        }
      } catch {
        console.error("Failed to parse server message");
      }
    },
    [addTranscript, playChunk, stopAudio],
  );

  // Keep a stable ref to handleMessage so the WS onmessage callback always
  // calls the latest version without needing to recreate the WebSocket.
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    intentionalDisconnectRef.current = false;
    // Clear any pending reconnect timer to prevent duplicate connections
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
        // Start heartbeat to keep WS alive (prevents backend idle timeout + Cloud Run timeout)
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", payload: {} }));
          }
        }, 25_000); // every 25s — well within 5min backend timeout
        // Mic is lazily initialized on first push-to-talk interaction
        // (see startTalking) — NOT on connect — to avoid browser permission
        // popup glitch.
      };
      ws.onclose = () => {
        // Stop heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setIsConnected(false);
        setIsListening(false);
        setIsSpeaking(false);
        stopMic();
        micInitializedRef.current = false; // allow re-init on next push-to-talk
        stopAudio();
        // Auto-reconnect with exponential backoff (unless intentional disconnect)
        if (!intentionalDisconnectRef.current && reconnectAttemptRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 16000);
          reconnectAttemptRef.current += 1;
          setConnectionStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(attemptConnect, delay);
        } else if (reconnectAttemptRef.current >= 5) {
          setConnectionStatus("failed");
        }
      };
      ws.onmessage = (e) => handleMessageRef.current(e);
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    };

    attemptConnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopMic, stopAudio]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    micInitializedRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    stopMic();
    stopAudio();
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus("idle");
  }, [stopMic, stopAudio]);

  // Push-to-talk: hold Space to talk
  const startTalking = useCallback(() => {
    // Lazy mic init on first push-to-talk (avoids permission popup on connect)
    if (!micInitializedRef.current) {
      micInitializedRef.current = true;
      startMic();
    }
    micActiveRef.current = true;
    setIsListening(true);
    // Flush tutor audio so student can interrupt
    stopAudio();
  }, [startMic, stopAudio]);

  const stopTalking = useCallback(() => {
    micActiveRef.current = false;
    setIsListening(false);
    setIsThinking(true);
  }, []);

  // Spacebar push-to-talk
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
    (base64: string) => {
      send("image", { data: base64 });
      addTranscript("user", "📷 Uploaded an image");
      setIsThinking(true);
    },
    [send, addTranscript],
  );

  const interrupt = useCallback(() => {
    micActiveRef.current = false;
    setIsListening(false);
    pendingAutoSpeakRef.current = false;
    awaitingAnswerRef.current = false;
    stopAudio();
    stopBrowserSpeech();
    clearThinking();
    send("interrupt", {});
    addTranscript("user", "✋ Stopped the tutor");
  }, [addTranscript, clearThinking, send, stopAudio, stopBrowserSpeech]);

  const sendText = useCallback(
    (text: string) => {
      const cleaned = normalizeInput(text);
      if (!cleaned.trim()) return;

      micActiveRef.current = false;
      setIsListening(false);
      pendingAutoSpeakRef.current = true;
      stopAudio();
      stopBrowserSpeech();

      // If the AI asked a question and the student is answering,
      // emit student_answer (continues same page) instead of question_header (new page).
      const isAnswer = awaitingAnswerRef.current;
      awaitingAnswerRef.current = false;

      setWhiteboardCommands((prev) => [
        ...prev,
        {
          id: `${isAnswer ? "sa" : "qh"}-${Date.now()}`,
          action: isAnswer ? "student_answer" : "question_header",
          params: { text: cleaned },
        },
      ]);
      send("text", { text: cleaned });
      addTranscript("user", cleaned);
      setIsThinking(true);
    },
    [send, addTranscript],
  );

  useEffect(() => {
    return () => {
      stopMic();
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      wsRef.current?.close();
    };
  }, [stopMic]);

  const toggleAutoMic = useCallback(() => {
    setAutoMicEnabled((prev) => {
      autoMicRef.current = !prev;
      return !prev;
    });
  }, []);

  const sendMode = useCallback(
    (mode: "teacher" | "quick") => {
      send("set_mode", { mode });
    },
    [send],
  );

  return {
    isConnected,
    isListening,
    isSpeaking,
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
    autoMicEnabled,
    toggleAutoMic,
    voiceCommand,
    sendMode,
  };
}
