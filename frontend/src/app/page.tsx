"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Whiteboard, type QuestionInfo } from "@/components/whiteboard/Whiteboard";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { SessionHistory } from "@/components/SessionHistory";
import { FormulaSheet } from "@/components/FormulaSheet";
import { HandwritingCanvas } from "@/components/HandwritingCanvas";
import { QuestionsSidebar } from "@/components/QuestionsSidebar";
import { useSession } from "@/hooks/useSession";
import type { WhiteboardCommand, TranscriptEntry } from "@/lib/types";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

interface NotebookPage {
  id: string;
  title: string;
  transcript: TranscriptEntry[];
  whiteboardCommands: WhiteboardCommand[];
  questions: QuestionInfo[];
}

function ChatMessageItem({ msg, onFollowUp }: { msg: { text: string; role: "user" | "tutor" | "system" }, onFollowUp?: (topic: string) => void }) {
  const isUser = msg.role === "user";

  const renderFormattedText = (rawText: string) => {
    if (isUser) return rawText;

    // Split by Recap to add the top border
    const recapSplit = rawText.split(/(?=\*\*Recap:\*\*|Recap:|\*\*Summary:\*\*|Summary:)/i);

    return (
      <>
        {recapSplit.map((section, sIdx) => {
          const lowerSection = section.toLowerCase();
          const isRecap = lowerSection.startsWith('**recap:**') || lowerSection.startsWith('recap:') || 
                          lowerSection.startsWith('**summary:**') || lowerSection.startsWith('summary:');
          
          const parts = section.split(/(`[^`]+`)/);
          
          return (
            <div key={sIdx} className={isRecap && sIdx > 0 ? "mt-4 pt-4 border-t border-white/10" : ""}>
              {parts.map((part, i) => {
                if (part.startsWith('`') && part.endsWith('`')) {
                  return (
                    <code
                      key={i}
                      className="px-1.5 py-[1px] rounded mx-0.5 font-mono inline-block my-0.5"
                      style={{ background: "var(--bg-bubble-ai-math)", fontSize: "1.05em" }}
                    >
                      {part.slice(1, -1)}
                    </code>
                  );
                }
                
                // Bold Step X:
                const stepParts = part.split(/(Step \d+:|\*\*Step \d+:\*\*)/gi);
                return (
                  <span key={i}>
                    {stepParts.map((sp, j) => {
                      if (/^(?:\*\*)?Step \d+:(?:\*\*)?$/i.test(sp)) {
                        return (
                          <span key={j} className="font-semibold block mt-3 mb-1" style={{ color: "var(--accent)" }}>
                            {sp.replace(/\*\*/g, '')}
                          </span>
                        );
                      }
                      return sp.replace(/\*\*/g, '');
                    })}
                  </span>
                );
              })}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className={`flex w-full mb-4 ${isUser ? "justify-end" : "justify-start"} group`}>
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[85%]`}>
        <div
          className={`whitespace-pre-wrap ${isUser ? "" : "shadow-sm"}`}
          style={{
            background: isUser ? "var(--bg-bubble-user)" : "var(--bg-bubble-ai)",
            color: "var(--text-primary)",
            borderLeft: isUser ? "none" : "3px solid var(--accent)",
            borderBottomRightRadius: isUser ? "0px" : "16px",
            borderBottomLeftRadius: isUser ? "16px" : "0px",
            borderTopLeftRadius: "16px",
            borderTopRightRadius: "16px",
            padding: isUser ? "12px 16px" : "16px 20px",
            fontSize: "15px",
            lineHeight: isUser ? "1.5" : "1.7"
          }}
        >
          {!isUser && (
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-40 block mb-2">
              MathBoard
            </span>
          )}
          {renderFormattedText(msg.text)}
        </div>
        {!isUser && (
          <div className="flex items-center gap-2 mt-2 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-wrap">
            <button className="focus-ring text-[11px] px-2 py-0.5 rounded transition-all hover:bg-white/10" style={{ color: "var(--text-muted)" }}>👍 Helpful</button>
            <button className="focus-ring text-[11px] px-2 py-0.5 rounded transition-all hover:bg-white/10" style={{ color: "var(--text-muted)" }}>👎 Confusing</button>
            {onFollowUp && (
              <>
                <div className="w-px h-3 bg-white/10 mx-1"></div>
                <button onClick={() => onFollowUp("Explain differently")} className="focus-ring text-[11px] px-2 py-0.5 rounded transition-all hover:bg-white/10" style={{ color: "var(--accent-light)", background: "rgba(126,140,255,0.1)" }}>Explain differently</button>
                <button onClick={() => onFollowUp("Why does this work?")} className="focus-ring text-[11px] px-2 py-0.5 rounded transition-all hover:bg-white/10" style={{ color: "var(--accent-light)", background: "rgba(126,140,255,0.1)" }}>Why does this work?</button>
                <button onClick={() => onFollowUp("Show step breakdown")} className="focus-ring text-[11px] px-2 py-0.5 rounded transition-all hover:bg-white/10" style={{ color: "var(--accent-light)", background: "rgba(126,140,255,0.1)" }}>Step breakdown</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  const [stage, setStage] = useState(0);
  const stages = [
    { text: "Your math teacher is reading...", icon: "👀" },
    { text: "Your math teacher is calculating...", icon: "🧮" },
    { text: "Your math teacher is drawing...", icon: "✍️" }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStage(s => (s + 1) % stages.length);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all duration-300"
      style={{
        background: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.12)",
      }}>
      <span className="text-sm scale-110">{stages[stage].icon}</span>
      <span className="text-[11px] font-medium opacity-90 transition-opacity duration-300" style={{ color: "#a5b4fc" }}>
        {stages[stage].text}
      </span>
      <span className="flex gap-0.5 ml-auto opacity-75">
        <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ background: "#818cf8", animationDelay: "0ms" }} />
        <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ background: "#818cf8", animationDelay: "150ms" }} />
        <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ background: "#818cf8", animationDelay: "300ms" }} />
      </span>
    </div>
  );
}

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
    interrupt,
    whiteboardCommands,
    setWhiteboardCommands,
    transcript,
    setTranscript,
    voiceCommand,
    autoMicEnabled,
    toggleAutoMic,
    sendMode,
    awaitingAnswer,
  } = useSession();

  const [showHistory, setShowHistory] = useState(false);
  const [questions, setQuestions] = useState<QuestionInfo[]>([]);
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [composerText, setComposerText] = useState("");
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sentToast, setSentToast] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const toolbarPortalRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const [pages, setPages] = useState<NotebookPage[]>([
    { id: "page-1", title: "Page 1", transcript: [], whiteboardCommands: [], questions: [] }
  ]);
  const [activePageId, setActivePageId] = useState("page-1");

  const switchPage = useCallback((newId: string) => {
    // Save current page state, then load the target page — all via functional setState
    setPages(prev => {
      const updated = prev.map(p =>
        p.id === activePageId ? { ...p, transcript, whiteboardCommands, questions } : p
      );
      const newPage = updated.find(p => p.id === newId);
      if (newPage) {
        if (typeof setTranscript === "function") setTranscript(newPage.transcript);
        if (typeof setWhiteboardCommands === "function") setWhiteboardCommands(newPage.whiteboardCommands);
        setQuestions(newPage.questions);
        setActivePageId(newId);

        disconnect();
        if (isConnected) {
          setTimeout(() => { try { connect(); } catch (e) { console.error("Reconnect failed:", e); } }, 100);
        }
      }
      return updated;
    });
  }, [activePageId, transcript, whiteboardCommands, questions, setTranscript, setWhiteboardCommands, disconnect, isConnected, connect]);

  const addPage = useCallback(() => {
    setPages(prev => {
      // Save current page state
      const updated = prev.map(p =>
        p.id === activePageId ? { ...p, transcript, whiteboardCommands, questions } : p
      );
      const newId = `page-${Date.now()}`;
      const newPage: NotebookPage = { id: newId, title: `Page ${updated.length + 1}`, transcript: [], whiteboardCommands: [], questions: [] };
      if (typeof setTranscript === "function") setTranscript([]);
      if (typeof setWhiteboardCommands === "function") setWhiteboardCommands([]);
      setQuestions([]);
      setActivePageId(newId);

      disconnect();
      if (isConnected) {
        setTimeout(() => { try { connect(); } catch (e) { console.error("Reconnect failed:", e); } }, 100);
      }
      return [...updated, newPage];
    });
  }, [activePageId, transcript, whiteboardCommands, questions, setTranscript, setWhiteboardCommands, disconnect, isConnected, connect]);

  const handleQuestionsChange = useCallback((qs: QuestionInfo[]) => {
    setQuestions(qs);
  }, []);

  // Wrap sendText to show feedback toast
  const sendTextWithToast = useCallback((text: string, imageBase64?: string) => {
    sendText(text);
    const label = imageBase64 ? "📷 Image sent" : text ? "✅ Sent" : "";
    if (label) {
      setSentToast(label);
      setTimeout(() => setSentToast(null), 1800);
    }
    if (isMobile) setShowSidebar(false);
  }, [sendText, isMobile]);

  const followUp = useCallback((label: string) => {
    setComposerText(`[${label}] `);
    textInputRef.current?.focus();
  }, []);

  const composerFill = useCallback((text: string) => {
    setComposerText(text);
    textInputRef.current?.focus();
  }, []);

  const handleHandwritingSubmit = useCallback((blob: Blob) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(",")[1];
      if (b64) sendTextWithToast("", b64);
    };
    reader.onerror = () => {
      console.error("Failed to read handwriting data");
    };
    reader.readAsDataURL(blob);
  }, [sendTextWithToast]);

  // Escape key closes panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showHistory) setShowHistory(false);
        if (showSidebar) setShowSidebar(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHistory]);

  // Auto-scroll and auto-focus transcript
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    if (!isSpeaking) {
      textInputRef.current?.focus();
    }
  }, [transcript, isSpeaking]);

  useEffect(() => {
    // Focus on mount after a tiny delay to ensure render
    setTimeout(() => textInputRef.current?.focus(), 100);
  }, []);

  return (
    <main className="flex h-screen flex-col" style={{ background: "var(--bg-base)" }}>
      {/* ── Error Toast ── */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-lg px-5 py-3 text-sm font-medium shadow-lg cursor-pointer"
          style={{ background: "var(--danger)", color: "#fff", maxWidth: "90vw" }}
          onClick={() => {/* error is auto-dismissed, but click provides feedback */}}
          role="alert"
        >
          {errorMessage}
        </div>
      )}
      {/* ── Sent Toast ── */}
      {sentToast && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-lg px-4 py-2 text-[12px] font-medium shadow-lg pointer-events-none"
          style={{ background: "rgba(52,211,153,0.15)", color: "var(--success)", border: "1px solid rgba(52,211,153,0.3)", backdropFilter: "blur(8px)" }}>
          {sentToast}
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
        <div className="flex items-center gap-6">
          {/* Mobile hamburger */}
          <button
            className="md:hidden focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-white/5"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => setShowSidebar(!showSidebar)}
            aria-label="Toggle questions panel"
          >
            {showSidebar ? "✕" : "☰"}
          </button>
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

          <div className="hidden sm:block h-6 w-px mx-2" style={{ background: "var(--border)" }} />

          {/* ── Tabs UI ── */}
          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar max-w-[300px]">
            {pages.map((p, idx) => (
              <button
                key={p.id}
                onClick={() => switchPage(p.id)}
                className="focus-ring px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1.5 whitespace-nowrap"
                style={{
                  background: p.id === activePageId ? "rgba(91,107,248,0.15)" : "transparent",
                  color: p.id === activePageId ? "var(--accent)" : "var(--text-muted)",
                  border: `1px solid ${p.id === activePageId ? "rgba(91,107,248,0.2)" : "transparent"}`,
                }}
              >
                <span className="opacity-70">📓</span> {p.title}
              </button>
            ))}
            <button
              onClick={addPage}
              className="focus-ring px-2 py-1 text-[13px] ml-1 rounded-md transition-all hover:bg-white/5 flex shrink-0"
              style={{ color: "var(--text-muted)" }}
              title="New Page"
            >
              +
            </button>
          </div>
        </div>

        {/* Toolbar portal — whiteboard tools render here */}
        <div ref={toolbarPortalRef} id="toolbar-portal" className="flex items-center gap-2 flex-1 justify-center" />

        <div className="flex items-center gap-2">

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
              <button onClick={connect} className="focus-ring ml-2 underline hover:no-underline">Retry</button>
            </>
          )}
        </div>
      )}

      {/* ── Main Area ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Secondary Floating Tools Menu (Right Edge) */}
        <div className="absolute right-2 md:right-4 top-2 md:top-4 z-30 flex flex-col gap-2">
          <div className="flex flex-col items-center gap-2 rounded-xl p-2 shadow-sm"
               style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <HandwritingCanvas onSubmit={handleHandwritingSubmit} />
            <FormulaSheet onInsert={(formula) => {
              setComposerText((prev) => `${prev}${formula}`);
              textInputRef.current?.focus();
            }} />
            <button
              onClick={() => setShowHistory(true)}
              className="focus-ring flex h-[34px] w-[34px] items-center justify-center rounded-lg text-lg transition-colors hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
              title="Session History"
              aria-label="Open session history"
            >
              📚
            </button>
          </div>
        </div>

        {/* ── Left Panel: Questions & Transcript ── */}
        {/* Mobile backdrop */}
        {isMobile && showSidebar && (
          <div
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setShowSidebar(false)}
          />
        )}
        <div className={`${isMobile ? 'fixed inset-y-0 left-0 z-40 w-[85vw] max-w-[400px] transition-transform duration-300 ease-out' : 'hidden md:flex'} ${isMobile && !showSidebar ? '-translate-x-full' : 'translate-x-0'}`}>
          <QuestionsSidebar
            questions={questions}
            transcript={transcript}
            expandedQ={expandedQ}
            setExpandedQ={setExpandedQ}
            onFollowUp={followUp}
            onComposerFill={composerFill}
            isThinking={isThinking}
            chatEndRef={chatEndRef}
            onScrollToQuestion={(label) => setScrollTarget(label)}
          />
        </div>

        {/* Whiteboard Area (Center/Right) */}
        <div className="flex flex-1 flex-col relative z-10" style={{ background: "var(--bg-base)" }}>
          <Whiteboard
            commands={whiteboardCommands}
            isSpeaking={isSpeaking}
            isThinking={isThinking}
            onQuestionsChange={handleQuestionsChange}
            toolbarPortalRef={toolbarPortalRef}
            voiceCommand={voiceCommand}
            scrollToLabel={scrollTarget}
          />
        </div>
      </div>

      {/* ── Bottom Control Bar ── */}
      <div
        className="relative z-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-5 py-3"
        style={{
          background: "var(--bg-surface)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))"
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
          onSendText={sendTextWithToast}
          onStartTalking={startTalking}
          onStopTalking={stopTalking}
          onToggleAutoMic={toggleAutoMic}
          onInterrupt={interrupt}
          questions={questions}
          inputRef={textInputRef}
          textInput={composerText}
          onTextInputChange={setComposerText}
          onModeChange={sendMode}
          awaitingAnswer={awaitingAnswer}
        />
      </div>

      {/* Session History Panel */}
      <SessionHistory open={showHistory} onClose={() => setShowHistory(false)} />
    </main>
  );
}
