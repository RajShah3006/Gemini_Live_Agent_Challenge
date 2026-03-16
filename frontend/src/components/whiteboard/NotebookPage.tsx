"use client";

/**
 * NotebookPage — Renders a single whiteboard page (one per question).
 *
 * Handles:
 *  - Canvas setup with device-pixel-ratio scaling and dot-grid background
 *  - Layout management: overlap prevention, X clamping, auto-grow
 *  - Animated drawing of each whiteboard command (text, LaTeX, graphs, shapes)
 *  - Page boundary detection for overflow into next page
 */

import { useEffect, useRef, useCallback, useState, memo } from "react";
import type { WhiteboardCommand } from "@/lib/types";
import {
  CONTENT_SIZE, FONT, TEXT_COLOR,
  BG, PAUSE_BETWEEN,
  latexToHuman, extractMath,
  clearBoard, animateCmd, drawInstant,
} from "./whiteboard-helpers";
import { WritingHand } from "./WritingHand";

/* ═══ Page Config ═══ */
const PAGE_PAD_TOP = 50;     // top padding (below header)
const MIN_CANVAS_H = 300;    // minimum canvas height
const CANVAS_W = 900;        // fixed canvas width (CSS scales it to container)
const MIN_Y_GAP = 25;        // minimum vertical gap between commands (was 10)
const MAX_TEXT_WIDTH = CANVAS_W - 80; // max text width before wrapping

interface NotebookPageProps {
  label: string;              // "Q1", "Q2", etc.
  questionText: string;       // Original question text
  commands: WhiteboardCommand[];
  isActive: boolean;          // True if this is the page currently receiving AI output
  isThinking: boolean;
  accentColor: string;        // Unique color for this page
}

