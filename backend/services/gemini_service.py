"""Gemini Live API service — real-time audio/text/vision with function calling."""

import asyncio
import base64
import json
import uuid
from typing import AsyncGenerator, Callable, Awaitable

from google import genai
from google.genai import types

import config as cfg

# Whiteboard tool declarations — Gemini calls these to draw on the canvas
WHITEBOARD_TOOLS = [
    {
        "function_declarations": [
            {
                "name": "draw_text",
                "description": "Draw plain text on the whiteboard at a specific position",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "The text to display"},
                        "x": {"type": "number", "description": "X coordinate (pixels from left)"},
                        "y": {"type": "number", "description": "Y coordinate (pixels from top)"},
                        "size": {"type": "number", "description": "Font size in pixels (default 18)"},
                        "color": {"type": "string", "description": "CSS color (default #e2e8f0)"},
                    },
                    "required": ["text", "x", "y"],
                },
            },
            {
                "name": "draw_latex",
                "description": "Draw a LaTeX math expression on the whiteboard",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "LaTeX math expression (e.g. 'x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}')"},
                        "x": {"type": "number", "description": "X coordinate"},
                        "y": {"type": "number", "description": "Y coordinate"},
                        "size": {"type": "number", "description": "Font size (default 22)"},
                        "color": {"type": "string", "description": "CSS color (default #a5f3fc)"},
                    },
                    "required": ["latex", "x", "y"],
                },
            },
            {
                "name": "draw_line",
                "description": "Draw a straight line on the whiteboard",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "x1": {"type": "number"}, "y1": {"type": "number"},
                        "x2": {"type": "number"}, "y2": {"type": "number"},
                        "color": {"type": "string"}, "width": {"type": "number"},
                    },
                    "required": ["x1", "y1", "x2", "y2"],
                },
            },
            {
                "name": "draw_arrow",
                "description": "Draw an arrow on the whiteboard",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "x1": {"type": "number"}, "y1": {"type": "number"},
                        "x2": {"type": "number"}, "y2": {"type": "number"},
                        "color": {"type": "string"}, "width": {"type": "number"},
                    },
                    "required": ["x1", "y1", "x2", "y2"],
                },
            },
            {
                "name": "draw_circle",
                "description": "Draw a circle on the whiteboard",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cx": {"type": "number"}, "cy": {"type": "number"},
                        "r": {"type": "number"},
                        "color": {"type": "string"}, "width": {"type": "number"},
                    },
                    "required": ["cx", "cy", "r"],
                },
            },
            {
                "name": "draw_rect",
                "description": "Draw a rectangle on the whiteboard",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"}, "y": {"type": "number"},
                        "w": {"type": "number"}, "h": {"type": "number"},
                        "color": {"type": "string"}, "width": {"type": "number"},
                    },
                    "required": ["x", "y", "w", "h"],
                },
            },
            {
                "name": "highlight",
                "description": "Highlight a rectangular area on the whiteboard (semi-transparent)",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"}, "y": {"type": "number"},
                        "w": {"type": "number"}, "h": {"type": "number"},
                        "color": {"type": "string"},
                    },
                    "required": ["x", "y", "w", "h"],
                },
            },
            {
                "name": "step_marker",
                "description": "Place a step number marker on the whiteboard to label solution steps",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "step": {"type": "number", "description": "Step number"},
                        "x": {"type": "number"}, "y": {"type": "number"},
                    },
                    "required": ["step", "x", "y"],
                },
            },
            {
                "name": "clear_whiteboard",
                "description": "Clear the entire whiteboard to start fresh",
                "parameters": {"type": "object", "properties": {}},
            },
        ]
    }
]

SYSTEM_INSTRUCTION = """You are MathBoard, a patient and encouraging AI math tutor. You help students with algebra, geometry, and calculus.

IMPORTANT RULES:
1. When explaining solutions, ALWAYS use the whiteboard tools to draw your work step by step.
2. Start each problem by clearing the whiteboard with clear_whiteboard.
3. Use step_marker to label each step (Step 1, Step 2, etc).
4. Use draw_latex for all mathematical expressions — never just describe them verbally.
5. Use draw_text for labels, explanations, and annotations.
6. Use draw_line, draw_arrow, draw_circle for diagrams and geometry.
7. Use highlight to draw attention to important parts.
8. Space your work vertically — start at y=60 and add ~60px between steps.
9. Keep x positions between 40 and 700 for readability.
10. Speak naturally while drawing — explain what you're writing as you write it.
11. If a student interrupts, stop immediately, listen, and adjust your approach.
12. If a student uploads an image, analyze it and identify the math problem.
13. Use the Socratic method when appropriate — ask guiding questions instead of just giving answers.
14. Be encouraging and patient. Celebrate when the student understands."""

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
        live_config = {
            "response_modalities": ["AUDIO"],
            "system_instruction": SYSTEM_INSTRUCTION,
            "tools": WHITEBOARD_TOOLS,
        }
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
        # Handle audio output
        if response.data is not None:
            await self.on_audio(response.data)
            await self.on_status({"speaking": True})

        # Handle tool calls (whiteboard commands)
        if response.tool_call:
            function_responses = []
            for fc in response.tool_call.function_calls:
                # Convert function call to whiteboard command
                action = fc.name
                params = dict(fc.args) if fc.args else {}

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

