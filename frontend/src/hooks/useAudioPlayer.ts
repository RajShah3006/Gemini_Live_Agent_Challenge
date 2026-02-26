"use client";

/**
 * Audio playback hook — plays PCM audio chunks received from Gemini.
 * Expects 16-bit PCM at 24kHz mono (Gemini Live API output format).
 */

import { useCallback, useRef, useState } from "react";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);

  const getContext = useCallback(() => {
    if (!contextRef.current || contextRef.current.state === "closed") {
      contextRef.current = new AudioContext({ sampleRate: 24000 });
      nextStartRef.current = 0;
    }
    return contextRef.current;
  }, []);

  const playChunk = useCallback(
    (base64Data: string) => {
      const ctx = getContext();
      // Decode base64 to bytes
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Convert Int16 PCM to Float32
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x8000;
      }

      // Create and schedule audio buffer
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextStartRef.current);
      source.start(startTime);
      nextStartRef.current = startTime + buffer.duration;

      setIsPlaying(true);
      source.onended = () => {
        if (ctx.currentTime >= nextStartRef.current - 0.01) {
          setIsPlaying(false);
        }
      };
    },
    [getContext],
  );

  const stop = useCallback(() => {
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    nextStartRef.current = 0;
    setIsPlaying(false);
  }, []);

  return { isPlaying, playChunk, stop };
}
