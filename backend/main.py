"""
MathBoard Backend — FastAPI application entry point.

Endpoints:
  - WebSocket /ws/session — Main bidirectional channel for voice, text, images, whiteboard
  - GET /api/sessions      — List saved sessions from Firestore
  - GET /api/sessions/{id} — Get session detail with messages
  - GET /health            — Health check
  - GET /                  — Root info

The WebSocket handler orchestrates GeminiSession (AI), WhiteboardService (state),
and SessionService (persistence) for each connected client.
"""

import asyncio
import base64
import binascii
import json
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config as cfg
from services.gemini_service import GeminiSession
from services.session_service import SessionService
from services.tts_service import synthesize as tts_synthesize
from services.whiteboard_service import WhiteboardService

# ── Cloud Logging ──
try:
    import google.cloud.logging as cloud_logging
    cl_client = cloud_logging.Client(project=cfg.GCP_PROJECT_ID or None)
    cl_client.setup_logging(log_level=logging.INFO)
    logging.info("Cloud Logging attached")
except Exception as e:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.warning(f"Cloud Logging unavailable ({e}), using local logs")

logger = logging.getLogger("mathboard")


# ── Lifespan: startup/shutdown cleanup ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    whiteboard_svc.start_cleanup_loop()
    yield
    # Shutdown: close GCP clients
    whiteboard_svc.close_client()
    session_svc.close()


app = FastAPI(title="MathBoard Backend", lifespan=lifespan)

