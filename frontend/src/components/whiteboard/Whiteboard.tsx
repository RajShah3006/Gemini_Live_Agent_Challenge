"use client";

import { useEffect, useRef, useState } from "react";
import type { WhiteboardCommand } from "@/lib/types";
import { WritingHand } from "./WritingHand";
import { TeacherMascot, type MascotState } from "./TeacherMascot";
import { WhiteboardToolbar } from "./WhiteboardToolbar";

/* ── Lightboard Config ──────────────────────── */
const CHAR_DELAY = 38;
const LINE_DURATION = 350;
const SHAPE_DURATION = 450;
const BG = "#060a10";
const GRID = "rgba(80,140,255,0.04)";
const FONT = "Kalam, 'Architects Daughter', 'Segoe Script', cursive";

// Neon palette
const NEON_TEXT = "#ffffff";
const NEON_TEXT_GLOW = "#88ccff";
const NEON_MATH = "#00e5ff";
const NEON_MATH_GLOW = "#0090cc";
const NEON_STEP = "#00ffaa";
const NEON_STEP_GLOW = "#009966";
const NEON_LINE = "#ffffff";
const NEON_LINE_GLOW = "#5599ff";

interface WhiteboardProps {
  commands: WhiteboardCommand[];
  isSpeaking?: boolean;
  isThinking?: boolean;
}

