"use client";

/**
 * App-level error boundary — catches unhandled React errors and shows a recovery UI.
 * Next.js automatically wraps each route segment with this component.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d0f1a",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😵</div>
      <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        Something went wrong
      </h2>
      <p style={{ color: "#94a3b8", maxWidth: "400px", marginBottom: "1.5rem" }}>
        MathBoard hit an unexpected error. Your session data is safe — just reload to continue.
      </p>
      <button
        onClick={reset}
        style={{
          padding: "0.75rem 2rem",
          borderRadius: "0.5rem",
          background: "rgba(99,102,241,0.2)",
          border: "1px solid rgba(99,102,241,0.4)",
          color: "#818cf8",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: "1rem",
        }}
      >
        🔄 Try Again
      </button>
      {process.env.NODE_ENV === "development" && (
        <pre
          style={{
            marginTop: "2rem",
            padding: "1rem",
            background: "rgba(0,0,0,0.3)",
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            color: "#f87171",
            maxWidth: "600px",
            overflow: "auto",
            textAlign: "left",
          }}
        >
          {error.message}
        </pre>
      )}
    </div>
  );
}
