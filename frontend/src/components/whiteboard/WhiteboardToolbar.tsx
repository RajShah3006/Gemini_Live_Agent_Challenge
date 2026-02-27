"use client";

/**
 * Floating toolbar for the whiteboard: screenshot, fullscreen, zoom.
 */

import { useCallback, useState } from "react";

interface WhiteboardToolbarProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function WhiteboardToolbar({ canvasRef, containerRef }: WhiteboardToolbarProps) {
  const [zoom, setZoom] = useState(1);

  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `mathboard-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [canvasRef]);

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
    setZoom(prev => {
      const next = Math.max(0.5, Math.min(2, prev + dir * 0.25));
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.transform = `scale(${next})`;
        canvas.style.transformOrigin = "top left";
      }
      return next;
    });
  }, [canvasRef]);

  return (
    <div
      className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg px-1.5 py-1"
      style={{
        background: "rgba(10,15,30,0.65)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--border)",
      }}
    >
      <ToolBtn title="Screenshot" onClick={handleScreenshot}>📸</ToolBtn>
      <ToolBtn title="Zoom out" onClick={() => handleZoom(-1)}>−</ToolBtn>
      <span className="text-[10px] min-w-[32px] text-center" style={{ color: "var(--text-muted)" }}>{Math.round(zoom * 100)}%</span>
      <ToolBtn title="Zoom in" onClick={() => handleZoom(1)}>+</ToolBtn>
      <ToolBtn title="Fullscreen" onClick={handleFullscreen}>⛶</ToolBtn>
    </div>
  );
}

function ToolBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-white/10"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}