_cors_raw = os.getenv("CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()] if _cors_raw else []

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins or [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

session_svc = SessionService()
whiteboard_svc = WhiteboardService()


# ── Per-session rate limiter ──
class RateLimiter:
    """Simple sliding-window rate limiter (per WebSocket session)."""
    def __init__(self, max_per_minute: int = 30):
        self._max = max_per_minute
        self._timestamps: list[float] = []

    def check(self) -> bool:
        now = time.time()
        self._timestamps = [t for t in self._timestamps if now - t < 60]
        if len(self._timestamps) >= self._max:
            return False
        self._timestamps.append(now)
        return True


# ── Global IP-based rate limiter ──
class GlobalRateLimiter:
    """Sliding-window rate limiter keyed by IP address."""
    def __init__(self, max_per_minute: int = 120):
        self._max = max_per_minute
        self._ips: dict[str, list[float]] = defaultdict(list)

    def check(self, ip: str) -> bool:
        now = time.time()
        timestamps = [t for t in self._ips[ip] if now - t < 60]
        if not timestamps:
            self._ips.pop(ip, None)  # GC empty entries to prevent memory leak
        else:
            self._ips[ip] = timestamps
        if len(self._ips[ip]) >= self._max:
            return False
        self._ips[ip].append(now)
        return True


_global_limiter = GlobalRateLimiter(max_per_minute=120)

# WebSocket idle timeout (seconds) — close connections idle longer than this
WS_IDLE_TIMEOUT = 300  # 5 minutes


@app.get("/health")
async def health():
    return {"status": "ok", "server_version": "voice-debug-2026-03-16a"}


# ── REST API: Session History (Firestore) ──

@app.get("/api/sessions")
async def list_sessions(limit: int = 20):
    """List recent tutoring sessions from Firestore."""
    try:
        sessions = await session_svc.list_sessions(limit=limit)
        return {"sessions": sessions}
    except Exception as e:
        logger.warning(f"Firestore list failed: {e}")
        return {"sessions": [], "error": str(e)}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a single session with all messages from Firestore."""
    try:
        data = await session_svc.get_session(session_id)
        if not data:
            raise HTTPException(status_code=404, detail="Session not found")
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Firestore get failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── REST API: Export to Cloud Storage ──

@app.post("/api/sessions/{session_id}/export")
async def export_whiteboard(session_id: str):
    """Upload current whiteboard commands as JSON to Cloud Storage."""
    try:
        cmds = await whiteboard_svc.get_commands(session_id)
        if not cmds:
            raise HTTPException(status_code=404, detail="No whiteboard data")
        json_bytes = json.dumps(cmds, indent=2).encode()
        url = await whiteboard_svc.upload_export(session_id, json_bytes, "whiteboard.json", "application/json")
        return {"url": url, "commands": len(cmds)}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"GCS export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── WebSocket: Live Tutoring Session ──

@app.websocket("/ws/session")
async def websocket_session(ws: WebSocket):
    await ws.accept()
    session_id = None
    ws_open = True  # set to False as soon as the client socket closes
    tts_enabled = False  # client toggles this via tts_toggle message

    # Try to create a Firestore session
    try:
        session_id = await session_svc.create_session()
        logger.info(f"Session started: {session_id}")
    except Exception as e:
        logger.warning(f"Firestore session create failed (continuing without): {e}")

    async def _send(payload: dict) -> bool:
        """Send a JSON message to the client. Returns False if the socket is closed."""
        if not ws_open:
            return False
        try:
            await ws.send_json(payload)
            return True
        except Exception:
            # Client already disconnected — swallow silently
            return False

    async def on_audio(data: bytes):
        """Forward audio from Gemini to the client."""
        encoded = base64.b64encode(data).decode("utf-8") if isinstance(data, bytes) else data
        await _send({"type": "audio", "payload": {"data": encoded}})

    async def on_whiteboard(cmd: dict):
        """Forward whiteboard commands to the client."""
        if session_id:
            await whiteboard_svc.track_command(session_id, cmd)
        await _send({"type": "whiteboard", "payload": cmd})

    async def _synthesize_and_send(text: str):
        """Synthesize TTS audio and send to client."""
        try:
            audio_b64 = await tts_synthesize(text)
            if audio_b64:
                await _send({"type": "tts_audio", "payload": {"data": audio_b64}})
        except Exception as e:
            logger.warning(f"TTS synthesis failed: {e}")

    async def on_transcript(role: str, text: str):
        """Forward transcript updates to the client. Synthesize TTS for tutor text if enabled."""
        await _send({"type": "transcript", "payload": {"role": role, "text": text}})
        # Fire-and-forget TTS for tutor responses when TTS is enabled
        if role == "tutor" and tts_enabled and text.strip():
            _track_task(asyncio.create_task(_synthesize_and_send(text)))

    async def on_status(status: dict):
        """Forward status updates to the client."""
        await _send({"type": "status", "payload": status})

    session = GeminiSession(
        on_audio=on_audio,
        on_whiteboard=on_whiteboard,
        on_transcript=on_transcript,
        on_status=on_status,
    )

    try:
        limiter = RateLimiter(max_per_minute=30)
        client_ip = ws.client.host if ws.client else "unknown"
        pending_tasks: set[asyncio.Task] = set()

        def _track_task(task: asyncio.Task):
            """Track a background task and log errors if it crashes."""
            pending_tasks.add(task)
            def _done(t: asyncio.Task):
                pending_tasks.discard(t)
                if t.cancelled():
                    return
                exc = t.exception()
                if exc:
                    logger.error(f"Background task crashed: {exc}", exc_info=exc)
            task.add_done_callback(_done)

        # Eagerly start voice session so it's ready when the user wants to talk
        _track_task(asyncio.create_task(session.start_voice()))
        await _send({"type": "status", "payload": {"connected": True, "session_id": session_id}})

        # ── Task helpers (defined once, not per-iteration) ──
        async def _handle_text(t_str: str, request_id: str | None = None):
            try:
                await session.send_text(t_str, request_id=request_id)
                if session_id:
                    try:
                        await session_svc.save_message(session_id, "user", t_str)
                    except Exception as e:
                        logger.warning(f"Firestore save failed: {e}")
            except Exception as e:
                logger.error(f"Task _handle_text crashed: {e}", exc_info=True)
                await _send({"type": "status", "payload": {"error": "Failed to process your question — please try again."}})

        async def _handle_image(d_b64: str, t_str: str, request_id: str | None = None):
            try:
                await session.send_image(d_b64, t_str, request_id=request_id)
                if session_id:
                    try:
                        await session_svc.save_message(
                            session_id,
                            "user",
                            t_str if t_str else "[image uploaded]",
                        )
                    except Exception as e:
                        logger.warning(f"Firestore save failed: {e}")
            except Exception as e:
                logger.error(f"Task _handle_image crashed: {e}", exc_info=True)
                await _send({"type": "status", "payload": {"error": "Failed to process your image — please try again."}})

        async def _handle_interrupt():
            try:
                await session.interrupt()
            except Exception as e:
                logger.error(f"Task _handle_interrupt crashed: {e}", exc_info=True)

        while True:
            try:
                raw_text = await asyncio.wait_for(ws.receive_text(), timeout=WS_IDLE_TIMEOUT)
                # Guard against oversized frames (max 10MB)
                if len(raw_text) > 10_485_760:
                    logger.warning(f"Oversized WebSocket frame ({len(raw_text)} bytes) — dropping")
                    await _send({"type": "status", "payload": {"error": "Message too large"}})
                    continue
                data = json.loads(raw_text)
            except asyncio.TimeoutError:
                logger.info(f"WebSocket idle timeout ({WS_IDLE_TIMEOUT}s) — closing {session_id}")
                await _send({"type": "status", "payload": {"error": "Session timed out due to inactivity"}})
                break
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Malformed JSON from client: {e}")
                await _send({"type": "status", "payload": {"error": "Invalid message format"}})
                continue

            msg_type = data.get("type", "")
            payload = data.get("payload", {})

            if msg_type == "audio":
                raw_b64 = payload.get("data", "")
                if len(raw_b64) > 5_000_000:  # ~3.75 MB decoded
                    logger.warning(f"Audio payload too large ({len(raw_b64)} bytes) — skipping")
                    continue
                try:
                    audio_bytes = base64.b64decode(raw_b64)
                except (binascii.Error, ValueError) as e:
                    logger.warning(f"Malformed audio base64 — skipping: {e}")
                    continue
                _track_task(asyncio.create_task(session.send_audio(audio_bytes)))

            elif msg_type == "text":
                text = (payload.get("text", "") or "")[:2000]  # cap at 2000 chars
                request_id = payload.get("request_id")
                if text:
                    if not limiter.check() or not _global_limiter.check(client_ip):
                        await _send({"type": "status", "payload": {"error": "Slow down — too many requests. Try again in a moment! ☕"}})
                        continue
                    _track_task(asyncio.create_task(_handle_text(text, str(request_id) if request_id else None)))

            elif msg_type == "image":
                image_data = payload.get("data", "")
                image_text = (payload.get("text", "") or "")[:2000]
                request_id = payload.get("request_id")
                if len(image_data) > 10_000_000:  # ~7.5 MB decoded
                    logger.warning("Image payload too large — skipping")
                    await _send({"type": "status", "payload": {"error": "Image too large (max 7 MB)"}})
                    continue
                if image_data:
                    if not limiter.check() or not _global_limiter.check(client_ip):
                        await _send({"type": "status", "payload": {"error": "Slow down — too many requests. Try again in a moment! ☕"}})
                        continue
                    _track_task(asyncio.create_task(_handle_image(image_data, image_text, str(request_id) if request_id else None)))

            elif msg_type == "interrupt":
                _track_task(asyncio.create_task(_handle_interrupt()))

            elif msg_type == "ping":
                # [Heartbeat] Respond to client health checks
                await _send({"type": "pong", "payload": {}})

            elif msg_type == "set_mode":
                new_mode = payload.get("mode", "teacher")
                await session.set_mode(new_mode)

            elif msg_type == "tts_toggle":
                tts_enabled = bool(payload.get("enabled", False))
                logger.info(f"TTS {'enabled' if tts_enabled else 'disabled'}")

            elif msg_type == "control":
                action = payload.get("action", "")
                if action == "clear":
                    await on_whiteboard({
                        "id": "user-clear",
                        "action": "clear",
                        "params": {},
                    })

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        ws_open = False  # stop all background callbacks from writing to the dead socket
        # Cancel any in-flight tasks and wait for them
        for task in pending_tasks:
            task.cancel()
        if pending_tasks:
            await asyncio.gather(*pending_tasks, return_exceptions=True)
        await session.close()
        if session_id:
            try:
                await session_svc.end_session(session_id)
            except Exception as e:
                logger.warning(f"Firestore end-session failed: {e}")
            await whiteboard_svc.clear_session(session_id)
