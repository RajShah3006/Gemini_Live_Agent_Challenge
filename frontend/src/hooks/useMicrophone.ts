"use client";

/**
 * Microphone capture hook — captures PCM audio and streams it via callback.
 * Audio is captured as 16-bit PCM at 16kHz mono (Gemini Live API input format).
 */

import { useCallback, useRef, useState } from "react";

export function useMicrophone(onAudioChunk: (base64: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const context = new AudioContext({ sampleRate: 16000 });
      const source = context.createMediaStreamSource(stream);
      // Buffer size 4096 at 16kHz = ~256ms chunks
      const processor = context.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // Convert to base64
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        onAudioChunk(btoa(binary));
      };

      source.connect(processor);
      processor.connect(context.destination);

      contextRef.current = context;
      streamRef.current = stream;
      processorRef.current = processor;
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  }, [onAudioChunk]);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    contextRef.current?.close();
    processorRef.current = null;
    streamRef.current = null;
    contextRef.current = null;
    setIsRecording(false);
  }, []);

  return { isRecording, start, stop };
}
