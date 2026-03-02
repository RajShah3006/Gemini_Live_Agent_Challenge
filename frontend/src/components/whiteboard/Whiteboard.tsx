"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WhiteboardCommand } from "@/lib/types";
import { WritingHand } from "./WritingHand";
import { TeacherMascot, type MascotState } from "./TeacherMascot";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { GraphPresets } from "./GraphPresets";

/* ── Lightboard Config ──────────────────────── */
const CHAR_DELAY = 38;
const LINE_DURATION = 500;
const PAUSE_BETWEEN = 250;
const SHAPE_DURATION = 400;
const BG = "#0b1120";
const GRID = "rgba(255,255,255,0.025)";
const FONT = "'Single Day', 'Segoe Script', cursive";
// Clean marker palette — visible on dark bg, no neon
const TEXT_COLOR = "#e2e8f0";      // white-ish for plain text
const LINE_COLOR = "#94a3b8";      // soft gray for lines/dividers
const AXIS_COLOR = "#64748b";      // muted for graph axes

// Step colors — single accent for step labels, varied colors for equation highlighting
const STEP_LABEL_COLOR = "#5eead4";   // consistent teal for all step labels
const STEP_COLORS = [
  "#5eead4",   // teal — equations/math
  "#a78bfa",   // violet — equations/math
  "#60a5fa",   // blue — equations/math
  "#4ade80",   // green — equations/math
  "#fbbf24",   // yellow — highlights
  "#f472b6",   // pink — highlights
  "#fb923c",   // orange — highlights
];

/** Extract math expression from a natural language question.
 *  e.g. "What is the integral of x^2 + 3x?" → "x^2 + 3x"
 *       "Solve 2x + 5 = 15" → "2x + 5 = 15"
 *       "5 + 3" → "5 + 3"
 */
function extractMath(text: string): string {
  if (!text) return "";
  // Try to find an equation/expression with math operators or variables
  const mathPatterns = [
    /(\d+\s*[\+\-\*\/\^]=?\s*[\dxyz][\dxyz\s\+\-\*\/\^=\(\)\.]*)/i,  // e.g. 2x + 5 = 15
    /([\dxyz][\dxyz\s\+\-\*\/\^=\(\)\.]*[\+\-\*\/\^=][\dxyz\s\+\-\*\/\^=\(\)\.]*)/i, // expressions with operators
    /([∫∑√Δπ][^\s]*[\dxyz\s\+\-\*\/\^=\(\)\.]*)/i, // math symbols
    /(\$[^$]+\$)/,  // LaTeX inline
    /(\\frac|\\int|\\sqrt|\\sum)[^.?!]*/i, // LaTeX commands
  ];
  for (const pat of mathPatterns) {
    const m = text.match(pat);
    if (m && m[1] && m[1].trim().length >= 3) return m[1].trim();
  }
  // If no math found, return the full text (it might be the expression itself)
  return text;
}

/* ── LaTeX → human-readable math ── */
/* ── Unicode superscript helper ── */
const SUP_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻",
  "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ", "x": "ˣ",
  "y": "ʸ", "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ",
  "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "k": "ᵏ", "l": "ˡ", "m": "ᵐ",
  "o": "ᵒ", "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ",
  "v": "ᵛ", "w": "ʷ", "z": "ᶻ", "∞": "°°",
};
function toSuperscript(s: string): string {
  // Map ∞ specially
  if (s === "∞" || s === "infty") return "∞";
  return s.split("").map(c => SUP_MAP[c] ?? SUP_MAP[c.toLowerCase()] ?? c).join("");
}

