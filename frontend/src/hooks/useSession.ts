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

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [serverSpeaking, setServerSpeaking] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "reconnecting" | "failed">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [whiteboardCommands, setWhiteboardCommands] = useState<WhiteboardCommand[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [voiceCommand, setVoiceCommand] = useState<{ cmd: string; arg?: string } | null>(null);

  const { playChunk, stop: stopAudio } = useAudioPlayer();

  const stopBrowserSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    pendingAutoSpeakRef.current = false;
    activeUtteranceRef.current = null;
    window.speechSynthesis.cancel();
    setTtsSpeaking(false);
  }, []);

  const speakText = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setTtsSpeaking(true);
    utterance.onend = () => {
      if (activeUtteranceRef.current === utterance) {
        activeUtteranceRef.current = null;
        setTtsSpeaking(false);
      }
    };
    utterance.onerror = () => {
      if (activeUtteranceRef.current === utterance) {
        activeUtteranceRef.current = null;
        setTtsSpeaking(false);
      }
    };
    activeUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
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
        switch (msg.type) {
          case "whiteboard":
            setIsThinking(false);
            setWhiteboardCommands((prev) => [
              ...prev,
              msg.payload as unknown as WhiteboardCommand,
            ]);
            break;
          case "transcript": {
            const role = (msg.payload.role as "user" | "tutor") || "tutor";
            const text = msg.payload.text as string;
            if (role === "tutor" && pendingAutoSpeakRef.current && typeof text === "string") {
              pendingAutoSpeakRef.current = false;
              speakText(text);
            }
            addTranscript(role, text);
            break;
          }
          case "status":
            if (msg.payload.speaking !== undefined)
              setServerSpeaking(msg.payload.speaking as boolean);
            if (msg.payload.listening !== undefined)
              setIsListening(msg.payload.listening as boolean);
            if (msg.payload.connected !== undefined)
              setIsConnected(msg.payload.connected as boolean);
            if (msg.payload.reconnecting) {
              // Gemini is reconnecting; UI already shows status via isConnected
            }
            if (msg.payload.reconnected) {
              // Gemini successfully reconnected
            }
            if (msg.payload.interrupted) {
              stopAudio();
              stopBrowserSpeech();
              setIsThinking(false);
            }
            if (msg.payload.turn_complete) {
              setIsThinking(false);
            }
            if (msg.payload.error) {
              pendingAutoSpeakRef.current = false;
              stopBrowserSpeech();
              setIsThinking(false);
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
            pendingAutoSpeakRef.current = false;
            stopBrowserSpeech();
            setIsThinking(false);
            setErrorMessage(typeof msg.payload === "string" ? msg.payload : "Something went wrong — please try again.");
            setTimeout(() => setErrorMessage(null), 6000);
            break;
        }
      } catch (err) {
        console.error("Failed to parse server message:", err);
      }
    },
    [addTranscript, playChunk, speakText, stopAudio, stopBrowserSpeech],
  );

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
        startMic();
      };
      ws.onclose = () => {
        setIsConnected(false);
        setIsListening(false);
        setServerSpeaking(false);
        setTtsSpeaking(false);
        setIsThinking(false);
        stopMic();
        stopAudio();
        stopBrowserSpeech();
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
  }, [handleMessage, startMic, stopAudio, stopBrowserSpeech, stopMic]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptRef.current = 0;
    stopMic();
    stopAudio();
    stopBrowserSpeech();
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus("idle");
  }, [stopAudio, stopBrowserSpeech, stopMic]);

  const startTalking = useCallback(() => {
    micActiveRef.current = true;
    pendingAutoSpeakRef.current = false;
    setIsListening(true);
    stopAudio();
    stopBrowserSpeech();
  }, [stopAudio, stopBrowserSpeech]);

  const stopTalking = useCallback(() => {
    micActiveRef.current = false;
    setIsListening(false);
    setIsThinking(true);
  }, []);

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
      setIsThinking(true);
    },
    [addTranscript, send, stopAudio, stopBrowserSpeech],
  );

  const sendText = useCallback(
    (text: string, imageBase64?: string) => {
      const cleaned = normalizeInput(text);
      if (imageBase64) {
        sendImage(imageBase64, cleaned);
        return;
      }
      if (!cleaned.trim()) return;

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
      setIsThinking(true);
    },
    [addTranscript, send, sendImage, stopAudio, stopBrowserSpeech],
  );

  useEffect(() => {
    return () => {
      stopBrowserSpeech();
      stopMic();
      wsRef.current?.close();
    };
  }, [stopBrowserSpeech, stopMic]);

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
    whiteboardCommands,
    transcript,
    voiceCommand,
  };
}
