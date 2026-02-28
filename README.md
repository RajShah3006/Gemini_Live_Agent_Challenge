# MathBoard — AI Math Tutor with Digital Whiteboard

> A real-time AI math tutor powered by Gemini Live API. Students speak naturally, upload photos of homework, and watch step-by-step solutions drawn live on a digital whiteboard. Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).

## 🏆 Category: Live Agents

## ✨ Features

- 🎙️ **Voice conversation** — Speak naturally with the AI tutor via Gemini Live API (real-time audio streaming)
- 📷 **Image upload** — Drag-drop, paste, or browse photos of homework → AI recognizes and solves the problems
- 📐 **AI-driven whiteboard** — Watch step-by-step solutions drawn live on a digital canvas with human-readable math notation
- 🎨 **Multi-color steps** — Each step gets a distinct neon color (cyan, purple, pink, amber, emerald, blue, orange)
- 📈 **Graph plotting** — Tutor plots mathematical functions (sin, cos, polynomials, etc.) with animated curves and labeled axes
- 📝 **Homework grading** — Upload a photo and the tutor grades your work with ✓/✗ marks and an overall score
- 🔄 **Voice re-explain** — Say "explain step 2 again" and the tutor re-explains below without clearing the board
- 📄 **PDF export** — Download your whiteboard as a PDF for studying later
- 📚 **Session history** — Review past tutoring sessions stored in Cloud Firestore
- 🛑 **Barge-in support** — Interrupt the AI anytime and it adjusts
- 🔁 **Auto-reconnect** — Gracefully recovers from Gemini API errors with exponential backoff
- 🦉 **Teacher mascot** — Animated owl professor with idle/talking/thinking/writing states

## 🏗️ Architecture

See [docs/architecture.md](docs/architecture.md) for the full Mermaid diagram.

```
┌─────────────────┐     WebSocket      ┌──────────────────┐     Live API     ┌─────────────────┐
│  Next.js         │ ◄──────────────► │  FastAPI           │ ◄──────────────► │  Gemini 2.5      │
│  • Canvas Board  │                   │  • Session Mgr     │                  │  Flash           │
│  • Mic (16kHz)   │                   │  • Firestore       │                  │  • Audio I/O     │
│  • Speaker (24k) │                   │  • Cloud Storage   │                  │  • Vision        │
│  • Image Upload  │                   │  • Cloud Logging   │                  │  • Tool Calls    │
└─────────────────┘                   └────────┬───────────┘                  └─────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │   Google Cloud         │
                                    │   • Cloud Run (host)   │
                                    │   • Firestore (data)   │
                                    │   • Cloud Storage      │
                                    │   • Secret Manager     │
                                    │   • Cloud Logging      │
                                    └───────────────────────┘
```

**How it works:**
1. Student speaks → 16kHz PCM audio streams via WebSocket → Gemini Live API
2. Gemini responds with audio (24kHz) + function calls (`draw_latex`, `draw_graph`, etc.)
3. Function calls become whiteboard commands rendered on the Canvas in real-time
4. Student can interrupt anytime — Gemini handles barge-in natively
5. Sessions, exports, and logs are persisted to Google Cloud services

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React, TailwindCSS, HTML5 Canvas, Web Audio API |
| Backend | Python 3.12, FastAPI, WebSockets |
| AI | Gemini 2.5 Flash Native Audio via Live API, Google GenAI SDK, 6 whiteboard tool functions |
| Cloud | Cloud Run, Cloud Firestore, Cloud Storage, Secret Manager, Cloud Logging |
| DevOps | Docker, automated deploy script (`deploy.sh`) |

## 🔧 Whiteboard Tools (Function Calling)

| Tool | Description |
|------|-------------|
| `clear_whiteboard` | Clear the board for a new problem |
| `step_marker` | Place a numbered step heading |
| `draw_text` | Write plain text labels |
| `draw_latex` | Write math expressions (auto-converted to human-readable) |
| `draw_line` | Draw lines, underlines, diagrams |
| `draw_graph` | Plot a math function with axes and animated curve |