function latexToHuman(s: string): string {
  if (s == null || typeof s !== "string") return String(s ?? "");
  let r = s;
  // Fix control chars from JSON-mangled LaTeX backslashes:
  // \f (form-feed) → \frac, \t (tab) → \times/\theta, \b (BS) → \beta, etc.
  r = r.replace(/\f/g, "\\f");         // form-feed  → \f
  r = r.replace(/\t/g, "\\t");         // tab        → \t
  r = r.replace(/\x08/g, "\\b");       // backspace  → \b  (\b in regex = word boundary)
  r = r.replace(/\r/g, "\\r");         // CR         → \r
  r = r.replace(/\n/g, "\\n");         // newline    → \n
  // Handle fractions — multiple forms Gemini may send:
  // \frac{num}{den}, \frac num{den}, \frac{num}den, \fracND (single chars)
  for (let i = 0; i < 3; i++) {
    // Full braces: \frac{...}{...}
    r = r.replace(/\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "($1)⁄($2)");
    // Left braces only: \frac{...}D
    r = r.replace(/\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}\s*([a-zA-Z0-9])/g, "($1)⁄($2)");
    // Right braces only: \fracN{...}
    r = r.replace(/\\frac\s*([a-zA-Z0-9])\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "($1)⁄($2)");
    // No braces: \fracND (two single chars)
    r = r.replace(/\\frac\s*([a-zA-Z0-9])\s*([a-zA-Z0-9])/g, "($1)⁄($2)");
  }
  // Square root
  r = r.replace(/\\sqrt\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "√($1)");
  // Integrals
  r = r.replace(/\\int_\{([^}]*)}\^\{([^}]*)}/g, "∫[$1→$2]");
  r = r.replace(/\\int/g, "∫");
  // Summation / product
  r = r.replace(/\\sum_\{([^}]*)}\^\{([^}]*)}/g, "Σ[$1→$2]");
  r = r.replace(/\\sum/g, "Σ");
  r = r.replace(/\\prod/g, "Π");
  // Limits
  r = r.replace(/\\lim_\{([^}]*)}/g, "lim($1)");
  r = r.replace(/\\lim/g, "lim");
  // Infinity
  r = r.replace(/\\infty/g, "∞");
  // Greek letters
  r = r.replace(/\\alpha/g, "α"); r = r.replace(/\\beta/g, "β");
  r = r.replace(/\\gamma/g, "γ"); r = r.replace(/\\delta/g, "δ");
  r = r.replace(/\\epsilon/g, "ε"); r = r.replace(/\\theta/g, "θ");
  r = r.replace(/\\lambda/g, "λ"); r = r.replace(/\\mu/g, "μ");
  r = r.replace(/\\pi/g, "π"); r = r.replace(/\\sigma/g, "σ");
  r = r.replace(/\\phi/g, "φ"); r = r.replace(/\\omega/g, "ω");
  r = r.replace(/\\Delta/g, "Δ"); r = r.replace(/\\Sigma/g, "Σ");
  // Trig / log
  r = r.replace(/\\sin/g, "sin"); r = r.replace(/\\cos/g, "cos");
  r = r.replace(/\\tan/g, "tan"); r = r.replace(/\\log/g, "log");
  r = r.replace(/\\ln/g, "ln"); r = r.replace(/\\exp/g, "exp");
  // Superscript: x^{2} → x² (common ones), else x^(n)
  r = r.replace(/\^\{0}/g, "⁰"); r = r.replace(/\^\{1}/g, "¹");
  r = r.replace(/\^\{2}/g, "²"); r = r.replace(/\^\{3}/g, "³");
  r = r.replace(/\^\{4}/g, "⁴"); r = r.replace(/\^\{5}/g, "⁵");
  r = r.replace(/\^\{6}/g, "⁶"); r = r.replace(/\^\{7}/g, "⁷");
  r = r.replace(/\^\{8}/g, "⁸"); r = r.replace(/\^\{9}/g, "⁹");
  // Compound superscripts like ^{n+1}, ^{2x}, ^{∞}
  r = r.replace(/\^\{([^}]*)}/g, (_m, inner: string) => toSuperscript(inner));
  // Bare caret: e^x → eˣ, x^2 → x², etc.
  r = r.replace(/\^(\d)/g, (_m, d: string) => toSuperscript(d));
  r = r.replace(/\^([a-zA-Z∞])/g, (_m, c: string) => toSuperscript(c));
  r = r.replace(/\^([+\-])/g, (_m, c: string) => toSuperscript(c));
  // Subscript: _{n} → _n
  r = r.replace(/_\{([^}]*)}/g, "_$1");
  // Operators
  r = r.replace(/\\times/g, "×"); r = r.replace(/\\cdot/g, "·");
  r = r.replace(/\\div/g, "÷"); r = r.replace(/\\pm/g, "±");
  r = r.replace(/\\neq/g, "≠"); r = r.replace(/\\leq/g, "≤");
  r = r.replace(/\\geq/g, "≥"); r = r.replace(/\\approx/g, "≈");
  r = r.replace(/\\rightarrow/g, "→"); r = r.replace(/\\implies/g, "⟹");
  r = r.replace(/\\Rightarrow/g, "⇒");
  // Arrows
  r = r.replace(/\\to/g, "→");
  // Misc
  r = r.replace(/\\partial/g, "∂"); r = r.replace(/\\nabla/g, "∇");
  r = r.replace(/\\forall/g, "∀"); r = r.replace(/\\exists/g, "∃");
  r = r.replace(/\\in/g, "∈"); r = r.replace(/\\notin/g, "∉");
  r = r.replace(/\\subset/g, "⊂"); r = r.replace(/\\cup/g, "∪");
  r = r.replace(/\\cap/g, "∩"); r = r.replace(/\\emptyset/g, "∅");
  r = r.replace(/\\cdots/g, "…"); r = r.replace(/\\ldots/g, "…");
  r = r.replace(/\\dots/g, "…"); r = r.replace(/\\vdots/g, "⋮");
  // Boxed answers — just show the content
  for (let i = 0; i < 2; i++) {
    r = r.replace(/\\boxed\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, "[$1]");
  }
  r = r.replace(/\\overline\{([^{}]*)}/g, "$1̄");
  r = r.replace(/\\underline\{([^{}]*)}/g, "$1");
  r = r.replace(/\\hat\{([^{}]*)}/g, "$1̂");
  r = r.replace(/\\vec\{([^{}]*)}/g, "$1→");
  // Clean up remaining LaTeX formatting
  r = r.replace(/\\,/g, " "); r = r.replace(/\\;/g, " ");
  r = r.replace(/\\!/g, ""); r = r.replace(/\\quad/g, "  ");
  r = r.replace(/\\qquad/g, "   ");
  r = r.replace(/\\left/g, ""); r = r.replace(/\\right/g, "");
  r = r.replace(/\\text\{([^}]*)}/g, "$1");
  r = r.replace(/\\mathrm\{([^}]*)}/g, "$1");
  r = r.replace(/\\mathbf\{([^}]*)}/g, "$1");
  r = r.replace(/\\mathit\{([^}]*)}/g, "$1");
  r = r.replace(/\\displaystyle/g, "");
  // Last-chance frac cleanup: if \frac survived all patterns, strip it gracefully
  r = r.replace(/\\frac\s*/g, "");
  r = r.replace(/\\[a-zA-Z]+/g, ""); // catch-all: strip any remaining \commands
  r = r.replace(/\{/g, ""); r = r.replace(/}/g, "");
  // Replace programming asterisk with proper multiplication dot
  r = r.replace(/(\d)\s*\*\s*(?=[\d(xyzXYZ])/g, "$1·");
  r = r.replace(/\)\s*\*\s*(?=[\d(xyzXYZ])/g, ")·");
  r = r.replace(/([a-zA-Z])\s*\*\s*(?=[\d(xyzXYZ])/g, "$1·");
  // Collapse multiple spaces
  r = r.replace(/  +/g, " ").trim();
  return r;
}

interface WhiteboardProps {
  commands: WhiteboardCommand[];
  isSpeaking?: boolean;
  isThinking?: boolean;
  onQuestionsChange?: (questions: QuestionInfo[]) => void;
  toolbarPortalRef?: React.RefObject<HTMLDivElement | null>;
}

/* ── Section = one response block on the board ── */
interface Section {
  idx: number;
  label: string;         // "Q1", "Q2", "↪ follow-up"
  isNewQuestion: boolean; // true = show divider, false = just spacing
  yStart: number;        // absolute y where this section begins on the canvas
  col: number;           // 0 = left column, 1 = right column
  xOffset: number;       // px to add to x coordinates for this column
  questionText?: string; // the user's original question text
}

export interface QuestionInfo {
  label: string;  // "Q1", "Q2"
  text: string;   // truncated question text
  idx: number;    // section index for scrolling
  yStart: number;
}

const SECTION_GAP = 80;        // px gap between questions (generous spacing)
const DIVIDER_HEIGHT = 36;     // height of the section divider
const FOLLOWUP_GAP = 14;       // tight gap between steps within a question

export function Whiteboard({ commands, isSpeaking = false, isThinking = false, onQuestionsChange, toolbarPortalRef }: WhiteboardProps) {
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
  const currentStepRef = useRef(0);
  const [zoom, setZoom] = useState(2);

  // Section tracking
  const sectionsRef = useRef<Section[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const yOffsetRef = useRef(0);     // Y offset for current section
  const questionCountRef = useRef(0); // counts actual questions (not follow-ups)
  const turnCompleteRef = useRef(true); // true when the last turn finished
  const sectionStartedRef = useRef(false); // did we start a section for this turn?
  const awaitingAnswerRef = useRef(false); // true after question_header, before Gemini response

  // Column layout tracking (dynamic widths based on content)
  const COL_GAP = 30;           // gap between columns
  const COL_MIN_WIDTH = 280;    // minimum px per column
  const colMaxYRef = useRef<number[]>([]);      // per-column max Y (height)
  const colXStartRef = useRef<number[]>([0]);   // per-column absolute x start
  const colContentWidthRef = useRef<number[]>([0]); // per-column measured content width
  const currentColRef = useRef(0);              // current column index
  const xOffsetRef = useRef(0);                 // current x offset for column

  // Derive mascot state
  const mascotState: MascotState = isDrawing ? "writing" : isSpeaking ? "talking" : isThinking ? "thinking" : "idle";

  // Track the max y coordinate to grow the canvas
  function trackY(y: number) {
    const col = currentColRef.current;
    if (col < colMaxYRef.current.length && y + 80 > colMaxYRef.current[col]) {
      colMaxYRef.current[col] = y + 80;
    }
    const globalMax = colMaxYRef.current.length > 0
      ? Math.max(...colMaxYRef.current)
      : y + 80;
    if (globalMax > maxYRef.current) {
      maxYRef.current = globalMax;
      resizeCanvas();
    }
  }

  // Track the max x extent of content in the current column
  function trackContentX(ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand) {
    const col = currentColRef.current;
    if (col >= colContentWidthRef.current.length) return;
    const colStart = colXStartRef.current[col] || 0;
    const maxX = measureCommandMaxX(ctx, cmd);
    if (maxX <= 0) return;
    const contentW = maxX - colStart + 30; // 30px right padding
    if (contentW > colContentWidthRef.current[col]) {
      colContentWidthRef.current[col] = Math.max(contentW, COL_MIN_WIDTH);
    }
  }

  /** Measure the furthest x-extent of a rendered command */
  function measureCommandMaxX(ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand): number {
    const p = cmd.params;
    switch (cmd.action) {
      case "draw_text":
        ctx.font = `${(p.size as number) || 24}px ${FONT}`;
        return (p.x as number) + ctx.measureText(latexToHuman((p.text as string) || "")).width;
      case "draw_latex":
        ctx.font = `${(p.size as number) || 24}px ${FONT}`;
        return (p.x as number) + ctx.measureText(latexToHuman((p.latex as string) || "")).width;
      case "draw_graph":
        return (p.x as number) + ((p.width as number) || 500);
      case "draw_line":
        return Math.max((p.x1 as number) || 0, (p.x2 as number) || 0);
      case "step_marker": {
        const sx = (p.x as number) || (colXStartRef.current[currentColRef.current] || 0) + 20;
        ctx.font = `bold 22px ${FONT}`;
        return sx + ctx.measureText(`Step ${p.step}`).width + 40;
      }
      case "draw_circle":
        return (p.x as number) + ((p._pillW as number) || ((p.radius as number) || 30));
      default:
        return 0;
    }
  }

  /** Compute actual content width of a column by scanning all completed commands in it */
  function computeColumnWidth(col: number): number {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return COL_MIN_WIDTH;
    const colStart = colXStartRef.current[col] || 0;
    let maxExtent = 0;
    for (const c of completedRef.current) {
      const secIdx = c._sectionIdx;
      if (secIdx === undefined) continue;
      const sec = sectionsRef.current[secIdx];
      if (!sec || sec.col !== col) continue;
      const ext = measureCommandMaxX(ctx, c);
      if (ext > 0 && ext - colStart > maxExtent) {
        maxExtent = ext - colStart;
      }
    }
    return Math.max(maxExtent + 30, COL_MIN_WIDTH);
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
    // Draw chalk column dividers at dynamic positions
    const numDynCols = colXStartRef.current.length;
    if (numDynCols > 1) {
      for (let c = 1; c < numDynCols; c++) {
        const cx = colXStartRef.current[c] - COL_GAP / 2;
        drawWavyLine(ctx, cx, 20, cx, h - 20, "rgba(148,163,184,0.08)", 0.8);
      }
    }
    // Redraw all section dividers (within their column)
    sectionsRef.current.forEach(sec => {
      if (sec.isNewQuestion && sec.idx > 0) drawSectionDivider(ctx, sec, w);
    });
    // Redraw all completed commands (update dynamic colWidth on headers first)
    completedRef.current.forEach(c => {
      if (c.action === "question_header") {
        const sIdx = c._sectionIdx ?? 0;
        const secCol = sectionsRef.current[sIdx]?.col ?? 0;
        c.params._colWidth = Math.max(colContentWidthRef.current[secCol] || COL_MIN_WIDTH, COL_MIN_WIDTH);
      }
      const step = c._step || 0;
      drawInstant(ctx, c, dpr, step);
    });
  }

  /** Draw a column-scoped divider + label between question sections */
  function drawSectionDivider(ctx: CanvasRenderingContext2D, sec: Section, _canvasW: number) {
    const colWidth = colContentWidthRef.current[sec.col] || COL_MIN_WIDTH;
    const y = sec.yStart + 14;
    const leftX = sec.xOffset + 15;
    const rightX = sec.xOffset + colWidth - 15;
    const midX = sec.xOffset + colWidth / 2;

    // Hand-drawn wavy divider line
    drawWavyLine(ctx, leftX, y, rightX, y, "rgba(148,163,184,0.2)", 1);
    // Label pill
    const label = sec.label;
    ctx.font = `bold 13px ${FONT}`;
    const tw = ctx.measureText(label).width;
    const px = midX - tw / 2 - 12;
    ctx.fillStyle = "rgba(148,163,184,0.10)";
    ctx.beginPath();
    ctx.roundRect(px, y - 11, tw + 24, 22, 11);
    ctx.fill();
    markerText(ctx, label, midX - tw / 2, y + 4, "#94a3b8", 13, true);
  }

  /**
   * Start a new layout section with dynamic column widths.
   * New questions go into a new column (sized by previous content) or the shortest existing column.
   * Follow-ups stay in the same column.
   */
  function startNewSection(isNewQuestion: boolean) {
    const sectionIdx = sectionsRef.current.length;
    const existingCols = colXStartRef.current.length;

    // Ensure colMaxYRef has enough entries
    while (colMaxYRef.current.length < existingCols) {
      colMaxYRef.current.push(0);
    }
    while (colContentWidthRef.current.length < existingCols) {
      colContentWidthRef.current.push(0);
    }

    let col: number;
    let xOffset: number;
    let yStart: number;

    if (isNewQuestion) {
      questionCountRef.current += 1;

      // Check if we can create a new column to the right
      // Recompute previous column's width from actual rendered content
      const prevColWidth = computeColumnWidth(existingCols - 1);
      colContentWidthRef.current[existingCols - 1] = prevColWidth;
      const lastColEnd = colXStartRef.current[existingCols - 1] + prevColWidth;
      const newColStart = lastColEnd + COL_GAP;
      const hasRoom = newColStart + COL_MIN_WIDTH <= viewWidthRef.current;

      // Find if any existing column is empty (height 0)
      let emptyCol = -1;
      for (let i = 0; i < existingCols; i++) {
        if ((colMaxYRef.current[i] ?? 0) === 0) { emptyCol = i; break; }
      }

      if (emptyCol >= 0) {
        // Reuse empty column
        col = emptyCol;
      } else if (hasRoom) {
        // Create new column to the right, positioned after previous content
        col = existingCols;
        colXStartRef.current.push(newColStart);
        colMaxYRef.current.push(0);
        colContentWidthRef.current.push(0);
      } else {
        // No room — stack below the shortest existing column
        col = 0;
        let minH = colMaxYRef.current[0] ?? 0;
        for (let i = 1; i < existingCols; i++) {
          const h = colMaxYRef.current[i] ?? 0;
          if (h < minH) { minH = h; col = i; }
        }
      }

      xOffset = colXStartRef.current[col] || 0;
      yStart = (colMaxYRef.current[col] ?? 0) > 0
        ? (colMaxYRef.current[col] ?? 0) + SECTION_GAP
        : 0;
    } else {
      // Follow-up → same column as parent question
      col = currentColRef.current;
      xOffset = colXStartRef.current[col] || 0;
      yStart = (colMaxYRef.current[col] ?? 0) + FOLLOWUP_GAP;
    }

    currentColRef.current = col;
    xOffsetRef.current = xOffset;

    const label = isNewQuestion ? `Q${questionCountRef.current}` : `↪ Q${questionCountRef.current}`;
    const section: Section = { idx: sectionIdx, label, isNewQuestion, yStart, col, xOffset };
    sectionsRef.current.push(section);
    setSections([...sectionsRef.current]);

    // Add divider height if this column already has content
    const showDivider = isNewQuestion && sectionIdx > 0 && (colMaxYRef.current[col] ?? 0) > 0;
    const divH = showDivider ? DIVIDER_HEIGHT : 0;
    yOffsetRef.current = yStart + divH;
    currentStepRef.current = 0;
    sectionStartedRef.current = true;

    // Draw divider within the column
    if (showDivider) {
      trackY(yStart + divH);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawSectionDivider(ctx, section, viewWidthRef.current);
    }
  }

  function autoScroll(y: number) {
    const container = containerRef.current;
    if (!container) return;
    const viewH = container.clientHeight;
    const scaledY = y * (zoomRef.current / 2);
    const targetScroll = scaledY - viewH + 120;
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

      // Only honor explicit user-initiated clear
      if (cmd.action === "clear") {
        if (cmd.id === "user-clear") {
          completedRef.current = [];
          sectionsRef.current = [];
          setSections([]);
          maxYRef.current = 0;
          yOffsetRef.current = 0;
          currentStepRef.current = 0;
          questionCountRef.current = 0;
          turnCompleteRef.current = true;
          sectionStartedRef.current = false;
          awaitingAnswerRef.current = false;
          colMaxYRef.current = [];
          currentColRef.current = 0;
          xOffsetRef.current = 0;
          colXStartRef.current = [0];
          colContentWidthRef.current = [0];
          resizeCanvas();
          if (containerRef.current) containerRef.current.scrollTop = 0;
        }
        setCursor(c => ({ ...c, show: false }));
        setIsDrawing(false);
        continue;
      }

      // ── Question header: show user's typed question on the board ──
      if (cmd.action === "question_header") {
        const rawText = (cmd.params.text as string) || "";
        startNewSection(true);
        turnCompleteRef.current = false;
        awaitingAnswerRef.current = true; // keep this section open for Gemini's answer

        // Store question text on the section for external access
        const section = sectionsRef.current[sectionsRef.current.length - 1];
        section.questionText = rawText;

        // Notify parent of updated question list
        if (onQuestionsChange) {
          const qs = sectionsRef.current
            .filter(s => s.isNewQuestion && s.questionText)
            .map(s => ({ label: s.label, text: s.questionText!.slice(0, 60), idx: s.idx, yStart: s.yStart }));
          onQuestionsChange(qs);
        }

        // Draw cell label + math expression only
        const label = section.label;
        const qText = extractMath(rawText);
        const qX = 20 + (section.xOffset || 0);
        const qY = yOffsetRef.current + 22;

        // Label badge (e.g. "Q1")
        ctx.font = `bold 15px ${FONT}`;
        const lw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(99,102,241,0.15)";
        ctx.beginPath();
        ctx.roundRect(qX, qY - 13, lw + 12, 20, 6);
        ctx.fill();
        markerText(ctx, label, qX + 6, qY + 2, "#818cf8", 15);

        // Math expression after label
        ctx.font = `24px ${FONT}`;
        markerText(ctx, qText, qX + lw + 20, qY + 2, TEXT_COLOR, 24);

        // Subtle underline across column width (use current content width or minimum)
        const colWidth = Math.max(colContentWidthRef.current[section.col] || 0, COL_MIN_WIDTH);
        ctx.beginPath();
        ctx.moveTo(qX, qY + 12);
        ctx.lineTo(qX + colWidth - 40, qY + 12);
        markerStroke(ctx, "rgba(148,163,184,0.15)", 1);

        // Track initial header content width
        ctx.font = `24px ${FONT}`;
        const headerMaxX = qX + lw + 20 + ctx.measureText(qText).width;
        const headerContentW = headerMaxX - (section.xOffset || 0) + 30;
        if (headerContentW > (colContentWidthRef.current[section.col] || 0)) {
          colContentWidthRef.current[section.col] = Math.max(headerContentW, COL_MIN_WIDTH);
        }
        ctx.beginPath();
        ctx.moveTo(qX, qY + 12);
        ctx.lineTo(qX + colWidth - 40, qY + 12);
        markerStroke(ctx, "rgba(148,163,184,0.15)", 1);

        trackY(qY + 20);
        autoScroll(qY + 20);
        yOffsetRef.current += 40; // push Gemini content below question header

        // Store with computed positions for redraw
        const headerCmd: WhiteboardCommand = {
          ...cmd,
          params: { ...cmd.params, _x: qX, _y: qY, _label: label, _colWidth: colWidth },
          _step: 0,
          _sectionIdx: section.idx,
        };
        completedRef.current.push(headerCmd);
        continue;
      }

      // ── Section management ──
      // Every new Gemini response must start a new section to avoid overlap.
      // EXCEPT when we just drew a question_header — the answer belongs in that same section.
      if (awaitingAnswerRef.current) {
        // Gemini's answer arrived — stay in the same section as the question header
        awaitingAnswerRef.current = false;
        sectionStartedRef.current = true;
        turnCompleteRef.current = false;
      } else if (turnCompleteRef.current && !sectionStartedRef.current) {
        const isNewQ = cmd.action === "step_marker" && (cmd.params.step as number) === 1;
        startNewSection(isNewQ || sectionsRef.current.length === 0);
        turnCompleteRef.current = false;
      }

      // If still no section (edge case), create one
      if (sectionsRef.current.length === 0) {
        startNewSection(true);
        turnCompleteRef.current = false;
      }

      setIsDrawing(true);
      if (cmd.action === "step_marker") {
        currentStepRef.current = (cmd.params.step as number) || currentStepRef.current + 1;
      }

      // Offset coordinates to place in current section's column area
      const offsetCmd = offsetCommand(cmd, yOffsetRef.current, xOffsetRef.current);
      offsetCmd._step = currentStepRef.current;
      offsetCmd._sectionIdx = sectionsRef.current.length - 1;

      // Dynamic circle→pill sizing: measure nearby text and auto-fit pill dimensions
      // ONLY search within the same section to avoid cross-column matches
      if (offsetCmd.action === "draw_circle") {
        const rawCx = offsetCmd.params.x as number;
        const rawCy = offsetCmd.params.y as number;
        const circleSection = offsetCmd._sectionIdx;
        let pillW = 60, pillH = 30;
        let bestDist = Infinity;
        let bestIsLatex = false;
        for (let ci = completedRef.current.length - 1; ci >= 0; ci--) {
          const prev = completedRef.current[ci];
          // Only consider commands from the same section
          if (prev._sectionIdx !== circleSection) continue;
          if (prev.action !== "draw_text" && prev.action !== "draw_latex") continue;
          const isLatex = prev.action === "draw_latex";
          const tY = prev.params.y as number;
          const tX = prev.params.x as number;
          const yDist = Math.abs(rawCy - tY);
          if (yDist > 80) continue;
          const raw = isLatex ? prev.params.latex : prev.params.text;
          const text = latexToHuman(raw as string);
          const tSize = (prev.params.size as number) || 24;
          ctx.font = `${tSize}px ${FONT}`;
          const tw = ctx.measureText(text).width;
          const textCx = tX + tw / 2;
          const textCy = tY - tSize * 0.3;
          const dist = Math.hypot(rawCx - textCx, rawCy - textCy);
          // Prefer latex over text: never replace a latex match with text
          if (bestIsLatex && !isLatex) continue;
          if (isLatex && !bestIsLatex && dist < 300) {
            // Latex always wins over a previous text match
            bestDist = dist;
            bestIsLatex = true;
          } else if (dist >= bestDist) {
            continue;
          } else {
            bestDist = dist;
            bestIsLatex = isLatex;
          }
          pillW = tw + 28;
          pillH = tSize + 16;
          // Re-center pill on the text
          offsetCmd.params.x = textCx;
          offsetCmd.params.y = textCy;
        }
        offsetCmd.params._pillW = pillW;
        offsetCmd.params._pillH = pillH;
      }

      // Grow canvas and auto-scroll
      const cmdY = getCommandY(offsetCmd);
      if (cmdY > 0) {
        trackY(cmdY);
        autoScroll(cmdY);
      }
      // Track content width for dynamic column sizing
      trackContentX(ctx, offsetCmd);
      await animateCmd(ctx, offsetCmd, dprRef.current, setCursor, currentStepRef.current);
      completedRef.current.push(offsetCmd);
      if (queueRef.current.length > 0) {
        await new Promise(r => setTimeout(r, PAUSE_BETWEEN));
      }
    }
    setCursor(c => ({ ...c, show: false }));
    setIsDrawing(false);
    // Mark turn complete so next batch of commands creates a new section
    // BUT if we're awaiting Gemini's answer (question_header was just drawn), keep the turn open
    if (!awaitingAnswerRef.current) {
      turnCompleteRef.current = true;
      sectionStartedRef.current = false;
    }
    busyRef.current = false;
    if (queueRef.current.length > 0) drain();
  }

  // ── Graph preset: inject a draw_graph command directly ──
  function handleGraphPreset(fn: string, label: string) {
    // Place graph below current content
    const yPos = Math.max(60, maxYRef.current + 30);
    const graphCmd: WhiteboardCommand = {
      id: `preset-${Date.now()}`,
      action: "draw_graph",
      params: { fn, label, x: 60, y: yPos, width: 500, height: 350 },
    };
    queueRef.current.push(graphCmd);
    // Ensure a section exists
    if (sectionsRef.current.length === 0) {
      startNewSection(true);
      turnCompleteRef.current = false;
    }
    drain();
  }

  // ── Undo: remove last completed command and redraw ──
  function handleUndo() {
    if (completedRef.current.length === 0) return;
    completedRef.current.pop();
    redrawAll();
  }

  // ── Clear board (user-initiated) ──
  function handleClear() {
    completedRef.current = [];
    sectionsRef.current = [];
    setSections([]);
    maxYRef.current = 0;
    yOffsetRef.current = 0;
    currentStepRef.current = 0;
    questionCountRef.current = 0;
    turnCompleteRef.current = true;
    sectionStartedRef.current = false;
    awaitingAnswerRef.current = false;
    colMaxYRef.current = [];
    currentColRef.current = 0;
    xOffsetRef.current = 0;
    colXStartRef.current = [0];
    colContentWidthRef.current = [0];
    resizeCanvas();
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }

  // Redraw everything from completedRef
  function redrawAll() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = dprRef.current;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const cmd of completedRef.current) {
      drawInstant(ctx, cmd, dpr);
    }
  }

  // Initial size + resize handler
  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+wheel zoom (non-passive so we can preventDefault)
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(prev => Math.max(0.25, Math.min(3, prev - e.deltaY * 0.003)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: BG }}>
      {/* Toolbar + graph presets + Q-nav — portaled into header */}
      {portalReady && toolbarPortalRef?.current && createPortal(
        <>
          {/* Question navigation tabs */}
          {sections.filter(s => s.isNewQuestion).length > 1 && (
            <div className="flex items-center gap-0.5 rounded-xl px-1.5 py-1"
              style={{
                background: "rgba(148,163,184,0.06)",
                border: "1px solid rgba(148,163,184,0.08)",
              }}
            >
              <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: "none", maxWidth: 220 }}>
                {sections.filter(s => s.isNewQuestion).map(sec => (
                  <button
                    key={sec.idx}
                    onClick={() => {
                      containerRef.current?.scrollTo({ top: sec.yStart * (zoom / 2), behavior: "smooth" });
                    }}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
                    style={{ color: "#94a3b8" }}
                    title={sec.questionText ? `${sec.label}: ${sec.questionText}` : `Scroll to ${sec.label}`}
                  >
                    <span style={{ color: STEP_COLORS[sec.idx % STEP_COLORS.length] }}>●</span>
                    {sec.label}
                  </button>
                ))}
              </div>
              {sections.filter(s => s.isNewQuestion).length > 5 && (
                <span className="text-[10px] shrink-0 pl-0.5" style={{ color: "var(--text-muted)" }}>…</span>
              )}
            </div>
          )}
          <GraphPresets onGraph={handleGraphPreset} />
          <WhiteboardToolbar
            canvasRef={canvasRef}
            containerRef={containerRef}
            onUndo={handleUndo}
            onClear={handleClear}
            canUndo={completedRef.current.length > 0}
            zoom={zoom}
            onZoomChange={setZoom}
          />
        </>,
        toolbarPortalRef.current,
      )}

      {/* Writing hand cursor (inside scrollable container) */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-auto"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1e293b #060a10" }}
      >
        <div style={{
          transform: `scale(${zoom / 2})`,
          transformOrigin: "top left",
          width: `${200 / zoom}%`,
          minHeight: `${200 / zoom}%`,
        }}>
          <canvas ref={canvasRef} className="block" />
          <WritingHand x={cursor.x} y={cursor.y} show={cursor.show} glowColor={cursor.color} />
        </div>
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

