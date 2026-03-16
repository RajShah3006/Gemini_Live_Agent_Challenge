/**
 * whiteboard-helpers.ts
 *
 * Shared drawing, animation, math, and config helpers for the notebook whiteboard.
 * Extracted from the monolithic Whiteboard.tsx so both the orchestrator and
 * individual NotebookPage components can reuse them.
 */

import type { WhiteboardCommand } from "@/lib/types";

/* ═══ Configuration ═══ */

export const CHAR_DELAY = 38;
export const LINE_DURATION = 500;
export const PAUSE_BETWEEN = 250;
export const SHAPE_DURATION = 400;
export const BG = "#0b1120"; // Deep navy page
export const FONT = "'Single Day', 'Segoe Script', cursive";
export const CONTENT_SIZE = 28; // Unified size: readable but avoids overlap
export const TEXT_COLOR = "#f8fafc"; // Brighter white for better contrast
export const LINE_COLOR = "#94a3b8";
export const AXIS_COLOR = "#64748b";
export const STEP_LABEL_COLOR = "#818cf8"; // Using a soft indigo for step labels
export const STEP_COLORS = [
  "#818cf8", "#34d399", "#f472b6", "#fbbf24",
  "#60a5fa", "#a78bfa", "#fb923c",
];

/* ═══ Types ═══ */

export type SetCursor = React.Dispatch<
  React.SetStateAction<{ x: number; y: number; show: boolean; color: string }>
>;

/* ═══ Text Processing ═══ */

const SUP_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻",
  "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ", "x": "ˣ",
  "y": "ʸ", "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ",
  "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "k": "ᵏ", "l": "ˡ", "m": "ᵐ",
  "o": "ᵒ", "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ",
  "v": "ᵛ", "w": "ʷ", "z": "ᶻ", "∞": "°°",
};

export function toSuperscript(s: string): string {
  if (s === "∞" || s === "infty") return "∞";
  return s.split("").map(c => SUP_MAP[c] ?? SUP_MAP[c.toLowerCase()] ?? c).join("");
}

export function extractMath(text: string): string {
  if (!text) return "";
  const mathPatterns = [
    /(\d+\s*[+\-*/^]=?\s*[\dxyz][\dxyz\s+\-*/^=().]*)/i,
    /([\dxyz][\dxyz\s+\-*/^=().]*[+\-*/^=][\dxyz\s+\-*/^=().]*)/i,
    /([∫∑√Δπ][^\s]*[\dxyz\s+\-*/^=().]*)/i,
    /(\$[^$]+\$)/,
    /(\\frac|\\int|\\sqrt|\\sum)[^.?!]*/i,
  ];
  for (const pat of mathPatterns) {
    const m = text.match(pat);
    if (m && m[1] && m[1].trim().length >= 3) return m[1].trim();
  }
  return text;
}

