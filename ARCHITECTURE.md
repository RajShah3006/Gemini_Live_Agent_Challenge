# MathBoard — Architecture Guide

## Overview

MathBoard is a real-time AI math tutor built for the Gemini Live Agent Challenge. It combines voice conversation, an AI-driven whiteboard, and image analysis into an interactive learning experience.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js)                      │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Voice    │  │  Composer    │  │  Whiteboard            │ │
│  │  Panel    │  │  (text/math  │  │  ┌──────────────────┐  │ │
│  │  ┌──────┐│  │   /image)    │  │  │  NotebookPage ×N │  │ │
│  │  │ Mic  ││  └──────┬───────┘  │  │  (canvas per Q)  │  │ │
│  │  │ TTS  ││         │          │  └──────────────────┘  │ │
│  │  │ Audio││         │          │  ┌──────────────────┐  │ │
│  │  └──────┘│         │          │  │  Graph / LaTeX   │  │ │
│  └────┬─────┘         │          │  │  Formula Sheet   │  │ │
│       │               │          │  └──────────────────┘  │ │
│       └───────┬───────┘          └────────────┬───────────┘ │
│               │                               │             │
│         ┌─────▼───────────────────────────────▼──────┐      │
│         │           useSession Hook                   │      │
│         │  (WebSocket client, state management)       │      │
│         └─────────────────┬───────────────────────────┘      │
└───────────────────────────┼──────────────────────────────────┘
                            │ WebSocket (wss://)
┌───────────────────────────┼──────────────────────────────────┐
│                      BACKEND (FastAPI)                        │
│                           │                                   │
│         ┌─────────────────▼──────────────────┐               │
│         │       WebSocket Handler             │               │
│         │  (main.py /ws/session)              │               │
│         └──────┬──────────────┬───────────────┘               │
│                │              │                                │
│    ┌───────────▼───┐   ┌─────▼──────────────┐               │
│    │ GeminiSession  │   │  SessionService    │               │
│    │                │   │  (Firestore)       │               │
│    │ ┌────────────┐ │   └────────────────────┘               │
│    │ │ Audio Model │ │                                        │
│    │ │ (Live API)  │ │   ┌──────────────────┐               │
│    │ ├────────────┤ │   │ WhiteboardService │               │
│    │ │ WB Model   │ │   │ (in-memory + GCS) │               │
│    │ │ (Standard) │ │   └──────────────────┘               │
│    │ └────────────┘ │                                        │
│    └────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
                     │                    │
           ┌─────────▼─────┐    ┌────────▼────────┐
           │  Gemini API   │    │   Firestore DB   │
           │  (Google AI)  │    │   (sessions/     │
           │               │    │    messages)      │
           └───────────────┘    └─────────────────┘
```

## Dual-Model Architecture

MathBoard uses **two separate Gemini models** to avoid the Live API's instability issues:

| Model | API | Purpose | Input | Output |
|-------|-----|---------|-------|--------|
| `gemini-2.5-flash-native-audio` | Live API | Voice conversation | Audio PCM | Audio + tool calls |
| `gemini-2.5-flash-lite` | Standard API | Text/image → whiteboard | Text, images | Tool calls + text |

**Why two models?**
- The Live API (native audio) supports real-time voice but is prone to 1011/1008 errors
- Text and image inputs never touch the Live API, making them 100% reliable
- Both models share the same whiteboard tool declarations

## Directory Structure

```
backend/
├── main.py                    # FastAPI app, WebSocket handler, REST endpoints
├── config.py                  # Config loader (Secret Manager → env fallback)
├── requirements.txt           # Python dependencies
├── Dockerfile                 # Cloud Run container
└── services/
    ├── gemini_service.py      # Dual-model Gemini integration (743 lines)
    │   ├── GeminiSession      # Manages both models + Live API lifecycle
    │   ├── WHITEBOARD_DECLS   # Tool declarations (draw_text, draw_latex, etc.)
    │   ├── WB_SYSTEM_INSTRUCTION    # Whiteboard model prompt
    │   └── AUDIO_SYSTEM_INSTRUCTION # Voice model prompt
    ├── session_service.py     # Firestore CRUD for sessions + messages
    └── whiteboard_service.py  # In-memory command tracking + GCS export

frontend/
├── Dockerfile                 # Cloud Run container (standalone Next.js)
├── src/
│   ├── app/
│   │   ├── page.tsx           # Main orchestrator — wires all components together
│   │   ├── layout.tsx         # Root layout with metadata
│   │   ├── error.tsx          # Error boundary (crash recovery UI)
│   │   └── globals.css        # Global styles + CSS variables + keyframes
│   ├── components/
│   │   ├── voice/
│   │   │   ├── VoicePanel.tsx       # Voice UI: mic, text input, math keyboard
│   │   │   └── AudioVisualizer.tsx  # Animated audio waveform
│   │   ├── whiteboard/
│   │   │   ├── Whiteboard.tsx       # Orchestrator: routes commands to pages
│   │   │   ├── NotebookPage.tsx     # Single canvas page with layout manager
│   │   │   ├── WhiteboardToolbar.tsx# Undo, clear, zoom, export tools
│   │   │   ├── whiteboard-helpers.ts# Drawing primitives, animation, math eval
│   │   │   ├── GraphPresets.tsx     # 46 graph presets in 6 categories
│   │   │   ├── WritingHand.tsx      # Animated cursor during drawing
│   │   │   └── TeacherMascot.tsx    # Animated owl mascot
│   │   ├── upload/
│   │   │   └── ImageUpload.tsx      # Drag-drop + paste image upload
│   │   ├── QuestionsSidebar.tsx     # Left sidebar: question list + actions
│   │   ├── FormulaSheet.tsx         # 83 formulas in 9 categories with search
│   │   ├── SessionHistory.tsx       # Past sessions from Firestore
│   │   └── HandwritingCanvas.tsx    # Freehand drawing input
│   ├── hooks/
│   │   ├── useSession.ts           # WebSocket client + all session state
│   │   ├── useMicrophone.ts        # AudioWorklet mic capture (16kHz PCM)
│   │   └── useAudioPlayer.ts       # Audio playback (24kHz PCM from Gemini)
│   └── lib/
│       ├── config.ts               # WS_URL / API_URL auto-detection
│       ├── types.ts                # TypeScript interfaces
│       └── imageUpload.ts          # Image validation + file reading
└── public/
    ├── audio-worklet-processor.js  # Web Audio worklet for mic capture
    └── mathlive-fonts/             # KaTeX woff2 fonts for MathLive
```

## Data Flow

### Text Question Flow
```
User types "solve x² + 3x - 4 = 0"
  → useSession.sendText() adds question_header command
  → WebSocket sends { type: "text", payload: { text: "..." } }
  → Backend: _handle_text() → GeminiSession.send_text()
  → gemini_service: _generate_whiteboard() with standard API
  → Model returns tool calls: step_marker, draw_latex, draw_circle
  → Each command sent to client via WebSocket { type: "whiteboard" }
  → Model returns text summary → { type: "transcript" }
  → Frontend: useSession adds commands to state
  → Whiteboard.tsx routes commands to active NotebookPage
  → NotebookPage: layout manager enforces spacing, animateCmd() draws
  → TTS speaks the transcript text via browser speechSynthesis
```

### Voice Flow
```
User holds mic button
  → useMicrophone captures 16kHz PCM via AudioWorklet
  → Base64-encoded chunks sent via WebSocket { type: "audio" }
  → Backend: GeminiSession.send_audio() → Live API
  → Gemini processes speech, returns:
    - Audio chunks → forwarded as { type: "audio" } to client
    - Tool calls → forwarded as { type: "whiteboard" }
  → useAudioPlayer decodes and plays 24kHz PCM audio
```

## Whiteboard Layout System

Each question gets its own `NotebookPage` (canvas). The layout manager in NotebookPage.tsx enforces:

1. **Overlap prevention**: Each command's Y is clamped to be below the previous command's bottom edge
2. **Accurate height tracking**: `getCommandBottom()` calculates per-command-type heights
3. **X clamping**: Text pushed back to x=40 if it would overflow the 900px canvas
4. **Auto-grow**: Canvas height increases as content is added
5. **Auto-scroll**: View scrolls to keep new content visible

## Key Technologies

- **Gemini 2.5 Flash** (Live API + Standard API)
- **Next.js 16** with App Router + standalone output
- **FastAPI** with async WebSocket support
- **Cloud Firestore** for session persistence
- **Cloud Run** for serverless deployment with continuous deployment from GitHub
- **Web Audio API** (AudioWorklet) for real-time mic capture
- **MathLive** for math keyboard input
- **Canvas API** for whiteboard rendering with animations

## Environment Variables

### Backend
| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | Gemini API key |
| `GCP_PROJECT_ID` | GCP project for Firestore/logging |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `FIRESTORE_DATABASE` | Firestore database name (default: "tutor") |
| `FIRESTORE_COLLECTION` | Collection name (default: "sessions") |

### Frontend (build-time)
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_WS_URL` | Backend WebSocket URL |
| `NEXT_PUBLIC_API_URL` | Backend REST API URL |