/** Offset X and Y coordinates in a command so it draws in the current section's column */
function offsetCommand(cmd: WhiteboardCommand, yOff: number, xOff: number): WhiteboardCommand {
  if (yOff === 0 && xOff === 0) return { ...cmd, params: { ...cmd.params } };
  const p = { ...cmd.params };
  if (p.y !== undefined) p.y = (p.y as number) + yOff;
  if (p.y1 !== undefined) p.y1 = (p.y1 as number) + yOff;
  if (p.y2 !== undefined) p.y2 = (p.y2 as number) + yOff;
  if (p.x !== undefined) p.x = (p.x as number) + xOff;
  if (p.x1 !== undefined) p.x1 = (p.x1 as number) + xOff;
  if (p.x2 !== undefined) p.x2 = (p.x2 as number) + xOff;
  return { ...cmd, params: p };
}

function getCommandY(cmd: WhiteboardCommand): number {
  const p = cmd.params;
  if (cmd.action === "draw_circle") {
    const ph = (p._pillH as number) || ((p.radius as number) || 30) * 2;
    return (p.y as number) + ph / 2;
  }
  if (p.y !== undefined) {
    if (cmd.action === "draw_graph") return (p.y as number) + ((p.height as number) || 350);
    return p.y as number;
  }
  if (p.y1 !== undefined) return Math.max(p.y1 as number, p.y2 as number);
  return 0;
}