export function latexToHuman(s: string): string {
  if (s == null || typeof s !== "string") return String(s ?? "");
  let r = s;
  // Strip LaTeX delimiters: $$...$$, $...$, \[...\], \(...\)
  r = r.replace(/^\$\$([\s\S]*)\$\$$/g, "$1");
  r = r.replace(/^\$([\s\S]*)\$$/g, "$1");
  r = r.replace(/^\\\[([\s\S]*)\\\]$/g, "$1");
  r = r.replace(/^\\\(([\s\S]*)\\\)$/g, "$1");
  // Strip inline delimiters that appear mid-string
  r = r.replace(/\$\$([^$]+)\$\$/g, "$1");
  r = r.replace(/\$([^$]+)\$/g, "$1");
  r = r.replace(/\\\(([^)]+)\\\)/g, "$1");
  r = r.replace(/\\\[([^\]]+)\\\]/g, "$1");
  r = r.replace(/\f/g, "\\f");
  r = r.replace(/\t/g, "\\t");
  r = r.replace(/\x08/g, "\\b");
  r = r.replace(/\r/g, "\\r");
  r = r.replace(/\n/g, "\\n");
  for (let i = 0; i < 3; i++) {
    r = r.replace(/\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "($1)⁄($2)");
    r = r.replace(/\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}\s*([a-zA-Z0-9])/g, "($1)⁄($2)");
    r = r.replace(/\\frac\s*([a-zA-Z0-9])\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "($1)⁄($2)");
    r = r.replace(/\\frac\s*([a-zA-Z0-9])\s*([a-zA-Z0-9])/g, "($1)⁄($2)");
  }
  r = r.replace(/\\sqrt\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "√($1)");
  r = r.replace(/\\int_\{([^}]*)}\^\{([^}]*)}/g, "∫[$1→$2]");
  r = r.replace(/\\int/g, "∫");
  r = r.replace(/\\sum_\{([^}]*)}\^\{([^}]*)}/g, "Σ[$1→$2]");
  r = r.replace(/\\sum/g, "Σ");
  r = r.replace(/\\prod/g, "Π");
  r = r.replace(/\\lim_\{([^}]*)}/g, "lim($1)");
  r = r.replace(/\\lim/g, "lim");
  r = r.replace(/\\infty/g, "∞");
  r = r.replace(/\\alpha/g, "α"); r = r.replace(/\\beta/g, "β");
  r = r.replace(/\\gamma/g, "γ"); r = r.replace(/\\delta/g, "δ");
  r = r.replace(/\\epsilon/g, "ε"); r = r.replace(/\\theta/g, "θ");
  r = r.replace(/\\lambda/g, "λ"); r = r.replace(/\\mu/g, "μ");
  r = r.replace(/\\pi/g, "π"); r = r.replace(/\\sigma/g, "σ");
  r = r.replace(/\\phi/g, "φ"); r = r.replace(/\\omega/g, "ω");
  r = r.replace(/\\Delta/g, "Δ"); r = r.replace(/\\Sigma/g, "Σ");
  r = r.replace(/\\sin/g, "sin"); r = r.replace(/\\cos/g, "cos");
  r = r.replace(/\\tan/g, "tan"); r = r.replace(/\\sec/g, "sec");
  r = r.replace(/\\csc/g, "csc"); r = r.replace(/\\cot/g, "cot");
  r = r.replace(/\\arcsin/g, "arcsin"); r = r.replace(/\\arccos/g, "arccos");
  r = r.replace(/\\arctan/g, "arctan");
  r = r.replace(/\\log/g, "log");
  r = r.replace(/\\ln/g, "ln"); r = r.replace(/\\exp/g, "exp");
  r = r.replace(/\\max/g, "max"); r = r.replace(/\\min/g, "min");
  r = r.replace(/\\det/g, "det"); r = r.replace(/\\gcd/g, "gcd");
  r = r.replace(/\\bmod/g, "mod"); r = r.replace(/\\mod/g, "mod");
  r = r.replace(/\^\{0}/g, "⁰"); r = r.replace(/\^\{1}/g, "¹");
  r = r.replace(/\^\{2}/g, "²"); r = r.replace(/\^\{3}/g, "³");
  r = r.replace(/\^\{4}/g, "⁴"); r = r.replace(/\^\{5}/g, "⁵");
  r = r.replace(/\^\{6}/g, "⁶"); r = r.replace(/\^\{7}/g, "⁷");
  r = r.replace(/\^\{8}/g, "⁸"); r = r.replace(/\^\{9}/g, "⁹");
  r = r.replace(/\^\{([^}]*)}/g, (_m, inner: string) => toSuperscript(inner));
  r = r.replace(/\^(\d)/g, (_m, d: string) => toSuperscript(d));
  r = r.replace(/\^([a-zA-Z∞])/g, (_m, c: string) => toSuperscript(c));
  r = r.replace(/\^([+\-])/g, (_m, c: string) => toSuperscript(c));
  r = r.replace(/_\{([^}]*)}/g, "_$1");
  r = r.replace(/\\times/g, "×"); r = r.replace(/\\cdot/g, "·");
  r = r.replace(/\\div/g, "÷"); r = r.replace(/\\pm/g, "±");
  r = r.replace(/\\neq/g, "≠"); r = r.replace(/\\leq/g, "≤");
  r = r.replace(/\\geq/g, "≥"); r = r.replace(/\\approx/g, "≈");
  r = r.replace(/\\rightarrow/g, "→"); r = r.replace(/\\implies/g, "⟹");
  r = r.replace(/\\Rightarrow/g, "⇒");
  r = r.replace(/\\to/g, "→");
  r = r.replace(/\\partial/g, "∂"); r = r.replace(/\\nabla/g, "∇");
  r = r.replace(/\\forall/g, "∀"); r = r.replace(/\\exists/g, "∃");
  r = r.replace(/\\in/g, "∈"); r = r.replace(/\\notin/g, "∉");
  r = r.replace(/\\subset/g, "⊂"); r = r.replace(/\\cup/g, "∪");
  r = r.replace(/\\cap/g, "∩"); r = r.replace(/\\emptyset/g, "∅");
  r = r.replace(/\\cdots/g, "…"); r = r.replace(/\\ldots/g, "…");
  r = r.replace(/\\dots/g, "…"); r = r.replace(/\\vdots/g, "⋮");
  for (let i = 0; i < 2; i++) {
    r = r.replace(/\\boxed\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "[$1]");
  }
  r = r.replace(/\\overline\{([^{}]*)}/g, "$1̄");
  r = r.replace(/\\underline\{([^{}]*)}/g, "$1");
  r = r.replace(/\\hat\{([^{}]*)}/g, "$1̂");
  r = r.replace(/\\vec\{([^{}]*)}/g, "$1→");
  r = r.replace(/\\,/g, " "); r = r.replace(/\\;/g, " ");
  r = r.replace(/\\!/g, ""); r = r.replace(/\\quad/g, "  ");
  r = r.replace(/\\qquad/g, "   ");
  r = r.replace(/\\left/g, ""); r = r.replace(/\\right/g, "");
  r = r.replace(/\\text\{([^}]*)}/g, "$1");
  r = r.replace(/\\mathrm\{([^}]*)}/g, "$1");
  r = r.replace(/\\mathbf\{([^}]*)}/g, "$1");
  r = r.replace(/\\mathit\{([^}]*)}/g, "$1");
  r = r.replace(/\\displaystyle/g, "");
  r = r.replace(/\\frac\s*/g, "");
  r = r.replace(/\\[a-zA-Z]+/g, "");
  r = r.replace(/\{/g, ""); r = r.replace(/}/g, "");
  r = r.replace(/(\d)\s*\*\s*(?=[\d(xyzXYZ])/g, "$1·");
  r = r.replace(/\)\s*\*\s*(?=[\d(xyzXYZ])/g, ")·");
  r = r.replace(/([a-zA-Z])\s*\*\s*(?=[\d(xyzXYZ])/g, "$1·");
  r = r.replace(/  +/g, " ").trim();
  return r;
}

/* ═══ Drawing Primitives ═══ */

export function markerText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color: string, size: number, bold = false,
) {
  ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = bold ? 1.5 : 2.5;
  ctx.shadowOffsetX = 0.5;
  ctx.shadowOffsetY = 0.5;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export function markerStroke(
  ctx: CanvasRenderingContext2D, color: string, width: number,
) {
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function drawWavyLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width: number,
) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const segments = Math.max(4, Math.floor(len / 12));
  const dx = x2 - x1, dy = y2 - y1;
  const nx = -dy / len, ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const disp = Math.sin(t * Math.PI * segments * 0.5) * 2.5;
    ctx.lineTo(x1 + dx * t + nx * disp, y1 + dy * t + ny * disp);
  }
  markerStroke(ctx, color, width);
}

