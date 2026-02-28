"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";

interface Session {
  id: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SessionHistory({ open, onClose }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { role: string; content: string; timestamp: number }[]>>({});

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    fetch(`${API_URL}/api/sessions?limit=20`)
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.sessions || []);
        if (data.error) setError(data.error);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  async function loadMessages(sid: string) {
    if (expanded === sid) { setExpanded(null); return; }
    setExpanded(sid);
    if (messages[sid]) return;
    try {
      const r = await fetch(`${API_URL}/api/sessions/${sid}`);
      const data = await r.json();
      setMessages((prev) => ({ ...prev, [sid]: data.messages || [] }));
    } catch {}
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div
        className="relative ml-auto h-full w-[380px] flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)",
          animation: "slideInRight 0.2s ease-out",
        }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            📚 Session History
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-lg hover:bg-white/5 transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <p className="text-center text-xs py-8" style={{ color: "var(--text-muted)" }}>
              Loading sessions...
            </p>
          )}
          {error && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error.includes("credentials") ? "Firestore not configured locally — sessions available after GCP deployment." : error}
            </div>
          )}
          {!loading && sessions.length === 0 && !error && (
            <p className="text-center text-xs py-8" style={{ color: "var(--text-muted)" }}>
              No past sessions yet. Start a tutoring session!
            </p>
          )}
          {sessions.map((s) => (
            <div key={s.id}>
              <button
                onClick={() => loadMessages(s.id)}
                className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{ border: "1px solid var(--border)", background: expanded === s.id ? "var(--bg-elevated)" : "transparent" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-medium" style={{ color: "var(--accent-light)" }}>
                    #{s.id}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px]"
                    style={{
                      background: s.status === "active" ? "rgba(52,211,153,0.1)" : "rgba(100,116,139,0.1)",
                      color: s.status === "active" ? "#34d399" : "var(--text-muted)",
                    }}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>{new Date(s.created_at * 1000).toLocaleDateString()} {new Date(s.created_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span>·</span>
                  <span>{s.message_count} messages</span>
                </div>
              </button>
              {expanded === s.id && messages[s.id] && (
                <div className="ml-3 mt-1 mb-2 space-y-1.5 border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
                  {messages[s.id].length === 0 ? (
                    <p className="text-[11px] py-1" style={{ color: "var(--text-muted)" }}>No messages recorded</p>
                  ) : (
                    messages[s.id].map((m, i) => (
                      <div key={i} className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-semibold" style={{ color: m.role === "user" ? "var(--accent-light)" : "var(--text-muted)" }}>
                          {m.role === "user" ? "You" : "Tutor"}:
                        </span>{" "}
                        {m.content}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 text-center text-[10px]" style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}>
          Powered by Cloud Firestore
        </div>
      </div>
    </div>
  );
}
