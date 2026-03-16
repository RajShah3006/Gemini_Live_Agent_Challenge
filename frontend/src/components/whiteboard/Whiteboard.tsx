"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WhiteboardCommand } from "@/lib/types";
import { WritingHand } from "./WritingHand";
import { TeacherMascot, type MascotState } from "./TeacherMascot";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { GraphPresets } from "./GraphPresets";
import {
  clearBoard,
  markerText,
  markerStroke,
  drawWavyLine,
  getStepColor,
  evalMathFn,
  drawGraphAxes,
  drawGraphCurve,
  drawGraphLabel,
  animatedLine,
  animateCmd,
  drawInstant,
  type SetCursor,
} from "./whiteboard-helpers";

/* ── Lightboard Config ──────────────────────── */
const CHAR_DELAY = 38;
const LINE_DURATION = 500;
const PAUSE_BETWEEN = 250;
const SHAPE_DURATION = 400;
const BG = "#0b1120";
const GRID = "rgba(255,255,255,0.025)";
const FONT = "'Single Day', 'Segoe Script', cursive";
const CONTENT_SIZE = 24;  // single font size for all board content
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
  voiceCommand?: { cmd: string; arg?: string } | null;
  scrollToLabel?: string | null;
}

/* ── Section = one response block on the board ── */
interface Section {
  idx: number;
  label: string;         // "Q1", "Q2", "↪ follow-up"
  isNewQuestion: boolean; // true = show divider, false = just spacing
  yStart: number;        // absolute y where this section begins on the canvas
  col: number;           // grid column index
  row: number;           // grid row index
  xOffset: number;       // px to add to x coordinates for this column
  questionText?: string; // the user's original question text
}

export interface QuestionInfo {
  label: string;  // "Q1", "Q2"
  text: string;   // truncated question text
  stepCount?: number; // number of steps in the response
  idx: number;    // section index for scrolling
  yStart: number;
}

const FOLLOWUP_GAP = 14;       // tight gap between steps within a question