function NotebookPageInner({
  label,
  questionText,
  commands,
  isActive,
  isThinking,
  accentColor,
}: NotebookPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dprRef = useRef(1);
  const processedRef = useRef(0);
  const completedRef = useRef<WhiteboardCommand[]>([]);
  const commandsRef = useRef<WhiteboardCommand[]>(commands);
  const busyRef = useRef(false);
  const maxYRef = useRef(PAGE_PAD_TOP);
  const currentStepRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0, show: false, color: accentColor });
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(MIN_CANVAS_H);
  const [hasSolution, setHasSolution] = useState(false);
  const [containerWidth, setContainerWidth] = useState(CANVAS_W);
  const [contextLost, setContextLost] = useState(false);

  /* ── Resize canvas to fit content ── */
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = CANVAS_W;
    const h = Math.max(MIN_CANVAS_H, maxYRef.current + 60);
    setCanvasHeight(h);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Canvas context unavailable (memory pressure) — retry once with tracked timeout
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = setTimeout(() => resizeCanvas(), 100);
      return;
    }
    ctx.scale(dpr, dpr);
    clearBoard(ctx, w, h);
    // Redraw all completed commands
    for (const cmd of completedRef.current) {
      drawInstant(ctx, cmd, dpr, cmd._step || 0);
    }
  }, []);

  /* ── Process incoming commands ── */
  const drain = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;

    // Use a while loop to naturally drain the queue
    while (processedRef.current < commandsRef.current.length) {
      const rawCmd = commandsRef.current[processedRef.current];
      processedRef.current++;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) continue;

      if (rawCmd.action === "clear") continue; // Pages handle clear at orchestrator level

      // Skip question_header — the page header is rendered in React
      if (rawCmd.action === "question_header") continue;

      setIsDrawing(true);
      if (rawCmd.action === "step_marker") {
        currentStepRef.current = (rawCmd.params.step as number) || currentStepRef.current + 1;
      }

      // Offset command coordinates to page-local space
      const cmd = { ...rawCmd, params: { ...rawCmd.params } };
      cmd._step = currentStepRef.current;

      // ── Layout enforcement: prevent overlap ──
      // Ensure each command's Y is below the previous command's bottom edge
      if (cmd.params.y !== undefined && cmd.action !== "highlight") {
        const cmdY = cmd.params.y as number;
        const minSafeY = maxYRef.current + MIN_Y_GAP;
        if (cmdY < minSafeY) {
          const shift = minSafeY - cmdY;
          cmd.params.y = minSafeY;
          // Also shift y1/y2 for lines/arrows
          if (cmd.params.y1 !== undefined) cmd.params.y1 = (cmd.params.y1 as number) + shift;
          if (cmd.params.y2 !== undefined) cmd.params.y2 = (cmd.params.y2 as number) + shift;
        }
      }
      // Clamp text X to prevent right-edge overflow
      if ((cmd.action === "draw_text" || cmd.action === "draw_latex") && cmd.params.x !== undefined) {
        const x = cmd.params.x as number;
        if (x > CANVAS_W - 100) cmd.params.x = 40;
      }

      // Strip redundant "Step N:" prefix
      if (cmd.action === "draw_text" && typeof cmd.params.text === "string") {
        cmd.params.text = cmd.params.text.replace(/^Step\s*\d+\s*[:.\-–—]\s*/i, "");
        if (!cmd.params.text) continue;
      }

      // draw_circle removed — skip any draw_circle commands
      if (cmd.action === "draw_circle") continue;

      // Grow canvas if needed — use accurate content height
      const cmdY = getCommandY(cmd);
      const cmdBottom = getCommandBottom(cmd);
      if (cmdBottom > maxYRef.current) {
        maxYRef.current = cmdBottom;
      }
      if (cmdBottom + 40 > canvasHeight) {
        resizeCanvas();
        // resizeCanvas() already calls ctx.scale(dpr, dpr) — no need to scale again
      }

      // Auto-scroll the page container to show new content
      if (containerRef.current && cmdY > 0) {
        const visibleH = containerRef.current.clientHeight;
        if (cmdY > containerRef.current.scrollTop + visibleH - 80) {
          containerRef.current.scrollTo({
            top: Math.max(0, cmdY - visibleH + 120),
            behavior: "smooth",
          });
        }
      }

      setHasSolution(true);
      await animateCmd(ctx, cmd, dprRef.current, setCursor, currentStepRef.current);
      completedRef.current.push(cmd);
      if (processedRef.current < commandsRef.current.length) {
        await new Promise(r => setTimeout(r, PAUSE_BETWEEN));
      }
    }

    setCursor(c => ({ ...c, show: false }));
    setIsDrawing(false);
    busyRef.current = false;
  }, [resizeCanvas]);

  /* ── Watch for new commands ── */
  useEffect(() => {
    commandsRef.current = commands;
    drain();
  }, [commands, drain]);

  /* ── Initial canvas setup + track container width + context loss handling ── */
  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
      resizeCanvas();
    };
    canvas?.addEventListener("contextlost", onContextLost);
    canvas?.addEventListener("contextrestored", onContextRestored);
    const onResize = () => {
      resizeCanvas();
      if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
    };
    if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      canvas?.removeEventListener("contextlost", onContextLost);
      canvas?.removeEventListener("contextrestored", onContextRestored);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [resizeCanvas]);

  const mathExpr = extractMath(questionText);
  const displayQ = questionText.replace(/^\[Q\d+\]\s*/i, "");

  return (
    <div
      className={`notebook-page ${isActive ? "notebook-page--active" : ""}`}
      style={{
        marginBottom: 32, // Extra spacing between pages
        transition: "all 0.3s ease",
        overflow: "hidden",
      }}
    >
      {/* ── Page Header (Hidden, moved to sticky Whiteboard header) ── */}
      <div className="sr-only">
        {label}: {questionText}
      </div>

      {/* ── Canvas Area ── */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          overflow: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: "#1e293b #060a10",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: canvasHeight,
            background: BG,
          }}
        />
        {contextLost && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.6)", color: "#fbbf24", fontSize: 14, fontWeight: 500,
          }}>
            Canvas context lost — recovering…
          </div>
        )}
        <WritingHand x={cursor.x * containerWidth / CANVAS_W} y={cursor.y * containerWidth / CANVAS_W} show={cursor.show} glowColor={cursor.color} />
      </div>

      {/* ── Active drawing indicator ── */}
      {isDrawing && (
        <div
          style={{
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

// Memoize to prevent re-renders when sibling pages update
export const NotebookPage = memo(NotebookPageInner, (prev, next) =>
  prev.commands === next.commands &&
  prev.isActive === next.isActive &&
  prev.isThinking === next.isThinking &&
  prev.accentColor === next.accentColor
);

/* ── Helper: get Y coordinate from command ── */
function getCommandY(cmd: WhiteboardCommand): number {
  const p = cmd.params;
  if (cmd.action === "draw_circle") return 0; // draw_circle removed
  if (p.y !== undefined) {
    if (cmd.action === "draw_graph") return (p.y as number) + ((p.height as number) || 350);
    return p.y as number;
  }
  if (p.y1 !== undefined) return Math.max(p.y1 as number, p.y2 as number);
  return 0;
}

/* ── Helper: get bottom edge Y of a command (for layout spacing) ── */
function getCommandBottom(cmd: WhiteboardCommand): number {
  const p = cmd.params;
  const y = (p.y as number) || 0;
  switch (cmd.action) {
    case "draw_graph":
      return y + ((p.height as number) || 350) + 30;
    case "draw_text":
    case "draw_latex":
      return y + ((p.size as number) || 34) + 15;
    case "step_marker":
      return y + 50; // was 40 — more room after step header
    case "draw_line":
    case "draw_arrow":
      return Math.max((p.y1 as number) || 0, (p.y2 as number) || 0) + 15;
    case "draw_circle":
      return y; // draw_circle removed
    case "highlight":
      return y + ((p.height as number) || 40) + 15;
    default:
      return y + 50;
  }
}
