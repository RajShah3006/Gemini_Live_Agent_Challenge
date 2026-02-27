"use client";

import { useState, useRef, useEffect } from "react";
import { Whiteboard } from "@/components/whiteboard/Whiteboard";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { ImageUpload } from "@/components/upload/ImageUpload";
import { useSession } from "@/hooks/useSession";

export default function Home() {
  const {
    isConnected,
    isListening,
    isSpeaking,
    isThinking,
    connect,
    disconnect,
    sendImage,
    sendText,
    startTalking,
    stopTalking,
    whiteboardCommands,
    transcript,
  } = useSession();

  const [showUpload, setShowUpload] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <main className="flex h-screen flex-col" style={{ background: "var(--bg-base)" }}>
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

        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{
              background: isConnected ? "rgba(52,211,153,0.1)" : "rgba(100,116,139,0.1)",
              color: isConnected ? "var(--success)" : "var(--text-muted)",
              border: `1px solid ${isConnected ? "rgba(52,211,153,0.2)" : "rgba(100,116,139,0.15)"}`,
            }}
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

      {/* ── Main Area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Whiteboard */}
        <div className="flex flex-1 flex-col">
          <Whiteboard
            commands={whiteboardCommands}
            isSpeaking={isSpeaking}
            isThinking={isThinking}
          />
        </div>

        {/* ── Right Panel: Transcript ── */}
        <div
          className="flex w-[300px] flex-col"
          style={{
            background: "var(--bg-surface)",
            borderLeft: "1px solid var(--border)",
          }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Your Questions
            </h3>
            {transcript.length > 0 && (
              <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                {transcript.length}
              </span>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {transcript.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-center text-xs px-4" style={{ color: "var(--text-muted)" }}>
                  Your questions will appear here. Hold <kbd className="rounded px-1 py-0.5 text-[10px] font-mono" style={{ border: "1px solid var(--border)" }}>Space</kbd> to ask.
                </p>
              </div>
            ) : (
              transcript.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                    msg.role === "user" ? "ml-6" : "mr-3"
                  }`}
                  style={{
                    background: msg.role === "user" ? "rgba(99,102,241,0.08)" : "var(--bg-elevated)",
                    border: `1px solid ${msg.role === "user" ? "rgba(99,102,241,0.12)" : "var(--border)"}`,
                    color: "var(--text-primary)",
                    animation: "slideUp 0.25s ease-out",
                  }}
                >
                  <span
                    className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: msg.role === "user" ? "var(--accent-light)" : "var(--text-muted)" }}
                  >
                    {msg.role === "user" ? "You" : "Tutor"}
                  </span>
                  {msg.text}
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Upload area */}
          {showUpload && (
            <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="pt-3">
                <ImageUpload
                  onUpload={(base64) => {
                    sendImage(base64);
                    setShowUpload(false);
                  }}
                  onCancel={() => setShowUpload(false)}
                />
              </div>
            </div>
          )}
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
          onConnect={connect}
          onDisconnect={disconnect}
          onToggleUpload={() => setShowUpload((v) => !v)}
          onSendText={sendText}
          onStartTalking={startTalking}
          onStopTalking={stopTalking}
        />
      </div>
    </main>
  );
}
