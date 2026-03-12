"use client";

/**
 * Whiteboard — Orchestrator component that manages notebook pages.
 *
 * Each user question gets its own NotebookPage (canvas). This component:
 *  - Routes incoming whiteboard commands to the correct page
 *  - Splits commands on "question_header" action to create new pages
 *  - Manages page navigation, scrolling, zoom
 *  - Hosts the toolbar, graph presets panel, and teacher mascot
 *  - Handles voice commands (undo, clear, zoom, goto)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { WhiteboardCommand } from "@/lib/types";
import { STEP_COLORS } from "./whiteboard-helpers";
import { NotebookPage } from "./NotebookPage";
import { TeacherMascot, type MascotState } from "./TeacherMascot";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { GraphPresets } from "./GraphPresets";

/* ═══ Types ═══ */

export interface QuestionInfo {
  label: string;
  text: string;
  idx: number;
  yStart: number;
  stepCount: number;
}

interface Page {
  id: string;
  label: string;           // "Q1", "Q2", etc.
  questionText: string;
  isFollowUp: boolean;
  parentLabel?: string;     // For follow-ups: which Q they reference
  commands: WhiteboardCommand[];
  accentColor: string;
}

interface WhiteboardProps {
  commands: WhiteboardCommand[];
  isSpeaking?: boolean;
  isThinking?: boolean;
  onQuestionsChange?: (questions: QuestionInfo[]) => void;
  toolbarPortalRef?: React.RefObject<HTMLDivElement | null>;
  voiceCommand?: { cmd: string; arg?: string } | null;
  scrollToLabel?: string | null;
}

/* ═══ Main Whiteboard Orchestrator ═══ */

