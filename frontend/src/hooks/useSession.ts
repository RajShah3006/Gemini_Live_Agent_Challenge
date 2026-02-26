"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "@/lib/config";
import type {
  WhiteboardCommand,
  TranscriptEntry,
  ServerMessage,
} from "@/lib/types";

export function useSession() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [whiteboardCommands, setWhiteboardCommands] = useState<
    WhiteboardCommand[]
  >([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

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
            break;
          case "audio":
            // Audio playback will be handled in Phase 2
            break;
          case "error":
            console.error("Server error:", msg.payload);
            break;
        }
      } catch {
        console.error("Failed to parse server message");
      }
    },
    [addTranscript],
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => {
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
    };
    ws.onmessage = handleMessage;
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [handleMessage]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

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
    },
    [send, addTranscript],
  );

  const sendText = useCallback(
    (text: string) => {
      send("text", { text });
      addTranscript("user", text);
    },
    [send, addTranscript],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    isConnected,
    isListening,
    isSpeaking,
    connect,
    disconnect,
    sendImage,
    sendText,
    whiteboardCommands,
    transcript,
  };
}
