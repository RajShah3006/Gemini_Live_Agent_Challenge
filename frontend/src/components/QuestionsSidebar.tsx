"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TranscriptEntry } from "@/lib/types";
import type { QuestionInfo } from "@/components/whiteboard/Whiteboard";

/* ── Types ── */

interface QuestionsSidebarProps {
  questions: QuestionInfo[];
  transcript: TranscriptEntry[];
  expandedQ: number | null;
  setExpandedQ: (idx: number | null) => void;
  onFollowUp: (label: string) => void;
  onComposerFill: (text: string) => void;
  isThinking: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  onScrollToQuestion?: (label: string) => void;
}

type QAction = "rename" | "archive" | "delete";

/* ── Helpers ── */

function smartTitle(text: string): string {
  // Extract a concise title from the question text
  const clean = text.replace(/\*\*/g, "").trim();
  // If starts with common math keywords, use them
  const match = clean.match(
    /^(solve|find|compute|evaluate|simplify|prove|graph|what is|calculate|derive|integrate|differentiate|explain|show)\b/i
  );
  if (match) {
    // Take up to the first sentence/clause break
    const end = clean.search(/[.?!,;]|(?:\s+(?:and|then|if|for|where|given)\s)/i);
    return end > 0 && end < 80 ? clean.slice(0, end) : clean.slice(0, 72);
  }
  // Fallback: first 72 chars
  return clean.length > 72 ? clean.slice(0, 69) + "…" : clean;
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/* ── Small action dropdown ── */

function ActionMenu({
  onAction,
  onClose,
}: {
  onAction: (a: QAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items: { action: QAction; icon: string; label: string; danger?: boolean }[] = [
    { action: "rename", icon: "✏️", label: "Rename" },
    { action: "archive", icon: "📦", label: "Archive" },
    { action: "delete", icon: "🗑️", label: "Delete", danger: true },
  ];

  return (
    <div
      ref={ref}
      className="absolute right-2 top-8 z-50 rounded-lg py-1 shadow-xl"
      style={{
        background: "rgba(15,20,35,0.98)",
        border: "1px solid rgba(148,163,184,0.12)",
        backdropFilter: "blur(16px)",
        minWidth: 140,
      }}
    >
      {items.map((it) => (
        <button
          key={it.action}
          onClick={(e) => {
            e.stopPropagation();
            onAction(it.action);
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors hover:bg-white/[0.06]"
          style={{ color: it.danger ? "#f87171" : "var(--text-secondary)" }}
        >
          <span className="text-xs">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ── Chat message (inline) ── */

function InlineMessage({ msg }: { msg: TranscriptEntry }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed ${isUser ? "ml-4" : ""}`}
      style={{
        background: isUser ? "rgba(99,102,241,0.08)" : "rgba(148,163,184,0.04)",
        borderLeft: isUser ? "none" : "2px solid var(--accent)",
        color: "var(--text-primary)",
      }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-wider block mb-1"
        style={{ color: isUser ? "#818cf8" : "var(--accent)", opacity: 0.6 }}
      >
        {isUser ? "You" : "MathBoard"}
      </span>
      <span className="whitespace-pre-wrap">{msg.text}</span>
    </div>
  );
}

/* ── Thinking dots ── */

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
          style={{
            background: "var(--accent)",
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
      <span className="text-[10px] ml-1.5" style={{ color: "var(--text-muted)" }}>
        Thinking…
      </span>
    </div>
  );
}

/* ── Main sidebar component ── */

export function QuestionsSidebar({
  questions,
  transcript,
  expandedQ,
  setExpandedQ,
  onFollowUp,
  onComposerFill,
  isThinking,
  chatEndRef,
  onScrollToQuestion,
}: QuestionsSidebarProps) {
  const [searchFilter, setSearchFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [renames, setRenames] = useState<Record<number, string>>({});
  const [archived, setArchived] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingIdx !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingIdx]);

  const commitRename = useCallback(() => {
    if (renamingIdx !== null && renameValue.trim()) {
      setRenames((r) => ({ ...r, [renamingIdx]: renameValue.trim() }));
    }
    setRenamingIdx(null);
    setRenameValue("");
  }, [renamingIdx, renameValue]);

  const handleAction = useCallback(
    (idx: number, action: QAction) => {
      setMenuOpen(null);
      switch (action) {
        case "rename": {
          const q = questions.find((q) => q.idx === idx);
          setRenameValue(renames[idx] || q?.text.slice(0, 60) || "");
          setRenamingIdx(idx);
          break;
        }
        case "archive":
          setArchived((s) => new Set(s).add(idx));
          break;
        case "delete":
          setDeleted((s) => new Set(s).add(idx));
          break;
      }
    },
    [questions, renames]
  );

  // Group transcript per question
  const getQTranscript = useCallback(
    (q: QuestionInfo) => {
      const userIdx = transcript.findIndex(
        (t) => t.role === "user" && q.text && t.text.includes(q.text.slice(0, 20))
      );
      const nextUserIdx =
        userIdx >= 0 ? transcript.findIndex((t, i) => i > userIdx && t.role === "user") : -1;
      const endIdx = nextUserIdx >= 0 ? nextUserIdx : transcript.length;
      return userIdx >= 0 ? transcript.slice(userIdx, endIdx) : [];
    },
    [transcript]
  );

  const visibleQuestions = questions
    .filter((q) => !deleted.has(q.idx) && !archived.has(q.idx))
    .filter(
      (q) =>
        !searchFilter ||
        q.text.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (renames[q.idx] || "").toLowerCase().includes(searchFilter.toLowerCase())
    );

  const archivedCount = questions.filter((q) => archived.has(q.idx) && !deleted.has(q.idx)).length;

  return (
    <div
      className="flex w-full md:w-[400px] h-full flex-col relative z-20 shadow-[1px_0_10px_rgba(0,0,0,0.05)]"
      style={{
        background: "var(--bg-surface)",
        borderRight: "1px solid rgba(148,163,184,0.08)",
      }}
    >
      {/* ── Header ── */}
      <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(148,163,184,0.06)" }}>
        <div className="flex items-center justify-between mb-2">
          <h3
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Questions
          </h3>
          <div className="flex items-center gap-1.5">
            {archivedCount > 0 && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-medium cursor-default"
                style={{ background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" }}
                title={`${archivedCount} archived`}
              >
                📦 {archivedCount}
              </span>
            )}
            {questions.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc" }}
              >
                {visibleQuestions.length}
              </span>
            )}
          </div>
        </div>
        {(transcript.length > 4 || questions.length > 3) && (
          <div className="relative">
            <input
              type="text"
              placeholder="Search questions…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full rounded-lg px-2.5 py-1.5 text-[11px] outline-none pl-7"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid rgba(148,163,184,0.06)",
              }}
              aria-label="Search questions"
            />
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              🔍
            </span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {questions.length === 0 && transcript.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col h-full items-center justify-center p-6 text-center">
            <h2
              className="text-sm font-bold mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              Your personal AI math tutor
            </h2>
            <p
              className="text-xs mb-6 px-1 leading-relaxed opacity-80"
              style={{ color: "var(--text-secondary)" }}
            >
              From algebra to calculus, step by step.
            </p>

            <div className="w-full space-y-2 text-left mb-8">
              {[
                { icon: "📚", label: "Calculus", desc: "What is the derivative of tan²x?" },
                { icon: "🔢", label: "Algebra", desc: "Solve 2x² - 5x + 3 = 0 step by step" },
                { icon: "💡", label: "Concepts", desc: "Explain the product rule with an example" },
                { icon: "📷", label: "Homework", desc: "Upload a photo to grade it" },
              ].map(({ icon, label, desc }) => (
                <div
                  key={label}
                  className="flex items-start gap-3 p-3 rounded-xl transition-all hover:bg-white/5 cursor-pointer border border-transparent hover:border-white/10 shadow-sm"
                  onClick={() => onComposerFill(desc)}
                >
                  <span className="text-lg shrink-0">{icon}</span>
                  <div>
                    <span
                      className="text-[12px] font-bold block mb-0.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {label}
                    </span>
                    <span
                      className="text-[11px] leading-relaxed block"
                      style={{ color: "var(--text-muted)" }}
                    >
                      &quot;{desc}&quot;
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p
              className="text-[11px] bg-white/5 p-3 rounded-lg border border-white/5 text-left w-full"
              style={{ color: "var(--text-muted)" }}
            >
              <span className="font-bold mr-1" style={{ color: "var(--accent)" }}>
                Pro tip:
              </span>
              Include the full question (with all terms) so I can show every step clearly.
            </p>
          </div>
        ) : (
          <>
            {/* ── Question cards ── */}
            {visibleQuestions.map((q) => {
              const isActive = expandedQ === q.idx;
              const qTrans = getQTranscript(q);
              const hasTutorReply = qTrans.some((t) => t.role === "tutor");
              const tutorReply = qTrans.find((t) => t.role === "tutor");
              const preview = tutorReply
                ? tutorReply.text.slice(0, 80).replace(/\*\*/g, "") +
                  (tutorReply.text.length > 80 ? "…" : "")
                : "";
              const displayTitle = renames[q.idx] || smartTitle(q.text);
              const statusLabel = hasTutorReply ? "Solved" : "Working";
              const statusColor = hasTutorReply
                ? { bg: "rgba(52,211,153,0.10)", text: "#34d399", dot: "#34d399" }
                : { bg: "rgba(251,191,36,0.10)", text: "#fbbf24", dot: "#fbbf24" };
              const isRenaming = renamingIdx === q.idx;

              return (
                <div
                  key={q.idx}
                  className="group relative rounded-xl overflow-hidden transition-all duration-200"
                  style={{
                    background: isActive
                      ? "rgba(99,102,241,0.10)"
                      : "rgba(15,20,40,0.4)",
                    border: isActive
                      ? "1px solid rgba(99,102,241,0.35)"
                      : "1px solid rgba(148,163,184,0.06)",
                    boxShadow: isActive ? "0 0 20px rgba(99,102,241,0.10), inset 0 1px 0 rgba(255,255,255,0.03)" : "none",
                  }}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
                      style={{ background: "#818cf8" }}
                    />
                  )}

                  {/* ── Card header (clickable) ── */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setExpandedQ(isActive ? null : q.idx);
                      if (!isActive && onScrollToQuestion) {
                        onScrollToQuestion(q.label);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedQ(isActive ? null : q.idx);
                        if (!isActive && onScrollToQuestion) onScrollToQuestion(q.label);
                      }
                    }}
                    className="focus-ring w-full text-left px-3.5 py-3 transition-colors hover:bg-white/[0.03] cursor-pointer"
                  >
                    {/* Top row: badge + step count + status + menu */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-[10px] font-bold shrink-0 rounded px-1.5 py-[2px] tracking-wide"
                        style={{
                          background: isActive
                            ? "rgba(99,102,241,0.25)"
                            : "rgba(99,102,241,0.12)",
                          color: isActive ? "#a5b4fc" : "#818cf8",
                        }}
                      >
                        {q.label}
                      </span>
                      {/* Step count badge */}
                      {q.stepCount > 0 && (
                        <span
                          className="text-[9px] font-medium px-1.5 py-[1px] rounded-full"
                          style={{ background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" }}
                        >
                          {q.stepCount} step{q.stepCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span className="flex-1" />
                      {/* Status badge */}
                      <span
                        className="flex items-center gap-1 text-[9px] font-medium px-1.5 py-[2px] rounded-full"
                        style={{ background: statusColor.bg, color: statusColor.text }}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: statusColor.dot }}
                        />
                        {statusLabel}
                      </span>
                      {/* Three-dot menu */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(menuOpen === q.idx ? null : q.idx);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[14px] px-1 rounded hover:bg-white/10"
                        style={{ color: "var(--text-muted)" }}
                        aria-label="Question actions"
                      >
                        ⋯
                      </button>
                    </div>

                    {/* Title (or inline rename input) */}
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") { setRenamingIdx(null); setRenameValue(""); }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-[12px] font-medium rounded px-2 py-1 outline-none"
                        style={{
                          background: "var(--bg-elevated)",
                          color: "var(--text-primary)",
                          border: "1px solid rgba(99,102,241,0.4)",
                        }}
                        maxLength={80}
                      />
                    ) : (
                      <div
                        className="text-[12.5px] font-medium leading-snug line-clamp-2"
                        style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
                      >
                        {displayTitle}
                      </div>
                    )}

                    {/* Preview (collapsed only) */}
                    {!isActive && preview && (
                      <div
                        className="text-[10.5px] leading-relaxed mt-1.5 line-clamp-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        → {preview}
                      </div>
                    )}
                  </div>
                  {menuOpen === q.idx && (
                    <ActionMenu
                      onAction={(a) => handleAction(q.idx, a)}
                      onClose={() => setMenuOpen(null)}
                    />
                  )}

                  {/* ── Follow-up (hover, collapsed) ── */}
                  {!isActive && (
                    <div className="px-3.5 pb-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onFollowUp(q.label)}
                        className="focus-ring text-[10px] font-medium transition-colors hover:underline"
                        style={{ color: "#818cf8" }}
                      >
                        ↩ Follow up
                      </button>
                    </div>
                  )}

                  {/* ── Expanded transcript ── */}
                  {isActive && (
                    <div
                      className="px-3.5 pb-3 pt-2 space-y-1.5"
                      style={{ borderTop: "1px solid rgba(148,163,184,0.06)" }}
                    >
                      {qTrans.map((msg, mi) => (
                        <InlineMessage key={mi} msg={msg} />
                      ))}
                      <button
                        onClick={() => onFollowUp(q.label)}
                        className="focus-ring w-full text-[10px] font-medium py-2 rounded-lg transition-colors hover:bg-white/5"
                        style={{ color: "#818cf8" }}
                      >
                        ↩ Follow up on {q.label}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Ungrouped transcript ── */}
            {transcript
              .filter((msg) =>
                searchFilter
                  ? msg.text.toLowerCase().includes(searchFilter.toLowerCase())
                  : true
              )
              .filter((_, i) => questions.length === 0 || i >= questions.length * 2)
              .map((msg, i) => (
                <InlineMessage key={`t-${i}`} msg={msg} />
              ))}
          </>
        )}

        {isThinking && <ThinkingDots />}
        <div ref={chatEndRef} />
      </div>
    </div>
  );
}