export function Whiteboard({
  commands,
  isSpeaking = false,
  isThinking = false,
  onQuestionsChange,
  toolbarPortalRef,
  voiceCommand,
  scrollToLabel,
}: WhiteboardProps) {
  const [pages, setPages] = useState<Page[]>([]);
  const pagesRef = useRef<Page[]>([]);
  const processedRef = useRef(0);
  const questionCountRef = useRef(0);
  const activePageIdRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const dummyCanvasRef = useRef<HTMLCanvasElement | null>(null); // For toolbar undo/clear
  const [zoom, setZoom] = useState(1);

  // Track active page for rendering
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // Mascot state
  const isDrawing = pages.some(p => p.id === activePageId && p.commands.length > 0);
  const mascotState: MascotState = isDrawing && isThinking ? "writing" : isSpeaking ? "talking" : isThinking ? "thinking" : "idle";

  /* ── Route incoming commands to pages ── */
  const processCommands = useCallback(() => {
    const fresh = commands.slice(processedRef.current);
    if (fresh.length === 0) return;
    processedRef.current = commands.length;

    let updated = false;

    for (const cmd of fresh) {
      // Clear all pages
      if (cmd.action === "clear" && cmd.id === "user-clear") {
        pagesRef.current = [];
        questionCountRef.current = 0;
        activePageIdRef.current = null;
        setPages([]);
        setActivePageId(null);
        updated = true;
        continue;
      }
      if (cmd.action === "clear") continue;

      // Question header → create new page or follow-up
      if (cmd.action === "question_header") {
        const rawText = (cmd.params.text as string) || "";

        // Detect follow-up
        const qRef = rawText.match(/^\[Q(\d+)\]/i);
        let isFollowUp = false;
        let parentLabel: string | undefined;

        if (qRef) {
          const refNum = parseInt(qRef[1], 10);
          const parentPage = pagesRef.current.find(
            p => !p.isFollowUp && p.label === `Q${refNum}`
          );
          if (parentPage) {
            isFollowUp = true;
            parentLabel = parentPage.label;
          }
        } else if (pagesRef.current.length > 0) {
          const trimmed = rawText.trim();
          const looksLikeFollowUp =
            trimmed.length < 60 &&
            !/[0-9]{2,}|[+\-*/^=∫∑∏√]|\\frac|derivative|integral|solve|graph|plot/i.test(trimmed) &&
            /^(why|how|what|explain|elaborate|more|detail|show|can you|could you|tell me|again|huh|isn.t|doesn.t|but|and|also|wait|so|really|isn.t that|what about|what if)/i.test(trimmed);
          if (looksLikeFollowUp) {
            for (let i = pagesRef.current.length - 1; i >= 0; i--) {
              if (!pagesRef.current[i].isFollowUp) {
                parentLabel = pagesRef.current[i].label;
                isFollowUp = true;
                break;
              }
            }
          }
        }

        if (isFollowUp && parentLabel) {
          // Find the parent page and add commands there
          const parentPage = pagesRef.current.find(p => p.label === parentLabel);
          if (parentPage) {
            // Add a visual separator command to the parent page
            const sepY = getNextY(parentPage.commands);
            parentPage.commands = [
              ...parentPage.commands,
              {
                id: `followup-sep-${Date.now()}`,
                action: "draw_text" as const,
                params: {
                  text: `↪ ${rawText.replace(/^\[Q\d+\]\s*/i, "")}`,
                  x: 30,
                  y: sepY + 50,
                  _isFollowUpHeader: true,
                },
              },
            ];
            activePageIdRef.current = parentPage.id;
            setActivePageId(parentPage.id);
            updated = true;
          }
        } else {
          // New question → new page
          questionCountRef.current += 1;
          const label = `Q${questionCountRef.current}`;
          const color = STEP_COLORS[(questionCountRef.current - 1) % STEP_COLORS.length];
          const newPage: Page = {
            id: `page-${Date.now()}-${questionCountRef.current}`,
            label,
            questionText: rawText,
            isFollowUp: false,
            commands: [],
            accentColor: color,
          };
          pagesRef.current = [...pagesRef.current, newPage];
          activePageIdRef.current = newPage.id;
          setActivePageId(newPage.id);
          updated = true;
        }
        continue;
      }

      // All other commands → route to active page
      if (activePageIdRef.current) {
        const activePage = pagesRef.current.find(p => p.id === activePageIdRef.current);
        if (activePage) {
          activePage.commands = [...activePage.commands, cmd];
          updated = true;
        }
      } else if (pagesRef.current.length === 0) {
        // No page exists yet — create one
        questionCountRef.current += 1;
        const label = `Q${questionCountRef.current}`;
        const color = STEP_COLORS[(questionCountRef.current - 1) % STEP_COLORS.length];
        const newPage: Page = {
          id: `page-${Date.now()}-${questionCountRef.current}`,
          label,
          questionText: "Solution",
          isFollowUp: false,
          commands: [cmd],
          accentColor: color,
        };
        pagesRef.current = [...pagesRef.current, newPage];
        activePageIdRef.current = newPage.id;
        setActivePageId(newPage.id);
        updated = true;
      }
    }

    if (updated) {
      setPages([...pagesRef.current]);
      // Notify parent of question list
      if (onQuestionsChange) {
        const qs = pagesRef.current
          .filter(p => !p.isFollowUp)
          .map((p, i) => ({
            label: p.label,
            text: p.questionText.slice(0, 60),
            idx: i,
            yStart: 0,
            stepCount: p.commands.filter(c => c.action === "step_marker").length,
          }));
        onQuestionsChange(qs);
      }
    }
  }, [commands, onQuestionsChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external commands prop
    processCommands();
  }, [processCommands]);

  /* ── Auto-scroll to active page when a new one is created ── */
  useEffect(() => {
    if (activePageId && scrollContainerRef.current) {
      const el = pageRefsMap.current.get(activePageId);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    }
  }, [activePageId, pages.length]);

  /* ── Voice commands ── */
  useEffect(() => {
    if (!voiceCommand) return;
    const { cmd, arg } = voiceCommand;
    switch (cmd) {
      case "clear":
        pagesRef.current = [];
        questionCountRef.current = 0;
        activePageIdRef.current = null;
        processedRef.current = 0;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing voiceCommand prop
        setPages([]);
        setActivePageId(null);
        break;
      case "zoom_in":
        setZoom(prev => Math.min(2, prev + 0.25));
        break;
      case "zoom_out":
        setZoom(prev => Math.max(0.5, prev - 0.25));
        break;
      case "goto_q": {
        const qNum = parseInt(arg || "1", 10);
        const page = pagesRef.current.find(p => p.label === `Q${qNum}`);
        if (page) {
          const el = pageRefsMap.current.get(page.id);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        break;
      }
      case "undo":
        break;
    }
  }, [voiceCommand]);

  /* ── Ctrl+wheel zoom ── */
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(prev => Math.max(0.5, Math.min(2, prev - e.deltaY * 0.003)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ── Scroll to question when sidebar navigates ── */
  useEffect(() => {
    if (!scrollToLabel) return;
    const page = pagesRef.current.find(p => p.label === scrollToLabel);
    if (page) {
      activePageIdRef.current = page.id;
      setActivePageId(page.id);
      const el = pageRefsMap.current.get(page.id);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    }
  }, [scrollToLabel]);

  /* ── Graph preset handler ── */
  const handleGraphPreset = useCallback((fn: string, label: string) => {
    // Find or create active page, then inject graph command
    let targetPage = pagesRef.current.find(p => p.id === activePageIdRef.current);
    if (!targetPage && pagesRef.current.length > 0) {
      targetPage = pagesRef.current[pagesRef.current.length - 1];
    }
    if (!targetPage) {
      questionCountRef.current += 1;
      const lbl = `Q${questionCountRef.current}`;
      const color = STEP_COLORS[(questionCountRef.current - 1) % STEP_COLORS.length];
      targetPage = {
        id: `page-${Date.now()}-${questionCountRef.current}`,
        label: lbl,
        questionText: `Graph: ${label}`,
        isFollowUp: false,
        commands: [],
        accentColor: color,
      };
      pagesRef.current = [...pagesRef.current, targetPage];
      activePageIdRef.current = targetPage.id;
    }
    const yPos = getNextY(targetPage.commands) + 30;
    const graphCmd: WhiteboardCommand = {
      id: `preset-${Date.now()}`,
      action: "draw_graph",
      params: { fn, label, x: 60, y: yPos, width: 500, height: 350 },
    };
    // Update immutably by replacing the page in pagesRef
    const updatedPage = { ...targetPage, commands: [...targetPage.commands, graphCmd] };
    pagesRef.current = pagesRef.current.map(p => p.id === updatedPage.id ? updatedPage : p);
    setPages([...pagesRef.current]);
  }, []);

  /* ── Clear / Undo handlers (for toolbar) ── */
  const handleClear = useCallback(() => {
    pagesRef.current = [];
    questionCountRef.current = 0;
    activePageIdRef.current = null;
    processedRef.current = 0;
    setPages([]);
    setActivePageId(null);
  }, []);

  const handleUndo = useCallback(() => {
    if (activePageIdRef.current) {
      const page = pagesRef.current.find(p => p.id === activePageIdRef.current);
      if (page && page.commands.length > 0) {
        page.commands = page.commands.slice(0, -1);
        setPages([...pagesRef.current]);
      }
    }
  }, []);

  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [dummyCanvas, setDummyCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving portal ref after mount
    setPortalTarget(toolbarPortalRef?.current ?? null);
    if (!dummyCanvasRef.current) {
      dummyCanvasRef.current = document.createElement("canvas");
    }
    setDummyCanvas(dummyCanvasRef.current);
  }, [toolbarPortalRef]);

  const BG = "#0b1120";

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: BG }}>
      {/* ── Toolbar (portaled into header) ── */}
      {portalTarget && createPortal(
        <>
          {/* Question navigation tabs */}
          {pages.filter(p => !p.isFollowUp).length > 1 && (
            <div className="flex items-center gap-0.5 rounded-xl px-1.5 py-1"
              style={{
                background: "rgba(148,163,184,0.06)",
                border: "1px solid rgba(148,163,184,0.08)",
              }}
            >
              <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: "none", maxWidth: 220 }}>
                {pages.filter(p => !p.isFollowUp).map(page => (
                  <button
                    key={page.id}
                    onClick={() => {
                      const el = pageRefsMap.current.get(page.id);
                      el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                      page.id === activePageId ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                    style={{ color: page.id === activePageId ? page.accentColor : "#94a3b8" }}
                    title={`${page.label}: ${page.questionText}`}
                  >
                    <span style={{ color: page.accentColor }}>●</span>
                    {page.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <GraphPresets onGraph={handleGraphPreset} />
          <WhiteboardToolbar
            canvasRef={{ current: dummyCanvas }}
            containerRef={scrollContainerRef}
            onUndo={handleUndo}
            onClear={handleClear}
            canUndo={pages.some(p => p.commands.length > 0)}
            zoom={zoom}
            onZoomChange={setZoom}
          />
        </>,
        portalTarget,
      )}

      {/* ── Notebook Content ── */}
      <div
        ref={scrollContainerRef}
        className="absolute inset-0 overflow-auto"
        style={{
          scrollbarWidth: "none", // hide scrollbar for sleek look
        }}
      >
        {/* Pinned Question Header */}
        {pages.filter(p => !p.isFollowUp).length > 0 && activePageId && (() => {
          const activePage = pages.find(p => p.id === activePageId);
          if (activePage) {
            const stepCount = activePage.commands.filter(c => c.action === "step_marker").length;
            return (
              <div className="sticky top-0 left-0 right-0 z-20 flex justify-center pt-4 pb-8 pointer-events-none bg-gradient-to-b from-[#0b1120] via-[#0b1120]/80 to-transparent">
                <div className="pointer-events-auto px-5 py-2.5 rounded-2xl shadow-lg flex items-center gap-3 backdrop-blur-md"
                     style={{ background: "rgba(15, 23, 42, 0.80)", border: "1px solid rgba(148,163,184,0.12)" }}>
                  <span className="text-[11px] font-bold tracking-wider px-2 py-0.5 rounded-md"
                    style={{ color: activePage.accentColor, background: `${activePage.accentColor}18` }}>
                    {activePage.label}
                  </span>
                  <span className="text-[13px] font-medium leading-snug max-w-[400px] truncate" style={{ color: "var(--text-primary)" }}>
                    {activePage.questionText}
                  </span>
                  {stepCount > 0 && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" }}>
                      {stepCount} step{stepCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })()}

        <div style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top center",
          width: `${100 / zoom}%`,
          padding: "40px 0 120px 0", // Top spacing for banner, bottom spacing for scrolling
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}>
          {/* ── Pages ── */}
          {pages.filter(p => !p.isFollowUp).map(page => (
            <div
              key={page.id}
              ref={el => {
                if (el) pageRefsMap.current.set(page.id, el);
              }}
              className="w-full max-w-[800px]" // Constraint width inside the canvas instead of shrinking the canvas container
            >
              <NotebookPage
                label={page.label}
                questionText={page.questionText}
                commands={page.commands}
                isActive={page.id === activePageId}
                isThinking={isThinking && page.id === activePageId}
                accentColor={page.accentColor}
              />
            </div>
          ))}

          {/* ── Empty State ── */}
          {pages.length === 0 && (
            <div className="flex items-center justify-center" style={{ minHeight: "70vh" }}>
              <div className="text-center relative">
                {/* Floating math symbols */}
                <div className="absolute inset-0 -m-20 pointer-events-none overflow-hidden opacity-[0.06]" aria-hidden>
                  <span className="absolute text-4xl top-2 left-4" style={{ animation: "mascotFloat 4s ease-in-out infinite" }}>∫</span>
                  <span className="absolute text-3xl top-8 right-6" style={{ animation: "mascotFloat 5s ease-in-out 0.5s infinite" }}>π</span>
                  <span className="absolute text-5xl bottom-4 left-8" style={{ animation: "mascotFloat 3.5s ease-in-out 1s infinite" }}>√</span>
                  <span className="absolute text-3xl bottom-8 right-2" style={{ animation: "mascotFloat 4.5s ease-in-out 0.3s infinite" }}>∑</span>
                  <span className="absolute text-4xl top-1/2 left-0" style={{ animation: "mascotFloat 3.8s ease-in-out 0.7s infinite" }}>Δ</span>
                  <span className="absolute text-3xl top-1/3 right-0" style={{ animation: "mascotFloat 4.2s ease-in-out 1.2s infinite" }}>∞</span>
                </div>
                {/* Owl mascot */}
                <svg width="80" height="90" viewBox="0 0 80 90" fill="none" xmlns="http://www.w3.org/2000/svg"
                  className="mx-auto mb-4" style={{ filter: "drop-shadow(0 0 16px rgba(99,102,241,0.4))", animation: "mascotFloat 3s ease-in-out infinite" }}>
                  <ellipse cx="40" cy="58" rx="26" ry="28" fill="#1a2744" stroke="#2d4a7a" strokeWidth="1.5" />
                  <ellipse cx="40" cy="64" rx="16" ry="18" fill="#0f1d35" opacity="0.6" />
                  <ellipse cx="14" cy="50" rx="10" ry="18" fill="#1a2744" stroke="#2d4a7a" strokeWidth="1"
                    style={{ transformOrigin: "24px 50px", animation: "wingWave 1.2s ease-in-out infinite" }} />
                  <ellipse cx="66" cy="50" rx="10" ry="18" fill="#1a2744" stroke="#2d4a7a" strokeWidth="1" />
                  <circle cx="40" cy="28" r="22" fill="#1e3050" stroke="#2d4a7a" strokeWidth="1.5" />
                  <path d="M22 12 L26 22 L18 20 Z" fill="#1e3050" stroke="#2d4a7a" strokeWidth="1" />
                  <path d="M58 12 L54 22 L62 20 Z" fill="#1e3050" stroke="#2d4a7a" strokeWidth="1" />
                  <circle cx="32" cy="26" r="9" fill="#0a1628" />
                  <circle cx="48" cy="26" r="9" fill="#0a1628" />
                  <circle cx="32" cy="26" r="5" fill="#818cf8" opacity="0.9">
                    <animate attributeName="r" values="5;4.5;5" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="48" cy="26" r="5" fill="#818cf8" opacity="0.9">
                    <animate attributeName="r" values="5;4.5;5" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="33" cy="25" r="2" fill="#060a10" />
                  <circle cx="49" cy="25" r="2" fill="#060a10" />
                  <circle cx="34" cy="24" r="1" fill="#ffffff" opacity="0.8" />
                  <circle cx="50" cy="24" r="1" fill="#ffffff" opacity="0.8" />
                  <rect x="22" y="18" width="16" height="14" rx="3" fill="none" stroke="#64748b" strokeWidth="1.2" />
                  <rect x="42" y="18" width="16" height="14" rx="3" fill="none" stroke="#64748b" strokeWidth="1.2" />
                  <line x1="38" y1="24" x2="42" y2="24" stroke="#64748b" strokeWidth="1" />
                  <path d="M36 33 L40 36 L44 33" fill="#fbbf24" stroke="#d97706" strokeWidth="0.8" />
                  <polygon points="22,10 40,2 58,10 40,18" fill="#334155" stroke="#475569" strokeWidth="1" />
                  <rect x="38" y="2" width="4" height="2" rx="1" fill="#475569" />
                  <ellipse cx="32" cy="86" rx="6" ry="3" fill="#f59e0b" opacity="0.8" />
                  <ellipse cx="48" cy="86" rx="6" ry="3" fill="#f59e0b" opacity="0.8" />
                </svg>
                <h2 className="text-xl font-semibold mb-1" style={{ color: "var(--accent-light)", textShadow: "0 0 20px var(--accent-glow)" }}>
                  Hi! I&apos;m MathBoard 🦉
                </h2>
                <p className="text-sm max-w-[280px] mx-auto" style={{ color: "var(--text-secondary)" }}>
                  Upload a photo of your homework or hold <kbd className="rounded px-1.5 py-0.5 text-[11px]" style={{ border: "1px solid var(--border)", color: "var(--accent-light)" }}>Space</kbd> to ask me anything
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Teacher mascot */}
      <TeacherMascot state={mascotState} />

      {/* Thinking indicator (when no pages yet) */}
      {isThinking && pages.length === 0 && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-4 py-2"
          style={{ background: "rgba(10,15,30,0.7)", backdropFilter: "blur(8px)", border: "1px solid var(--border)" }}>
          <span className="h-2 w-2 rounded-full animate-bounce" style={{ background: "var(--accent-light)", animationDelay: "0ms" }} />
          <span className="h-2 w-2 rounded-full animate-bounce" style={{ background: "var(--accent-light)", animationDelay: "150ms" }} />
          <span className="h-2 w-2 rounded-full animate-bounce" style={{ background: "var(--accent-light)", animationDelay: "300ms" }} />
          <span className="ml-1 text-[10px]" style={{ color: "var(--text-muted)" }}>thinking...</span>
        </div>
      )}
    </div>
  );
}

/* ═══ Helpers ═══ */

/** Get the next available Y position in a page's commands */
function getNextY(commands: WhiteboardCommand[]): number {
  let maxY = 60;
  for (const cmd of commands) {
    const p = cmd.params;
    let bottom = 0;
    if (p.y !== undefined) {
      const y = p.y as number;
      if (cmd.action === "draw_graph") bottom = y + ((p.height as number) || 350) + 30;
      else if (cmd.action === "draw_text" || cmd.action === "draw_latex") bottom = y + ((p.size as number) || 34) + 15;
      else if (cmd.action === "step_marker") bottom = y + 50;
      else bottom = y + 50;
    } else if (p.y1 !== undefined) {
      bottom = Math.max(p.y1 as number, p.y2 as number) + 20;
    }
    if (bottom > maxY) maxY = bottom;
  }
  return maxY;
}
