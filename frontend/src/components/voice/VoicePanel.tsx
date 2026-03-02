"use client";

import { useState } from "react";
import type { RefObject } from "react";
import { AudioVisualizer } from "./AudioVisualizer";

import type { QuestionInfo } from "@/components/whiteboard/Whiteboard";

interface VoicePanelProps {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleUpload: () => void;
  onSendText: (text: string) => void;
  onStartTalking: () => void;
  onStopTalking: () => void;
  questions?: QuestionInfo[];
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function VoicePanel({
  isConnected,
  isListening,
  isSpeaking,
  onConnect,
  onDisconnect,
  onToggleUpload,
  onSendText,
  onStartTalking,
  onStopTalking,
  questions = [],
  inputRef,
}: VoicePanelProps) {
  const [textInput, setTextInput] = useState("");

  const handleSendText = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setTextInput("");
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
      {/* Status + visualizer */}
      <div className="flex items-center gap-2 min-w-[140px]">
        {isListening ? (
          <>
            <AudioVisualizer active color="red" bars={4} />
            <span className="text-xs font-medium" style={{ color: "var(--danger)" }}>Speaking...</span>
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

      {/* Push-to-talk */}
      <div className="relative">
        {isListening && (
          <div className="absolute inset-0 rounded-lg" style={{ animation: "talkRing 1s ease-out infinite", border: "2px solid rgba(248,113,113,0.3)" }} />
        )}
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
      </div>

      <span className="text-[10px] hidden sm:inline" style={{ color: "var(--text-muted)" }}>
        or <kbd className="rounded px-1 py-0.5 text-[10px] font-mono" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Space</kbd>
      </span>

      {/* Separator */}
      <div className="h-6 w-px" style={{ background: "var(--border)" }} />

      {/* Text input with question reference chips */}
      <div className="flex flex-1 items-center gap-2">
        {questions.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {questions.slice(-3).map(q => (
              <button
                key={q.idx}
                onClick={() => setTextInput(prev => `[${q.label}] ${prev}`)}
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
        <input
          type="text"
          ref={inputRef}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendText()}
          placeholder={questions.length > 0 ? "Ask a new question or click Q# to follow up..." : "Type a question..."}
          className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-[var(--border-focus)]"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
          }}
        />
        <button
          onClick={handleSendText}
          disabled={!textInput.trim()}
          className="rounded-lg px-3 py-2 text-sm font-medium text-white transition-all disabled:opacity-30"
          style={{ background: "var(--accent)" }}
        >
          Send
        </button>
      </div>

      {/* Separator */}
      <div className="h-6 w-px" style={{ background: "var(--border)" }} />

      {/* Actions */}
      <button
        onClick={onToggleUpload}
        className="rounded-lg px-3 py-2 text-sm transition-colors hover:brightness-125"
        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        aria-label="Upload image"
      >
        📷
      </button>
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
