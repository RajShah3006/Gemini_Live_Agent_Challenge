"use client";

/**
 * Audio playback hook — plays PCM audio chunks received from Gemini.
 * Expects 16-bit PCM at 24kHz mono (Gemini Live API output format).
 */

import { useCallback, useRef, useState } from "react";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const nextStartRef = useRef(0);

  const getContext = useCallback(() => {
    if (!contextRef.current || contextRef.current.state === "closed") {
      contextRef.current = new AudioContext({ sampleRate: 24000 });
      const gain = contextRef.current.createGain();
      gain.connect(contextRef.current.destination);
      gainRef.current = gain;
      nextStartRef.current = 0;
    }
    return contextRef.current;
  }, []);

  const playChunk = useCallback(
    (base64Data: string) => {
      const ctx = getContext();

      const doPlay = () => {
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
        source.connect(gainRef.current || ctx.destination);

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
      };

      // Browser autoplay policy may suspend the context until a user gesture.
      // Resume it before scheduling audio so chunks always play.
      if (ctx.state === "suspended") {
        ctx.resume().then(doPlay).catch(doPlay);
      } else {
        doPlay();
      }
    },
    [getContext],
  );

  const stop = useCallback(() => {
    const ctx = contextRef.current;
    const gain = gainRef.current;
    if (ctx && gain) {
      // Smooth 120ms fadeout to avoid click/pop
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.12);
      setTimeout(() => {
        ctx.close().catch(() => {});
        contextRef.current = null;
        gainRef.current = null;
      }, 130);
    } else if (ctx) {
      ctx.close().catch(() => {});
      contextRef.current = null;
    }
    nextStartRef.current = 0;
    setIsPlaying(false);
  }, []);

  return { isPlaying, playChunk, stop };
}
