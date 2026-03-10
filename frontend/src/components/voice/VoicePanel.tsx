"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { AudioVisualizer } from "./AudioVisualizer";

import type { QuestionInfo } from "@/components/whiteboard/Whiteboard";
import { extractImageFileFromClipboard, readImageFileAsDataUrl } from "@/lib/imageUpload";

interface VoicePanelProps {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  isThinking?: boolean;
  autoMicEnabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSendText: (text: string, imageBase64?: string) => void;
  onStartTalking: () => void;
  onStopTalking: () => void;
  onToggleAutoMic: () => void;
  questions?: QuestionInfo[];
  inputRef?: RefObject<HTMLInputElement | null>;
  textInput: string;
  onTextInputChange: (value: string) => void;
}

export function VoicePanel({
  isConnected,
  isListening,
  isSpeaking,
  isThinking = false,
  autoMicEnabled,
  onConnect,
  onDisconnect,
  onSendText,
  onStartTalking,
  onStopTalking,
  onToggleAutoMic,
  questions = [],
  inputRef,
  textInput,
  onTextInputChange,
}: VoicePanelProps) {
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImageFile = useCallback(async (file: File) => {
    setImageError(null);
    try {
      setPendingImage(await readImageFileAsDataUrl(file));
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Failed to read file");
    }
  }, []);

  const handleSendText = () => {
    const trimmed = textInput.trim();
    if (!trimmed && !pendingImage) return;
    onSendText(trimmed, pendingImage ?? undefined);
    onTextInputChange("");
    setPendingImage(null);
    setImageError(null);
  };

  if (!isConnected) {
    return (
      <div className="flex w-full items-center justify-center gap-4">
        <button
          onClick={onConnect}
          className="rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{
            background: "var(--accent)",
            animation: "pulseGlow 2.5s ease-in-out infinite",
          }}
          aria-label="Start tutoring session"
        >
          Start Session
        </button>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Connect to start talking with your AI tutor
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex items-center gap-2 min-w-[140px]">
        {isListening ? (
          <>
            <AudioVisualizer active color="red" bars={4} />
            <span className="text-xs font-medium" style={{ color: "var(--danger)" }}>
              {autoMicEnabled ? "Listening…" : "Speaking..."}
            </span>
          </>
        ) : isSpeaking ? (
          <>
            <AudioVisualizer active color="emerald" bars={4} />
            <span className="text-xs font-medium" style={{ color: "var(--success)" }}>Tutor explaining</span>
          </>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Ready</span>
        )}
      </div>

      {/* Mic button — push-to-talk when auto-mic is off, status indicator when on */}
      <div className="flex items-center gap-1.5">
        <div className="relative">
          {isListening && (
            <div className="absolute inset-0 rounded-lg" style={{ animation: "talkRing 1s ease-out infinite", border: "2px solid rgba(248,113,113,0.3)" }} />
          )}
          {autoMicEnabled ? (
            // Auto-mic mode: button shows current state; click to force-stop listening
            <button
              onClick={isListening ? onStopTalking : undefined}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
              aria-label={isListening ? "Stop listening" : "Mic will open after response"}
              style={{
                background: isListening ? "var(--danger)" : "rgba(52,211,153,0.12)",
                color: isListening ? "#fff" : "var(--success)",
                border: isListening ? "none" : "1px solid rgba(52,211,153,0.25)",
                cursor: isListening ? "pointer" : "default",
              }}
            >
              {isListening ? "🔴 Listening…" : "🎙️ Mic ready"}
            </button>
          ) : (
            // Push-to-talk mode
            <button
              onMouseDown={onStartTalking}
              onMouseUp={onStopTalking}
              onMouseLeave={onStopTalking}
              onTouchStart={onStartTalking}
              onTouchEnd={onStopTalking}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
              aria-label={isListening ? "Release to stop talking" : "Hold to talk"}
              style={{
                background: isListening ? "var(--danger)" : "var(--bg-elevated)",
                color: isListening ? "#fff" : "var(--text-secondary)",
                border: isListening ? "none" : "1px solid var(--border)",
                transform: isListening ? "scale(1.02)" : "scale(1)",
              }}
            >
              {isListening ? "🔴 Release" : "🎤 Hold to talk"}
            </button>
          )}
        </div>

        {/* Auto-mic toggle */}
        <button
          onClick={onToggleAutoMic}
          title={autoMicEnabled ? "Auto-mic ON — mic opens after each response. Click to switch to push-to-talk." : "Auto-mic OFF — hold button to talk. Click to enable auto-mic."}
          className="rounded-lg px-2 py-2 text-[11px] font-semibold transition-all"
          style={{
            background: autoMicEnabled ? "rgba(52,211,153,0.15)" : "rgba(100,116,139,0.1)",
            color: autoMicEnabled ? "var(--success)" : "var(--text-muted)",
            border: `1px solid ${autoMicEnabled ? "rgba(52,211,153,0.3)" : "rgba(100,116,139,0.15)"}`,
          }}
          aria-label={autoMicEnabled ? "Disable auto-mic" : "Enable auto-mic"}
        >
          {autoMicEnabled ? "🟢 Auto" : "Auto"}
        </button>

        {!autoMicEnabled && (
          <span className="text-[10px] hidden sm:inline" style={{ color: "var(--text-muted)" }}>
            or <kbd className="rounded px-1 py-0.5 text-[10px] font-mono" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Space</kbd>
          </span>
        )}
      </div>

      <div className="h-6 w-px" style={{ background: "var(--border)" }} />

      <div className="flex flex-1 items-center gap-2">
        {questions.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {questions.slice(-3).map((q) => (
              <button
                key={q.idx}
                onClick={() => onTextInputChange(`[${q.label}] ${textInput}`)}
                className="rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors hover:bg-white/15"
                style={{
                  background: "rgba(99,102,241,0.15)",
                  color: "#a5b4fc",
                  border: "1px solid rgba(99,102,241,0.25)",
                }}
                title={`Follow up on ${q.label}: ${q.text}`}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 space-y-2">
          {/* Lecture quick-start chips — shown only before the first question */}
          {questions.length === 0 && !textInput && !pendingImage && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { icon: "📚", label: "Teach me about…", value: "Teach me about " },
                { icon: "🔢", label: "Solve step by step", value: "Solve: " },
                { icon: "💡", label: "Explain concept", value: "Explain " },
                { icon: "📐", label: "Show an example", value: "Show me an example of " },
              ].map(({ icon, label, value }) => (
                <button
                  key={label}
                  onClick={() => {
                    onTextInputChange(value);
                    inputRef?.current?.focus();
                  }}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-all hover:brightness-125"
                  style={{
                    background: "rgba(99,102,241,0.08)",
                    color: "#a5b4fc",
                    border: "1px solid rgba(99,102,241,0.18)",
                  }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          )}
          {pendingImage && (
            <div
              className="flex items-center gap-2 rounded-lg px-2 py-2"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.16)" }}
            >
              <img src={pendingImage} alt="Pending upload" className="h-10 w-10 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
                  Photo attached
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Paste another image to replace it, or press Send to ask with this photo.
                </div>
              </div>
              <button
                onClick={() => {
                  setPendingImage(null);
                  setImageError(null);
                }}
                className="rounded px-2 py-1 text-[11px]"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                Remove
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              ref={inputRef}
              value={textInput}
              onChange={(e) => onTextInputChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendText()}
              onPaste={(e) => {
                const file = extractImageFileFromClipboard(e.clipboardData.items);
                if (file) {
                  e.preventDefault();
                  void processImageFile(file);
                }
              }}
              placeholder={
                questions.length > 0
                  ? "Ask a follow-up, click Q# to reference a step, or paste a photo…"
                  : "Teach me about… / Solve: … / Explain… / or paste a photo"
              }
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-[var(--border-focus)]"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
              }}
            />
            <button
              onClick={handleSendText}
              disabled={(!textInput.trim() && !pendingImage) || isThinking}
              className="rounded-lg px-3 py-2 text-sm font-medium text-white transition-all disabled:opacity-30"
              style={{ background: "var(--accent)" }}
            >
              Send
            </button>
          </div>
          {imageError && (
            <div className="text-[11px] font-medium" style={{ color: "var(--danger)" }}>
              {imageError}
            </div>
          )}
        </div>
      </div>

      <div className="h-6 w-px" style={{ background: "var(--border)" }} />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="rounded-lg px-3 py-2 text-sm transition-colors hover:brightness-125"
        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        aria-label="Upload image"
      >
        📷
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void processImageFile(file);
          }
          e.currentTarget.value = "";
        }}
      />
      <button
        onClick={onDisconnect}
        className="rounded-lg px-3 py-2 text-sm transition-colors hover:brightness-125"
        style={{ color: "var(--danger)", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.15)" }}
        aria-label="End session"
      >
        End
      </button>
    </div>
  );
}
