"use client";

/**
 * Animated writing hand that follows the drawing cursor on the whiteboard.
 * Uses a pure SVG hand with a glowing marker tip.
 */

interface WritingHandProps {
  x: number;
  y: number;
  show: boolean;
  glowColor?: string;
}

export function WritingHand({ x, y, show, glowColor = "#00e5ff" }: WritingHandProps) {
  return (
    <div
      className="pointer-events-none absolute z-30 transition-opacity duration-200"
      style={{
        left: x - 8,
        top: y - 8,
        opacity: show ? 1 : 0,
        filter: `drop-shadow(0 0 8px ${glowColor}) drop-shadow(0 0 20px ${glowColor}40)`,
        transform: "rotate(-30deg) translate(-20px, -40px)",
        willChange: "left, top, opacity",
      }}
    >
      <svg width="52" height="56" viewBox="0 0 52 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Marker body */}
        <rect x="20" y="0" width="8" height="36" rx="3" fill="#334155" stroke="#475569" strokeWidth="1" />
        {/* Marker grip lines */}
        <line x1="22" y1="8" x2="26" y2="8" stroke="#64748b" strokeWidth="0.8" />
        <line x1="22" y1="12" x2="26" y2="12" stroke="#64748b" strokeWidth="0.8" />
        <line x1="22" y1="16" x2="26" y2="16" stroke="#64748b" strokeWidth="0.8" />
        {/* Marker tip */}
        <path d="M20 36 L24 48 L28 36 Z" fill={glowColor} />
        {/* Tip glow dot */}
        <circle cx="24" cy="48" r="3" fill={glowColor} opacity="0.9">
          <animate attributeName="r" values="2;4;2" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0.5;0.9" dur="1.2s" repeatCount="indefinite" />
        </circle>
        {/* Hand silhouette holding marker */}
        <ellipse cx="24" cy="24" rx="16" ry="10" fill="#1e293b" opacity="0.7" />
        {/* Thumb */}
        <ellipse cx="12" cy="20" rx="5" ry="7" fill="#1e293b" opacity="0.6" transform="rotate(-15 12 20)" />
        {/* Fingers wrapped around marker */}
        <ellipse cx="32" cy="18" rx="6" ry="4" fill="#1e293b" opacity="0.5" transform="rotate(10 32 18)" />
        <ellipse cx="34" cy="24" rx="5" ry="3.5" fill="#1e293b" opacity="0.5" transform="rotate(15 34 24)" />
        <ellipse cx="33" cy="30" rx="5" ry="3" fill="#1e293b" opacity="0.4" transform="rotate(20 33 30)" />
      </svg>
    </div>
  );
}
