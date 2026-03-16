"use client";

import { useEffect, useRef } from "react";
import type { QuestionInfo, TranscriptEntry } from "@/lib/types";

interface QuestionCardsViewProps {
  questions: QuestionInfo[];
  transcript: TranscriptEntry[];
  expandedQ: number | null;
  setExpandedQ: (idx: number | null) => void;
  onFollowUp: (label: string) => void;
  scrollToLabel?: string | null;
}

function parseFollowUpLabel(text: string): string | null {
  const m = text.match(/^\s*\[(Q\d+)\]/i);
  return m ? m[1].toUpperCase() : null;
}

function stripFollowUp(text: string): string {
  return text.replace(/^\s*\[Q\d+\]\s*/i, "").trim();
}

function buildSegments(
  questions: QuestionInfo[],
  transcript: TranscriptEntry[]
): Record<string, Array<{ start: number; end: number }>> {
  const segs: Record<string, Array<{ start: number; end: number }>> = {};
  const labelSet = new Set(questions.map((q) => q.label));
  questions.forEach((q) => {
    segs[q.label] = [];
  });

  let openLabel: string | null = null;
  let openStart = 0;
  let newIdx = 0;

  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    if (msg.role !== "user") continue;

    const follow = parseFollowUpLabel(msg.text);
    let label: string | null = null;
    if (follow && labelSet.has(follow)) {
      label = follow;
    } else {
      label = questions[newIdx]?.label ?? null;
      newIdx += 1;
    }

    if (openLabel) {
      segs[openLabel].push({ start: openStart, end: i - 1 });
    }
    if (label) {
      openLabel = label;
      openStart = i;
    }
  }

  if (openLabel) {
    segs[openLabel].push({ start: openStart, end: transcript.length - 1 });
  }

  return segs;
}

export function QuestionCardsView({
  questions,
  transcript,
  expandedQ,
  setExpandedQ,
  onFollowUp,
  scrollToLabel,
}: QuestionCardsViewProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const segments = buildSegments(questions, transcript);

  useEffect(() => {
    if (!scrollToLabel) return;
    const el = cardRefs.current[scrollToLabel];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToLabel]);

  if (!questions.length) {
    return (
      <div className="flex h-full items-center justify-center text-center px-6">
        <div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Ask a question to get started
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Each question will appear as its own card here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      {questions.map((q) => {
        const isActive = expandedQ === q.idx;
        const segs = segments[q.label] || [];
        const msgs = segs.flatMap((s) => transcript.slice(s.start, s.end + 1));
        const lastTutor = [...msgs].reverse().find((m) => m.role === "tutor");
        const preview = lastTutor
          ? lastTutor.text.slice(0, 140).replace(/\*\*/g, "") + (lastTutor.text.length > 140 ? "..." : "")
          : "";

        return (
          <div
            key={q.idx}
            ref={(el) => {
              cardRefs.current[q.label] = el;
            }}
            className="rounded-2xl border p-5"
            style={{
              background: "rgba(15,20,40,0.55)",
              borderColor: isActive ? "rgba(99,102,241,0.4)" : "rgba(148,163,184,0.08)",
              boxShadow: isActive ? "0 12px 30px rgba(15,20,40,0.4)" : "none",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[11px] font-bold rounded px-2 py-[2px]"
                style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}
              >
                {q.label}
              </span>
              {(q.stepCount ?? 0) > 0 && (
                <span
                  className="text-[10px] px-2 py-[2px] rounded-full"
                  style={{ background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" }}
                >
                  {q.stepCount} step{q.stepCount !== 1 ? "s" : ""}
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => setExpandedQ(isActive ? null : q.idx)}
                className="focus-ring text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                {isActive ? "Collapse" : "Expand"}
              </button>
              <button
                onClick={() => onFollowUp(q.label)}
                className="focus-ring text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
                style={{ color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
              >
                Follow up
              </button>
            </div>

            <div className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
              {q.text}
            </div>

            {!isActive && preview && (
              <div
                className="text-[13px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {preview}
              </div>
            )}

            {isActive && (
              <div className="space-y-2">
                {msgs.map((m, i) => {
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={`${q.idx}-${i}`}
                      className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed ${isUser ? "ml-6" : ""}`}
                      style={{
                        background: isUser ? "rgba(99,102,241,0.08)" : "rgba(148,163,184,0.06)",
                        borderLeft: isUser ? "none" : "2px solid var(--accent)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <div
                        className="text-[10px] font-bold uppercase tracking-wider mb-1"
                        style={{ color: isUser ? "#818cf8" : "var(--accent)", opacity: 0.6 }}
                      >
                        {isUser ? "You" : "MathBoard"}
                      </div>
                      {stripFollowUp(m.text)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