export function clearBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const s = 40;
  ctx.fillStyle = "rgba(148,163,184,0.06)";
  for (let x = s; x < w; x += s) {
    for (let y = s; y < h; y += s) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ═══ Step Color Helper ═══ */

export function getStepColor(step: number): string {
  if (step <= 0) return STEP_COLORS[0];
  return STEP_COLORS[(step - 1) % STEP_COLORS.length];
}

/* ═══ Safe Math Evaluator ═══ */

const SAFE_MATH_RE = /^[0-9x+\-*/().,%^ \t]*$/;
const SAFE_FUNCS = [
  "Math.sin","Math.cos","Math.tan","Math.abs","Math.sqrt","Math.log","Math.log2","Math.log10",
  "Math.exp","Math.pow","Math.floor","Math.ceil","Math.round","Math.min","Math.max",
  "Math.PI","Math.E","Math.asin","Math.acos","Math.atan","Math.atan2",
  "Math.sinh","Math.cosh","Math.tanh","Math.sign","Math.cbrt","Math.hypot",
];

export function evalMathFn(expr: string, x: number): number {
  try {
    // Validate by stripping known-safe functions, then checking only safe chars remain
    let stripped = expr;
    for (const fn of SAFE_FUNCS) stripped = stripped.replaceAll(fn, "");
    if (!SAFE_MATH_RE.test(stripped)) return NaN;
    // Evaluate the validated expression in a restricted scope (no globals access)
    const fn = new Function("x", "Math", `"use strict"; return (${expr});`);
    const result = fn(x, Math);
    return typeof result === "number" && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

/* ═══ Graph Helpers ═══ */

function niceStep(range: number): number {
  const rough = range / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm <= 1.5) return mag;
  if (norm <= 3.5) return 2 * mag;
  if (norm <= 7.5) return 5 * mag;
  return 10 * mag;
}

function formatTickLabel(v: number): string {
  if (isNaN(v) || !isFinite(v)) return "";
  return Math.abs(v) >= 1000 ? v.toExponential(0) : parseFloat(v.toFixed(2)).toString();
}

export function drawGraphAxes(
  ctx: CanvasRenderingContext2D,
  gx: number, gy: number, gw: number, gh: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
) {
  const TICK_COLOR = "#64748b";
  const LABEL_SIZE = 13;
  const mapX = (v: number) => gx + ((v - xMin) / (xMax - xMin)) * gw;
  const mapY = (v: number) => gy + gh - ((v - yMin) / (yMax - yMin)) * gh;
  const ox = mapX(0), oy = mapY(0);
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;

  // Graph area background (subtle contrast from page BG)
  ctx.fillStyle = "rgba(15,23,42,0.4)";
  ctx.fillRect(gx, gy, gw, gh);

  // Subtle grid lines at tick positions (Desmos-style)
  const xStep = niceStep(xMax - xMin);
  const yStep = niceStep(yMax - yMin);
  ctx.save();
  ctx.strokeStyle = "rgba(148,163,184,0.06)";
  ctx.lineWidth = 0.5;
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax; v += xStep) {
    if (Math.abs(v) < xStep * 0.01) continue;
    const px = mapX(v);
    ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px, gy + gh); ctx.stroke();
  }
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    if (Math.abs(v) < yStep * 0.01) continue;
    const py = mapY(v);
    ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx + gw, py); ctx.stroke();
  }
  ctx.restore();

  // Graph border
  ctx.strokeStyle = "rgba(148,163,184,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(gx, gy, gw, gh);

  if (yMin <= 0 && yMax >= 0) {
    ctx.beginPath(); ctx.moveTo(gx, oy); ctx.lineTo(gx + gw, oy);
    markerStroke(ctx, AXIS_COLOR, 1.5);
    ctx.beginPath(); ctx.moveTo(gx + gw, oy);
    ctx.lineTo(gx + gw - 8, oy - 4); ctx.moveTo(gx + gw, oy);
    ctx.lineTo(gx + gw - 8, oy + 4);
    markerStroke(ctx, AXIS_COLOR, 1.5);
  }
  if (xMin <= 0 && xMax >= 0) {
    ctx.beginPath(); ctx.moveTo(ox, gy + gh); ctx.lineTo(ox, gy);
    markerStroke(ctx, AXIS_COLOR, 1.5);
    ctx.beginPath(); ctx.moveTo(ox, gy);
    ctx.lineTo(ox - 4, gy + 8); ctx.moveTo(ox, gy);
    ctx.lineTo(ox + 4, gy + 8);
    markerStroke(ctx, AXIS_COLOR, 1.5);
  }
  ctx.font = `${LABEL_SIZE}px ${FONT}`;
  ctx.fillStyle = TICK_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const tickY = (yMin <= 0 && yMax >= 0) ? oy : gy + gh;
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax; v += xStep) {
    if (Math.abs(v) < xStep * 0.01) continue;
    const px = mapX(v);
    ctx.beginPath(); ctx.moveTo(px, tickY - 4); ctx.lineTo(px, tickY + 4);
    ctx.strokeStyle = TICK_COLOR; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(formatTickLabel(v), px, tickY + 6);
  }
  const tickX = (xMin <= 0 && xMax >= 0) ? ox : gx;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    if (Math.abs(v) < yStep * 0.01) continue;
    const py = mapY(v);
    ctx.beginPath(); ctx.moveTo(tickX - 4, py); ctx.lineTo(tickX + 4, py);
    ctx.strokeStyle = TICK_COLOR; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(formatTickLabel(v), tickX - 8, py);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText("x", gx + gw + 12, tickY - 4);
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("y", (xMin <= 0 && xMax >= 0 ? ox : gx) + 8, gy - 8);
}

