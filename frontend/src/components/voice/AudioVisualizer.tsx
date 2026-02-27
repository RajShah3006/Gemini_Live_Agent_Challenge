"use client";

/**
 * Compact audio waveform visualizer using CSS-animated bars.
 * Purely visual — driven by `active` prop, no actual audio analysis needed.
 */

interface AudioVisualizerProps {
  active: boolean;
  color?: "emerald" | "blue" | "red";
  bars?: number;
}

const COLOR_MAP = {
  emerald: { bar: "bg-emerald-400", glow: "shadow-emerald-400/50" },
  blue: { bar: "bg-cyan-400", glow: "shadow-cyan-400/50" },
  red: { bar: "bg-red-400", glow: "shadow-red-400/50" },
};

export function AudioVisualizer({ active, color = "emerald", bars = 5 }: AudioVisualizerProps) {
  const { bar, glow } = COLOR_MAP[color];

  return (
    <div className="flex items-end justify-center gap-[3px] h-5" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full transition-all duration-150 ${
            active ? `${bar} shadow-sm ${glow}` : "bg-gray-700"
          }`}
          style={{
            height: active ? undefined : 4,
            animation: active
              ? `vizBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`
              : "none",
          }}
        />
      ))}
    </div>
  );
}
