"use client";

import { useEffect, useRef } from "react";
import type { WhiteboardCommand } from "@/lib/types";

interface WhiteboardProps {
  commands: WhiteboardCommand[];
}

export function Whiteboard({ commands }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Process only new commands
    const newCommands = commands.slice(processedRef.current);
    for (const cmd of newCommands) {
      renderCommand(ctx, cmd, canvas);
    }
    processedRef.current = commands.length;
  }, [commands]);

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      // Re-render all commands after resize
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, canvas.width, canvas.height);
      for (const cmd of commands) {
        renderCommand(ctx, cmd, canvas);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [commands]);

  return (
    <div className="relative flex-1 bg-gray-950">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
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

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = step; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = step; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function renderCommand(
  ctx: CanvasRenderingContext2D,
  cmd: WhiteboardCommand,
  canvas: HTMLCanvasElement,
) {
  const p = cmd.params;
  switch (cmd.action) {
    case "clear":
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, canvas.width, canvas.height);
      break;

    case "draw_text":
      ctx.fillStyle = (p.color as string) || "#e2e8f0";
      ctx.font = `${(p.size as number) || 18}px monospace`;
      ctx.fillText(
        p.text as string,
        p.x as number,
        p.y as number,
      );
      break;

    case "draw_latex":
      // Render LaTeX as text for now — KaTeX canvas rendering in Phase 3
      ctx.fillStyle = (p.color as string) || "#a5f3fc";
      ctx.font = `${(p.size as number) || 22}px serif`;
      ctx.fillText(
        p.latex as string,
        p.x as number,
        p.y as number,
      );
      break;

    case "draw_line":
      ctx.strokeStyle = (p.color as string) || "#94a3b8";
      ctx.lineWidth = (p.width as number) || 2;
      ctx.beginPath();
      ctx.moveTo(p.x1 as number, p.y1 as number);
      ctx.lineTo(p.x2 as number, p.y2 as number);
      ctx.stroke();
      break;

    case "draw_arrow": {
      const x1 = p.x1 as number,
        y1 = p.y1 as number,
        x2 = p.x2 as number,
        y2 = p.y2 as number;
      ctx.strokeStyle = (p.color as string) || "#94a3b8";
      ctx.lineWidth = (p.width as number) || 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Arrowhead
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 12;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }

    case "draw_circle":
      ctx.strokeStyle = (p.color as string) || "#94a3b8";
      ctx.lineWidth = (p.width as number) || 2;
      ctx.beginPath();
      ctx.arc(
        p.cx as number,
        p.cy as number,
        p.r as number,
        0,
        2 * Math.PI,
      );
      ctx.stroke();
      break;

    case "draw_rect":
      ctx.strokeStyle = (p.color as string) || "#94a3b8";
      ctx.lineWidth = (p.width as number) || 2;
      ctx.strokeRect(
        p.x as number,
        p.y as number,
        p.w as number,
        p.h as number,
      );
      break;

    case "highlight":
      ctx.fillStyle = (p.color as string) || "rgba(250,204,21,0.15)";
      ctx.fillRect(
        p.x as number,
        p.y as number,
        p.w as number,
        p.h as number,
      );
      break;

    case "step_marker":
      ctx.fillStyle = "#10b981";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(
        `Step ${p.step as number}`,
        p.x as number,
        p.y as number,
      );
      break;
  }
}
