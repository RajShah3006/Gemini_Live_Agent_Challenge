# Architecture Diagram

Paste this into https://mermaid.live to generate the PNG/SVG for submission:

```mermaid
graph TB
    subgraph "Client Browser"
        UI[Next.js Frontend]
        WB[Canvas Whiteboard]
        MIC["🎙️ Microphone\n16kHz PCM"]
        SPK["🔊 Speaker\n24kHz PCM"]
        IMG["📷 Image Upload\nDrag-Drop / Paste"]
        HIST["📚 Session History"]
    end

    subgraph "Google Cloud Run"
        subgraph "Backend — FastAPI"
            WS[WebSocket Handler]
            GS[GeminiSession Manager]
            FC[Function Call Router]
            API["REST API\n/api/sessions"]
        end
        subgraph "Frontend — Next.js SSR"
            SSR[Static Pages]
        end
    end

    subgraph "Google Cloud Services"
        GEMINI["Gemini 2.5 Flash\nLive API\n(GenAI SDK)"]
        FS["Cloud Firestore\nSession History & Messages"]
        CS["Cloud Storage\nPDF & Snapshot Exports"]
        SM["Secret Manager\nAPI Key Storage"]
        CL["Cloud Logging\nStructured Logs"]
    end

    UI -->|WebSocket| WS
    MIC -->|Audio Stream| WS
    IMG -->|Base64 Image| WS
    WS --> GS
    GS <-->|"Real-time Audio + Function Calls"| GEMINI
    GEMINI -->|"Tool Calls (draw_latex, draw_graph...)"| FC
    FC -->|Whiteboard Commands JSON| WS
    WS -->|Audio PCM chunks| SPK
    WS -->|Drawing Commands| WB
    GS --> FS
    GS --> CL
    API --> FS
    API --> CS
    SM -.->|API Keys| GS
    HIST -->|"GET /api/sessions"| API
    WB -->|"POST /api/export"| CS

    style GEMINI fill:#4285F4,stroke:#333,color:#fff
    style WB fill:#10b981,stroke:#333,color:#fff
    style MIC fill:#3b82f6,stroke:#333,color:#fff
    style SPK fill:#f59e0b,stroke:#333,color:#fff
    style IMG fill:#8b5cf6,stroke:#333,color:#fff
    style FS fill:#ea4335,stroke:#333,color:#fff
    style CS fill:#34a853,stroke:#333,color:#fff
    style SM fill:#fbbc05,stroke:#333,color:#000
    style CL fill:#4285F4,stroke:#333,color:#fff
    style HIST fill:#818cf8,stroke:#333,color:#fff
```

## Data Flow

1. **Student speaks** → Mic captures 16kHz PCM → WebSocket → Backend → Gemini Live API
2. **Gemini responds** → Audio (24kHz) streams back → Backend → WebSocket → Browser speaker
3. **Gemini draws** → Function calls (`draw_latex`, `draw_graph`, etc.) → Backend routes → WebSocket → Canvas renders
4. **Student uploads image** → Base64 → WebSocket → Backend → Gemini vision analyzes → Draws solution
5. **Student interrupts** → Text or voice → Gemini handles barge-in → Adjusts approach
6. **Session saved** → Questions & commands → Firestore → Retrievable via Session History panel
7. **Exports stored** → PDF/snapshots → Cloud Storage → Signed download URLs

## Google Cloud Services

| Service | Integration Point | Purpose |
|---------|------------------|---------|
| **Cloud Run** | `deploy.sh` | Hosts frontend (Next.js SSR) and backend (FastAPI) containers |
| **Cloud Firestore** | `session_service.py` | Persists session metadata, user questions, whiteboard commands |
| **Cloud Storage** | `whiteboard_service.py` | Stores whiteboard PDF/JSON exports with 7-day signed URLs |
| **Secret Manager** | `config.py` | Securely loads `GOOGLE_API_KEY` (falls back to `.env` locally) |
| **Cloud Logging** | `main.py` | Structured logging across all services (auto-attaches on GCP) |

## Whiteboard Tool Functions (Gemini Function Calling)

| Function | Purpose |
|----------|---------|
| `clear_whiteboard` | Clear canvas for new problem |
| `step_marker` | Label solution steps (Step 1, 2, 3...) |
| `draw_text` | Plain text annotations |
| `draw_latex` | Mathematical expressions (auto-converted to human-readable) |
| `draw_line` | Straight lines, underlines, diagrams |
| `draw_graph` | Plot mathematical functions with animated curves and axes |
