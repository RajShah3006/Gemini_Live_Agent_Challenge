"use client";

import { useEffect, useRef, useState } from "react";
import type { WhiteboardCommand } from "@/lib/types";

/* ── Config ─────────────────────────────────── */
const CHAR_DELAY = 40;
const LINE_DURATION = 350;
const SHAPE_DURATION = 450;
const BG_COLOR = "#101c15";
const GRID_COLOR = "rgba(255,255,255,0.025)";
const FONT = "Caveat, 'Segoe Script', cursive";

interface WhiteboardProps {
  commands: WhiteboardCommand[];
}

export function Whiteboard({ commands }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const queueRef = useRef<WhiteboardCommand[]>([]);
  const completedRef = useRef<WhiteboardCommand[]>([]);
  const processedRef = useRef(0);
  const busyRef = useRef(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0, show: false });

  // Queue new commands & kick off animation
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
        clearBoard(ctx, canvas);
        setCursor(c => ({ ...c, show: false }));
        continue;
      }
      await animateCmd(ctx, cmd, setCursor);
      completedRef.current.push(cmd);
    }
    setCursor(c => ({ ...c, show: false }));
    busyRef.current = false;
    // catch any items added while finishing
    if (queueRef.current.length > 0) drain();
  }

  // Resize — instant redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const p = canvas.parentElement;
      if (!p) return;
      canvas.width = p.clientWidth;
      canvas.height = p.clientHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      clearBoard(ctx, canvas);
      completedRef.current.forEach(c => drawInstant(ctx, c, canvas));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <div className="relative flex-1" style={{ background: BG_COLOR }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* Chalk cursor glow */}
      <div
        className="pointer-events-none absolute rounded-full transition-all duration-75 ease-out"
        style={{
          left: cursor.x - 5,
          top: cursor.y - 5,
          width: 10,
          height: 10,
          background: "rgba(255,255,255,0.9)",
          boxShadow:
            "0 0 14px 5px rgba(255,255,255,0.5), 0 0 30px 10px rgba(165,243,252,0.2)",
          opacity: cursor.show ? 1 : 0,
        }}
      />
      {commands.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="mb-3 text-5xl">📐</div>
            <p className="text-lg font-medium text-gray-500">
              Whiteboard ready
            </p>
            <p className="mt-1 text-sm text-gray-600">
              Upload a math problem or ask a question to get started
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Animated command renderer ────────────────── */

type SetCursor = React.Dispatch<
  React.SetStateAction<{ x: number; y: number; show: boolean }>
>;

function animateCmd(
  ctx: CanvasRenderingContext2D,
  cmd: WhiteboardCommand,
  setCursor: SetCursor,
): Promise<void> {
  const p = cmd.params;
  return new Promise(resolve => {
    switch (cmd.action) {
      case "draw_text":
      case "draw_latex": {
        const text = (cmd.action === "draw_latex" ? p.latex : p.text) as string;
        const x = p.x as number,
          y = p.y as number;
        const size = (p.size as number) || (cmd.action === "draw_latex" ? 26 : 22);
        const color =
          (p.color as string) ||
          (cmd.action === "draw_latex" ? "#a5f3fc" : "#f0ede6");
        ctx.font = `${size}px ${FONT}`;
        ctx.fillStyle = color;
        let i = 0;
        const tick = () => {
          if (i >= text.length) { resolve(); return; }
          const xOff = ctx.measureText(text.slice(0, i)).width;
          ctx.globalAlpha = 0.85 + Math.random() * 0.15;
          ctx.fillText(text[i], x + xOff, y + (Math.random() - 0.5) * 0.8);
          ctx.globalAlpha = 1;
          setCursor({
            x: x + xOff + ctx.measureText(text[i]).width,
            y: y - size * 0.5,
            show: true,
          });
          i++;
          setTimeout(tick, CHAR_DELAY);
        };
        tick();
        break;
      }

      case "draw_line":
        chalkLine(ctx, p.x1 as number, p.y1 as number, p.x2 as number, p.y2 as number,
          (p.color as string) || "#f0ede6", (p.width as number) || 2,
          LINE_DURATION, setCursor, resolve);
        break;

      case "draw_arrow": {
        const x1 = p.x1 as number, y1 = p.y1 as number,
          x2 = p.x2 as number, y2 = p.y2 as number;
        const color = (p.color as string) || "#f0ede6",
          w = (p.width as number) || 2;
        chalkLine(ctx, x1, y1, x2, y2, color, w, LINE_DURATION, setCursor, () => {
          const a = Math.atan2(y2 - y1, x2 - x1), h = 14;
          ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6));
          ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6));
          ctx.stroke();
          resolve();
        });
        break;
      }

      case "draw_circle": {
        const cx = p.cx as number, cy = p.cy as number, r = p.r as number;
        const color = (p.color as string) || "#f0ede6", w = (p.width as number) || 2;
        const t0 = performance.now();
        let prev = 0;
        const step = () => {
          const prog = Math.min((performance.now() - t0) / SHAPE_DURATION, 1);
          const ang = prog * Math.PI * 2;
          ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
          ctx.beginPath(); ctx.arc(cx, cy, r, prev, ang); ctx.stroke();
          ctx.globalAlpha = 0.18; ctx.lineWidth = w + 1.5;
          ctx.beginPath(); ctx.arc(cx, cy, r + (Math.random() - 0.5), prev, ang); ctx.stroke();
          ctx.globalAlpha = 1; ctx.lineWidth = w;
          prev = ang;
          setCursor({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), show: true });
          prog < 1 ? requestAnimationFrame(step) : resolve();
        };
        requestAnimationFrame(step);
        break;
      }

      case "draw_rect": {
        const rx = p.x as number, ry = p.y as number,
          rw = p.w as number, rh = p.h as number;
        const color = (p.color as string) || "#f0ede6", w = (p.width as number) || 2;
        const sides: [number, number, number, number][] = [
          [rx, ry, rx + rw, ry], [rx + rw, ry, rx + rw, ry + rh],
          [rx + rw, ry + rh, rx, ry + rh], [rx, ry + rh, rx, ry],
        ];
        let si = 0;
        const next = () => {
          if (si >= sides.length) { resolve(); return; }
          const [a, b, c, d] = sides[si++];
          chalkLine(ctx, a, b, c, d, color, w, SHAPE_DURATION / 4, setCursor, next);
        };
        next();
        break;
      }

      case "highlight":
        ctx.fillStyle = (p.color as string) || "rgba(250,204,21,0.15)";
        ctx.fillRect(p.x as number, p.y as number, p.w as number, p.h as number);
        resolve();
        break;

      case "step_marker": {
        const sx = p.x as number, sy = p.y as number;
        const label = `Step ${p.step as number}`;
        ctx.font = `bold 18px ${FONT}`;
        ctx.fillStyle = "#10b981";
        let i = 0;
        const tick = () => {
          if (i >= label.length) { resolve(); return; }
          const xOff = ctx.measureText(label.slice(0, i)).width;
          ctx.fillText(label[i], sx + xOff, sy);
          setCursor({ x: sx + xOff + ctx.measureText(label[i]).width, y: sy - 12, show: true });
          i++;
          setTimeout(tick, 30);
        };
        tick();
        break;
      }

      default:
        resolve();
    }
  });
}

