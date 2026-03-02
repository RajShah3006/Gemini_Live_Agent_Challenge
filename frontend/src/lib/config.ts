/** WebSocket URL for the backend */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? `wss://${window.location.host}/ws/session`
    : "ws://localhost:8000/ws/session");

/** Backend API base URL */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? `https://${window.location.host}`
    : "http://localhost:8000");
