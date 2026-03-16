"use client";

import { useEffect, useRef } from "react";
import { Whiteboard } from "@/components/whiteboard/Whiteboard";
import type { WhiteboardCommand } from "@/lib/types";

interface QuestionCardData {
  label: string;
  text: string;
  commands: WhiteboardCommand[];
  stepCount: number;
}

interface QuestionBoardCardsProps {
  cards: QuestionCardData[];
  expandedQ: number | null;
  setExpandedQ: (idx: number | null) => void;
  onFollowUp: (label: string) => void;
  scrollToLabel?: string | null;
  isThinking?: boolean;
}

export function QuestionBoardCards({
  cards,
  expandedQ,
  setExpandedQ,
  onFollowUp,
  scrollToLabel,
  isThinking,
}: QuestionBoardCardsProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevCommandCountRef = useRef(0);

  useEffect(() => {
    if (!scrollToLabel) return;
    const el = cardRefs.current[scrollToLabel];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToLabel]);

  // Auto-scroll to bottom when new commands arrive
  const totalCommands = cards.reduce((sum, c) => sum + c.commands.length, 0);
  useEffect(() => {
    if (totalCommands > prevCommandCountRef.current) {
      prevCommandCountRef.current = totalCommands;
      const container = scrollContainerRef.current;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
        if (isNearBottom) {
          requestAnimationFrame(() => {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          });
        }
      }
    }
  }, [totalCommands]);

  if (!cards.length) {
    return (
      <div className="flex h-full items-center justify-center text-center px-6">
        <div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Ask a question to get started
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Each question will appear as its own card with its own whiteboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto px-6 py-5 space-y-5">
      {cards.map((card, idx) => {
        const isActive = expandedQ === idx;
        const isLatest = idx === cards.length - 1;

        return (
          <div
            key={card.label}
            ref={(el) => {
              cardRefs.current[card.label] = el;
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
                {card.label}
              </span>
              {card.stepCount > 0 && (
                <span
                  className="text-[10px] px-2 py-[2px] rounded-full"
                  style={{ background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" }}
                >
                  {card.stepCount} step{card.stepCount !== 1 ? "s" : ""}
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => setExpandedQ(isActive ? null : idx)}
                className="focus-ring text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                {isActive ? "Collapse" : "Expand"}
              </button>
              <button
                onClick={() => onFollowUp(card.label)}
                className="focus-ring text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-white/5"
                style={{ color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
              >
                Follow up
              </button>
            </div>

            <div className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
              {card.text || `Question ${idx + 1}`}
            </div>

            <div
              className="relative rounded-xl overflow-hidden"
              style={{
                height: isActive ? 520 : 320,
                border: "1px solid rgba(148,163,184,0.08)",
                background: "var(--bg-base)",
              }}
            >
              <div className="flex h-full flex-col">
                <Whiteboard
                  commands={card.commands}
                  isSpeaking={false}
                  isThinking={isLatest ? !!isThinking : false}
                  onQuestionsChange={undefined}
                  toolbarPortalRef={undefined}
                  voiceCommand={undefined}
                  scrollToLabel={undefined}
                />
              </div>
            </div>
          </div>
        );
      })}

    </div>
  );
}
