"use client";

/**
 * Animated owl teacher mascot that sits in the bottom-right corner of the whiteboard.
 * States: idle (floating), talking (mouth moves), thinking (dots), writing (wing extended).
 * Pure SVG + CSS keyframe animations — no libraries.
 */

import { useEffect, useState } from "react";

export type MascotState = "idle" | "talking" | "thinking" | "writing";

interface TeacherMascotProps {
  state: MascotState;
}

export function TeacherMascot({ state }: TeacherMascotProps) {
  const [mouthOpen, setMouthOpen] = useState(false);

  // Animate mouth when talking
  useEffect(() => {
    if (state !== "talking") { setMouthOpen(false); return; }
    const id = setInterval(() => setMouthOpen(v => !v), 180);
    return () => clearInterval(id);
  }, [state]);

  return (
    <div
      className="pointer-events-none absolute bottom-4 right-4 z-20"
      style={{ animation: state === "idle" || state === "thinking" ? "mascotFloat 3s ease-in-out infinite" : undefined }}
    >
      <svg width="80" height="90" viewBox="0 0 80 90" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ filter: "drop-shadow(0 0 12px rgba(0,229,255,0.3))" }}>

        {/* Body */}
        <ellipse cx="40" cy="58" rx="26" ry="28" fill="#1a2744" stroke="#2d4a7a" strokeWidth="1.5" />

        {/* Belly */}
        <ellipse cx="40" cy="64" rx="16" ry="18" fill="#0f1d35" opacity="0.6" />

        {/* Left wing */}
        <ellipse
          cx="14" cy="50" rx="10" ry="18" fill="#1a2744" stroke="#2d4a7a" strokeWidth="1"
          style={{
            transformOrigin: "24px 50px",
            animation: state === "writing" ? "wingWave 0.8s ease-in-out infinite" : undefined,
          }}
        />

        {/* Right wing */}
        <ellipse
          cx="66" cy="50" rx="10" ry="18" fill="#1a2744" stroke="#2d4a7a" strokeWidth="1"
          style={{
            transformOrigin: "56px 50px",
            animation: state === "writing" ? "wingPoint 1s ease-in-out infinite" : undefined,
          }}
        />

        {/* Head */}
        <circle cx="40" cy="28" r="22" fill="#1e3050" stroke="#2d4a7a" strokeWidth="1.5" />

        {/* Ear tufts */}
        <path d="M22 12 L26 22 L18 20 Z" fill="#1e3050" stroke="#2d4a7a" strokeWidth="1" />
        <path d="M58 12 L54 22 L62 20 Z" fill="#1e3050" stroke="#2d4a7a" strokeWidth="1" />

        {/* Eye sockets */}
        <circle cx="32" cy="26" r="9" fill="#0a1628" />
        <circle cx="48" cy="26" r="9" fill="#0a1628" />

        {/* Eyes - glow */}
        <circle cx="32" cy="26" r="5" fill="#00e5ff" opacity="0.9">
          <animate attributeName="r" values="5;4.5;5" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="48" cy="26" r="5" fill="#00e5ff" opacity="0.9">
          <animate attributeName="r" values="5;4.5;5" dur="2s" repeatCount="indefinite" />
        </circle>

        {/* Pupils */}
        <circle cx="33" cy="25" r="2" fill="#060a10" />
        <circle cx="49" cy="25" r="2" fill="#060a10" />

        {/* Eye highlights */}
        <circle cx="34" cy="24" r="1" fill="#ffffff" opacity="0.8" />
        <circle cx="50" cy="24" r="1" fill="#ffffff" opacity="0.8" />

        {/* Glasses */}
        <rect x="22" y="18" width="16" height="14" rx="3" fill="none" stroke="#64748b" strokeWidth="1.2" />
        <rect x="42" y="18" width="16" height="14" rx="3" fill="none" stroke="#64748b" strokeWidth="1.2" />
        <line x1="38" y1="24" x2="42" y2="24" stroke="#64748b" strokeWidth="1" />

        {/* Beak / mouth */}
        {mouthOpen ? (
          <>
            <path d="M36 34 L40 37 L44 34" fill="#f59e0b" stroke="#d97706" strokeWidth="0.8" />
            <path d="M36 34 L40 31 L44 34" fill="#fbbf24" stroke="#d97706" strokeWidth="0.8" />
          </>
        ) : (
          <path d="M36 33 L40 36 L44 33" fill="#fbbf24" stroke="#d97706" strokeWidth="0.8" />
        )}

        {/* Graduation cap */}
        <polygon points="22,10 40,2 58,10 40,18" fill="#334155" stroke="#475569" strokeWidth="1" />
        <rect x="38" y="2" width="4" height="2" rx="1" fill="#475569" />
        <line x1="56" y1="10" x2="60" y2="18" stroke="#475569" strokeWidth="1.2" />
        <circle cx="60" cy="19" r="2" fill="#fbbf24" />

        {/* Feet */}
        <ellipse cx="32" cy="86" rx="6" ry="3" fill="#f59e0b" opacity="0.8" />
        <ellipse cx="48" cy="86" rx="6" ry="3" fill="#f59e0b" opacity="0.8" />
      </svg>

      {/* Thinking dots */}
      {state === "thinking" && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      )}

      {/* State label */}
      <div className="mt-1 text-center text-[9px] font-medium tracking-wider text-cyan-600/60 uppercase">
        {state === "talking" && "explaining"}
        {state === "writing" && "drawing"}
        {state === "thinking" && "thinking..."}
      </div>
    </div>
  );
}
