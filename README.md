# MathBoard — AI Math Tutor with Digital Whiteboard

> A real-time AI math tutor powered by Gemini Live API. Students speak naturally, upload photos of homework, and watch step-by-step solutions drawn live on a digital whiteboard. Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).

## Category: Live Agents

## Features

- 🎙️ **Voice conversation** — Natural speech interaction with Gemini Live API
- 📷 **Image upload** — Drag-drop or paste photos of math homework for AI to analyze
- 📐 **AI-driven whiteboard** — Step-by-step solutions rendered on a digital canvas
- 🛑 **Barge-in support** — Interrupt the AI anytime to redirect, clarify, or guide the approach
- 🧮 **Math rendering** — LaTeX expressions rendered beautifully
- 📚 **Covers algebra, geometry, calculus** — From basic equations to integrals

## Architecture

```
Frontend (Next.js)  ←→  WebSocket  ←→  Backend (FastAPI)  ←→  Gemini Live API
     ↓                                      ↓
  Canvas Whiteboard                   Firestore (sessions)
                                      Cloud Storage (snapshots)
```

All hosted on **Google Cloud Run**.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, React, TailwindCSS, HTML5 Canvas |
| Backend | Python FastAPI, WebSockets, Google GenAI SDK |
| AI | Gemini 2.5 Flash via Live API |
| Cloud | Cloud Run, Firestore, Cloud Storage |

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.12+
- Google Cloud project with Gemini API enabled

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # Fill in your GOOGLE_API_KEY
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Google Cloud

```bash
./deploy.sh your-gcp-project-id
```

## License
MIT