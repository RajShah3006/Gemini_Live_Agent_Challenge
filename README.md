# MathBoard — AI Math Tutor with Digital Whiteboard

> A real-time AI math tutor powered by Gemini Live API. Students speak naturally, upload photos of homework, and watch step-by-step solutions drawn live on a digital whiteboard. Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).

## 🏆 Category: Live Agents

## ✨ Features

- 🎙️ **Voice conversation** — Speak naturally with the AI tutor via Gemini Live API (real-time audio streaming)
- 📷 **Image upload** — Drag-drop, paste, or browse photos of homework → AI recognizes and solves the problems
- 📐 **AI-driven whiteboard** — Watch step-by-step solutions drawn live on a digital canvas with LaTeX math rendering
- 🛑 **Barge-in support** — Interrupt the AI anytime ("wait, use the quadratic formula instead") and it adjusts
- 🎯 **Student-guided solving** — You're in control: redirect the approach, ask for explanations, or add constraints
- 🧮 **Algebra, Geometry, Calculus** — From basic equations to integrals and beyond

## 🏗️ Architecture

See [docs/architecture.md](docs/architecture.md) for the full Mermaid diagram.

```
┌─────────────────┐     WebSocket      ┌──────────────────┐     Live API     ┌─────────────────┐
│  Next.js         │ ◄──────────────► │  FastAPI           │ ◄──────────────► │  Gemini 2.5      │
│  • Canvas Board  │                   │  • Session Mgr     │                  │  Flash           │
│  • Mic (16kHz)   │                   │  • Function Router  │                  │  • Audio I/O     │
│  • Speaker (24k) │                   │  • WS Handler       │                  │  • Vision        │
│  • Image Upload  │                   │                    │                  │  • Tool Calls    │
└─────────────────┘                   └────────┬───────────┘                  └─────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │   Google Cloud         │
                                    │   • Cloud Run (host)   │
                                    │   • Firestore (data)   │
                                    │   • Cloud Storage      │
                                    └───────────────────────┘
```

**How it works:**
1. Student speaks → 16kHz PCM audio streams via WebSocket → Gemini Live API
2. Gemini responds with audio (24kHz) + function calls (`draw_latex`, `draw_line`, etc.)
3. Function calls become whiteboard commands rendered on the Canvas in real-time
4. Student can interrupt anytime — Gemini handles barge-in natively

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React, TailwindCSS, HTML5 Canvas, Web Audio API |
| Backend | Python 3.12, FastAPI, WebSockets |
| AI | Gemini 2.5 Flash via Live API, Google GenAI SDK, 9 whiteboard tool functions |
| Cloud | Google Cloud Run, Firestore, Cloud Storage |
| DevOps | Docker, automated deploy script (`deploy.sh`) |

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

### 2. Start the backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY
uvicorn main:app --reload --port 8000
```

### 3. Start the frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

### 4. Open the app
Go to [http://localhost:3000](http://localhost:3000), click **Start Session**, and start talking!

## ☁️ Deploy to Google Cloud

### Automated (recommended)
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
│   ├── main.py              # FastAPI app + WebSocket handler
│   ├── config.py             # Environment configuration
│   ├── Dockerfile            # Cloud Run container
│   ├── requirements.txt
│   ├── services/
│   │   ├── gemini_service.py # Gemini Live API session + 9 whiteboard tools
│   │   ├── whiteboard_service.py
│   │   └── session_service.py
│   └── models/
│       └── messages.py       # Pydantic message models
├── frontend/
│   ├── src/
│   │   ├── app/page.tsx      # Main app page
│   │   ├── components/
│   │   │   ├── whiteboard/Whiteboard.tsx  # Canvas renderer
│   │   │   ├── voice/VoicePanel.tsx       # Voice + text controls
│   │   │   └── upload/ImageUpload.tsx     # Drag-drop image upload
│   │   ├── hooks/
│   │   │   ├── useSession.ts     # WebSocket + orchestration
│   │   │   ├── useMicrophone.ts  # 16kHz PCM mic capture
│   │   │   └── useAudioPlayer.ts # 24kHz PCM audio playback
│   │   └── lib/
│   │       ├── types.ts          # Shared types
│   │       └── config.ts         # API URLs
│   ├── Dockerfile
│   └── next.config.ts
├── docs/
│   └── architecture.md       # Mermaid architecture diagram
├── deploy.sh                 # Automated Cloud Run deployment
└── README.md
```

## 🎬 Demo Video

_Coming soon — will show a live math tutoring session with voice interaction and whiteboard._

## 📝 License

MIT