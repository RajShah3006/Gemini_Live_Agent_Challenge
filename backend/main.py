from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from models.messages import ClientMessage, ServerMessage

app = FastAPI(title="Gemini Live Agent")

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
    try:
        while True:
            data = await ws.receive_json()
            client_msg = ClientMessage(**data)
            response = ServerMessage(
                type="ack",
                payload={"received_type": client_msg.type},
            )
            await ws.send_json(response.model_dump())
    except WebSocketDisconnect:
        pass
