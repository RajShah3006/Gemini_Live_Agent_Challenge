"use client";

/**
 * Quick-tap graph preset buttons — sends a graph command directly to the whiteboard.
 */

import { useState } from "react";

interface GraphPresetsProps {
  onGraph: (fn: string, label: string) => void;
}

const PRESETS = [
  { fn: "Math.sin(x)", label: "y = sin(x)", icon: "∿" },
  { fn: "Math.cos(x)", label: "y = cos(x)", icon: "◠" },
  { fn: "x*x", label: "y = x²", icon: "⋃" },
  { fn: "Math.pow(x,3)", label: "y = x³", icon: "∛" },
  { fn: "Math.sqrt(Math.abs(x))", label: "y = √x", icon: "√" },
  { fn: "1/x", label: "y = 1/x", icon: "⅟" },
  { fn: "Math.abs(x)", label: "y = |x|", icon: "∨" },
  { fn: "Math.exp(x)", label: "y = eˣ", icon: "eˣ" },
  { fn: "Math.log(x)", label: "y = ln(x)", icon: "ln" },
  { fn: "Math.tan(x)", label: "y = tan(x)", icon: "⊻" },
];

export function GraphPresets({ onGraph }: GraphPresetsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all"
        style={{
          background: open ? "rgba(99,102,241,0.25)" : "rgba(148,163,184,0.06)",
          border: `1px solid ${open ? "rgba(99,102,241,0.5)" : "rgba(148,163,184,0.08)"}`,
          color: open ? "#a5b4fc" : "var(--text-muted)",
        }}
        aria-label="Graph presets"
      >
        📈 Graphs
      </button>

      {open && (
        <div
          className="absolute top-9 left-0 flex flex-wrap gap-1.5 rounded-lg p-2 z-50"
          style={{
            background: "rgba(10,15,30,0.92)",
            backdropFilter: "blur(16px)",
            border: "1px solid var(--border)",
            maxWidth: 280,
          }}
        >
          {PRESETS.map(p => (
            <button
              key={p.fn}
              onClick={() => { onGraph(p.fn, p.label); setOpen(false); }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-white/10"
              style={{ color: "#c4b5fd", border: "1px solid rgba(99,102,241,0.25)" }}
              title={p.label}
            >
              <span className="text-sm">{p.icon}</span>
              <span className="text-[10px] opacity-80">{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