export function Whiteboard({ commands, isSpeaking = false, isThinking = false }: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);
  const queueRef = useRef<WhiteboardCommand[]>([]);
  const completedRef = useRef<WhiteboardCommand[]>([]);
  const processedRef = useRef(0);
  const busyRef = useRef(false);
  const maxYRef = useRef(0);
  const viewWidthRef = useRef(800);
  const [cursor, setCursor] = useState({ x: 0, y: 0, show: false, color: "#00e5ff" });
  const [isDrawing, setIsDrawing] = useState(false);

  // Derive mascot state
  const mascotState: MascotState = isDrawing ? "writing" : isSpeaking ? "talking" : isThinking ? "thinking" : "idle";

  // Track the max y coordinate to grow the canvas
  function trackY(y: number) {
    if (y + 80 > maxYRef.current) {
      maxYRef.current = y + 80;
      resizeCanvas();
    }
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = container.clientWidth;
    viewWidthRef.current = w;
    const minH = container.clientHeight;
    const h = Math.max(minH, maxYRef.current);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    clearBoard(ctx, w, h);
    completedRef.current.forEach(c => drawInstant(ctx, c, dpr));
  }

  function autoScroll(y: number) {
    const container = containerRef.current;
    if (!container) return;
    const viewH = container.clientHeight;
    const targetScroll = y - viewH + 120;
    if (targetScroll > container.scrollTop) {
      container.scrollTo({ top: targetScroll, behavior: "smooth" });
    }
  }

  useEffect(() => {
    const fresh = commands.slice(processedRef.current);
    if (fresh.length > 0) {
      queueRef.current.push(...fresh);
      processedRef.current = commands.length;
      drain();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands]);

  async function drain() {
    if (busyRef.current) return;
    busyRef.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) { busyRef.current = false; return; }

    while (queueRef.current.length > 0) {
      const cmd = queueRef.current.shift()!;
      if (cmd.action === "clear") {
        completedRef.current = [];
        maxYRef.current = 0;
        resizeCanvas();
        if (containerRef.current) containerRef.current.scrollTop = 0;
        setCursor(c => ({ ...c, show: false }));
        setIsDrawing(false);
        continue;
      }
      setIsDrawing(true);
      // Grow canvas and scroll to where we're about to draw
      const cmdY = getCommandY(cmd);
      if (cmdY > 0) {
        trackY(cmdY);
        autoScroll(cmdY);
      }
      await animateCmd(ctx, cmd, dprRef.current, setCursor);
      completedRef.current.push(cmd);
    }
    setCursor(c => ({ ...c, show: false }));
    setIsDrawing(false);
    busyRef.current = false;
    if (queueRef.current.length > 0) drain();
  }

  // Initial size + resize handler
  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: BG }}>
      {/* Whiteboard toolbar */}
      <WhiteboardToolbar canvasRef={canvasRef} containerRef={containerRef} />
      {/* Writing hand cursor (inside scrollable container) */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1e293b #060a10" }}
      >
        <canvas ref={canvasRef} className="block" />
        <WritingHand x={cursor.x} y={cursor.y} show={cursor.show} glowColor={cursor.color} />
      </div>
      {commands.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center relative">
            {/* Floating math symbols background */}
            <div className="absolute inset-0 -m-20 pointer-events-none overflow-hidden opacity-[0.06]" aria-hidden>
              <span className="absolute text-4xl top-2 left-4" style={{ animation: "mascotFloat 4s ease-in-out infinite" }}>∫</span>
              <span className="absolute text-3xl top-8 right-6" style={{ animation: "mascotFloat 5s ease-in-out 0.5s infinite" }}>π</span>
              <span className="absolute text-5xl bottom-4 left-8" style={{ animation: "mascotFloat 3.5s ease-in-out 1s infinite" }}>√</span>
              <span className="absolute text-3xl bottom-8 right-2" style={{ animation: "mascotFloat 4.5s ease-in-out 0.3s infinite" }}>∑</span>
              <span className="absolute text-4xl top-1/2 left-0" style={{ animation: "mascotFloat 3.8s ease-in-out 0.7s infinite" }}>Δ</span>
              <span className="absolute text-3xl top-1/3 right-0" style={{ animation: "mascotFloat 4.2s ease-in-out 1.2s infinite" }}>∞</span>
            </div>
            {/* Owl mascot (waving version) */}
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
      {/* Teacher mascot */}
      <TeacherMascot state={mascotState} />
      {/* Thinking indicator */}
      {isThinking && !isDrawing && commands.length > 0 && (
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

function getCommandY(cmd: WhiteboardCommand): number {
  const p = cmd.params;
  if (p.y !== undefined) return p.y as number;
  if (p.y1 !== undefined) return Math.max(p.y1 as number, p.y2 as number);
  if (p.cy !== undefined) return (p.cy as number) + (p.r as number || 0);
  return 0;
}

/* ═══ Helpers: neon glow drawing ═══ */

function glowText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color: string, glow: string, size: number, dpr: number, bold = false,
) {
  const prefix = bold ? "bold " : "";
  ctx.font = `${prefix}${size}px ${FONT}`;
  // Outer glow
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16 * dpr;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  // Inner glow (brighter center)
  ctx.shadowBlur = 6 * dpr;
  ctx.shadowColor = color;
  ctx.fillText(text, x, y);
  // Crisp pass
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y);
}

function glowStroke(
  ctx: CanvasRenderingContext2D, color: string, glow: string,
  width: number, dpr: number,
) {
  // Outer glow
  ctx.shadowColor = glow;
  ctx.shadowBlur = 14 * dpr;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  // Crisp center
  ctx.shadowBlur = 4 * dpr;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.stroke();
}

type SetCursor = React.Dispatch<
  React.SetStateAction<{ x: number; y: number; show: boolean; color: string }>
>;

/* ═══ Animated command renderer ═══ */

function animateCmd(
  ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand,
  dpr: number, setCursor: SetCursor,
): Promise<void> {
  const p = cmd.params;
  return new Promise(resolve => {
    switch (cmd.action) {
      case "draw_text":
      case "draw_latex": {
        const isLatex = cmd.action === "draw_latex";
        const text = (isLatex ? p.latex : p.text) as string;
        const x = p.x as number, y = p.y as number;
        const size = (p.size as number) || (isLatex ? 28 : 24);
        const color = (p.color as string) || (isLatex ? NEON_MATH : NEON_TEXT);
        const glow = isLatex ? NEON_MATH_GLOW : NEON_TEXT_GLOW;
        ctx.font = `${size}px ${FONT}`;
        let i = 0;
        const tick = () => {
          if (i >= text.length) { ctx.shadowBlur = 0; resolve(); return; }
          const xOff = ctx.measureText(text.slice(0, i)).width;
          glowText(ctx, text[i], x + xOff, y, color, glow, size, dpr);
          const charW = ctx.measureText(text[i]).width;
          setCursor({ x: x + xOff + charW, y: y - size * 0.4, show: true, color: glow });
          i++;
          setTimeout(tick, CHAR_DELAY);
        };
        tick();
        break;
      }

      case "draw_line": {
        const color = (p.color as string) || NEON_LINE;
        neonLine(ctx, p.x1 as number, p.y1 as number, p.x2 as number, p.y2 as number,
          color, NEON_LINE_GLOW, (p.width as number) || 2, LINE_DURATION, dpr, setCursor, resolve);
        break;
      }

      case "draw_arrow": {
        const x1 = p.x1 as number, y1 = p.y1 as number,
          x2 = p.x2 as number, y2 = p.y2 as number;
        const color = (p.color as string) || NEON_LINE, w = (p.width as number) || 2;
        neonLine(ctx, x1, y1, x2, y2, color, NEON_LINE_GLOW, w, LINE_DURATION, dpr, setCursor, () => {
          const a = Math.atan2(y2 - y1, x2 - x1), h = 14;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6));
          glowStroke(ctx, color, NEON_LINE_GLOW, w, dpr);
          ctx.beginPath(); ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6));
          glowStroke(ctx, color, NEON_LINE_GLOW, w, dpr);
          ctx.shadowBlur = 0;
          resolve();
        });
        break;
      }

      case "draw_circle": {
        const cx = p.cx as number, cy = p.cy as number, r = p.r as number;
        const color = (p.color as string) || NEON_LINE, w = (p.width as number) || 2;
        const t0 = performance.now();
        let prev = 0;
        const step = () => {
          const prog = Math.min((performance.now() - t0) / SHAPE_DURATION, 1);
          const ang = prog * Math.PI * 2;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.arc(cx, cy, r, prev, ang);
          glowStroke(ctx, color, NEON_LINE_GLOW, w, dpr);
          prev = ang;
          setCursor({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), show: true, color: NEON_LINE_GLOW });
          prog < 1 ? requestAnimationFrame(step) : (ctx.shadowBlur = 0, resolve());
        };
        requestAnimationFrame(step);
        break;
      }

      case "draw_rect": {
        const rx = p.x as number, ry = p.y as number,
          rw = p.w as number, rh = p.h as number;
        const color = (p.color as string) || NEON_LINE, w = (p.width as number) || 2;
        const sides: [number, number, number, number][] = [
          [rx, ry, rx + rw, ry], [rx + rw, ry, rx + rw, ry + rh],
          [rx + rw, ry + rh, rx, ry + rh], [rx, ry + rh, rx, ry],
        ];
        let si = 0;
        const next = () => {
          if (si >= sides.length) { resolve(); return; }
          const [a, b, c, d] = sides[si++];
          neonLine(ctx, a, b, c, d, color, NEON_LINE_GLOW, w, SHAPE_DURATION / 4, dpr, setCursor, next);
        };
        next();
        break;
      }

      case "highlight":
        ctx.shadowColor = (p.color as string) || "rgba(0,229,255,0.3)";
        ctx.shadowBlur = 20 * dpr;
        ctx.fillStyle = (p.color as string) || "rgba(0,229,255,0.06)";
        ctx.fillRect(p.x as number, p.y as number, p.w as number, p.h as number);
        ctx.shadowBlur = 0;
        resolve();
        break;

      case "step_marker": {
        const sx = p.x as number, sy = p.y as number;
        const label = `Step ${p.step as number}`;
        ctx.font = `bold 20px ${FONT}`;
        let i = 0;
        const tick = () => {
          if (i >= label.length) { ctx.shadowBlur = 0; resolve(); return; }
          const xOff = ctx.measureText(label.slice(0, i)).width;
          glowText(ctx, label[i], sx + xOff, sy, NEON_STEP, NEON_STEP_GLOW, 20, dpr, true);
          setCursor({ x: sx + xOff + ctx.measureText(label[i]).width, y: sy - 12, show: true, color: NEON_STEP_GLOW });
          i++;
          setTimeout(tick, 28);
        };
        tick();
        break;
      }

      default: resolve();
    }
  });
}

