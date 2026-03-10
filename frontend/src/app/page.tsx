"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Whiteboard, type QuestionInfo } from "@/components/whiteboard/Whiteboard";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { SessionHistory } from "@/components/SessionHistory";
import { FormulaSheet } from "@/components/FormulaSheet";
import { HandwritingCanvas } from "@/components/HandwritingCanvas";
import { useSession } from "@/hooks/useSession";

export default function Home() {
  const {
    isConnected,
    isListening,
    isSpeaking,
    isThinking,
    connectionStatus,
    errorMessage,
    connect,
    disconnect,
    sendText,
    startTalking,
    stopTalking,
    whiteboardCommands,
    transcript,
    voiceCommand,
    autoMicEnabled,
    toggleAutoMic,
  } = useSession();

  const [showHistory, setShowHistory] = useState(false);
  const [questions, setQuestions] = useState<QuestionInfo[]>([]);
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [composerText, setComposerText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const toolbarPortalRef = useRef<HTMLDivElement>(null);

  const handleQuestionsChange = useCallback((qs: QuestionInfo[]) => {
    setQuestions(qs);
  }, []);

  const followUp = useCallback((label: string) => {
    setComposerText(`[${label}] `);
    textInputRef.current?.focus();
  }, []);

  const handleHandwritingSubmit = useCallback((blob: Blob) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(",")[1];
      if (b64) sendText("", b64);
    };
    reader.readAsDataURL(blob);
  }, [sendText]);

  // Escape key closes panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showHistory) setShowHistory(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHistory]);

  // Auto-scroll transcript
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <main className="flex h-screen flex-col" style={{ background: "var(--bg-base)" }}>
      {/* ── Error Toast ── */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-lg px-5 py-3 text-sm font-medium shadow-lg"
          style={{ background: "var(--danger)", color: "#fff", maxWidth: "90vw" }}>
          {errorMessage}
        </div>
      )}
      {/* ── Header ── */}
      <header
        className="relative z-10 flex items-center justify-between px-5 py-2.5"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white text-sm"
            style={{ background: "var(--accent)" }}>
            M
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>MathBoard</h1>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>AI Math Tutor</p>
          </div>
        </div>

        {/* Toolbar portal — whiteboard tools render here */}
        <div ref={toolbarPortalRef} id="toolbar-portal" className="flex items-center gap-2" />

        <div className="flex items-center gap-2">
          <HandwritingCanvas onSubmit={handleHandwritingSubmit} />
          <FormulaSheet onInsert={(formula) => {
            setComposerText((prev) => `${prev}${formula}`);
            textInputRef.current?.focus();
          }} />
          <button
            onClick={() => setShowHistory(true)}
            className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            title="Session History"
            aria-label="Open session history"
          >
            📚 History
          </button>
          <span
            className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium relative cursor-default"
            style={{
              background: isConnected ? "rgba(52,211,153,0.1)" : "rgba(100,116,139,0.1)",
              color: isConnected ? "var(--success)" : "var(--text-muted)",
              border: `1px solid ${isConnected ? "rgba(52,211,153,0.2)" : "rgba(100,116,139,0.15)"}`,
            }}
            title={isConnected ? "AI is connected and ready to help" : "Not connected — click Connect to start"}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: isConnected ? "var(--success)" : "var(--text-muted)",
                boxShadow: isConnected ? "0 0 6px rgba(52,211,153,0.5)" : "none",
              }}
            />
            {isConnected ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      {/* ── Connection Toast ── */}
      {(connectionStatus === "reconnecting" || connectionStatus === "failed") && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium shadow-lg"
          style={{
            background: connectionStatus === "failed" ? "rgba(248,113,113,0.15)" : "rgba(251,191,36,0.15)",
            border: `1px solid ${connectionStatus === "failed" ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.3)"}`,
            color: connectionStatus === "failed" ? "#f87171" : "#fbbf24",
            backdropFilter: "blur(12px)",
          }}>
          {connectionStatus === "reconnecting" ? (
            <>
              <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#fbbf24" }} />
              Reconnecting to AI…
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full" style={{ background: "#f87171" }} />
              Connection lost
              <button onClick={connect} className="ml-2 underline hover:no-underline">Retry</button>
            </>
          )}
        </div>
      )}

      {/* ── Main Area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Whiteboard */}
        <div className="flex flex-1 flex-col">
          <Whiteboard
            commands={whiteboardCommands}
            isSpeaking={isSpeaking}
            isThinking={isThinking}
            onQuestionsChange={handleQuestionsChange}
            toolbarPortalRef={toolbarPortalRef}
            voiceCommand={voiceCommand}
          />
        </div>

        {/* ── Right Panel: Questions & Transcript ── */}
        <div
          className="flex w-[300px] flex-col"
          style={{
            background: "var(--bg-surface)",
            borderLeft: "1px solid rgba(148,163,184,0.06)",
          }}
        >
          {/* Panel header with search */}
          <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(148,163,184,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Questions
              </h3>
              {questions.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc" }}>
                  {questions.length}
                </span>
              )}
            </div>
            {(transcript.length > 4 || questions.length > 3) && (
              <input
                type="text"
                placeholder="Search questions..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="w-full rounded-lg px-2.5 py-1.5 text-[11px] outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid rgba(148,163,184,0.06)",
                }}
              />
            )}
          </div>

          {/* Collapsible question groups */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {questions.length === 0 && transcript.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center px-4 space-y-3">
                  <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>How to use MathBoard</p>
                  <div className="space-y-2 text-left">
                    {[
                      { icon: "📚", label: "Lecture", desc: "Teach me about derivatives" },
                      { icon: "🔢", label: "Problem", desc: "Solve: 2x + 5 = 15" },
                      { icon: "💡", label: "Follow-up", desc: "Why did you subtract 5?" },
                      { icon: "📷", label: "Homework", desc: "Upload a photo to grade it" },
                    ].map(({ icon, label, desc }) => (
                      <div key={label} className="flex items-start gap-2">
                        <span className="text-sm shrink-0">{icon}</span>
                        <div>
                          <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>{label}: </span>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] pt-1" style={{ color: "var(--text-muted)" }}>
                    Hold <kbd className="rounded px-1 py-0.5 text-[10px] font-mono" style={{ border: "1px solid rgba(148,163,184,0.08)" }}>Space</kbd> or use the mic to speak
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Question cards with transcript grouped under them */}
                {questions
                  .filter(q => !searchFilter || q.text.toLowerCase().includes(searchFilter.toLowerCase()))
                  .map((q, qi) => {
                  const isExpanded = expandedQ === q.idx;
                  // Group transcript: find user message matching this question, then tutor replies until next user message
                  const userIdx = transcript.findIndex(t => t.role === "user" && q.text && t.text.includes(q.text.slice(0, 20)));
                  const nextUserIdx = userIdx >= 0 ? transcript.findIndex((t, i) => i > userIdx && t.role === "user") : -1;
                  const endIdx = nextUserIdx >= 0 ? nextUserIdx : transcript.length;
                  const qTranscript = userIdx >= 0 ? transcript.slice(userIdx, endIdx) : [];
                  const hasTutorReply = qTranscript.some(t => t.role === "tutor");
                  const tutorReply = qTranscript.find(t => t.role === "tutor");
                  const answerPreview = tutorReply ? tutorReply.text.slice(0, 60) + (tutorReply.text.length > 60 ? "…" : "") : "";
                  return (
                    <div key={q.idx} className="group rounded-xl overflow-hidden"
                      style={{
                        background: "rgba(15,20,40,0.5)",
                        border: "1px solid rgba(148,163,184,0.06)",
                      }}>
                      <button
                        onClick={() => setExpandedQ(isExpanded ? null : q.idx)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                      >
                        <span className="text-[11px] font-bold shrink-0 rounded px-1.5 py-0.5"
                          style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                          {q.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[12px] truncate block" style={{ color: "var(--text-primary)" }}>
                            {q.text}
                          </span>
                          {answerPreview && !isExpanded && (
                            <span className="text-[10px] truncate block mt-0.5" style={{ color: "var(--text-muted)" }}>
                              → {answerPreview}
                            </span>
                          )}
                        </div>
                        {hasTutorReply ? (
                          <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>
                            ✓ Solved
                          </span>
                        ) : (
                          <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                            ⏳
                          </span>
                        )}
                        <span className="text-[10px] transition-transform" style={{
                          color: "var(--text-muted)",
                          transform: isExpanded ? "rotate(180deg)" : "rotate(0)",
                        }}>▾</span>
                      </button>
                      {/* Follow-up link visible on hover for all questions */}
                      {!isExpanded && (
                        <div className="px-3 pb-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => followUp(q.label)}
                            className="text-[10px] font-medium transition-colors hover:underline"
                            style={{ color: "#818cf8" }}>
                            ↩ Follow up
                          </button>
                        </div>
                      )}
                      <div className={isExpanded ? "q-expand-active" : "q-expand-enter"}>
                        {isExpanded && (
                        <div className="px-3 pb-2 space-y-1.5" style={{ borderTop: "1px solid rgba(148,163,184,0.04)" }}>
                          {qTranscript.map((msg, mi) => (
                            <div key={mi} className="text-[13px] leading-relaxed rounded-lg px-3 py-2"
                              style={{
                                background: msg.role === "user" ? "rgba(99,102,241,0.06)" : "rgba(148,163,184,0.04)",
                                color: msg.role === "user" ? "var(--text-secondary)" : "var(--text-primary)",
                              }}>
                              <span className="text-[10px] font-semibold uppercase opacity-50 mr-1.5 block mb-0.5">
                                {msg.role === "user" ? "You" : "Tutor"}:
                              </span>
                              {msg.text}
                            </div>
                          ))}
                          <button
                            onClick={() => followUp(q.label)}
                            className="w-full text-[10px] font-medium py-1 rounded-md transition-colors hover:bg-white/5"
                            style={{ color: "#818cf8" }}>
                            ↩ Follow up on {q.label}
                          </button>
                        </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Ungrouped transcript (before any question) */}
                {transcript.filter(msg =>
                  searchFilter ? msg.text.toLowerCase().includes(searchFilter.toLowerCase()) : true
                ).filter((_, i) => questions.length === 0 || i >= questions.length * 2).map((msg, i) => (
                  <div
                    key={`t-${i}`}
                    className="rounded-xl px-3 py-2 text-[12px] leading-relaxed"
                    style={{
                      background: msg.role === "user" ? "rgba(99,102,241,0.06)" : "rgba(15,20,40,0.5)",
                      border: "1px solid rgba(148,163,184,0.06)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-wider opacity-50 mr-1">
                      {msg.role === "user" ? "You" : "Tutor"}:
                    </span>
                    {msg.text}
                  </div>
                ))}
              </>
            )}
            <div ref={chatEndRef} />
          </div>

        </div>
      </div>

      {/* ── Bottom Control Bar ── */}
      <div
        className="relative z-10 flex items-center gap-3 px-5 py-3"
        style={{
          background: "var(--bg-surface)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <VoicePanel
          isConnected={isConnected}
          isListening={isListening}
          isSpeaking={isSpeaking}
          isThinking={isThinking}
          autoMicEnabled={autoMicEnabled}
          onConnect={connect}
          onDisconnect={disconnect}
          onSendText={sendText}
          onStartTalking={startTalking}
          onStopTalking={stopTalking}
          onToggleAutoMic={toggleAutoMic}
          questions={questions}
          inputRef={textInputRef}
          textInput={composerText}
          onTextInputChange={setComposerText}
        />
      </div>

      {/* Session History Panel */}
      <SessionHistory open={showHistory} onClose={() => setShowHistory(false)} />
    </main>
  );
}
