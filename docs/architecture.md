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
    end

    subgraph "Google Cloud Run"
        subgraph "Backend — FastAPI"
            WS[WebSocket Handler]
            GS[GeminiSession Manager]
            FC[Function Call Router]
        end
        subgraph "Frontend — Next.js SSR"
            SSR[Static Pages]
        end
    end

    subgraph "Google Cloud Services"
        GEMINI["Gemini 2.5 Flash\nLive API"]
        FS["Cloud Firestore\nSession History"]
        CS["Cloud Storage\nWhiteboard Snapshots"]
    end

    UI -->|WebSocket| WS
    MIC -->|Audio Stream| WS
    IMG -->|Base64 Image| WS
    WS --> GS
    GS <-->|"Real-time Audio + Function Calls"| GEMINI
    GEMINI -->|"Tool Calls (draw_latex, draw_line...)"| FC
    FC -->|Whiteboard Commands JSON| WS
    WS -->|Audio PCM chunks| SPK
    WS -->|Drawing Commands| WB
    GS --> FS
    WB --> CS

    style GEMINI fill:#4285F4,stroke:#333,color:#fff
    style WB fill:#10b981,stroke:#333,color:#fff
    style MIC fill:#3b82f6,stroke:#333,color:#fff
    style SPK fill:#f59e0b,stroke:#333,color:#fff
    style IMG fill:#8b5cf6,stroke:#333,color:#fff
    style FS fill:#ea4335,stroke:#333,color:#fff
    style CS fill:#34a853,stroke:#333,color:#fff
```

## Data Flow

1. **Student speaks** → Mic captures 16kHz PCM → WebSocket → Backend → Gemini Live API
2. **Gemini responds** → Audio (24kHz) streams back → Backend → WebSocket → Browser speaker
3. **Gemini draws** → Function calls (`draw_latex`, `draw_line`, etc.) → Backend routes → WebSocket → Canvas renders
4. **Student uploads image** → Base64 → WebSocket → Backend → Gemini vision analyzes → Draws solution
5. **Student interrupts** → Text or voice → Gemini handles barge-in → Adjusts approach

## Whiteboard Tool Functions

| Function | Purpose |
|----------|---------|
| `clear_whiteboard` | Clear canvas for new problem |
| `step_marker` | Label solution steps (Step 1, 2, 3...) |
| `draw_text` | Plain text annotations |
| `draw_latex` | Mathematical expressions |
| `draw_line` | Straight lines |
| `draw_arrow` | Arrows for flow/direction |
| `draw_circle` | Circles for geometry |
| `draw_rect` | Rectangles |
| `highlight` | Semi-transparent highlight area |
