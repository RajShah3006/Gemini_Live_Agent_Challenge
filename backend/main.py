import asyncio
import base64
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from services.gemini_service import GeminiSession

app = FastAPI(title="MathBoard Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/session")
async def websocket_session(ws: WebSocket):
    await ws.accept()

    async def on_audio(data: bytes):
        """Forward audio from Gemini to the client."""
        encoded = base64.b64encode(data).decode("utf-8") if isinstance(data, bytes) else data
        await ws.send_json({"type": "audio", "payload": {"data": encoded}})

    async def on_whiteboard(cmd: dict):
        """Forward whiteboard commands to the client."""
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
        await ws.send_json({"type": "status", "payload": {"connected": True}})

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

            elif msg_type == "image":
                image_data = payload.get("data", "")
                if image_data:
                    await session.send_image(image_data)

            elif msg_type == "control":
                action = payload.get("action", "")
                if action == "clear":
                    await on_whiteboard({
                        "id": "clear",
                        "action": "clear",
                        "params": {},
                    })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await session.close()
