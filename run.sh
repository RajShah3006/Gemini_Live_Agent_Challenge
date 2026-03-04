#!/usr/bin/env bash
# ─── MathBoard — One-Command Launcher ───
# Works on macOS, Linux, and Windows (Git Bash / WSL)
# Usage: ./run.sh
#
# Prerequisites (the script will tell you if anything is missing):
#   • Python 3.10–3.12  (https://python.org)
#   • Node.js 18+       (https://nodejs.org)
#   • A Gemini API key   (https://aistudio.google.com/apikey)

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ── Detect OS ──
OS="unknown"
case "$(uname -s)" in
  Darwin*)  OS="mac";;
  Linux*)   OS="linux";;
  MINGW*|MSYS*|CYGWIN*) OS="windows";;
esac
echo "🖥️  Detected OS: $OS"

# ── Find Python (prefer 3.10–3.12 to avoid Rust compile issues) ──
PYTHON=""
for cmd in python3.12 python3.11 python3.10 python3 python; do
  if command -v "$cmd" &>/dev/null; then
    PY_VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
    PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
    if [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ] && [ "$PY_MINOR" -le 12 ]; then
      PYTHON="$cmd"
      break
    fi
  fi
done

# Fallback: accept any Python 3.10+ but warn about 3.13+
if [ -z "$PYTHON" ]; then
  for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
      PY_VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
      PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
      PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
      if [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ]; then
        PYTHON="$cmd"
        if [ "$PY_MINOR" -ge 13 ]; then
          echo "⚠️  Python $PY_VER detected — 3.12 is recommended (some packages may need Rust to compile)."
          echo "   If you see Rust/cargo errors, install Python 3.12 from https://python.org"
        fi
        break
      fi
    fi
  done
fi

if [ -z "$PYTHON" ]; then
  echo "❌ Python 3.10+ not found."
  if [ "$OS" = "windows" ]; then
    echo "   Download Python 3.12 from https://python.org/downloads"
    echo "   ⚠️  IMPORTANT: Check 'Add Python to PATH' during installation!"
  elif [ "$OS" = "mac" ]; then
    echo "   Run: brew install python@3.12"
  else
    echo "   Run: sudo apt install python3.12 python3.12-venv"
  fi
  exit 1
fi
echo "🐍 Using: $PYTHON ($($PYTHON --version 2>&1))"

# ── Ensure venv module is available (needed on some Linux distros) ──
if ! $PYTHON -c "import venv" &>/dev/null; then
  echo "❌ Python venv module not found."
  if [ "$OS" = "linux" ]; then
    echo "   Run: sudo apt install python3-venv"
  fi
  exit 1
fi

# ── Find Node ──
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found."
  if [ "$OS" = "windows" ]; then
    echo "   Download from https://nodejs.org (LTS version)"
  elif [ "$OS" = "mac" ]; then
    echo "   Run: brew install node"
  else
    echo "   Run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  fi
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js v${NODE_MAJOR} found — need 18+. Update from https://nodejs.org"
  exit 1
fi
echo "📦 Using: node $(node --version)"

# ── Find npm ──
if ! command -v npm &>/dev/null; then
  echo "❌ npm not found. It should come with Node.js — reinstall from https://nodejs.org"
  exit 1
fi

# ── Kill existing processes on ports 3000 & 8000 ──
kill_port() {
  local port=$1
  case "$OS" in
    mac|linux)
      lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
      ;;
    windows)
      netstat -ano 2>/dev/null | grep ":${port} " | awk '{print $5}' | sort -u | while read pid; do
        [ -n "$pid" ] && [ "$pid" != "0" ] && taskkill //F //PID "$pid" 2>/dev/null || true
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
cd "$ROOT_DIR/backend"

# Create venv if missing or broken
if [ ! -f "venv/pyvenv.cfg" ]; then
  echo "   Creating Python virtual environment..."
  rm -rf venv
  $PYTHON -m venv venv
fi

# Activate venv (cross-platform)
if [ "$OS" = "windows" ]; then
  source venv/Scripts/activate
else
  source venv/bin/activate
fi

# Upgrade pip + setuptools + wheel first (avoids Rust/build issues on Windows)
echo "   Upgrading pip..."
pip install --upgrade pip setuptools wheel -q 2>&1 | tail -1 || true

