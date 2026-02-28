#!/usr/bin/env bash
# ─── MathBoard — One-Command Launcher ───
# Works on macOS, Linux, and Windows (Git Bash / WSL)
# Usage: ./run.sh

set -e

# ── Detect OS ──
OS="unknown"
case "$(uname -s)" in
  Darwin*)  OS="mac";;
  Linux*)   OS="linux";;
  MINGW*|MSYS*|CYGWIN*) OS="windows";;
esac
echo "🖥️  Detected OS: $OS"

# ── Find Python ──
PYTHON=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON="$cmd"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "❌ Python not found. Install Python 3.12+ from https://python.org"
  exit 1
fi
echo "🐍 Using: $PYTHON ($($PYTHON --version 2>&1))"

# ── Find Node ──
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install Node 20+ from https://nodejs.org"
  exit 1
fi
echo "📦 Using: node $(node --version)"

# ── Kill existing processes on ports 3000 & 8000 ──
kill_port() {
  local port=$1
  case "$OS" in
    mac|linux)
      lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
      ;;
    windows)
      # Git Bash on Windows
      netstat -ano 2>/dev/null | grep ":${port} " | awk '{print $5}' | sort -u | while read pid; do
        taskkill //F //PID "$pid" 2>/dev/null || true
      done
      ;;
  esac
}

echo "🧹 Cleaning up old processes..."
kill_port 8000
kill_port 3000

# ── Setup Backend ──
echo ""
echo "⚙️  Setting up backend..."
cd backend

# Create venv if missing
if [ ! -d "venv" ]; then
  echo "   Creating Python virtual environment..."
  $PYTHON -m venv venv
fi

# Activate venv (cross-platform)
if [ "$OS" = "windows" ]; then
  source venv/Scripts/activate
else
  source venv/bin/activate
fi

# Install/update deps
echo "   Installing Python dependencies..."
pip install -q -r requirements.txt 2>&1 | tail -1

# Create .env if missing
if [ ! -f ".env" ]; then
  echo ""
  echo "📝 No .env found — creating from template..."
  cp .env.example .env
  echo "⚠️  IMPORTANT: Edit backend/.env and add your GOOGLE_API_KEY"
  echo "   Get one at: https://aistudio.google.com/apikey"
  echo ""
fi

cd ..

# ── Setup Frontend ──
echo "⚙️  Setting up frontend..."
cd frontend

# Install npm deps if needed
if [ ! -d "node_modules" ]; then
  echo "   Installing npm dependencies..."
  npm install --silent
fi

# Clear stale Next.js lock
rm -f .next/dev/lock

cd ..

# ── Launch ──
echo ""
echo "🚀 Starting MathBoard..."
echo "   Backend:  http://localhost:8000"
echo "   Frontend: http://localhost:3000"
echo ""
echo "   Press Ctrl+C to stop both services."
echo ""

# Trap to kill all child processes on exit
trap 'echo ""; echo "👋 Shutting down..."; kill 0 2>/dev/null; exit 0' INT TERM EXIT

# Start backend
(cd backend && \
  if [ "$OS" = "windows" ]; then source venv/Scripts/activate; else source venv/bin/activate; fi && \
  uvicorn main:app --host 0.0.0.0 --port 8000 2>&1 | sed 's/^/   [backend] /') &

# Wait for backend to be ready
echo "   Waiting for backend..."
for i in $(seq 1 15); do
  if curl -s http://localhost:8000/health >/dev/null 2>&1; then
    echo "   ✅ Backend ready!"
    break
  fi
  sleep 1
done

# Start frontend
(cd frontend && npm run dev 2>&1 | sed 's/^/   [frontend] /') &

wait