/* ── Animated line with chalk texture ──────── */

function chalkLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width: number, dur: number,
  setCursor: SetCursor, onDone: () => void,
) {
  const t0 = performance.now();
  let lx = x1, ly = y1;
  const step = () => {
    const prog = Math.min((performance.now() - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - prog, 3);
    const cx = x1 + (x2 - x1) * ease, cy = y1 + (y2 - y1) * ease;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lx + (Math.random() - 0.5) * 0.5, ly + (Math.random() - 0.5) * 0.5);
    ctx.lineTo(cx + (Math.random() - 0.5) * 0.5, cy + (Math.random() - 0.5) * 0.5);
    ctx.stroke();
    // chalk dust texture
    ctx.globalAlpha = 0.18; ctx.lineWidth = width + 1.5;
    ctx.beginPath();
    ctx.moveTo(lx + (Math.random() - 0.5) * 1.5, ly + (Math.random() - 0.5) * 1.5);
    ctx.lineTo(cx + (Math.random() - 0.5) * 1.5, cy + (Math.random() - 0.5) * 1.5);
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = width;
    lx = cx; ly = cy;
    setCursor({ x: cx, y: cy, show: true });
    prog < 1 ? requestAnimationFrame(step) : onDone();
  };
  requestAnimationFrame(step);
}

/* ── Instant draw (resize / completed redraw) ── */

function drawInstant(
  ctx: CanvasRenderingContext2D,
  cmd: WhiteboardCommand,
  canvas: HTMLCanvasElement,
) {
  const p = cmd.params;
  switch (cmd.action) {
    case "clear":
      clearBoard(ctx, canvas);
      break;
    case "draw_text":
      ctx.fillStyle = (p.color as string) || "#f0ede6";
      ctx.font = `${(p.size as number) || 22}px ${FONT}`;
      ctx.fillText(p.text as string, p.x as number, p.y as number);
      break;
    case "draw_latex":
      ctx.fillStyle = (p.color as string) || "#a5f3fc";
      ctx.font = `${(p.size as number) || 26}px ${FONT}`;
      ctx.fillText(p.latex as string, p.x as number, p.y as number);
      break;
    case "draw_line":
      ctx.strokeStyle = (p.color as string) || "#f0ede6";
      ctx.lineWidth = (p.width as number) || 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x1 as number, p.y1 as number);
      ctx.lineTo(p.x2 as number, p.y2 as number); ctx.stroke();
      break;
    case "draw_arrow": {
      const x1 = p.x1 as number, y1 = p.y1 as number,
        x2 = p.x2 as number, y2 = p.y2 as number;
      ctx.strokeStyle = (p.color as string) || "#f0ede6";
      ctx.lineWidth = (p.width as number) || 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const a = Math.atan2(y2 - y1, x2 - x1), h = 14;
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6)); ctx.stroke();
      break;
    }
    case "draw_circle":
      ctx.strokeStyle = (p.color as string) || "#f0ede6";
      ctx.lineWidth = (p.width as number) || 2;
      ctx.beginPath(); ctx.arc(p.cx as number, p.cy as number, p.r as number, 0, 2 * Math.PI); ctx.stroke();
      break;
    case "draw_rect":
      ctx.strokeStyle = (p.color as string) || "#f0ede6";
      ctx.lineWidth = (p.width as number) || 2;
      ctx.strokeRect(p.x as number, p.y as number, p.w as number, p.h as number);
      break;
    case "highlight":
      ctx.fillStyle = (p.color as string) || "rgba(250,204,21,0.15)";
      ctx.fillRect(p.x as number, p.y as number, p.w as number, p.h as number);
      break;
    case "step_marker":
      ctx.fillStyle = "#10b981";
      ctx.font = `bold 18px ${FONT}`;
      ctx.fillText(`Step ${p.step as number}`, p.x as number, p.y as number);
      break;
  }
}

/* ── Background ────────────────────────────── */

function clearBoard(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  const s = 40;
  for (let x = s; x < canvas.width; x += s) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = s; y < canvas.height; y += s) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}