# Install deps — try binary-only first to avoid compiling from source
echo "   Installing Python dependencies..."
pip install --only-binary=:all: -q -r requirements.txt 2>&1 | tail -3 || {
  echo "   ⚠️  Pre-built binaries unavailable for some packages, trying source build..."
  pip install -q -r requirements.txt 2>&1 | tail -3 || {
    echo ""
    echo "   ❌ Failed to install Python packages."
    echo "   This usually means your Python version ($PY_VER) doesn't have pre-built wheels."
    echo "   Fix: Install Python 3.12 from https://python.org/downloads"
    exit 1
  }
}

# ── Ensure .env exists and has API key ──
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "   📝 Created backend/.env from template."
fi

# Check if API key is set
API_KEY=$(grep -E "^GOOGLE_API_KEY=" .env 2>/dev/null | cut -d= -f2- || echo "")
if [ -z "$API_KEY" ] || [ "$API_KEY" = "your-google-api-key" ]; then
  echo ""
  echo "   🔑 Gemini API key is required to run MathBoard."
  echo "   Get one free at: https://aistudio.google.com/apikey"
  echo ""
  read -rp "   Paste your API key here (or press Enter to skip): " USER_KEY
  if [ -n "$USER_KEY" ]; then
    if [ "$OS" = "mac" ]; then
      sed -i '' "s|^GOOGLE_API_KEY=.*|GOOGLE_API_KEY=${USER_KEY}|" .env
    else
      sed -i "s|^GOOGLE_API_KEY=.*|GOOGLE_API_KEY=${USER_KEY}|" .env
    fi
    echo "   ✅ API key saved to backend/.env"
  else
    echo "   ⚠️  Skipped — edit backend/.env manually before using the app."
  fi
fi

cd "$ROOT_DIR"

# ── Setup Frontend ──
echo ""
echo "⚙️  Setting up frontend..."
cd "$ROOT_DIR/frontend"

# Install npm deps if needed
if [ ! -d "node_modules" ]; then
  echo "   Installing npm dependencies (this may take a minute)..."
  npm install 2>&1 | tail -3
fi

# Clear stale Next.js lock
rm -f .next/dev/lock

cd "$ROOT_DIR"

# ── Launch ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Starting MathBoard..."
echo "   Backend:  http://localhost:8000"
echo "   Frontend: http://localhost:3000"
echo ""
echo "   Press Ctrl+C to stop both services."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Trap to kill all child processes on exit
trap 'echo ""; echo "👋 Shutting down..."; kill 0 2>/dev/null; exit 0' INT TERM EXIT

# Start backend (use python -m uvicorn for portability)
(cd "$ROOT_DIR/backend" && \
  if [ "$OS" = "windows" ]; then source venv/Scripts/activate; else source venv/bin/activate; fi && \
  python -m uvicorn main:app --host 0.0.0.0 --port 8000 2>&1 | sed 's/^/   [backend] /') &

# Wait for backend to be ready (with timeout)
echo "   Waiting for backend..."
READY=0
for i in $(seq 1 20); do
  if command -v curl &>/dev/null; then
    if curl -s http://localhost:8000/health >/dev/null 2>&1; then
      READY=1
      break
    fi
  else
    # No curl (common on fresh Windows) — just wait a few seconds
    if [ "$i" -ge 5 ]; then
      READY=1
      break
    fi
  fi
  sleep 1
done
if [ "$READY" -eq 1 ]; then
  echo "   ✅ Backend ready!"
else
  echo "   ⚠️  Backend may not be ready — check output above for errors"
fi

# Start frontend
(cd "$ROOT_DIR/frontend" && npx next dev --port 3000 2>&1 | sed 's/^/   [frontend] /') &

# Give frontend a moment then open browser
sleep 3
echo ""
echo "   🌐 Opening http://localhost:3000 ..."
case "$OS" in
  mac)    open "http://localhost:3000" 2>/dev/null || true ;;
  linux)  xdg-open "http://localhost:3000" 2>/dev/null || true ;;
  windows) start "http://localhost:3000" 2>/dev/null || cmd.exe /c start http://localhost:3000 2>/dev/null || true ;;
esac

wait