/* ═══ Animated neon line ═══ */

function neonLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, glow: string, width: number, dur: number,
  dpr: number, setCursor: SetCursor, onDone: () => void,
) {
  const t0 = performance.now();
  let lx = x1, ly = y1;
  const step = () => {
    const prog = Math.min((performance.now() - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - prog, 3);
    const cx = x1 + (x2 - x1) * ease, cy = y1 + (y2 - y1) * ease;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(cx, cy);
    glowStroke(ctx, color, glow, width, dpr);
    lx = cx; ly = cy;
    setCursor({ x: cx, y: cy, show: true, color: glow });
    prog < 1 ? requestAnimationFrame(step) : (ctx.shadowBlur = 0, onDone());
  };
  requestAnimationFrame(step);
}

/* ═══ Instant draw (resize / replay) ═══ */

function drawInstant(
  ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand,
  dpr: number,
) {
  const p = cmd.params;
  switch (cmd.action) {
    case "clear":
      break;
    case "draw_text":
      glowText(ctx, p.text as string, p.x as number, p.y as number,
        (p.color as string) || NEON_TEXT, NEON_TEXT_GLOW,
        (p.size as number) || 24, dpr);
      ctx.shadowBlur = 0;
      break;
    case "draw_latex":
      glowText(ctx, p.latex as string, p.x as number, p.y as number,
        (p.color as string) || NEON_MATH, NEON_MATH_GLOW,
        (p.size as number) || 28, dpr);
      ctx.shadowBlur = 0;
      break;
    case "draw_line":
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x1 as number, p.y1 as number);
      ctx.lineTo(p.x2 as number, p.y2 as number);
      glowStroke(ctx, (p.color as string) || NEON_LINE, NEON_LINE_GLOW, (p.width as number) || 2, dpr);
      ctx.shadowBlur = 0;
      break;
    case "draw_arrow": {
      const x1 = p.x1 as number, y1 = p.y1 as number,
        x2 = p.x2 as number, y2 = p.y2 as number;
      const color = (p.color as string) || NEON_LINE, w = (p.width as number) || 2;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      glowStroke(ctx, color, NEON_LINE_GLOW, w, dpr);
      const a = Math.atan2(y2 - y1, x2 - x1), h = 14;
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6));
      glowStroke(ctx, color, NEON_LINE_GLOW, w, dpr);
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6));
      glowStroke(ctx, color, NEON_LINE_GLOW, w, dpr);
      ctx.shadowBlur = 0;
      break;
    }
    case "draw_circle":
      ctx.beginPath();
      ctx.arc(p.cx as number, p.cy as number, p.r as number, 0, 2 * Math.PI);
      glowStroke(ctx, (p.color as string) || NEON_LINE, NEON_LINE_GLOW, (p.width as number) || 2, dpr);
      ctx.shadowBlur = 0;
      break;
    case "draw_rect":
      ctx.beginPath();
      ctx.rect(p.x as number, p.y as number, p.w as number, p.h as number);
      glowStroke(ctx, (p.color as string) || NEON_LINE, NEON_LINE_GLOW, (p.width as number) || 2, dpr);
      ctx.shadowBlur = 0;
      break;
    case "highlight":
      ctx.shadowColor = "rgba(0,229,255,0.3)";
      ctx.shadowBlur = 20 * dpr;
      ctx.fillStyle = (p.color as string) || "rgba(0,229,255,0.06)";
      ctx.fillRect(p.x as number, p.y as number, p.w as number, p.h as number);
      ctx.shadowBlur = 0;
      break;
    case "step_marker":
      glowText(ctx, `Step ${p.step as number}`, p.x as number, p.y as number,
        NEON_STEP, NEON_STEP_GLOW, 20, dpr, true);
      ctx.shadowBlur = 0;
      break;
  }
}

/* ═══ Background ═══ */

function clearBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const s = 40;
  for (let x = s; x < w; x += s) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = s; y < h; y += s) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}
