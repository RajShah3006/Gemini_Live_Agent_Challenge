"""Gemini Live API service — real-time audio/text/vision with function calling."""

import asyncio
import base64
import json
import uuid
from typing import AsyncGenerator, Callable, Awaitable

from google import genai
from google.genai import types

import config as cfg

# ── Tool declarations using SDK types ──

def _schema(props: dict, required: list[str] | None = None) -> types.Schema:
    return types.Schema(
        type="OBJECT",
        properties={k: types.Schema(**v) for k, v in props.items()},
        required=required or [],
    )

# Keep tools minimal — native audio models crash with too many tool declarations
WHITEBOARD_DECLS = [
    types.FunctionDeclaration(
        name="clear_whiteboard",
        description="Clear the entire whiteboard before starting a new problem",
        parameters=_schema({}),
    ),
    types.FunctionDeclaration(
        name="step_marker",
        description="Place a step number label (e.g. Step 1, Step 2) on the whiteboard",
        parameters=_schema({
            "step": {"type": "NUMBER", "description": "Step number"},
            "x": {"type": "NUMBER", "description": "X coordinate"},
            "y": {"type": "NUMBER", "description": "Y coordinate"},
        }, ["step", "x", "y"]),
    ),
    types.FunctionDeclaration(
        name="draw_text",
        description="Draw plain text on the whiteboard — use for labels, explanations, commentary",
        parameters=_schema({
            "text": {"type": "STRING", "description": "Text to display"},
            "x": {"type": "NUMBER", "description": "X coordinate (px from left, keep 40-700)"},
            "y": {"type": "NUMBER", "description": "Y coordinate (px from top)"},
            "size": {"type": "NUMBER", "description": "Font size in px (default 24)"},
        }, ["text", "x", "y"]),
    ),
    types.FunctionDeclaration(
        name="draw_latex",
        description="Draw a math expression on the whiteboard — use for ALL math: equations, fractions, variables",
        parameters=_schema({
            "latex": {"type": "STRING", "description": "Math expression, e.g. 'x = (-b ± √(b²-4ac)) / 2a'"},
            "x": {"type": "NUMBER", "description": "X coordinate"},
            "y": {"type": "NUMBER", "description": "Y coordinate"},
            "size": {"type": "NUMBER", "description": "Font size (default 28)"},
        }, ["latex", "x", "y"]),
    ),
    types.FunctionDeclaration(
        name="draw_line",
        description="Draw a straight line on the whiteboard (for underlines, dividers, diagrams)",
        parameters=_schema({
            "x1": {"type": "NUMBER"}, "y1": {"type": "NUMBER"},
            "x2": {"type": "NUMBER"}, "y2": {"type": "NUMBER"},
        }, ["x1", "y1", "x2", "y2"]),
    ),
]

WHITEBOARD_TOOLS = [types.Tool(function_declarations=WHITEBOARD_DECLS)]

SYSTEM_INSTRUCTION = """You are MathBoard, a math tutor who can teach ANY level — from basic arithmetic to graduate math. You have a whiteboard.

RULES — follow strictly:
1. Call tools IMMEDIATELY. Do not think silently — start drawing right away.
2. clear_whiteboard() first for every new question.
3. step_marker() for each step heading.
4. draw_latex() for ALL math. draw_text() for SHORT labels only (under 25 chars).
5. y starts at 60, increment ~70px. x between 40-700. Solve COMPLETELY.
6. Pace tool calls with your speech. One idea at a time.

START DRAWING IMMEDIATELY when asked a question."""

MODEL = "gemini-2.5-flash-native-audio-latest"