/* ═══ Safe math evaluator for graph plotting ═══ */

function evalMathFn(expr: string, x: number): number {
  try {
    const fn = new Function("x", "Math", `return (${expr});`);
    const result = fn(x, Math);
    return typeof result === "number" && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

/* ═══ Graph drawing helpers ═══ */

function drawGraphAxes(
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

  // X-axis
  if (yMin <= 0 && yMax >= 0) {
    ctx.beginPath(); ctx.moveTo(gx, oy); ctx.lineTo(gx + gw, oy);
    markerStroke(ctx, AXIS_COLOR, 1.5);
    ctx.beginPath(); ctx.moveTo(gx + gw, oy);
    ctx.lineTo(gx + gw - 8, oy - 4); ctx.moveTo(gx + gw, oy);
    ctx.lineTo(gx + gw - 8, oy + 4);
    markerStroke(ctx, AXIS_COLOR, 1.5);
  }
  // Y-axis
  if (xMin <= 0 && xMax >= 0) {
    ctx.beginPath(); ctx.moveTo(ox, gy + gh); ctx.lineTo(ox, gy);
    markerStroke(ctx, AXIS_COLOR, 1.5);
    ctx.beginPath(); ctx.moveTo(ox, gy);
    ctx.lineTo(ox - 4, gy + 8); ctx.moveTo(ox, gy);
    ctx.lineTo(ox + 4, gy + 8);
    markerStroke(ctx, AXIS_COLOR, 1.5);
  }

  const xStep = niceStep(xMax - xMin);
  const yStep = niceStep(yMax - yMin);

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

function drawGraphCurve(
  ctx: CanvasRenderingContext2D,
  fn: string, gx: number, gy: number, gw: number, gh: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
  color: string,
) {
  const mapX = (v: number) => gx + ((v - xMin) / (xMax - xMin)) * gw;
  const mapY = (v: number) => gy + gh - ((v - yMin) / (yMax - yMin)) * gh;
  const SAMPLES = 300;
  const dx = (xMax - xMin) / SAMPLES;

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  let penDown = false;

  for (let i = 0; i <= SAMPLES; i++) {
    const xv = xMin + i * dx;
    const yv = evalMathFn(fn, xv);
    if (isNaN(yv) || yv < yMin - 5 || yv > yMax + 5) {
      penDown = false;
      continue;
    }
    const px = mapX(xv), py = mapY(yv);
    if (!penDown) { ctx.moveTo(px, py); penDown = true; }
    else ctx.lineTo(px, py);
  }

  // Glow effect for graph curve
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  markerStroke(ctx, color, 3);
  ctx.shadowBlur = 0;
}

function drawGraphLabel(
  ctx: CanvasRenderingContext2D,
  label: string, gx: number, gy: number, gw: number,
  color: string,
) {
  const text = latexToHuman(label);
  ctx.font = `bold 18px ${FONT}`;
  const tw = ctx.measureText(text).width;
  markerText(ctx, text, gx + gw / 2 - tw / 2, gy - 20, color, 18, true);
}

/* ═══ Helpers: clean marker-style drawing (no neon glow) ═══ */

/** Hand-drawn wavy line — imperfect underline effect */
function drawWavyLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width: number,
) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const segments = Math.max(4, Math.floor(len / 12));
  // Perpendicular direction for displacement
  const dx = x2 - x1, dy = y2 - y1;
  const nx = -dy / len, ny = dx / len; // unit normal
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const disp = Math.sin(t * Math.PI * segments * 0.5) * 2.5;
    ctx.lineTo(x1 + dx * t + nx * disp, y1 + dy * t + ny * disp);
  }
  markerStroke(ctx, color, width);
}

