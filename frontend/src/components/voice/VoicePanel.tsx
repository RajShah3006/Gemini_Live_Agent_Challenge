"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import type { RefObject } from "react";
import { AudioVisualizer } from "./AudioVisualizer";

import type { QuestionInfo } from "@/components/whiteboard/Whiteboard";
import { extractImageFileFromClipboard, readImageFileAsDataUrl } from "@/lib/imageUpload";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        value?: string;
        onInput?: (e: Event) => void;
      };
    }
  }
}

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
  onInterrupt?: () => void;
  questions?: QuestionInfo[];
  inputRef?: RefObject<HTMLTextAreaElement | null>;
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
  onInterrupt,
  questions = [],
  inputRef,
  textInput,
  onTextInputChange,
}: VoicePanelProps) {
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [mode, setMode] = useState<"teacher" | "quick">("teacher");
  const [inputMode, setInputMode] = useState<"text" | "math">("text");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Dynamically load MathLive on the client only
    import("mathlive").then((ml) => {
      // Point MathLive fonts to our public copy (avoids _next/static/chunks/fonts 404)
      if (ml.MathfieldElement) {
        ml.MathfieldElement.fontsDirectory = "/mathlive-fonts/";
      }
    });
  }, []);

  const processImageFile = useCallback(async (file: File) => {
    setImageError(null);
    try {
      setPendingImage(await readImageFileAsDataUrl(file));
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Failed to read file");
    }
  }, []);

  const handleSendText = () => {
    let trimmed = textInput.trim();
    if (!trimmed && !pendingImage) return;

    if (mode === "quick") {
      trimmed += "\n\n[USER TOGGLE: Please provide a direct, quick answer without breaking down every step.]";
    }

    onSendText(trimmed, pendingImage ?? undefined);
    onTextInputChange("");
    setPendingImage(null);
    setImageError(null);

    // Reset textarea height after sending
    if (inputRef?.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onTextInputChange(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  if (!isConnected) {
    return (
      <div className="flex w-full flex-col items-center gap-5 py-2">
        {/* Hero CTA */}
        <div className="flex flex-col items-center gap-2 w-full max-w-md">
          <button
            onClick={onConnect}
            className="focus-ring w-full rounded-2xl px-8 py-4 text-base font-bold text-white transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99] shadow-lg"
            style={{
              background: "linear-gradient(135deg, #5B6BF8, #7C3AED)",
              animation: "pulseGlow 2.5s ease-in-out infinite",
              boxShadow: "0 4px 24px rgba(91,107,248,0.35)",
            }}
            aria-label="Start tutoring session"
          >
            🦉 Start Tutoring Session
          </button>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Ask a question, upload homework, or talk with your AI tutor
          </span>
        </div>
        {/* Sample questions grid */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-md">
          {[
            { icon: "📐", q: "What is the derivative of tan²x?" },
            { icon: "🔢", q: "Solve x² - 5x + 6 = 0" },
            { icon: "📈", q: "Graph y = sin(x) + cos(2x)" },
            { icon: "💡", q: "Explain the chain rule" },
          ].map(({ icon, q }) => (
            <button
              key={q}
              onClick={() => {
                onConnect();
                onTextInputChange(q);
              }}
              className="focus-ring flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] transition-all hover:scale-[1.02] hover:bg-white/5 active:scale-[0.98]"
              style={{
                background: "rgba(99,102,241,0.06)",
                border: "1px solid rgba(99,102,241,0.12)",
                color: "var(--text-secondary)",
              }}
            >
              <span className="text-base shrink-0">{icon}</span>
              <span className="line-clamp-2 leading-snug">{q}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Accessibility live region */}
      <div aria-live="polite" className="sr-only">
        {isThinking ? "AI is generating explanation" : isSpeaking ? "Tutor explaining" : isListening ? "Listening" : imageError ? "Error: " + imageError : "Ready"}
      </div>
      
      {/* ── Top Tier: Follow-up Chips & Image Previews ── */}
      {(questions.length > 0 || pendingImage || imageError || (questions.length === 0 && !textInput && !pendingImage)) && (
        <div className="flex flex-col gap-2 w-full px-1">
          {/* Lecture quick-start chips */}
          {questions.length === 0 && !textInput && !pendingImage && !isSpeaking && !isThinking && (
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
                  className="focus-ring rounded-full px-2.5 py-1 text-[11px] font-medium transition-all hover:brightness-125"
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

          {/* Follow-up Chips */}
          {questions.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {questions.map((q) => (
                <button
                  key={q.idx}
                  onClick={() => onTextInputChange(`[${q.label}] ${textInput}`)}
                  className="focus-ring whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all hover:brightness-125 hover:scale-[1.02]"
                  style={{
                    background: "rgba(99,102,241,0.12)",
                    color: "#a5b4fc",
                    border: "1px solid rgba(99,102,241,0.25)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  }}
                  title={`Follow up on ${q.label}: ${q.text}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          {/* Image Preview */}
          {pendingImage && (
            <div
              className="flex items-center gap-2 rounded-lg px-2 py-2 max-w-sm"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.16)" }}
            >
              <img src={pendingImage} alt="Pending upload" className="h-10 w-10 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
                  Photo attached
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Press Send to ask with this photo.
                </div>
              </div>
              <button
                onClick={() => {
                  setPendingImage(null);
                  setImageError(null);
                }}
                className="focus-ring rounded px-2 py-1 text-[11px]"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                Remove
              </button>
            </div>
          )}
          
          {/* Errors */}
          {imageError && (
            <div className="text-[11px] font-medium" style={{ color: "var(--danger)" }}>
              {imageError}
            </div>
          )}
        </div>
      )}

      {/* ── Middle Tier: Dominant Input Field ── */}
      <div 
        className="relative flex items-end rounded-2xl w-full transition-shadow focus-within:ring-2 focus-within:ring-indigo-500/50 shadow-sm hover:shadow-md"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
        }}
      >
        {inputMode === "text" ? (
          <textarea
            ref={inputRef}
            value={textInput}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const file = extractImageFileFromClipboard(e.clipboardData.items);
              if (file) {
                e.preventDefault();
                void processImageFile(file);
              }
            }}
            placeholder={
              questions.length > 0
                ? "Ask a follow-up, Shift+Enter for new line…"
                : "Ask a math question, e.g. 'Differentiate tan²x step by step'…"
            }
            rows={1}
            className="flex-1 max-h-[160px] min-h-[48px] bg-transparent resize-none rounded-2xl py-3.5 pl-4 pr-14 text-[15px] outline-none scrollbar-none"
            style={{ color: "var(--text-primary)" }}
          />
        ) : (
          // @ts-expect-error
          <math-field
            onInput={(e: any) => onTextInputChange(e.target.value)}
            onKeyDown={(e: any) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
            value={textInput}
            className="flex-1 min-h-[48px] max-h-[160px] bg-transparent rounded-2xl py-3.5 pl-4 pr-14 text-[15px] outline-none MathLiveInput"
            style={{ color: "var(--text-primary)" }}
          />
        )}
        <button
          onClick={handleSendText}
          disabled={(!textInput.trim() && !pendingImage) || isThinking}
          className="focus-ring absolute bottom-1.5 right-1.5 rounded-xl p-2.5 text-white transition-all disabled:opacity-30 disabled:scale-95 hover:scale-105"
          style={{ background: "var(--accent)", boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)" }}
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>

      {/* ── Bottom Tier: Utilities Row ── */}
      <div className="flex items-center justify-between px-1 w-full">
        {/* Left Utilities: Speech & Mic & Progress Options */}
        <div className="flex items-center gap-2">
          {/* Status icon/text built into mic area roughly */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              {isListening && <div className="absolute inset-0 rounded-lg" style={{ animation: "talkRing 1s ease-out infinite", border: "2px solid rgba(248,113,113,0.3)" }} />}
              {autoMicEnabled ? (
                <button
                  onClick={isListening ? onStopTalking : undefined}
                  className="focus-ring rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all"
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
                <button
                  onMouseDown={onStartTalking}
                  onMouseUp={onStopTalking}
                  onMouseLeave={onStopTalking}
                  onTouchStart={onStartTalking}
                  onTouchEnd={onStopTalking}
                  className={`focus-ring rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${isListening ? 'animate-pulse' : ''}`}
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
            
            <button
              onClick={onToggleAutoMic}
              title={autoMicEnabled ? "Switch to push-to-talk" : "Enable auto-listen (mic opens after tutor responds)"}
              className="focus-ring rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all hidden sm:flex items-center gap-1"
              style={{
                background: autoMicEnabled ? "rgba(52,211,153,0.15)" : "rgba(100,116,139,0.1)",
                color: autoMicEnabled ? "var(--success)" : "var(--text-muted)",
                border: `1px solid ${autoMicEnabled ? "rgba(52,211,153,0.3)" : "rgba(100,116,139,0.15)"}`,
              }}
            >
              {autoMicEnabled ? "🟢 Auto-Listen" : "🔇 Push-to-Talk"}
            </button>
          </div>
          
          <div className="h-4 w-px bg-[var(--border)] hidden sm:block mx-1" />

          {/* Mode Toggles */}
          {questions.length === 0 && (
            <div className="flex items-center gap-1 hidden md:flex">
              <button
                onClick={() => setMode("teacher")}
                className={`focus-ring text-[11px] font-medium px-2 py-1 rounded-md transition-colors ${mode === "teacher" ? "" : "opacity-60 hover:opacity-100"}`}
                style={{
                  background: mode === "teacher" ? "rgba(91,107,248,0.15)" : "transparent",
                  color: mode === "teacher" ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                🎓 Teacher
              </button>
              <button
                onClick={() => setMode("quick")}
                className={`focus-ring text-[11px] font-medium px-2 py-1 rounded-md transition-colors ${mode === "quick" ? "" : "opacity-60 hover:opacity-100"}`}
                style={{
                  background: mode === "quick" ? "rgba(255,255,255,0.08)" : "transparent",
                  color: mode === "quick" ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                ⚡️ Quick
              </button>
            </div>
          )}

          {/* Math Keyboard Toggle */}
          <button
            onClick={() => setInputMode(prev => prev === "text" ? "math" : "text")}
            className="focus-ring text-[11px] font-medium px-2 py-1.5 rounded-lg transition-colors hover:bg-white/5 ml-1"
            style={{
              color: inputMode === "math" ? "var(--success)" : "var(--text-muted)",
              background: inputMode === "math" ? "rgba(52,211,153,0.1)" : "transparent",
              border: `1px solid ${inputMode === "math" ? "rgba(52,211,153,0.3)" : "var(--border)"}`
            }}
            title="Toggle equation editor for math formulas"
          >
            🧮 {inputMode === "math" ? "Equation" : "Equation"}
          </button>
        </div>

        {/* Right Utilities: Status, Image, Stop, End */}
        <div className="flex items-center gap-2">
          
          {/* Audio Visualizer Status */}
          <div className="flex items-center gap-1.5 hidden sm:flex pointer-events-none opacity-80 mr-1">
             {isListening ? (
              <AudioVisualizer active color="red" bars={3} />
            ) : isSpeaking ? (
              <AudioVisualizer active color="emerald" bars={3} />
            ) : <span className="text-[10px] text-[var(--text-muted)]">Ready</span>}
          </div>

          {(isSpeaking || isThinking) && onInterrupt && (
            <button
               onClick={onInterrupt}
               className="focus-ring rounded-lg px-2.5 py-1.5 text-[11px] font-bold shadow-md transition-transform hover:scale-105 active:scale-95"
               style={{ background: "var(--danger)", color: "#fff" }}
               title="Stop Tutor generation"
             >
               ✋ Stop
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="focus-ring rounded-lg p-1.5 transition-colors hover:brightness-125"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            aria-label="Upload image"
            title="Upload image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </button>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processImageFile(file);
              e.currentTarget.value = "";
            }}
          />
          
          <button
            onClick={onDisconnect}
            className="focus-ring rounded-lg p-1.5 transition-colors hover:bg-red-500/10"
            style={{ color: "var(--danger)", border: "1px solid rgba(248,113,113,0.15)" }}
            aria-label="End session"
            title="End session"
          >
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
