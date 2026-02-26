/** WebSocket URL for the backend */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/session";

/** Backend API base URL */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
