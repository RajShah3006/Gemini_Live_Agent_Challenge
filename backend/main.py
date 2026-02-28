import asyncio
import base64
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config as cfg
from services.gemini_service import GeminiSession
from services.session_service import SessionService
from services.whiteboard_service import WhiteboardService

# ── Cloud Logging ──
try:
    import google.cloud.logging as cloud_logging
    cl_client = cloud_logging.Client(project=cfg.GCP_PROJECT_ID or None)
    cl_client.setup_logging(log_level=logging.INFO)
    logging.info("Cloud Logging attached")
except Exception:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.info("Cloud Logging unavailable, using local logs")

logger = logging.getLogger("mathboard")

app = FastAPI(title="MathBoard Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_svc = SessionService()
whiteboard_svc = WhiteboardService()


@app.get("/health")
async def health():
    return {"status": "ok"}


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
        cmds = whiteboard_svc.get_commands(session_id)
        if not cmds:
            raise HTTPException(status_code=404, detail="No whiteboard data")
        json_bytes = json.dumps(cmds, indent=2).encode()
        url = whiteboard_svc.upload_export(session_id, json_bytes, "whiteboard.json", "application/json")
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

    # Try to create a Firestore session
    try:
        session_id = await session_svc.create_session()
        logger.info(f"Session started: {session_id}")
    except Exception as e:
        logger.warning(f"Firestore session create failed (continuing without): {e}")

    async def on_audio(data: bytes):
        """Forward audio from Gemini to the client."""
        encoded = base64.b64encode(data).decode("utf-8") if isinstance(data, bytes) else data
        await ws.send_json({"type": "audio", "payload": {"data": encoded}})

    async def on_whiteboard(cmd: dict):
        """Forward whiteboard commands to the client."""
        if session_id:
            whiteboard_svc.track_command(session_id, cmd)
        await ws.send_json({"type": "whiteboard", "payload": cmd})

    async def on_transcript(role: str, text: str):
        """Forward transcript updates to the client."""
        await ws.send_json({"type": "transcript", "payload": {"role": role, "text": text}})

    async def on_status(status: dict):
        """Forward status updates to the client."""
        await ws.send_json({"type": "status", "payload": status})

    session = GeminiSession(
        on_audio=on_audio,
        on_whiteboard=on_whiteboard,
        on_transcript=on_transcript,
        on_status=on_status,
    )

    try:
        await session.connect()
        await ws.send_json({"type": "status", "payload": {"connected": True, "session_id": session_id}})

        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "")
            payload = data.get("payload", {})

            if msg_type == "audio":
                audio_bytes = base64.b64decode(payload.get("data", ""))
                await session.send_audio(audio_bytes)

            elif msg_type == "text":
                text = payload.get("text", "")
                if text:
                    await session.send_text(text)
                    # Save user message to Firestore
                    if session_id:
                        try:
                            await session_svc.save_message(session_id, "user", text)
                        except Exception:
                            pass

            elif msg_type == "image":
                image_data = payload.get("data", "")
                if image_data:
                    await session.send_image(image_data)
                    if session_id:
                        try:
                            await session_svc.save_message(session_id, "user", "[image uploaded]")
                        except Exception:
                            pass

            elif msg_type == "control":
                action = payload.get("action", "")
                if action == "clear":
                    await on_whiteboard({
                        "id": "clear",
                        "action": "clear",
                        "params": {},
                    })

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await session.close()
        if session_id:
            try:
                await session_svc.end_session(session_id)
            except Exception:
                pass
            whiteboard_svc.clear_session(session_id)