export function Whiteboard({ commands, isSpeaking = false, isThinking = false, onQuestionsChange, toolbarPortalRef, voiceCommand }: WhiteboardProps) {
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

  // ── Excel-style grid layout ──
  // Each question (cell) has a row + column. Column widths and row heights are
  // determined by the largest cell in that column/row respectively.
  const CELL_PAD = 20;          // padding inside each cell
  const CELL_GAP = 24;          // gap between cells
  const CELL_MIN_W = 280;       // minimum cell width
  // gridColWidths[c] = width of grid column c (widest cell content)
  const gridColWidthsRef = useRef<number[]>([]);
  // gridRowHeights[r] = height of grid row r (tallest cell content)
  const gridRowHeightsRef = useRef<number[]>([]);
  // Per-cell measured content dimensions (indexed by section idx)
  const cellContentWRef = useRef<number[]>([]);   // per-section content width
  const cellContentHRef = useRef<number[]>([]);   // per-section content height
  const currentColRef = useRef(0);
  const currentRowRef = useRef(0);
  const xOffsetRef = useRef(0);

  // Derive mascot state
  const mascotState: MascotState = isDrawing ? "writing" : isSpeaking ? "talking" : isThinking ? "thinking" : "idle";

  /** Compute x offset for a grid column (sum of previous column widths + gaps) */
  function gridColX(col: number): number {
    let x = 0;
    for (let c = 0; c < col; c++) {
      x += (gridColWidthsRef.current[c] || CELL_MIN_W) + CELL_GAP;
    }
    return x;
  }

  /** Compute y offset for a grid row (sum of previous row heights + gaps) */
  function gridRowY(row: number): number {
    let y = 0;
    for (let r = 0; r < row; r++) {
      y += (gridRowHeightsRef.current[r] || 0) + CELL_GAP;
    }
    return y;
  }

  /** Measure the max x extent (absolute) of a rendered command */
  function measureCommandMaxX(ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand): number {
    const p = cmd.params;
    switch (cmd.action) {
      case "draw_text":
        ctx.font = `${CONTENT_SIZE}px ${FONT}`;
        return (p.x as number) + ctx.measureText(latexToHuman((p.text as string) || "")).width;
      case "draw_latex":
        ctx.font = `${CONTENT_SIZE}px ${FONT}`;
        return (p.x as number) + ctx.measureText(latexToHuman((p.latex as string) || "")).width;
      case "draw_graph":
        return (p.x as number) + ((p.width as number) || 500);
      case "draw_line":
        return Math.max((p.x1 as number) || 0, (p.x2 as number) || 0);
      case "step_marker": {
        const sx = (p.x as number) || 20;
        ctx.font = `bold ${CONTENT_SIZE}px ${FONT}`;
        return sx + ctx.measureText(`Step ${p.step}`).width + 40;
      }
      case "draw_circle":
        return (p.x as number) + ((p.radius as number) || 30);
      default:
        return 0;
    }
  }

  /** Track a command's dimensions and update the grid column/row sizes */
  function trackCellSize(ctx: CanvasRenderingContext2D, cmd: WhiteboardCommand) {
    const secIdx = cmd._sectionIdx;
    if (secIdx === undefined) return;
    const sec = sectionsRef.current[secIdx];
    if (!sec) return;
    const { col, row, xOffset } = sec;

    // Track width
    const maxX = measureCommandMaxX(ctx, cmd);
    if (maxX > 0) {
      const contentW = maxX - xOffset + CELL_PAD;
      if (contentW > (cellContentWRef.current[secIdx] || 0)) {
        cellContentWRef.current[secIdx] = contentW;
        // Update grid column width if this cell is the widest
        const colW = Math.max(contentW, CELL_MIN_W);
        if (colW > (gridColWidthsRef.current[col] || 0)) {
          gridColWidthsRef.current[col] = colW;
        }
      }
    }

    // Track height
    const cmdY = getCommandY(cmd);
    if (cmdY > 0) {
      const cellH = cmdY - sec.yStart + 40; // 40px bottom padding
      if (cellH > (cellContentHRef.current[secIdx] || 0)) {
        cellContentHRef.current[secIdx] = cellH;
        // Update grid row height if this cell is the tallest
        if (cellH > (gridRowHeightsRef.current[row] || 0)) {
          gridRowHeightsRef.current[row] = cellH;
        }
      }
    }

    // Grow canvas if needed
    const totalH = gridRowY(gridRowHeightsRef.current.length);
    if (totalH > maxYRef.current) {
      maxYRef.current = totalH;
      resizeCanvas();
    }
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    // Column layout uses the 100% zoom viewport (zoom=1 → scale 0.5 → 2× container width)
    // so more columns fit. At 200% (default) the user scrolls; at 100% everything is visible.
    const w = container.clientWidth * 2;
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
    // Draw chalk column dividers at grid column boundaries
    const numGridCols = gridColWidthsRef.current.length;
    if (numGridCols > 1) {
      for (let c = 1; c < numGridCols; c++) {
        const cx = gridColX(c) - CELL_GAP / 2;
        drawWavyLine(ctx, cx, 20, cx, h - 20, "rgba(148,163,184,0.08)", 0.8);
      }
    }
    // Redraw all completed commands (update dynamic colWidth on headers)
    completedRef.current.forEach(c => {
      if (c.action === "question_header") {
        const sIdx = c._sectionIdx ?? 0;
        const secCol = sectionsRef.current[sIdx]?.col ?? 0;
        c.params._colWidth = Math.max(gridColWidthsRef.current[secCol] || CELL_MIN_W, CELL_MIN_W);
      }
      const step = c._step || 0;
      drawInstant(ctx, c, dpr, step);
    });
  }

  /**
   * Start a new layout section using Excel-style grid placement.
   * New questions fill left→right in the current row, wrapping to a new row when full.
   * Follow-ups stay in the same cell (same row/col), extending vertically.
   */
  function startNewSection(isNewQuestion: boolean) {
    const sectionIdx = sectionsRef.current.length;

    let col: number;
    let row: number;
    let xOffset: number;
    let yStart: number;

    if (isNewQuestion) {
      questionCountRef.current += 1;

      if (sectionIdx === 0) {
        // Very first question → row 0, col 0
        row = 0;
        col = 0;
        if (gridColWidthsRef.current.length === 0) gridColWidthsRef.current.push(CELL_MIN_W);
        if (gridRowHeightsRef.current.length === 0) gridRowHeightsRef.current.push(0);
      } else {
        // Try next column in the current row
        const nextCol = currentColRef.current + 1;
        const nextColX = gridColX(nextCol);
        const hasRoom = nextColX + CELL_MIN_W <= viewWidthRef.current;

        if (hasRoom) {
          row = currentRowRef.current;
          col = nextCol;
          while (gridColWidthsRef.current.length <= col) gridColWidthsRef.current.push(CELL_MIN_W);
        } else {
          // No room → wrap to new row, column 0
          row = currentRowRef.current + 1;
          col = 0;
          while (gridRowHeightsRef.current.length <= row) gridRowHeightsRef.current.push(0);
        }
      }

      xOffset = gridColX(col);
      yStart = gridRowY(row);
    } else {
      // Follow-up → same cell, extend below last content in that cell
      col = currentColRef.current;
      row = currentRowRef.current;
      xOffset = gridColX(col);
      // Find the last section in this cell (same col & row)
      let lastCellH = 0;
      for (let i = sectionIdx - 1; i >= 0; i--) {
        const s = sectionsRef.current[i];
        if (s.col === col && s.row === row) {
          lastCellH = cellContentHRef.current[i] || 0;
          break;
        }
      }
      yStart = gridRowY(row) + lastCellH + FOLLOWUP_GAP;
    }

    currentColRef.current = col;
    currentRowRef.current = row;
    xOffsetRef.current = xOffset;

    const label = isNewQuestion ? `Q${questionCountRef.current}` : `↪ Q${questionCountRef.current}`;
    const section: Section = { idx: sectionIdx, label, isNewQuestion, yStart, col, row, xOffset };
    sectionsRef.current.push(section);
    setSections([...sectionsRef.current]);

    yOffsetRef.current = yStart;
    currentStepRef.current = 0;
    sectionStartedRef.current = true;
    // Initialize cell content tracking
    while (cellContentWRef.current.length <= sectionIdx) cellContentWRef.current.push(0);
    while (cellContentHRef.current.length <= sectionIdx) cellContentHRef.current.push(0);
  }

  function autoScroll(y: number, x?: number) {
    const container = containerRef.current;
    if (!container) return;
    const scale = zoomRef.current / 2;
    // Vertical
    const viewH = container.clientHeight;
    const scaledY = y * scale;
    const targetTop = scaledY - viewH + 120;
    // Horizontal
    const viewW = container.clientWidth;
    const scaledX = (x ?? 0) * scale;
    const targetLeft = scaledX - viewW + 200;
    const needsY = targetTop > container.scrollTop;
    const needsX = x !== undefined && targetLeft > container.scrollLeft;
    if (needsY || needsX) {
      container.scrollTo({
        top: needsY ? targetTop : container.scrollTop,
        left: needsX ? targetLeft : container.scrollLeft,
        behavior: "smooth",
      });
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
          currentColRef.current = 0;
          currentRowRef.current = 0;
          xOffsetRef.current = 0;
          gridColWidthsRef.current = [];
          gridRowHeightsRef.current = [];
          cellContentWRef.current = [];
          cellContentHRef.current = [];
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

        // Detect follow-up: "[Q1] explain more" or short conversational queries
        const qRef = rawText.match(/^\[Q(\d+)\]/i);
        let isFollowUp = false;
        let parentSection: Section | undefined;

        if (qRef) {
          // Explicit follow-up like "[Q1] explain more"
          const refNum = parseInt(qRef[1], 10);
          parentSection = sectionsRef.current.find(
            s => s.isNewQuestion && s.label === `Q${refNum}`
          );
          if (parentSection) isFollowUp = true;
        } else if (sectionsRef.current.length > 0) {
          // Heuristic: short queries without math symbols are likely follow-ups
          const trimmed = rawText.trim();
          const looksLikeFollowUp =
            trimmed.length < 60 &&
            !/[0-9]{2,}|[+\-*/^=∫∑∏√]|\\frac|derivative|integral|solve|graph|plot/i.test(trimmed) &&
            /^(why|how|what|explain|elaborate|more|detail|show|can you|could you|tell me|again|huh|isn.t|doesn.t|but|and|also|wait|so|really|isn.t that|what about|what if)/i.test(trimmed);
          if (looksLikeFollowUp) {
            // Follow up on the most recent question
            for (let i = sectionsRef.current.length - 1; i >= 0; i--) {
              if (sectionsRef.current[i].isNewQuestion) {
                parentSection = sectionsRef.current[i];
                isFollowUp = true;
                break;
              }
            }
          }
        }

        if (isFollowUp && parentSection) {
          // Jump to the parent question's cell before creating follow-up section
          currentColRef.current = parentSection.col;
          currentRowRef.current = parentSection.row;
          startNewSection(false);
        } else {
          startNewSection(true);
        }
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
        ctx.font = `${CONTENT_SIZE}px ${FONT}`;
        markerText(ctx, qText, qX + lw + 20, qY + 2, TEXT_COLOR, CONTENT_SIZE);

        // Subtle underline across column width
        const colWidth = Math.max(gridColWidthsRef.current[section.col] || 0, CELL_MIN_W);
        ctx.beginPath();
        ctx.moveTo(qX, qY + 12);
        ctx.lineTo(qX + colWidth - 40, qY + 12);
        markerStroke(ctx, "rgba(148,163,184,0.15)", 1);

        // Track initial header content width in grid
        ctx.font = `${CONTENT_SIZE}px ${FONT}`;
        const headerMaxX = qX + lw + 20 + ctx.measureText(qText).width;
        const headerContentW = headerMaxX - (section.xOffset || 0) + CELL_PAD;
        cellContentWRef.current[section.idx] = Math.max(headerContentW, CELL_MIN_W);
        if (headerContentW > (gridColWidthsRef.current[section.col] || 0)) {
          gridColWidthsRef.current[section.col] = Math.max(headerContentW, CELL_MIN_W);
        }

        // Track cell height
        const headerH = 60;
        cellContentHRef.current[section.idx] = headerH;
        if (headerH > (gridRowHeightsRef.current[section.row] || 0)) {
          gridRowHeightsRef.current[section.row] = headerH;
        }

        // Grow canvas if needed
        const totalH = gridRowY(gridRowHeightsRef.current.length);
        if (totalH > maxYRef.current) {
          maxYRef.current = totalH;
          resizeCanvas();
        }
        autoScroll(qY + 20, qX);
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

      // Student answer → continue on the SAME section (AI asked a question)
      if (cmd.action === "student_answer") {
        const rawText = (cmd.params.text as string) || "";
        const section = sectionsRef.current[sectionsRef.current.length - 1];
        if (section && ctx) {
          const col = section.col;
          const row = section.row;
          const colX = gridColX(col);
          const rowY = gridRowY(row);
          const sepY = rowY + yOffsetRef.current + 16;

          ctx.save();
          ctx.font = "bold 14px 'Inter', sans-serif";
          ctx.fillStyle = "#94a3b8";
          ctx.fillText(`💬 Student: ${rawText}`, colX + 30, sepY);
          ctx.restore();

          yOffsetRef.current += 36;
          const totalH = rowY + yOffsetRef.current;
          if (totalH > maxYRef.current) {
            maxYRef.current = totalH;
            resizeCanvas();
          }

          // Store for redraw
          const answerCmd: WhiteboardCommand = {
            ...cmd,
            params: { ...cmd.params, _x: colX + 30, _y: sepY },
            _step: 0,
            _sectionIdx: section.idx,
          };
          completedRef.current.push(answerCmd);
        }
        continue;
      }

      // All other commands → apply section offsets and draw
      const section = sectionsRef.current[sectionsRef.current.length - 1];
      const sxOff = section ? section.xOffset : 0;
      const syOff = yOffsetRef.current;
      const offsetCmd: WhiteboardCommand = {
        ...cmd,
        params: { ...cmd.params },
        _sectionIdx: section?.idx,
      };
      // Offset x/y for grid layout
      if (typeof offsetCmd.params.x === "number") offsetCmd.params.x += sxOff;
      if (typeof offsetCmd.params.y === "number") offsetCmd.params.y += syOff;
      if (typeof offsetCmd.params.x1 === "number") offsetCmd.params.x1 += sxOff;
      if (typeof offsetCmd.params.y1 === "number") offsetCmd.params.y1 += syOff;
      if (typeof offsetCmd.params.x2 === "number") offsetCmd.params.x2 += sxOff;
      if (typeof offsetCmd.params.y2 === "number") offsetCmd.params.y2 += syOff;

      // Track cell dimensions and grow canvas
      trackCellSize(ctx, offsetCmd);
      const cmdY = getCommandY(offsetCmd);
      const cmdX = (offsetCmd.params.x as number) ?? (offsetCmd.params.x1 as number) ?? 0;
      if (cmdY > 0) autoScroll(cmdY, cmdX);
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
    currentColRef.current = 0;
    currentRowRef.current = 0;
    xOffsetRef.current = 0;
    gridColWidthsRef.current = [];
    gridRowHeightsRef.current = [];
    cellContentWRef.current = [];
    cellContentHRef.current = [];
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

  // ── Voice command handler ──
  useEffect(() => {
    if (!voiceCommand) return;
    const { cmd, arg } = voiceCommand;
    switch (cmd) {
      case "clear":
        handleClear();
        break;
      case "zoom_in":
        setZoom(prev => Math.min(3, prev + 0.25));
        break;
      case "zoom_out":
        setZoom(prev => Math.max(0.25, prev - 0.25));
        break;
      case "goto_q": {
        const qNum = parseInt(arg || "1", 10);
        const sec = sectionsRef.current.find(
          s => s.isNewQuestion && s.label === `Q${qNum}`
        );
        if (sec && containerRef.current) {
          const scale = zoomRef.current / 2;
          containerRef.current.scrollTo({
            top: sec.yStart * scale - 40,
            left: sec.xOffset * scale,
            behavior: "smooth",
          });
        }
        break;
      }
      case "undo":
        // Remove last command
        break;
    }
  }, [voiceCommand]);

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
    const r = (p.radius as number) || 30;
    return (p.y as number) + r;
  }
  if (p.y !== undefined) {
    if (cmd.action === "draw_graph") return (p.y as number) + ((p.height as number) || 350);
    return p.y as number;
  }
  if (p.y1 !== undefined) return Math.max(p.y1 as number, p.y2 as number);
  return 0;
}