export function drawGraphCurve(
  ctx: CanvasRenderingContext2D,
  fn: string, gx: number, gy: number, gw: number, gh: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
  color: string,
) {
  const mapX = (v: number) => gx + ((v - xMin) / (xMax - xMin)) * gw;
  const mapY = (v: number) => gy + gh - ((v - yMin) / (yMax - yMin)) * gh;
  const SAMPLES = 400;
  const dx = (xMax - xMin) / SAMPLES;
  ctx.save();
  // Clip to graph area for clean boundaries
  ctx.beginPath();
  ctx.rect(gx - 1, gy - 1, gw + 2, gh + 2);
  ctx.clip();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i <= SAMPLES; i++) {
    const xv = xMin + i * dx;
    const yv = evalMathFn(fn, xv);
    if (isNaN(yv)) { penDown = false; continue; }
    // Wider tolerance for vertical asymptotes
    const prevYv = i > 0 ? evalMathFn(fn, xMin + (i - 1) * dx) : yv;
    if (Math.abs(yv - prevYv) > (yMax - yMin) * 2) { penDown = false; continue; }
    const px = mapX(xv), py = mapY(yv);
    if (!penDown) { ctx.moveTo(px, py); penDown = true; }
    else ctx.lineTo(px, py);
  }
  // Glow layer
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  markerStroke(ctx, color, 3.5);
  ctx.shadowBlur = 0;
  ctx.restore();
}

