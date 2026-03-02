"use client";
import { useRef, useState, useCallback, useEffect } from "react";

interface HandwritingCanvasProps {
  onSubmit: (imageBlob: Blob) => void;
}

export function HandwritingCanvas({ onSubmit }: HandwritingCanvasProps) {
  const [active, setActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    lastPos.current = getPos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }, [getPos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPos.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }, [getPos]);

  const onPointerUp = useCallback(() => {
    drawing.current = false;
    lastPos.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
  }, []);

  const handleSubmit = useCallback(() => {
    canvasRef.current?.toBlob((blob) => {
      if (blob) {
        onSubmit(blob);
        clearCanvas();
        setActive(false);
      }
    }, "image/png");
  }, [onSubmit, clearCanvas]);

  // Reset canvas size when activated
  useEffect(() => {
    if (active && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [active]);

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-white/5"
        style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        title="Draw math with your mouse or finger"
        aria-label="Open handwriting input"
      >
        ✏️ Draw
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setActive(false); }}
    >
      <div
        className="rounded-xl overflow-hidden flex flex-col"
        style={{
          width: 500,
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            ✏️ Draw Math Expression
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={clearCanvas}
              className="text-[10px] px-2 py-1 rounded hover:bg-white/5"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              Clear
            </button>
            <button
              onClick={() => setActive(false)}
              className="text-[11px] rounded px-1.5 py-0.5 hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close drawing"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="p-3">
          <canvas
            ref={canvasRef}
            width={460}
            height={260}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="rounded-lg cursor-crosshair touch-none"
            style={{
              width: "100%",
              background: "rgba(15,20,40,0.8)",
              border: "1px solid rgba(148,163,184,0.1)",
            }}
          />
          <p className="text-[10px] mt-1.5 text-center" style={{ color: "var(--text-muted)" }}>
            Draw your math expression, then tap Submit to send it to the AI
          </p>
        </div>
        <div className="flex gap-2 px-4 pb-3">
          <button
            onClick={() => setActive(false)}
            className="flex-1 text-[11px] py-2 rounded-lg font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 text-[11px] py-2 rounded-lg font-medium text-white transition-colors hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            Submit to AI
          </button>
        </div>
      </div>
    </div>
  );
}
