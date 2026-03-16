"use client";

import type { TranscriptEntry } from "@/lib/types";
import type { QuestionInfo } from "@/lib/types";

interface QuestionCardsDockProps {
  questions: QuestionInfo[];
  transcript: TranscriptEntry[];
  onFollowUp: (label: string) => void;
  onScrollToQuestion?: (label: string) => void;
  onClose?: () => void;
}

function smartTitle(text: string): string {
  const clean = text.replace(/\*\*/g, "").trim();
  const match = clean.match(
    /^(solve|find|compute|evaluate|simplify|prove|graph|what is|calculate|derive|integrate|differentiate|explain|show)\b/i
  );
  if (match) {
    const end = clean.search(/[.?!,;]|(?:\s+(?:and|then|if|for|where|given)\s)/i);
    return end > 0 && end < 80 ? clean.slice(0, end) : clean.slice(0, 72);
  }
  return clean.length > 72 ? clean.slice(0, 69) + "..." : clean;
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (!ts || sec < 0) return "";
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function getQTranscript(q: QuestionInfo, transcript: TranscriptEntry[]): TranscriptEntry[] {
  const prefix = q.text ? q.text.slice(0, 30).toLowerCase() : "";
  const userIdx = prefix
    ? transcript.findIndex(
        (t) => t.role === "user" && t.text.toLowerCase().includes(prefix)
      )
    : -1;
  const nextUserIdx =
    userIdx >= 0 ? transcript.findIndex((t, i) => i > userIdx && t.role === "user") : -1;
  const endIdx = nextUserIdx >= 0 ? nextUserIdx : transcript.length;
  return userIdx >= 0 ? transcript.slice(userIdx, endIdx) : [];
}

export function QuestionCardsDock({
  questions,
  transcript,
  onFollowUp,
  onScrollToQuestion,
  onClose,
}: QuestionCardsDockProps) {
  if (!questions.length) return null;

  return (
    <div
      className="w-full"
      style={{
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between px-5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Question Cards
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc" }}
          >
            {questions.length}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="focus-ring text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
            aria-label="Hide question cards"
          >
            Hide
          </button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto px-5 pb-3">
        {questions.map((q) => {
          const qTrans = getQTranscript(q, transcript);
          const hasTutorReply = qTrans.some((t) => t.role === "tutor");
          const tutorReply = qTrans.find((t) => t.role === "tutor");
          const preview = tutorReply
            ? tutorReply.text.slice(0, 90).replace(/\*\*/g, "") + (tutorReply.text.length > 90 ? "..." : "")
            : "";
          const lastTs = qTrans.length ? qTrans[qTrans.length - 1].timestamp : 0;
          const statusLabel = hasTutorReply ? "Solved" : "Working";
          const statusColor = hasTutorReply
            ? { bg: "rgba(52,211,153,0.10)", text: "#34d399" }
            : { bg: "rgba(251,191,36,0.10)", text: "#fbbf24" };

          return (
            <div
              key={q.idx}
              className="min-w-[240px] max-w-[280px] rounded-xl border px-3 py-3 flex-shrink-0"
              style={{
                background: "rgba(15,20,40,0.45)",
                borderColor: "rgba(148,163,184,0.08)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold rounded px-1.5 py-[2px]"
                  style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}
                >
                  {q.label}
                </span>
                {(q.stepCount ?? 0) > 0 && (
                  <span
                    className="text-[9px] px-1.5 py-[1px] rounded-full"
                    style={{ background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" }}
                  >
                    {q.stepCount} step{q.stepCount !== 1 ? "s" : ""}
                  </span>
                )}
                <span className="flex-1" />
                <span
                  className="text-[9px] px-1.5 py-[2px] rounded-full"
                  style={{ background: statusColor.bg, color: statusColor.text }}
                >
                  {statusLabel}
                </span>
              </div>

              <div
                className="text-[12.5px] font-medium leading-snug line-clamp-2"
                style={{ color: "var(--text-primary)" }}
              >
                {smartTitle(q.text)}
              </div>

              {preview && (
                <div
                  className="text-[10.5px] mt-2 line-clamp-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  {preview}
                </div>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => onScrollToQuestion?.(q.label)}
                  className="focus-ring text-[10px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
                  style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  View
                </button>
                <button
                  onClick={() => onFollowUp(q.label)}
                  className="focus-ring text-[10px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
                  style={{ color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
                >
                  Follow up
                </button>
                <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(lastTs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