export function drawGraphLabel(
  ctx: CanvasRenderingContext2D,
  label: string, gx: number, gy: number, gw: number,
  color: string,
) {
  const text = latexToHuman(label);
  ctx.font = `bold 18px ${FONT}`;
  const tw = ctx.measureText(text).width;
  markerText(ctx, text, gx + gw / 2 - tw / 2, gy - 20, color, 18, true);
}

/* ═══ Animated Line ═══ */

export function animatedLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width: number, dur: number,
  setCursor: SetCursor, cursorColor: string, onDone: () => void,
) {
  const t0 = performance.now();
  let lx = x1, ly = y1;
  const step = () => {
    const prog = Math.min((performance.now() - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - prog, 3);
    const cx = x1 + (x2 - x1) * ease, cy = y1 + (y2 - y1) * ease;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(cx, cy);
    markerStroke(ctx, color, width);
    lx = cx; ly = cy;
    setCursor({ x: cx, y: cy, show: true, color: cursorColor });
    prog < 1 ? requestAnimationFrame(step) : onDone();
  };
  requestAnimationFrame(step);
}

/* ═══ Animated Command Renderer ═══ */

export function animateCmd(
  ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand,
  _dpr: number, setCursor: SetCursor, step: number,
): Promise<void> {
  const p = cmd.params;
  const sc = getStepColor(step);
  return new Promise(resolve => {
    switch (cmd.action) {
      case "draw_text":
      case "draw_latex": {
        const isLatex = cmd.action === "draw_latex";
        const raw = (isLatex ? p.latex : p.text) as string;
        const text = latexToHuman(raw);
        const x = p.x as number, y = p.y as number;
        const size = CONTENT_SIZE;
        const color = isLatex ? sc : TEXT_COLOR;
        ctx.font = `${size}px ${FONT}`;
        let i = 0;
        const tick = () => {
          if (i >= text.length) {
            setCursor(c => ({ ...c, show: false }));
            resolve();
            return;
          }
          const xOff = ctx.measureText(text.slice(0, i)).width;
          markerText(ctx, text[i], x + xOff, y, color, size);
          const charW = ctx.measureText(text[i]).width;
          setCursor({ x: x + xOff + charW, y: y - size * 0.4, show: true, color: sc });
          i++;
          setTimeout(tick, CHAR_DELAY);
        };
        tick();
        break;
      }

      case "draw_line": {
        const color = (p.color as string) || LINE_COLOR;
        animatedLine(ctx, p.x1 as number, p.y1 as number, p.x2 as number, p.y2 as number,
          color, (p.width as number) || 2, LINE_DURATION, setCursor, sc, resolve);
        break;
      }

      case "draw_arrow": {
        const x1 = p.x1 as number, y1 = p.y1 as number,
          x2 = p.x2 as number, y2 = p.y2 as number;
        const color = (p.color as string) || LINE_COLOR, w = (p.width as number) || 2;
        animatedLine(ctx, x1, y1, x2, y2, color, w, LINE_DURATION, setCursor, sc, () => {
          const a = Math.atan2(y2 - y1, x2 - x1), h = 14;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6));
          markerStroke(ctx, color, w);
          ctx.beginPath(); ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6));
          markerStroke(ctx, color, w);
          resolve();
        });
        break;
      }

      case "draw_circle": {
        // draw_circle removed — no-op, resolve immediately
        resolve();
        break;
      }

      case "draw_rect": {
        const rx = p.x as number, ry = p.y as number,
          rw = p.w as number, rh = p.h as number;
        const color = (p.color as string) || sc, w = (p.width as number) || 2;
        const sides: [number, number, number, number][] = [
          [rx, ry, rx + rw, ry], [rx + rw, ry, rx + rw, ry + rh],
          [rx + rw, ry + rh, rx, ry + rh], [rx, ry + rh, rx, ry],
        ];
        let si = 0;
        const next = () => {
          if (si >= sides.length) { resolve(); return; }
          const [a, b, c, d] = sides[si++];
          animatedLine(ctx, a, b, c, d, color, w, SHAPE_DURATION / 4, setCursor, sc, next);
        };
        next();
        break;
      }

      case "highlight":
        ctx.shadowBlur = 0;
        ctx.fillStyle = (p.color as string) || "rgba(94,234,212,0.06)";
        ctx.fillRect(p.x as number, p.y as number, p.w as number, p.h as number);
        resolve();
        break;

      case "step_marker": {
        const sx = p.x as number, sy = p.y as number;
        const stepNum = p.step as number;
        const label = `Step ${stepNum}`;
        const stepColor = getStepColor(stepNum);
        ctx.font = `bold ${CONTENT_SIZE}px ${FONT}`;
        const fullW = ctx.measureText(label).width;
        // Full-width divider (steps 2+)
        if (stepNum > 1) {
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.moveTo(20, sy - 22);
          ctx.lineTo(860, sy - 22);
          markerStroke(ctx, "rgba(148,163,184,0.10)", 1);
        }
        // Left accent bar
        ctx.shadowBlur = 0;
        ctx.fillStyle = stepColor;
        ctx.fillRect(sx - 14, sy - CONTENT_SIZE + 2, 4, CONTENT_SIZE + 8);
        // Step badge background
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = stepColor;
        ctx.beginPath();
        ctx.roundRect(sx - 6, sy - CONTENT_SIZE + 2, fullW + 16, CONTENT_SIZE + 8, 8);
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = stepColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        // Animate text
        let i = 0;
        const tick = () => {
          if (i >= label.length) { resolve(); return; }
          const xOff = ctx.measureText(label.slice(0, i)).width;
          markerText(ctx, label[i], sx + xOff, sy, stepColor, CONTENT_SIZE, true);
          setCursor({ x: sx + xOff + ctx.measureText(label[i]).width, y: sy - 12, show: true, color: stepColor });
          i++;
          setTimeout(tick, 28);
        };
        tick();
        break;
      }

      case "draw_graph": {
        const fn = p.fn as string;
        const label = (p.label as string) || "";
        const xMin = (p.x_min as number) ?? -5, xMax = (p.x_max as number) ?? 5;
        const yMin = (p.y_min as number) ?? -5, yMax = (p.y_max as number) ?? 5;
        const gx = (p.x as number) ?? 60, gy = (p.y as number) ?? 60;
        const gw = (p.width as number) ?? 500, gh = (p.height as number) ?? 350;
        if (label) drawGraphLabel(ctx, label, gx, gy, gw, sc);
        drawGraphAxes(ctx, gx, gy, gw, gh, xMin, xMax, yMin, yMax);

        const mapX = (v: number) => gx + ((v - xMin) / (xMax - xMin)) * gw;
        const mapY = (v: number) => gy + gh - ((v - yMin) / (yMax - yMin)) * gh;
        const SAMPLES = 400;
        const dx = (xMax - xMin) / SAMPLES;
        const CURVE_DURATION = 2000;
        const t0 = performance.now();
        const points: { px: number; py: number; valid: boolean }[] = [];
        for (let si = 0; si <= SAMPLES; si++) {
          const xv = xMin + si * dx;
          const yv = evalMathFn(fn, xv);
          const valid = !isNaN(yv);
          // Check for asymptotes (large jumps between adjacent points)
          let isAsymptote = false;
          if (valid && si > 0) {
            const prevYv = evalMathFn(fn, xMin + (si - 1) * dx);
            if (!isNaN(prevYv) && Math.abs(yv - prevYv) > (yMax - yMin) * 2) isAsymptote = true;
          }
          points.push({ px: valid ? mapX(xv) : 0, py: valid ? mapY(yv) : 0, valid: valid && !isAsymptote });
        }
        // Clip animation to graph area
        ctx.save();
        ctx.beginPath();
        ctx.rect(gx - 1, gy - 1, gw + 2, gh + 2);
        ctx.clip();
        let lastDrawn = 0;
        const animStep = () => {
          const elapsed = performance.now() - t0;
          const progress = Math.min(elapsed / CURVE_DURATION, 1);
          const targetIdx = Math.floor(progress * SAMPLES);
          ctx.lineCap = "round"; ctx.lineJoin = "round";
          let penDown = false;
          ctx.beginPath();
          for (let si = 0; si <= targetIdx; si++) {
            if (!points[si].valid) { penDown = false; continue; }
            if (si < lastDrawn && si > 0) { penDown = points[si - 1].valid; continue; }
            if (!penDown) { ctx.moveTo(points[si].px, points[si].py); penDown = true; }
            else ctx.lineTo(points[si].px, points[si].py);
          }
          ctx.shadowColor = sc;
          ctx.shadowBlur = 6;
          markerStroke(ctx, sc, 3.5);
          ctx.shadowBlur = 0;
          if (points[targetIdx]?.valid) {
            setCursor({ x: points[targetIdx].px, y: points[targetIdx].py, show: true, color: sc });
          }
          lastDrawn = targetIdx;
          if (progress < 1) {
            requestAnimationFrame(animStep);
          } else {
            ctx.restore();
            setCursor(c => ({ ...c, show: false }));
            resolve();
          }
        };
        requestAnimationFrame(animStep);
        break;
      }

      default: resolve();
    }
  });
}