## ☁️ Google Cloud Services

| Service | Usage |
|---------|-------|
| **Cloud Run** | Hosts both frontend and backend containers |
| **Cloud Firestore** | Persists tutoring session history and messages |
| **Cloud Storage** | Stores whiteboard PDF/JSON exports with signed URLs |
| **Secret Manager** | Securely loads API keys (falls back to `.env` for local dev) |
| **Cloud Logging** | Structured logging for all backend services |

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- Python 3.12+
- A Google Cloud project with the Gemini API enabled
- A Gemini API key ([get one here](https://aistudio.google.com/apikey))

### 1. Clone the repository
```bash
git clone https://github.com/your-username/Gemini_Live_Agent_Challenge.git
cd Gemini_Live_Agent_Challenge
```

### 2. Start both services (recommended)
```bash
# Edit backend/.env with your GOOGLE_API_KEY and GCP_PROJECT_ID
./run.sh
```

### 3. Or start manually

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY and GCP_PROJECT_ID
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### 4. Open the app
Go to [http://localhost:3000](http://localhost:3000), click **Start Session**, and start talking!

## ☁️ Deploy to Google Cloud

### Automated (recommended — earns bonus points!)
```bash
# Set your API key first
export GOOGLE_API_KEY="your-key-here"

# Deploy both services to Cloud Run
./deploy.sh your-gcp-project-id
```

### Manual
```bash
# Backend
cd backend
gcloud builds submit --tag gcr.io/PROJECT_ID/mathboard-backend
gcloud run deploy mathboard-backend --image gcr.io/PROJECT_ID/mathboard-backend --allow-unauthenticated

# Frontend
cd frontend
gcloud builds submit --tag gcr.io/PROJECT_ID/mathboard-frontend
gcloud run deploy mathboard-frontend --image gcr.io/PROJECT_ID/mathboard-frontend --allow-unauthenticated
```

## 📁 Project Structure

```
├── backend/
│   ├── main.py                     # FastAPI app + WebSocket + REST API
│   ├── config.py                   # Config with Secret Manager integration
│   ├── Dockerfile                  # Cloud Run container
│   ├── requirements.txt
│   ├── services/
│   │   ├── gemini_service.py       # Gemini Live API + 6 whiteboard tools
│   │   ├── session_service.py      # Cloud Firestore session persistence
│   │   └── whiteboard_service.py   # Cloud Storage exports + state tracking
│   └── models/
│       └── messages.py             # Pydantic message models
├── frontend/
│   ├── src/
│   │   ├── app/page.tsx            # Main app layout
│   │   ├── components/
│   │   │   ├── whiteboard/
│   │   │   │   ├── Whiteboard.tsx  # Canvas renderer + graph plotting
│   │   │   │   ├── WhiteboardToolbar.tsx
│   │   │   │   ├── TeacherMascot.tsx
│   │   │   │   └── WritingHand.tsx
│   │   │   ├── voice/VoicePanel.tsx
│   │   │   ├── upload/ImageUpload.tsx
│   │   │   └── SessionHistory.tsx  # Firestore session browser
│   │   ├── hooks/
│   │   │   ├── useSession.ts       # WebSocket orchestration
│   │   │   ├── useMicrophone.ts    # 16kHz PCM mic capture
│   │   │   └── useAudioPlayer.ts   # 24kHz PCM playback
│   │   └── lib/
│   │       ├── types.ts
│   │       └── config.ts
│   ├── Dockerfile
│   └── next.config.ts
├── docs/
│   └── architecture.md             # Mermaid architecture diagram
├── deploy.sh                       # Automated Cloud Run deployment
├── run.sh                          # Local dev launcher
└── README.md
```

## 🎬 Demo Video

_Coming soon — will show a live math tutoring session with voice interaction and whiteboard._

## 📝 License

MIT