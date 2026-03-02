"use client";

/**
 * Owl mascot — small corner badge. Reacts with a subtle tilt/blink
 * when new answers arrive (writing state).
 */

import { useEffect, useState } from "react";

export type MascotState = "idle" | "talking" | "thinking" | "writing";

interface TeacherMascotProps {
  state: MascotState;
}

export function TeacherMascot({ state }: TeacherMascotProps) {
  const [mouthOpen, setMouthOpen] = useState(false);
  const [reacting, setReacting] = useState(false);

  useEffect(() => {
    if (state !== "talking") { setMouthOpen(false); return; }
    const id = setInterval(() => setMouthOpen(v => !v), 180);
    return () => clearInterval(id);
  }, [state]);

  // Trigger a brief reaction when entering "writing" state
  useEffect(() => {
    if (state === "writing") {
      setReacting(true);
      const t = setTimeout(() => setReacting(false), 600);
      return () => clearTimeout(t);
    }
  }, [state]);

  const isActive = state === "writing" || state === "talking";

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 z-[1]"
      style={{
        opacity: isActive ? 0.15 : 0.07,
        transition: "opacity 0.6s ease, transform 0.3s ease",
        transform: reacting ? "rotate(-8deg) scale(1.1)" : "rotate(0deg) scale(1)",
        animation: state === "idle" || state === "thinking" ? "mascotFloat 4s ease-in-out infinite" : undefined,
      }}
    >
      <svg width="56" height="64" viewBox="0 0 80 90" fill="none" xmlns="http://www.w3.org/2000/svg">

        {/* Body */}
        <ellipse cx="40" cy="58" rx="26" ry="28" fill="#c8d6e5" stroke="#dfe6e9" strokeWidth="0.8" />

        {/* Belly */}
        <ellipse cx="40" cy="64" rx="16" ry="18" fill="#b2bec3" opacity="0.5" />

        {/* Left wing — resting */}
        <ellipse
          cx="14" cy="50" rx="10" ry="18" fill="#c8d6e5" stroke="#dfe6e9" strokeWidth="0.6"
          style={{
            transformOrigin: "24px 50px",
            animation: state === "writing" ? "wingWave 0.8s ease-in-out infinite" : undefined,
          }}
        />

        {/* Right wing — reaches to board when writing */}
        <ellipse
          cx="66" cy="50" rx="10" ry="18" fill="#c8d6e5" stroke="#dfe6e9" strokeWidth="0.6"
          style={{
            transformOrigin: "56px 50px",
            animation: state === "writing" ? "wingPoint 1s ease-in-out infinite" : undefined,
          }}
        />

        {/* Head */}
        <circle cx="40" cy="28" r="22" fill="#dfe6e9" stroke="#c8d6e5" strokeWidth="0.8" />

        {/* Ear tufts */}
        <path d="M22 12 L26 22 L18 20 Z" fill="#dfe6e9" stroke="#c8d6e5" strokeWidth="0.5" />
        <path d="M58 12 L54 22 L62 20 Z" fill="#dfe6e9" stroke="#c8d6e5" strokeWidth="0.5" />

        {/* Eye sockets */}
        <circle cx="32" cy="26" r="9" fill="#636e72" />
        <circle cx="48" cy="26" r="9" fill="#636e72" />

        {/* Eyes */}
        <circle cx="32" cy="26" r="5" fill="#dfe6e9" opacity="0.9">
          <animate attributeName="r" values="5;4.5;5" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="48" cy="26" r="5" fill="#dfe6e9" opacity="0.9">
          <animate attributeName="r" values="5;4.5;5" dur="2s" repeatCount="indefinite" />
        </circle>

        {/* Pupils */}
        <circle cx="33" cy="25" r="2" fill="#2d3436" />
        <circle cx="49" cy="25" r="2" fill="#2d3436" />

        {/* Eye highlights */}
        <circle cx="34" cy="24" r="1" fill="#ffffff" opacity="0.6" />
        <circle cx="50" cy="24" r="1" fill="#ffffff" opacity="0.6" />

        {/* Glasses */}
        <rect x="22" y="18" width="16" height="14" rx="3" fill="none" stroke="#b2bec3" strokeWidth="0.8" />
        <rect x="42" y="18" width="16" height="14" rx="3" fill="none" stroke="#b2bec3" strokeWidth="0.8" />
        <line x1="38" y1="24" x2="42" y2="24" stroke="#b2bec3" strokeWidth="0.6" />

        {/* Beak */}
        {mouthOpen ? (
          <>
            <path d="M36 34 L40 37 L44 34" fill="#fdcb6e" stroke="#e17055" strokeWidth="0.5" />
            <path d="M36 34 L40 31 L44 34" fill="#ffeaa7" stroke="#e17055" strokeWidth="0.5" />
          </>
        ) : (
          <path d="M36 33 L40 36 L44 33" fill="#ffeaa7" stroke="#e17055" strokeWidth="0.5" />
        )}

        {/* Graduation cap */}
        <polygon points="22,10 40,2 58,10 40,18" fill="#636e72" stroke="#b2bec3" strokeWidth="0.5" />
        <rect x="38" y="2" width="4" height="2" rx="1" fill="#b2bec3" />
        <line x1="56" y1="10" x2="60" y2="18" stroke="#b2bec3" strokeWidth="0.8" />
        <circle cx="60" cy="19" r="2" fill="#fdcb6e" />

        {/* Feet */}
        <ellipse cx="32" cy="86" rx="6" ry="3" fill="#fdcb6e" opacity="0.6" />
        <ellipse cx="48" cy="86" rx="6" ry="3" fill="#fdcb6e" opacity="0.6" />
      </svg>

      {/* Thinking dots */}
      {state === "thinking" && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex gap-2">
          <span className="h-3 w-3 rounded-full animate-bounce" style={{ background: "#94a3b8", animationDelay: "0ms" }} />
          <span className="h-3 w-3 rounded-full animate-bounce" style={{ background: "#94a3b8", animationDelay: "150ms" }} />
          <span className="h-3 w-3 rounded-full animate-bounce" style={{ background: "#94a3b8", animationDelay: "300ms" }} />
        </div>
      )}
    </div>
  );
}
