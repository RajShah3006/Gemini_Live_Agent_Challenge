/** Message types exchanged over WebSocket */

export interface ClientMessage {
  type: "audio" | "image" | "text" | "control";
  payload: Record<string, unknown>;
}

export interface ServerMessage {
  type: "audio" | "tts_audio" | "whiteboard" | "transcript" | "status" | "error";
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
    | "question_header"
    | "student_answer";
  params: Record<string, unknown>;
  _step?: number;
  _sectionIdx?: number;
}

export interface QuestionInfo {
  label: string; // "Q1", "Q2"
  text: string; // question text
  stepCount?: number; // number of steps in the response
  idx: number; // index for UI keys
  yStart: number; // reserved for scroll targets
}

export interface TranscriptEntry {
  role: "user" | "tutor";
  text: string;
  timestamp: number;
}