/* ═══ Instant Draw (resize / replay) ═══ */

export function drawInstant(
  ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand,
  _dpr: number, step = 0,
) {
  const p = cmd.params;
  const sc = getStepColor(step);
  switch (cmd.action) {
    case "clear":
      break;
    case "draw_text":
      markerText(ctx, latexToHuman(p.text as string), p.x as number, p.y as number,
        TEXT_COLOR, CONTENT_SIZE);
      break;
    case "draw_latex":
      markerText(ctx, latexToHuman(p.latex as string), p.x as number, p.y as number,
        sc, CONTENT_SIZE);
      break;
    case "draw_line":
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x1 as number, p.y1 as number);
      ctx.lineTo(p.x2 as number, p.y2 as number);
      markerStroke(ctx, LINE_COLOR, (p.width as number) || 2);
      break;
    case "draw_arrow": {
      const x1 = p.x1 as number, y1 = p.y1 as number,
        x2 = p.x2 as number, y2 = p.y2 as number;
      const w = (p.width as number) || 2;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      markerStroke(ctx, LINE_COLOR, w);
      const a = Math.atan2(y2 - y1, x2 - x1), h = 14;
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a - Math.PI / 6), y2 - h * Math.sin(a - Math.PI / 6));
      markerStroke(ctx, LINE_COLOR, w);
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a + Math.PI / 6), y2 - h * Math.sin(a + Math.PI / 6));
      markerStroke(ctx, LINE_COLOR, w);
      break;
    }
    case "draw_circle":
      // draw_circle removed — no-op
      break;
    case "draw_rect":
      ctx.beginPath();
      ctx.rect(p.x as number, p.y as number, p.w as number, p.h as number);
      markerStroke(ctx, sc, (p.width as number) || 2);
      break;
    case "highlight":
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(94,234,212,0.06)";
      ctx.fillRect(p.x as number, p.y as number, p.w as number, p.h as number);
      break;
    case "step_marker": {
      const sx = p.x as number, sy = p.y as number;
      const stepNum = p.step as number;
      const label = `Step ${stepNum}`;
      const stepColor = getStepColor(stepNum);
      ctx.font = `bold ${CONTENT_SIZE}px ${FONT}`;
      const fullW = ctx.measureText(label).width;
      if (stepNum > 1) {
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(20, sy - 22);
        ctx.lineTo(860, sy - 22);
        markerStroke(ctx, "rgba(148,163,184,0.10)", 1);
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = stepColor;
      ctx.fillRect(sx - 14, sy - CONTENT_SIZE + 2, 4, CONTENT_SIZE + 8);
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = stepColor;
      ctx.beginPath();
      ctx.roundRect(sx - 6, sy - CONTENT_SIZE + 2, fullW + 16, CONTENT_SIZE + 8, 8);
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = stepColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      markerText(ctx, label, sx, sy, stepColor, CONTENT_SIZE, true);
      break;
    }
    case "question_header": {
      const qText = extractMath((p.text as string) || "");
      const label = (p._label as string) || "";
      const qX = (p._x as number) || 20;
      const qY = (p._y as number) || 22;
      const colWidth = (p._colWidth as number) || 320;
      if (label) {
        ctx.font = `bold 15px ${FONT}`;
        const lw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(99,102,241,0.15)";
        ctx.beginPath();
        ctx.roundRect(qX, qY - 13, lw + 12, 20, 6);
        ctx.fill();
        markerText(ctx, label, qX + 6, qY + 2, "#818cf8", 15);
        ctx.font = `${CONTENT_SIZE}px ${FONT}`;
        markerText(ctx, qText, qX + lw + 20, qY + 2, TEXT_COLOR, CONTENT_SIZE);
      } else {
        ctx.font = `${CONTENT_SIZE}px ${FONT}`;
        markerText(ctx, qText, qX, qY, TEXT_COLOR, CONTENT_SIZE);
      }
      ctx.beginPath();
      ctx.moveTo(qX, qY + 12);
      ctx.lineTo(qX + colWidth - 40, qY + 12);
      markerStroke(ctx, "rgba(148,163,184,0.15)", 1);
      break;
    }
    case "draw_graph": {
      const fn = p.fn as string;
      const label = (p.label as string) || "";
      const xMin = (p.x_min as number) ?? -5, xMax = (p.x_max as number) ?? 5;
      const yMin = (p.y_min as number) ?? -5, yMax = (p.y_max as number) ?? 5;
      const gx = (p.x as number) ?? 60, gy = (p.y as number) ?? 60;
      const gw = (p.width as number) ?? 500, gh = (p.height as number) ?? 350;
      if (label) drawGraphLabel(ctx, label, gx, gy, gw, sc);
      drawGraphAxes(ctx, gx, gy, gw, gh, xMin, xMax, yMin, yMax);
      drawGraphCurve(ctx, fn, gx, gy, gw, gh, xMin, xMax, yMin, yMax, sc);
      break;
    }
  }
}
