#!/bin/bash
# Start both backend and frontend for MathBoard
# Usage: ./run.sh

trap 'kill 0' EXIT

echo "🚀 Starting MathBoard..."

# Kill anything on ports 3000/8000
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null
rm -f frontend/.next/dev/lock

# Backend
echo "⚡ Starting backend on :8000..."
(cd backend && source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000) &

# Frontend
echo "⚡ Starting frontend on :3000..."
(cd frontend && npm run dev) &

wait
