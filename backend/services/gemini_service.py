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

WHITEBOARD_DECLS = [
    types.FunctionDeclaration(
        name="draw_text",
        description="Draw plain text on the whiteboard. ALWAYS call this tool — never just speak text without drawing it.",
        parameters=_schema({
            "text": {"type": "STRING", "description": "Text to display"},
            "x": {"type": "NUMBER", "description": "X coordinate (px from left, keep 40-700)"},
            "y": {"type": "NUMBER", "description": "Y coordinate (px from top)"},
            "size": {"type": "NUMBER", "description": "Font size in px (default 24)"},
            "color": {"type": "STRING", "description": "CSS color (default white)"},
        }, ["text", "x", "y"]),
    ),
    types.FunctionDeclaration(
        name="draw_latex",
        description="Draw a math expression on the whiteboard. Use for ALL math: equations, fractions, variables, numbers. MUST call this for every math expression.",
        parameters=_schema({
            "latex": {"type": "STRING", "description": "Math expression, e.g. 'x = (-b ± √(b²-4ac)) / 2a'"},
            "x": {"type": "NUMBER", "description": "X coordinate"},
            "y": {"type": "NUMBER", "description": "Y coordinate"},
            "size": {"type": "NUMBER", "description": "Font size (default 28)"},
            "color": {"type": "STRING", "description": "CSS color (default cyan)"},
        }, ["latex", "x", "y"]),
    ),
    types.FunctionDeclaration(
        name="draw_line",
        description="Draw a straight line on the whiteboard",
        parameters=_schema({
            "x1": {"type": "NUMBER"}, "y1": {"type": "NUMBER"},
            "x2": {"type": "NUMBER"}, "y2": {"type": "NUMBER"},
            "color": {"type": "STRING"}, "width": {"type": "NUMBER"},
        }, ["x1", "y1", "x2", "y2"]),
    ),
    types.FunctionDeclaration(
        name="draw_arrow",
        description="Draw an arrow on the whiteboard",
        parameters=_schema({
            "x1": {"type": "NUMBER"}, "y1": {"type": "NUMBER"},
            "x2": {"type": "NUMBER"}, "y2": {"type": "NUMBER"},
            "color": {"type": "STRING"}, "width": {"type": "NUMBER"},
        }, ["x1", "y1", "x2", "y2"]),
    ),
    types.FunctionDeclaration(
        name="draw_circle",
        description="Draw a circle on the whiteboard",
        parameters=_schema({
            "cx": {"type": "NUMBER"}, "cy": {"type": "NUMBER"},
            "r": {"type": "NUMBER"},
            "color": {"type": "STRING"}, "width": {"type": "NUMBER"},
        }, ["cx", "cy", "r"]),
    ),
    types.FunctionDeclaration(
        name="draw_rect",
        description="Draw a rectangle on the whiteboard",
        parameters=_schema({
            "x": {"type": "NUMBER"}, "y": {"type": "NUMBER"},
            "w": {"type": "NUMBER"}, "h": {"type": "NUMBER"},
            "color": {"type": "STRING"}, "width": {"type": "NUMBER"},
        }, ["x", "y", "w", "h"]),
    ),
    types.FunctionDeclaration(
        name="highlight",
        description="Highlight a rectangular area (semi-transparent overlay)",
        parameters=_schema({
            "x": {"type": "NUMBER"}, "y": {"type": "NUMBER"},
            "w": {"type": "NUMBER"}, "h": {"type": "NUMBER"},
            "color": {"type": "STRING"},
        }, ["x", "y", "w", "h"]),
    ),
    types.FunctionDeclaration(
        name="step_marker",
        description="Place a step number label on the whiteboard",
        parameters=_schema({
            "step": {"type": "NUMBER", "description": "Step number"},
            "x": {"type": "NUMBER"}, "y": {"type": "NUMBER"},
        }, ["step", "x", "y"]),
    ),
    types.FunctionDeclaration(
        name="clear_whiteboard",
        description="Clear the entire whiteboard before starting a new problem",
        parameters=_schema({}),
    ),
]

WHITEBOARD_TOOLS = [types.Tool(function_declarations=WHITEBOARD_DECLS)]

SYSTEM_INSTRUCTION = """You are MathBoard, a patient and encouraging AI math tutor with a digital whiteboard.

YOU MUST ALWAYS CALL THE WHITEBOARD TOOL FUNCTIONS to draw on the board. Never just speak math without drawing it.

For EVERY math problem:
1. Call clear_whiteboard first.
2. Call step_marker(step=1, x=40, y=50) for each step.
3. Call draw_latex to write every equation and expression. This is mandatory.
4. Call draw_text for labels and short explanations.
5. Call draw_line / draw_arrow / draw_circle for diagrams.
6. Space vertically: start y=60, increment by ~70px per step. Keep x between 40-700.
7. Speak naturally while calling tools — explain what you are writing.

Example for "solve 2x + 3 = 7":
- call clear_whiteboard()
- call step_marker(step=1, x=40, y=50)
- call draw_latex(latex="2x + 3 = 7", x=60, y=80)
- call draw_text(text="Subtract 3 from both sides", x=60, y=130)
- call step_marker(step=2, x=40, y=170)
- call draw_latex(latex="2x = 4", x=60, y=200)
- call step_marker(step=3, x=40, y=250)
- call draw_latex(latex="x = 2", x=60, y=280, size=32)

NEVER describe math verbally without also calling draw_latex or draw_text. The student's whiteboard is blank unless you call the tools."""

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

    async def _receive_loop(self):
        """Continuously receive responses from Gemini."""
        try:
            while self._session:
                turn = self._session.receive()
                async for response in turn:
                    await self._handle_response(response)
        except Exception as e:
            print(f"Receive loop error: {e}")

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
                        response={"result": "ok", "scheduling": "WHEN_IDLE"},
                    )
                )

            if function_responses:
                await self._session.send_tool_response(
                    function_responses=function_responses
                )

        # Handle turn completion
        if response.server_content:
            if hasattr(response.server_content, 'interrupted') and response.server_content.interrupted:
                await self.on_status({"speaking": False})

            if hasattr(response.server_content, 'turn_complete') and response.server_content.turn_complete:
                await self.on_status({"speaking": False})

            # Extract text transcript if present
            if response.server_content.model_turn:
                for part in response.server_content.model_turn.parts:
                    if hasattr(part, 'text') and part.text:
                        await self.on_transcript("tutor", part.text)

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