class GeminiSession:
    """Manages a single Gemini Live API session with function calling."""

    def __init__(self, on_audio: Callable[[bytes], Awaitable[None]],
                 on_whiteboard: Callable[[dict], Awaitable[None]],
                 on_transcript: Callable[[str, str], Awaitable[None]],
                 on_status: Callable[[dict], Awaitable[None]]):
        self.on_audio = on_audio
        self.on_whiteboard = on_whiteboard
        self.on_transcript = on_transcript
        self.on_status = on_status
        self._session = None
        self._ctx = None
        self._client = genai.Client(api_key=cfg.GOOGLE_API_KEY)
        self._receive_task: asyncio.Task | None = None

    async def connect(self):
        """Open a Gemini Live session."""
        live_config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(
                parts=[types.Part(text=SYSTEM_INSTRUCTION)]
            ),
            tools=WHITEBOARD_TOOLS,
        )
        self._ctx = self._client.aio.live.connect(
            model=MODEL, config=live_config
        )
        self._session = await self._ctx.__aenter__()
        self._receive_task = asyncio.create_task(self._receive_loop())

    async def _reconnect(self):
        """Attempt to reconnect after an internal error."""
        print("[RECONNECT] Cleaning up old session...")
        try:
            if self._session and self._ctx:
                await self._ctx.__aexit__(None, None, None)
        except Exception:
            pass
        self._session = None
        self._ctx = None

        for attempt in range(3):
            wait = 1.5 * (attempt + 1)
            print(f"[RECONNECT] Attempt {attempt + 1}/3 in {wait}s...")
            await asyncio.sleep(wait)
            try:
                await self.connect()
                print("[RECONNECT] Success!")
                await self.on_status({"connected": True, "reconnected": True})
                return True
            except Exception as e:
                print(f"[RECONNECT] Attempt {attempt + 1} failed: {e}")
        print("[RECONNECT] All attempts failed")
        return False

    async def _receive_loop(self):
        """Continuously receive responses from Gemini."""
        try:
            while self._session:
                turn = self._session.receive()
                async for response in turn:
                    try:
                        await self._handle_response(response)
                    except Exception as e:
                        print(f"[ERROR] handling response: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            error_str = str(e)
            print(f"Receive loop error: {error_str}")
            if "internal" in error_str.lower():
                print("[WARN] Gemini internal error — attempting auto-reconnect...")
                await self.on_status({"error": "Gemini internal error — reconnecting...", "reconnecting": True})
                if await self._reconnect():
                    return  # reconnect starts a new receive loop via connect()
            await self.on_status({"error": f"Session lost: {error_str}", "connected": False})

    async def _handle_response(self, response):
        """Process a single response from Gemini."""
        # Debug: log every response
        attrs = []
        if response.data is not None:
            attrs.append("data(audio)")
        if response.tool_call:
            attrs.append(f"tool_call({len(response.tool_call.function_calls)})")
        if response.server_content:
            sc = response.server_content
            if hasattr(sc, 'model_turn') and sc.model_turn:
                parts = [type(p).__name__ for p in (sc.model_turn.parts or [])]
                attrs.append(f"model_turn({parts})")
            if hasattr(sc, 'interrupted') and sc.interrupted:
                attrs.append("interrupted")
            if hasattr(sc, 'turn_complete') and sc.turn_complete:
                attrs.append("turn_complete")
        if attrs:
            print(f"[RESP] {', '.join(attrs)}")

        # Handle audio output
        if response.data is not None:
            await self.on_audio(response.data)
            await self.on_status({"speaking": True})

        # Handle tool calls (whiteboard commands)
        if response.tool_call:
            print(f"[TOOL CALL] {len(response.tool_call.function_calls)} function(s)")
            function_responses = []
            for fc in response.tool_call.function_calls:
                action = fc.name
                params = dict(fc.args) if fc.args else {}
                print(f"  → {action}({params})")

                if action == "clear_whiteboard":
                    action = "clear"
                    params = {}

                cmd = {
                    "id": str(uuid.uuid4()),
                    "action": action,
                    "params": params,
                }
                await self.on_whiteboard(cmd)

                # Respond to Gemini that the function was executed
                function_responses.append(
                    types.FunctionResponse(
                        id=fc.id,
                        name=fc.name,
                        response={"status": "ok"},
                    )
                )

            if function_responses:
                await self._session.send_tool_response(
                    function_responses=function_responses
                )

        # Handle turn completion
        if response.server_content:
            if hasattr(response.server_content, 'interrupted') and response.server_content.interrupted:
                await self.on_status({"speaking": False, "interrupted": True})

            if hasattr(response.server_content, 'turn_complete') and response.server_content.turn_complete:
                await self.on_status({"speaking": False, "turn_complete": True})

            # Extract text transcript if present (log only, don't send to frontend)
            if response.server_content.model_turn:
                for part in response.server_content.model_turn.parts:
                    if hasattr(part, 'text') and part.text:
                        print(f"[TRANSCRIPT] tutor: {part.text[:80]}...")

    async def send_audio(self, audio_data: bytes):
        """Send audio chunk from user's microphone."""
        if self._session:
            await self._session.send_realtime_input(
                audio={"data": audio_data, "mime_type": "audio/pcm"}
            )

    async def send_text(self, text: str):
        """Send a text message (typed question or interruption)."""
        if self._session:
            await self._session.send_client_content(
                turns={"parts": [{"text": text}]}
            )

    async def send_image(self, base64_data: str):
        """Send an uploaded image for Gemini to analyze."""
        if self._session:
            # Strip data URI prefix if present
            if "," in base64_data:
                base64_data = base64_data.split(",", 1)[1]

            await self._session.send_client_content(
                turns={
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": base64_data,
                            }
                        },
                        {"text": "Please analyze this image, identify the math problem(s), and solve them step by step on the whiteboard."},
                    ]
                }
            )

    async def close(self):
        """Close the Gemini session."""
        if self._receive_task:
            self._receive_task.cancel()
        if self._session and self._ctx:
            await self._ctx.__aexit__(None, None, None)
            self._session = None
            self._ctx = None

