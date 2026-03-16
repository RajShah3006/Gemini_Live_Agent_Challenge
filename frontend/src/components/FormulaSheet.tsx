"use client";
import { useState } from "react";

interface FormulaSheetProps {
  onInsert: (formula: string) => void;
}

const CATEGORIES: { name: string; icon: string; formulas: { label: string; value: string }[] }[] = [
  {
    name: "Algebra",
    icon: "📐",
    formulas: [
      { label: "Quadratic Formula", value: "x = (-b ± √(b²-4ac)) / 2a" },
      { label: "Difference of Squares", value: "a² - b² = (a+b)(a-b)" },
      { label: "Binomial Expansion", value: "(a+b)² = a² + 2ab + b²" },
      { label: "Sum of Cubes", value: "a³ + b³ = (a+b)(a²-ab+b²)" },
    ],
  },
  {
    name: "Calculus",
    icon: "∫",
    formulas: [
      { label: "Power Rule", value: "d/dx [xⁿ] = nxⁿ⁻¹" },
      { label: "Chain Rule", value: "d/dx [f(g(x))] = f'(g(x))·g'(x)" },
      { label: "Product Rule", value: "d/dx [f·g] = f'g + fg'" },
      { label: "Integration by Parts", value: "∫u dv = uv - ∫v du" },
      { label: "∫ xⁿ dx", value: "∫ xⁿ dx = xⁿ⁺¹/(n+1) + C" },
      { label: "∫ eˣ dx", value: "∫ eˣ dx = eˣ + C" },
    ],
  },
  {
    name: "Trigonometry",
    icon: "📊",
    formulas: [
      { label: "Pythagorean Identity", value: "sin²θ + cos²θ = 1" },
      { label: "Double Angle (sin)", value: "sin(2θ) = 2sinθ·cosθ" },
      { label: "Double Angle (cos)", value: "cos(2θ) = cos²θ - sin²θ" },
      { label: "tan identity", value: "tanθ = sinθ / cosθ" },
      { label: "Law of Cosines", value: "c² = a² + b² - 2ab·cos(C)" },
    ],
  },
  {
    name: "Limits",
    icon: "→",
    formulas: [
      { label: "L'Hôpital's Rule", value: "lim f/g = lim f'/g' (0/0 or ∞/∞)" },
      { label: "lim sinx/x", value: "lim(x→0) sin(x)/x = 1" },
      { label: "Euler's Number", value: "e = lim(n→∞) (1 + 1/n)ⁿ" },
    ],
  },
];

export function FormulaSheet({ onInsert }: FormulaSheetProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-white/5"
        style={{
          color: open ? "#818cf8" : "var(--text-secondary)",
          border: `1px solid ${open ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
          background: open ? "rgba(99,102,241,0.08)" : "transparent",
        }}
        title="Formula Cheat Sheet"
        aria-label="Toggle formula cheat sheet"
      >
        📋 Formulas
      </button>
      {open && (
        <div
          className="fixed top-[52px] bottom-0 z-30 flex flex-col overflow-hidden"
          style={{
            width: 260,
            right: "min(300px, 30vw)",
            background: "var(--bg-surface)",
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>📋 Formula Sheet</span>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] rounded px-1.5 py-0.5 hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close formula sheet"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {CATEGORIES.map((cat) => (
              <div key={cat.name}>
                <button
                  onClick={() => setExpanded(expanded === cat.name ? null : cat.name)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className="text-sm">{cat.icon}</span>
                  <span className="text-[12px] font-medium flex-1" style={{ color: "var(--text-primary)" }}>{cat.name}</span>
                  <span className="text-[10px]" style={{
                    color: "var(--text-muted)",
                    transform: expanded === cat.name ? "rotate(180deg)" : "rotate(0)",
                    transition: "transform 0.15s",
                    display: "inline-block",
                  }}>▾</span>
                </button>
                {expanded === cat.name && (
                  <div className="pl-2 pr-1 pb-1 space-y-0.5">
                    {cat.formulas.map((f) => (
                      <button
                        key={f.label}
                        onClick={() => onInsert(f.value)}
                        className="w-full text-left px-2 py-1.5 rounded-md transition-colors hover:bg-white/[0.06] group"
                        title={`Insert: ${f.value}`}
                      >
                        <div className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>{f.label}</div>
                        <div className="text-[10px] font-mono opacity-70 group-hover:opacity-100" style={{ color: "#818cf8" }}>{f.value}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
