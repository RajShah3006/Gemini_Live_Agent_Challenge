/** Message types exchanged over WebSocket */

export interface ClientMessage {
  type: "audio" | "image" | "text" | "control" | "ping";
  payload: Record<string, unknown>;
}

export interface ServerMessage {
  type: "audio" | "whiteboard" | "transcript" | "status" | "error" | "pong";
  payload: Record<string, unknown>;
}

/** Drawing commands the AI sends to render on the whiteboard */
export interface WhiteboardCommand {
  id: string;
  action:
    | "clear"
    | "draw_text"
    | "draw_latex"
    | "draw_line"
    | "draw_arrow"
    | "draw_circle"
    | "draw_rect"
    | "draw_graph"
    | "highlight"
    | "step_marker"
    | "question_header";
  params: Record<string, unknown>;
  _step?: number;
  _sectionIdx?: number;
}

export interface TranscriptEntry {
  role: "user" | "tutor";
  text: string;
  timestamp: number;
}
