"use client";

import { useEffect, useRef, useState } from "react";
import type { WhiteboardCommand } from "@/lib/types";

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
}

export function Whiteboard({ commands }: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);
  const queueRef = useRef<WhiteboardCommand[]>([]);
  const completedRef = useRef<WhiteboardCommand[]>([]);
  const processedRef = useRef(0);
  const busyRef = useRef(false);
  const maxYRef = useRef(0);
  const viewWidthRef = useRef(800);
  const [cursor, setCursor] = useState({ x: 0, y: 0, show: false });

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
        continue;
      }
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
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1e293b #060a10" }}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      {/* Light-pen cursor */}
      <div
        className="pointer-events-none fixed rounded-full transition-all duration-[60ms] ease-out"
        style={{
          left: cursor.x - 6,
          top: cursor.y - 6,
          width: 12,
          height: 12,
          background: "radial-gradient(circle, #fff 0%, rgba(0,229,255,0.6) 50%, transparent 100%)",
          boxShadow: "0 0 18px 6px rgba(0,229,255,0.5), 0 0 40px 12px rgba(0,229,255,0.15)",
          opacity: cursor.show ? 1 : 0,
        }}
      />
      {commands.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="mb-3 text-5xl">📐</div>
            <p className="text-lg font-medium text-gray-500">Whiteboard ready</p>
            <p className="mt-1 text-sm text-gray-600">
              Upload a math problem or ask a question to get started
            </p>
          </div>
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
  React.SetStateAction<{ x: number; y: number; show: boolean }>
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
          setCursor({ x: x + xOff + charW, y: y - size * 0.4, show: true });
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
          setCursor({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), show: true });
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
          setCursor({ x: sx + xOff + ctx.measureText(label[i]).width, y: sy - 12, show: true });
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
    setCursor({ x: cx, y: cy, show: true });
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