function markerText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  color: string, size: number, bold = false,
) {
  ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
  // Subtle chalk shadow — lighter on bold to prevent ghosting
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = bold ? 1.5 : 2.5;
  ctx.shadowOffsetX = 0.5;
  ctx.shadowOffsetY = 0.5;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  // Reset shadow
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function markerStroke(
  ctx: CanvasRenderingContext2D, color: string, width: number,
) {
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

type SetCursor = React.Dispatch<
  React.SetStateAction<{ x: number; y: number; show: boolean; color: string }>
>;

/* ═══ Step-based color helper ═══ */
function getStepColor(step: number): string {
  if (step <= 0) return STEP_COLORS[0];
  return STEP_COLORS[(step - 1) % STEP_COLORS.length];
}

/* ═══ Animated command renderer ═══ */

function animateCmd(
  ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand,
  dpr: number, setCursor: SetCursor, step: number,
): Promise<void> {
  const p = cmd.params;
  const sc = getStepColor(step);
  return new Promise(resolve => {
    switch (cmd.action) {
      case "draw_text":
      case "draw_latex": {
        const isLatex = cmd.action === "draw_latex";
        const raw = (isLatex ? p.latex : p.text) as string;
        // Always sanitize — Gemini sometimes sends LaTeX even via draw_text
        const text = latexToHuman(raw);
        const x = p.x as number, y = p.y as number;
        const size = (p.size as number) || 24;
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
        const cx = p.x as number, cy = p.y as number;
        const pw = (p._pillW as number) || ((p.radius as number) || 30) * 2;
        const ph = (p._pillH as number) || ((p.radius as number) || 30) * 2;
        const color = (p.color as string) || sc, w = (p.width as number) || 2;
        const rr = ph / 2; // corner radius = half height for pill shape
        const left = cx - pw / 2, top = cy - ph / 2;
        // Perimeter segments: top, right-arc, bottom, left-arc
        const perim = pw - ph + Math.PI * rr + pw - ph + Math.PI * rr;
        const t0 = performance.now();
        const anim = () => {
          const prog = Math.min((performance.now() - t0) / SHAPE_DURATION, 1);
          const len = prog * perim;
          ctx.lineCap = "round";
          ctx.beginPath();
          // Trace pill path progressively
          let rem = len;
          // Top edge (left to right)
          const topW = pw - 2 * rr;
          if (rem > 0) {
            const seg = Math.min(rem, topW);
            ctx.moveTo(left + rr, top);
            ctx.lineTo(left + rr + seg, top);
            rem -= seg;
          }
          // Right arc
          if (rem > 0) {
            const arcLen = Math.PI * rr;
            const seg = Math.min(rem, arcLen);
            const ang = (seg / arcLen) * Math.PI;
            ctx.arc(left + pw - rr, top + rr, rr, -Math.PI / 2, -Math.PI / 2 + ang);
            rem -= seg;
          }
          // Bottom edge (right to left)
          if (rem > 0) {
            const seg = Math.min(rem, topW);
            ctx.lineTo(left + pw - rr - seg, top + ph);
            rem -= seg;
          }
          // Left arc
          if (rem > 0) {
            const arcLen = Math.PI * rr;
            const seg = Math.min(rem, arcLen);
            const ang = (seg / arcLen) * Math.PI;
            ctx.arc(left + rr, top + rr, rr, Math.PI / 2, Math.PI / 2 + ang);
          }
          markerStroke(ctx, color, w);
          prog < 1 ? requestAnimationFrame(anim) : resolve();
        };
        requestAnimationFrame(anim);
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
        const label = `Step ${p.step as number}`;
        ctx.font = `bold 22px ${FONT}`;
        let i = 0;
        const tick = () => {
          if (i >= label.length) { resolve(); return; }
          const xOff = ctx.measureText(label.slice(0, i)).width;
          markerText(ctx, label[i], sx + xOff, sy, STEP_LABEL_COLOR, 22, true);
          setCursor({ x: sx + xOff + ctx.measureText(label[i]).width, y: sy - 12, show: true, color: STEP_LABEL_COLOR });
          i++;
          setTimeout(tick, 28);
        };
        // Draw wavy underline below step label
        const fullW = ctx.measureText(label).width;
        drawWavyLine(ctx, sx, sy + 8, sx + fullW, sy + 8, "rgba(94,234,212,0.3)", 1.5);
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

        if (label) {
          drawGraphLabel(ctx, label, gx, gy, gw, sc);
        }
        drawGraphAxes(ctx, gx, gy, gw, gh, xMin, xMax, yMin, yMax);

        // Animate curve
        const mapX = (v: number) => gx + ((v - xMin) / (xMax - xMin)) * gw;
        const mapY = (v: number) => gy + gh - ((v - yMin) / (yMax - yMin)) * gh;
        const SAMPLES = 300;
        const dx = (xMax - xMin) / SAMPLES;
        const CURVE_DURATION = 2000;
        const t0 = performance.now();

        const points: { px: number; py: number; valid: boolean }[] = [];
        for (let si = 0; si <= SAMPLES; si++) {
          const xv = xMin + si * dx;
          const yv = evalMathFn(fn, xv);
          const valid = !isNaN(yv) && yv >= yMin - 5 && yv <= yMax + 5;
          points.push({ px: valid ? mapX(xv) : 0, py: valid ? mapY(yv) : 0, valid });
        }

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
          markerStroke(ctx, sc, 2.5);

          if (points[targetIdx]?.valid) {
            setCursor({ x: points[targetIdx].px, y: points[targetIdx].py, show: true, color: sc });
          }

          lastDrawn = targetIdx;
          if (progress < 1) {
            requestAnimationFrame(animStep);
          } else {
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

/* ═══ Animated line (clean, no glow) ═══ */

function animatedLine(
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

/* ═══ Instant draw (resize / replay) ═══ */

function drawInstant(
  ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand,
  dpr: number, step = 0,
) {
  const p = cmd.params;
  const sc = getStepColor(step);
  switch (cmd.action) {
    case "clear":
      break;
    case "draw_text":
      markerText(ctx, latexToHuman(p.text as string), p.x as number, p.y as number,
        TEXT_COLOR, (p.size as number) || 24);
      break;
    case "draw_latex":
      markerText(ctx, latexToHuman(p.latex as string), p.x as number, p.y as number,
        sc, (p.size as number) || 24);
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
    case "draw_circle": {
      const cx = p.x as number, cy = p.y as number;
      const pw = (p._pillW as number) || ((p.radius as number) || 30) * 2;
      const ph = (p._pillH as number) || ((p.radius as number) || 30) * 2;
      const rr = ph / 2;
      const left = cx - pw / 2, top = cy - ph / 2;
      ctx.beginPath();
      ctx.moveTo(left + rr, top);
      ctx.lineTo(left + pw - rr, top);
      ctx.arc(left + pw - rr, top + rr, rr, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(left + rr, top + ph);
      ctx.arc(left + rr, top + rr, rr, Math.PI / 2, -Math.PI / 2 + 2 * Math.PI);
      ctx.closePath();
      markerStroke(ctx, sc, (p.width as number) || 2);
      break;
    }
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
    case "step_marker":
      markerText(ctx, `Step ${p.step as number}`, p.x as number, p.y as number,
        STEP_LABEL_COLOR, 22, true);
      // Wavy underline
      ctx.font = `bold 22px ${FONT}`;
      drawWavyLine(ctx, p.x as number, (p.y as number) + 8,
        (p.x as number) + ctx.measureText(`Step ${p.step as number}`).width, (p.y as number) + 8,
        "rgba(94,234,212,0.3)", 1.5);
      break;
    case "question_header": {
      const qText = extractMath((p.text as string) || "");
      const label = (p._label as string) || "";
      const qX = (p._x as number) || 20;
      const qY = (p._y as number) || 22;
      const colWidth = (p._colWidth as number) || 320;
      // Label badge
      if (label) {
        ctx.font = `bold 15px ${FONT}`;
        const lw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(99,102,241,0.15)";
        ctx.beginPath();
        ctx.roundRect(qX, qY - 13, lw + 12, 20, 6);
        ctx.fill();
        markerText(ctx, label, qX + 6, qY + 2, "#818cf8", 15);
        // Math expression
        ctx.font = `24px ${FONT}`;
        markerText(ctx, qText, qX + lw + 20, qY + 2, TEXT_COLOR, 24);
      } else {
        ctx.font = `24px ${FONT}`;
        markerText(ctx, qText, qX, qY, TEXT_COLOR, 24);
      }
      // Underline
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

/* ═══ Background ═══ */

function clearBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  // Dot-grid pattern (graph-paper feel)
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
