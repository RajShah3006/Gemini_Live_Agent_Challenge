# MathBoard — AI Math Tutor with Digital Whiteboard

> A real-time AI math tutor powered by Gemini Live API. Students speak naturally, upload photos of homework, and watch step-by-step solutions drawn live on a digital whiteboard. Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).

## 🚀 Try It Live

**👉 [mathboard-frontend-943557716175.us-central1.run.app](https://mathboard-frontend-943557716175.us-central1.run.app/)**

### How to Use MathBoard

1. **Open the link** above in Chrome (mic access required).
2. **Click "Start Session"** — the AI tutor connects and the whiteboard loads.
3. **Choose your mode** in the bottom panel:
   - 🎓 **Teacher** — AI draws one step at a time, asks you questions, waits for your answer (amber pulsing border = your turn).
   - ⚡ **Quick** — AI solves the full problem immediately with no pauses.
4. **Ask a math question** — three ways to interact:
   - 🎙️ **Voice** — Click the mic button (or Push-to-Talk) and speak naturally: *"What is the derivative of x squared?"*
   - ⌨️ **Text** — Type in the input box and press Enter. Supports LaTeX: `$\int x^2 dx$`
   - 📷 **Image** — Drag-drop, paste (Ctrl+V), or click the upload button with a photo of a homework problem.
5. **Watch the whiteboard** — The AI draws step-by-step solutions live with color-coded steps, LaTeX math, and graphs.
6. **In Teacher mode, answer questions** — When the border pulses amber, the AI is waiting for your answer. Type or speak your response to continue.
7. **Export** — Click the PDF button to download your whiteboard as a study reference.

> **Tips:** Say *"explain step 2 again"* to get a re-explanation. You can interrupt the AI anytime (barge-in). Switch modes mid-session without losing your board.

---

## 🏆 Category: Live Agents

## ✨ Features

- 🎙️ **Voice conversation** — Speak naturally with the AI tutor via Gemini Live API (real-time bidirectional audio streaming)
- ⌨️ **Text & LaTeX input** — Type questions or LaTeX math expressions
- 📷 **Image upload** — Drag-drop, paste, or browse photos of homework → AI recognizes and solves the problems
- 📐 **AI-driven whiteboard** — Watch step-by-step solutions drawn live on a digital canvas with human-readable math notation
- 🎓 **Teacher mode** — Interactive: AI draws one step, asks a question, waits for your answer, then continues
- ⚡ **Quick mode** — Direct: AI solves the full problem at once
- 🎨 **Multi-color steps** — Each step gets a distinct neon color (cyan, purple, pink, amber, emerald, blue, orange)
- 📈 **Graph plotting** — Tutor plots mathematical functions (sin, cos, polynomials, etc.) with animated curves and labeled axes
- 🔊 **Text-to-Speech** — Browser TTS reads AI responses aloud (toggle on/off)
- 🔄 **Voice re-explain** — Say "explain step 2 again" and the tutor re-explains below without clearing the board
- 📄 **PDF export** — Download your whiteboard as a PDF for studying later
- 📚 **Session history** — Review past tutoring sessions stored in Cloud Firestore
- 🛑 **Barge-in support** — Interrupt the AI anytime mid-speech and it adjusts
- 🔁 **Always-on voice** — Eager connection, 15s keepalive, auto-reconnect with health monitoring
- 🦉 **Teacher mascot** — Animated owl professor with idle/talking/thinking/writing states

## 👥 Team

| Name | Role |
|------|------|
| **Ayham Hasan** | Team Lead |
| **Raj Shah** | Full-Stack Developer |
| **Suriya Nagappan** | Developer |

## 🏗️ Architecture

See [docs/architecture.md](docs/architecture.md) for the full Mermaid diagram.

```
┌─────────────────┐     WebSocket     ┌──────────────────┐     Live API     ┌─────────────────┐
│  Next.js        │ ◄──────────────►  │  FastAPI         │ ◄──────────────► │  Gemini 2.5     │
│  • Canvas Board │                   │  • Session Mgr   │                  │  Flash          │
│  • Mic (16kHz)  │                   │  • Firestore     │                  │  • Audio I/O    │
│  • Speaker (24k)│                   │  • Cloud Storage │                  │  • Vision       │
│  • Image Upload │                   │  • Cloud Logging │                  │  • Tool Calls   │
└─────────────────┘                   └────────┬─────────┘                  └─────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │   Google Cloud        │
                                    │   • Cloud Run (host)  │
                                    │   • Firestore (data)  │
                                    │   • Cloud Storage     │
                                    │   • Secret Manager    │
                                    │   • Cloud Logging     │
                                    └───────────────────────┘
```

**Dual-model architecture — voice and text never interfere:**
1. **Voice path:** Student speaks → 16kHz PCM audio streams via WebSocket → Gemini Live API → audio response (24kHz) + whiteboard tool calls
2. **Text/image path:** Student types or uploads → Standard Gemini API (generate_content) → whiteboard tool calls + text transcript
3. Function calls become whiteboard commands rendered on the Canvas in real-time
4. Both models share whiteboard history for cross-channel context
5. Student can interrupt anytime — Gemini handles barge-in natively
6. Always-on voice: eager connection, 15s keepalive heartbeat, auto-reconnect with health monitoring

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React, TailwindCSS, HTML5 Canvas, Web Audio API |
| Backend | Python 3.12, FastAPI, WebSockets |
| AI | Gemini 2.5 Flash (Live API for voice, Standard API for text/image), Google Cloud TTS, 6 whiteboard tool functions |
| Cloud | Cloud Run, Cloud Firestore, Cloud Storage, Secret Manager, Cloud Logging |
| DevOps | Docker, GitHub Actions CI/CD, Cloud Run auto-deploy on push |

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
git clone https://github.com/RajShah3006/Gemini_Live_Agent_Challenge.git
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
│   │   ├── gemini_service.py       # Dual Gemini models + 6 whiteboard tools + voice health monitor
│   │   ├── tts_service.py          # Google Cloud Text-to-Speech (Neural2)
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
│   │   │   │   ├── whiteboard-helpers.ts  # LaTeX→human conversion, drawing primitives
│   │   │   │   ├── WhiteboardToolbar.tsx
│   │   │   │   ├── NotebookPage.tsx
│   │   │   │   ├── TeacherMascot.tsx
│   │   │   │   └── WritingHand.tsx
│   │   │   ├── voice/VoicePanel.tsx    # Mic, TTS toggle, mode switch, text/math input
│   │   │   ├── upload/ImageUpload.tsx
│   │   │   ├── QuestionBoardCards.tsx  # Question cards with amber awaiting-answer state
│   │   │   └── SessionHistory.tsx      # Firestore session browser
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
├── .github/
│   └── workflows/deploy.yml          # CI/CD: auto-deploy on push to main
├── deploy.sh                          # Manual Cloud Run deployment
├── run.sh                             # Local dev launcher
└── README.md
```

## 🎬 Demo

**[▶️ Try MathBoard Live](https://mathboard-frontend-943557716175.us-central1.run.app/)**

_Demo video coming soon — will showcase a live math tutoring session with voice interaction, whiteboard drawing, and teacher mode Q&A._

## 📝 License

MIT
