"use client";

/**
 * Microphone capture hook — captures PCM audio and streams it via callback.
 * Audio is captured as 16-bit PCM at 16kHz mono (Gemini Live API input format).
 *
 * Uses AudioWorklet (modern, glitch-free) with ScriptProcessorNode fallback
 * for browsers that don't support AudioWorklet.
 */

import { useCallback, useRef, useState } from "react";

export function useMicrophone(onAudioChunk: (base64: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onAudioChunkRef = useRef(onAudioChunk);
  onAudioChunkRef.current = onAudioChunk;

  const arrayBufferToBase64 = useCallback((buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

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

      // Try AudioWorklet first (modern path), fall back to ScriptProcessor
      let useWorklet = false;
      if (context.audioWorklet) {
        try {
          await context.audioWorklet.addModule("/audio-worklet-processor.js");
          useWorklet = true;
        } catch (e) {
          console.warn("AudioWorklet failed to load, falling back to ScriptProcessor:", e);
        }
      }

      if (useWorklet) {
        const workletNode = new AudioWorkletNode(context, "pcm-capture-processor");
        workletNode.port.onmessage = (e: MessageEvent) => {
          const int16Buffer = e.data as ArrayBuffer;
          const base64 = arrayBufferToBase64(int16Buffer);
          onAudioChunkRef.current(base64);
        };
        source.connect(workletNode);
        workletNode.connect(context.destination);
        workletNodeRef.current = workletNode;
      } else {
        // Fallback: ScriptProcessorNode (deprecated but widely supported)
        const processor = context.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          onAudioChunkRef.current(arrayBufferToBase64(int16.buffer));
        };
        source.connect(processor);
        processor.connect(context.destination);
        processorRef.current = processor;
      }

      contextRef.current = context;
      streamRef.current = stream;
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  }, [arrayBufferToBase64]);

  const stop = useCallback(() => {
    workletNodeRef.current?.disconnect();
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    contextRef.current?.close();
    workletNodeRef.current = null;
    processorRef.current = null;
    streamRef.current = null;
    contextRef.current = null;
    setIsRecording(false);
  }, []);

  return { isRecording, start, stop };
}
