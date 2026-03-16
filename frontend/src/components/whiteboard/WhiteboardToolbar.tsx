"use client";

/**
 * Floating toolbar for the whiteboard with hand-drawn style icons.
 */

import { useCallback } from "react";

interface WhiteboardToolbarProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onUndo?: () => void;
  onClear?: () => void;
  canUndo?: boolean;
  zoom: number;
  onZoomChange: (z: number | ((prev: number) => number)) => void;
}

export function WhiteboardToolbar({ canvasRef, containerRef, onUndo, onClear, canUndo, zoom, onZoomChange }: WhiteboardToolbarProps) {

  // Stitch all canvases in the container together to capture the full scrolling whiteboard
  const stitchCanvases = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const container = containerRef.current;
    if (!container) return null;
    
    const canvases = Array.from(container.querySelectorAll("canvas"));
    if (canvases.length === 0) return null;

    let totalHeight = 0;
    let maxWidth = 0;

    // Calculate dimensions
    canvases.forEach(c => {
      // The CSS size is typically half the internal buffer size (for Retina)
      // We export at the internal buffer scale for maximum resolution
      totalHeight += c.height;
      maxWidth = Math.max(maxWidth, c.width);
    });

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = maxWidth;
    exportCanvas.height = totalHeight;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return null;

    // Fill background solid color
    ctx.fillStyle = "#0F1117"; // var(--bg-base)
    ctx.fillRect(0, 0, maxWidth, totalHeight);

    let currentY = 0;
    canvases.forEach(c => {
      ctx.drawImage(c, 0, currentY, c.width, c.height);
      currentY += c.height;
    });

    return exportCanvas;
  }, [containerRef]);

  const handleScreenshot = useCallback(async () => {
    const canvas = await stitchCanvases();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `mathboard-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [stitchCanvases]);

  const handlePDF = useCallback(async () => {
    const canvas = await stitchCanvases();
    if (!canvas) return;
    const { jsPDF } = await import("jspdf");
    const imgData = canvas.toDataURL("image/png");
    const cw = canvas.width, ch = canvas.height;
    const landscape = cw > ch;
    const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "px", format: [cw, ch] });
    pdf.addImage(imgData, "PNG", 0, 0, cw, ch);
    pdf.save(`mathboard-${Date.now()}.pdf`);
  }, [stitchCanvases]);

  const handleCopyImage = useCallback(async () => {
    const canvas = await stitchCanvases();
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      }
    } catch { /* clipboard API may not be available */ }
  }, [stitchCanvases]);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, [containerRef]);

  const handleZoom = useCallback((dir: 1 | -1) => {
    onZoomChange((prev: number) => Math.max(0.25, Math.min(3, prev + dir * 0.25)));
  }, [onZoomChange]);

  return (
    <div
      className="flex items-center gap-0.5 rounded-xl px-2 py-1"
      style={{
        background: "rgba(148,163,184,0.06)",
        border: "1px solid rgba(148,163,184,0.08)",
      }}
    >
      {/* Single shared SVG filter definition — avoids duplicate id="sketch" per icon */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id="sketch">
            <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="3" result="noise" seed="2" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      {onUndo && (
        <ToolBtn title="Undo last" onClick={onUndo} disabled={!canUndo}>
          <SketchIcon d="M16 8l-6 6 6 6M10 14h11" />
        </ToolBtn>
      )}
      {onClear && (
        <ToolBtn title="Clear board" onClick={onClear}>
          <SketchIcon d="M4 6h16M6 6v12a2 2 0 002 2h8a2 2 0 002-2V6M9 6V4h6v2" />
        </ToolBtn>
      )}
      {(onUndo || onClear) && <Sep />}
      <ToolBtn title="Copy board" onClick={handleCopyImage}>
        <SketchIcon d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-2M16 4h2a2 2 0 012 2v2M8 4a2 2 0 012-2h4a2 2 0 012 2" />
      </ToolBtn>
      <ToolBtn title="Save image" onClick={handleScreenshot}>
        <SketchIcon d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12M8 12l4 4 4-4" />
      </ToolBtn>
      <ToolBtn title="Export PDF" onClick={handlePDF}>
        <SketchIcon d="M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zM14 2v6h6M9 13h6M9 17h4" />
      </ToolBtn>
      <Sep />
      <ToolBtn title="Zoom out" onClick={() => handleZoom(-1)}>
        <SketchIcon d="M11 3a8 8 0 100 16 8 8 0 000-16zM21 21l-4-4M8 11h6" />
      </ToolBtn>
      <span className="text-[10px] min-w-[32px] text-center font-mono" style={{ color: "var(--text-muted)" }}>{Math.round(zoom * 100)}%</span>
      <ToolBtn title="Zoom in" onClick={() => handleZoom(1)}>
        <SketchIcon d="M11 3a8 8 0 100 16 8 8 0 000-16zM21 21l-4-4M8 11h6M11 8v6" />
      </ToolBtn>
      <ToolBtn title="Fullscreen" onClick={handleFullscreen}>
        <SketchIcon d="M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5M4 9V4h5M15 4h5v5M4 15v5h5M15 20h5v-5" />
      </ToolBtn>
    </div>
  );
}

/** Hand-drawn style SVG icon using a sketchy stroke */
function SketchIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ filter: "url(#sketch)" }}
    >
      <path d={d} />
    </svg>
  );
}

function ToolBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 md:h-7 md:w-7 items-center justify-center rounded-lg text-sm transition-all hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="h-4 w-px mx-0.5" style={{ background: "rgba(148,163,184,0.12)" }} />;
}
