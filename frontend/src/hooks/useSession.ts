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
  const micActiveRef = useRef(false);

  const { playChunk, stop: stopAudio } = useAudioPlayer();

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

  const addTranscript = useCallback(
    (role: "user" | "tutor", text: string) => {
      setTranscript((prev) => [
        ...prev,
        { role, text, timestamp: Date.now() },
      ]);
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
            if (msg.payload.connected !== undefined)
              setIsConnected(msg.payload.connected as boolean);
            if (msg.payload.reconnected) {
              console.log("[SESSION] Gemini auto-reconnected successfully");
            }
            if (msg.payload.reconnecting) {
              console.log("[SESSION] Gemini reconnecting...");
            }
            // Flush audio queue on interruption
            if (msg.payload.interrupted) {
              stopAudio();
              setIsThinking(false);
            }
            if (msg.payload.turn_complete) {
              setIsThinking(false);
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
        startMic();
      };
      ws.onclose = () => {
        setIsConnected(false);
        setIsListening(false);
        setIsSpeaking(false);
        stopMic();
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
      ws.onmessage = handleMessage;
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    };

    attemptConnect();
  }, [handleMessage, startMic, stopMic, stopAudio]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptRef.current = 0;
    stopMic();
    stopAudio();
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus("idle");
  }, [stopMic, stopAudio]);

  // Push-to-talk: hold Space to talk
  const startTalking = useCallback(() => {
    micActiveRef.current = true;
    setIsListening(true);
    // Flush tutor audio so student can interrupt
    stopAudio();
  }, [stopAudio]);

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

  const sendText = useCallback(
    (text: string) => {
      const cleaned = normalizeInput(text);
      // Show the user's question on the whiteboard before Gemini responds
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
    [send, addTranscript],
  );

  useEffect(() => {
    return () => {
      stopMic();
      wsRef.current?.close();
    };
  }, [stopMic]);

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
    whiteboardCommands,
    transcript,
  };
}
