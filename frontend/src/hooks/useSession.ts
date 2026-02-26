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

export function useSession() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [whiteboardCommands, setWhiteboardCommands] = useState<
    WhiteboardCommand[]
  >([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  const { playChunk, stop: stopAudio } = useAudioPlayer();

  const sendAudioChunk = useCallback(
    (base64: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
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
            // Play audio from Gemini
            if (msg.payload.data) {
              playChunk(msg.payload.data as string);
            }
            break;
          case "error":
            console.error("Server error:", msg.payload);
            break;
        }
      } catch {
        console.error("Failed to parse server message");
      }
    },
    [addTranscript, playChunk],
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      setIsConnected(true);
      // Start microphone capture once connected
      startMic();
      setIsListening(true);
    };
    ws.onclose = () => {
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
      stopMic();
      stopAudio();
    };
    ws.onmessage = handleMessage;
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [handleMessage, startMic, stopMic, stopAudio]);

  const disconnect = useCallback(() => {
    stopMic();
    stopAudio();
    wsRef.current?.close();
    wsRef.current = null;
  }, [stopMic, stopAudio]);

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
      stopMic();
      wsRef.current?.close();
    };
  }, [stopMic]);

  return {
    isConnected,
    isListening: isListening || isRecording,
    isSpeaking,
    connect,
    disconnect,
    sendImage,
    sendText,
    whiteboardCommands,
    transcript,
  };
}
