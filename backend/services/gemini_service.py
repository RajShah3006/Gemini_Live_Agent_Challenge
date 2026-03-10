"""Gemini dual-model service — voice via Live API, text/image via standard API.

Architecture:
  • Audio model  (Live API, native-audio) → voice conversation + whiteboard tools
  • Whiteboard model (standard generate_content API, Flash) → text/image → whiteboard tools
  Text/image never touch the Live API, so 1011 "internal error" is impossible for them.
"""

import asyncio
import base64
import json
import logging
import uuid
from typing import Callable, Awaitable

from google import genai
from google.genai import types

import config as cfg

logger = logging.getLogger("mathboard.gemini")

# Suppress noisy SDK warnings
logging.getLogger("google_genai.types").setLevel(logging.ERROR)

# ── LaTeX escape fix ──
# JSON interprets \f \t \n \r \b as control chars, clobbering LaTeX backslashes.
# E.g. \frac → form-feed + "rac", \times → tab + "imes".
# This helper restores the backslash in all string params.

def _fix_latex_escapes(params: dict) -> dict:
    """Re-escape control characters produced by JSON-parsing LaTeX backslash commands."""
    _CTRL = {
        '\f': '\\f',   # form-feed  → \f  (fixes \frac, \forall)
        '\t': '\\t',   # tab        → \t  (fixes \times, \theta, \tan, \text, \to)
        '\b': '\\b',   # backspace  → \b  (fixes \beta, \boxed)
        '\r': '\\r',   # CR         → \r  (fixes \rightarrow, \Rightarrow)
        '\n': '\\n',   # newline    → \n  (fixes \neq, \nabla, \notin)
    }
    result = {}
    for k, v in params.items():
        if isinstance(v, str):
            for char, esc in _CTRL.items():
                v = v.replace(char, esc)
        result[k] = v
    return result

# ── Tool declarations (shared by both models) ──

def _schema(props: dict, required: list[str] | None = None) -> types.Schema:
    return types.Schema(
        type="OBJECT",
        properties={k: types.Schema(**v) for k, v in props.items()},
        required=required or [],
    )

WHITEBOARD_DECLS = [
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
    types.FunctionDeclaration(
        name="draw_circle",
        description="Draw a circle to highlight or circle an important answer, final result, or key term",
        parameters=_schema({
            "x": {"type": "NUMBER", "description": "Center X"},
            "y": {"type": "NUMBER", "description": "Center Y"},
            "radius": {"type": "NUMBER", "description": "Radius in px (default 30)"},
        }, ["x", "y"]),
    ),
    types.FunctionDeclaration(
        name="draw_graph",
        description="Plot a math function graph with labeled axes. Use for graphing equations like y=x², y=sin(x), etc.",
        parameters=_schema({
            "fn": {"type": "STRING", "description": "JS math expression using x, e.g. 'Math.sin(x)', 'x*x', '2*x+1', 'Math.pow(x,3)-x'"},
            "label": {"type": "STRING", "description": "Graph label, e.g. 'y = sin(x)'"},
            "x_min": {"type": "NUMBER", "description": "Left x bound (default -5)"},
            "x_max": {"type": "NUMBER", "description": "Right x bound (default 5)"},
            "y_min": {"type": "NUMBER", "description": "Bottom y bound (default -5)"},
            "y_max": {"type": "NUMBER", "description": "Top y bound (default 5)"},
            "x": {"type": "NUMBER", "description": "Canvas x position of graph area (default 60)"},
            "y": {"type": "NUMBER", "description": "Canvas y position of graph area (default 60)"},
            "width": {"type": "NUMBER", "description": "Graph width in px (default 500)"},
            "height": {"type": "NUMBER", "description": "Graph height in px (default 350)"},
        }, ["fn", "label"]),
    ),
]

WHITEBOARD_TOOLS = [types.Tool(function_declarations=WHITEBOARD_DECLS)]

# System prompt for Live API (voice — paces tool calls with speech)
AUDIO_SYSTEM_INSTRUCTION = """You are MathBoard, an AI math tutor. You have a whiteboard that updates in real time as you teach.

You operate in THREE teaching modes. Detect the student's intent and choose the right mode automatically.

━━━ MODE 1: LECTURE MODE ━━━
Triggered when student says: "teach me about", "explain", "what is", "how does", "introduce", "I want to learn about"

Whiteboard flow — in this exact order:
  1. draw_text("📚 [Topic Title]", x=40, y=60, size=32) — large title header
  2. draw_latex(the key formula/definition, x=40, y=120, size=30)
  3. draw_text("[One-line key idea]", x=40, y=175, size=20) — e.g. "Rate of change of a function"
  4. step_marker(1, x=40, y=220) — "Worked Example"
     draw_latex(example problem setup, x=40, y=280, size=26)
  5. step_marker(2, x=40, ...) — solve the example step by step
     draw_latex() for each step
  6. draw_circle() around the final answer
  7. draw_text("[Method name]", x=40, y=..., size=18)

━━━ MODE 2: PROBLEM SOLVE MODE ━━━
Triggered when student submits a specific problem, equation, or expression to solve.

Whiteboard flow:
  1. draw_text("Problem: [restate the problem]", x=40, y=60, size=22)
  2. draw_line(40, 95, 700, 95) — separator line under the problem
  3. step_marker(1, x=40, y=110) — first solving step
     draw_latex() for each mathematical expression
  4. Continue with step_marker(2), step_marker(3)... for each step
  5. draw_latex() for the final answer
  6. draw_circle() centered on the final answer
  7. draw_text("[Method used]", x=40, y=..., size=18)

━━━ MODE 3: FOLLOW-UP / QUESTION MODE ━━━
Triggered when student asks: "why", "can you show", "what if", "I don't understand", "explain step N", "another example"

Whiteboard flow:
  1. draw_text("↳ [Brief restatement of question]", x=40, y=next_y, size=20)
  2. draw_circle() at the coordinates of the relevant previous step (to highlight it)
  3. Add draw_latex() or draw_text() explaining that specific step
  4. If a new example is requested, add a compact worked example with step markers

━━━ UNIVERSAL RULES ━━━
1. Call tools IMMEDIATELY — start drawing right away as you speak.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. step_marker() for each step heading. Always start Step 1 for each new question. Do NOT repeat "Step N" in draw_text.
4. draw_latex() for ALL math. Always \\frac{}{} with braces. Use \\cdot or \\times for multiplication (NEVER *). Write like a blackboard.
5. draw_text() for short labels only (under 25 chars). NEVER start with "Step".
6. FINAL ANSWER: standalone draw_latex() + draw_circle() centered on it.
7. LAYOUT: x between 30–80. y starts at 60, increment ~100px per line. step_marker y + 60 for first content. Min 50px gap.
8. Use symbolic notation: "x \\to \\infty" not prose.
9. For simple arithmetic, give 2-step mental math max.

GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
HOMEWORK: Grade each problem with ✓ or show corrections.
IMAGE REFERENCES: Refer explicitly to what you see in the photo before solving.
START DRAWING IMMEDIATELY when the student asks anything."""

# System prompt for standard API (text/image — returns all tools at once)
WB_SYSTEM_INSTRUCTION = """You are MathBoard, an AI math tutor. You have a whiteboard that updates in real time as you teach.

You operate in THREE teaching modes. Detect the student's intent and choose the right mode automatically.

━━━ MODE 1: LECTURE MODE ━━━
Triggered when student says: "teach me about", "explain", "what is", "how does", "introduce", "I want to learn about"

Whiteboard flow — draw ALL of these in one response:
  1. draw_text("📚 [Topic Title]", x=40, y=60, size=32) — large title header
  2. draw_latex(the key formula/definition, x=40, y=120, size=30)
  3. draw_text("[One-line key idea]", x=40, y=175, size=20) — e.g. "Rate of change of a function"
  4. step_marker(1, x=40, y=220) — label it the "Worked Example"
     draw_latex(example problem setup, x=40, y=280, size=26)
  5. step_marker(2..N) — solve the example step by step with draw_latex() at each step
  6. draw_circle() around the final answer
  7. draw_text("[Method name]", x=40, y=..., size=18) — name the technique

━━━ MODE 2: PROBLEM SOLVE MODE ━━━
Triggered when student submits a specific problem, equation, or expression to solve.

Whiteboard flow — draw ALL of these in one response:
  1. draw_text("Problem: [restate the problem]", x=40, y=60, size=22)
  2. draw_line(40, 95, 700, 95) — separator line under the problem statement
  3. step_marker(1, x=40, y=110) — first solving step
     draw_latex() for each mathematical expression in this step
  4. step_marker(2), step_marker(3)... for every solving step — be thorough
  5. draw_latex() for the final answer as a standalone expression
  6. draw_circle() centered on the final answer coordinates
  7. draw_text("[Method used]", x=40, y=..., size=18) — e.g. "Quadratic Formula", "Integration by Parts"

━━━ MODE 3: FOLLOW-UP / QUESTION MODE ━━━
Triggered when student asks: "why", "can you show", "what if", "I don't understand", "explain step N", "another example", or prefixes with [Q1], [Q2]

Whiteboard flow:
  1. draw_text("↳ [Brief restatement of question]", x=40, y=next_y, size=20)
  2. draw_circle() at the coordinates of the relevant previous step (highlight it)
  3. draw_latex() or draw_text() explaining that specific step in detail
  4. If a new example is requested, add a compact worked example with step markers

━━━ UNIVERSAL RULES ━━━
1. Call tools IMMEDIATELY — draw the COMPLETE response in one pass.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. step_marker() for each step heading. Always start Step 1 per new question. Do NOT repeat "Step N" in draw_text.
4. draw_latex() for ALL math. Always \\frac{}{} with braces for fractions (NOT \\frac12, NOT inline /). Use \\cdot or \\times for multiplication (NEVER *). Write like a blackboard.
5. draw_text() for short labels only (under 25 chars). NEVER start with "Step".
6. LAYOUT: x between 30–80. y starts at 60, increment ~100px per line. step_marker y + 60 for first content. Min 50px gap vertically. No side annotations (x > 200 never).
7. FINAL ANSWER: standalone draw_latex() + draw_circle() on it. If integral has + C, separate draw_latex() AFTER the circle.
8. Return ALL tool calls needed for the complete response.
9. Use symbolic notation: "x \\to \\infty" not "as x approaches infinity".
10. For simple arithmetic, 2-step mental math max.

GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
HOMEWORK: When image sent, grade each problem with ✓ or show corrections.
IMAGE REFERENCES: Refer explicitly to what you see in the photo before solving. Keep using it for follow-ups.
FOLLOW-UPS: If user says "[Q1]" or "[Q2]", answer about that specific previous question.
SPOKEN SUMMARY: After ALL drawing tool calls, return a 2–3 sentence spoken explanation of what you drew. This is REQUIRED — the student hears this aloud.
START DRAWING IMMEDIATELY when asked anything."""

AUDIO_MODEL = "gemini-2.5-flash-native-audio-latest"
WHITEBOARD_MODEL = "gemini-2.5-flash-lite"
STANDARD_API_RETRIES = 3
LIVE_CONNECT_RETRIES = 3
RETRYABLE_ERROR_MARKERS = (
    "429",
    "500",
    "503",
    "504",
    "resource exhausted",
    "quota",
    "rate limit",
    "temporarily unavailable",
    "try again",
    "high demand",
    "overloaded",
    "unavailable",
    "internal",
)


def _is_retryable_error(error: Exception) -> bool:
    message = str(error).lower()
    return any(marker in message for marker in RETRYABLE_ERROR_MARKERS)


def _build_image_prompt(user_text: str | None) -> str:
    cleaned = (user_text or "").strip()
    base = (
        "Use the uploaded photo as your main reference. First identify what is visible in the photo, "
        "including the exact math problem and any student work or mistakes shown. Then explain the problem "
        "using the photo as context and solve it step by step on the whiteboard."
    )
    if cleaned:
        return f"{base} Also answer the student's request: {cleaned}"
    return (
        f"{base} If the photo shows homework, grade each visible problem and explain any corrections."
    )


class GeminiSession:
    """Dual-model session: Live API for voice, standard API for text/image."""

    def __init__(self, on_audio: Callable[[bytes], Awaitable[None]],
                 on_whiteboard: Callable[[dict], Awaitable[None]],
                 on_transcript: Callable[[str, str], Awaitable[None]],
                 on_status: Callable[[dict], Awaitable[None]]):
        self.on_audio = on_audio
        self.on_whiteboard = on_whiteboard
        self.on_transcript = on_transcript
        self.on_status = on_status
        self._client = genai.Client(api_key=cfg.GOOGLE_API_KEY)

        # ── Live API state (voice) ──
        self._session = None
        self._ctx = None
        self._receive_task: asyncio.Task | None = None
        self._connecting = False
        self._speaking = False
        self._audio_transcript_buf: list[str] = []  # capture voice model text

        # ── Standard API state (text/image → whiteboard) ──
        self._wb_history: list[types.Content] = []
        self._wb_lock = asyncio.Lock()  # prevent concurrent whiteboard generation

    # ═══════════════════════════════════════════════════════════
    #  STANDARD API — text & image (zero connection issues)
    # ═══════════════════════════════════════════════════════════

    async def send_text(self, text: str):
        """Text input → standard generate_content API. No WebSocket, no 1011."""
        logger.info(f"[WB] Text question: {text[:80]}...")
        await self._generate_whiteboard(text)

    async def send_image(self, base64_data: str, text: str | None = None):
        """Image input → standard generate_content API."""
        if "," in base64_data:
            base64_data = base64_data.split(",", 1)[1]
        try:
            image_bytes = base64.b64decode(base64_data)
        except Exception:
            logger.warning("Malformed image base64")
            await self.on_status({"error": "Invalid image data"})
            return
        image_parts = [
            types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=image_bytes)),
        ]
        logger.info("[WB] Image uploaded — analyzing via standard API")
        await self._generate_whiteboard(
            _build_image_prompt(text),
            image_parts=image_parts,
        )

    async def _generate_with_retry(self, *, config: types.GenerateContentConfig):
        last_error: Exception | None = None
        for attempt in range(STANDARD_API_RETRIES):
            try:
                return await self._client.aio.models.generate_content(
                    model=WHITEBOARD_MODEL,
                    contents=self._wb_history,
                    config=config,
                )
            except Exception as e:
                last_error = e
                if attempt == STANDARD_API_RETRIES - 1 or not _is_retryable_error(e):
                    raise
                wait = 1.5 * (2 ** attempt)
                logger.warning(
                    f"[WB] Standard API busy on attempt {attempt + 1}/{STANDARD_API_RETRIES}: {e}. "
                    f"Retrying in {wait:.1f}s"
                )
                await asyncio.sleep(wait)
        raise last_error or RuntimeError("Standard API request failed")

    async def _generate_whiteboard(self, text: str, image_parts: list | None = None):
        """Generate whiteboard commands via standard generate_content API.

        Multi-turn tool calling: model returns function calls → we respond → repeat
        until the model finishes (returns text or no more function calls).
        """
        async with self._wb_lock:
            # Build user message
            parts: list[types.Part] = []
            if image_parts:
                parts.extend(image_parts)
            parts.append(types.Part(text=text))

            self._wb_history.append(types.Content(role="user", parts=parts))

            # Trim history to last 30 items to stay within token limits
            if len(self._wb_history) > 30:
                self._wb_history = self._wb_history[-30:]

            config = types.GenerateContentConfig(
                tools=WHITEBOARD_TOOLS,
                system_instruction=types.Content(
                    parts=[types.Part(text=WB_SYSTEM_INSTRUCTION)]
                ),
            )

            await self.on_status({"speaking": True})
            total_cmds = 0
            transcript_emitted = False

            try:
                # Standard API: model returns ALL tool calls in one response.
                # We process them, send function responses, then get one final text reply.
                # Max 2 rounds to avoid infinite tool-call loops.
                for round_num in range(2):
                    response = await self._generate_with_retry(config=config)

                    if not response.candidates:
                        logger.warning("[WB] No candidates in response")
                        await self.on_status({"error": "No response from AI — please try again."})
                        break

                    model_content = response.candidates[0].content
                    self._wb_history.append(model_content)

                    # Separate function calls from text
                    function_calls = []
                    text_parts = []
                    for part in (model_content.parts or []):
                        if part.function_call:
                            function_calls.append(part)
                        elif part.text:
                            text_parts.append(part.text)

                    # Forward whiteboard commands to frontend
                    function_response_parts = []
                    for part in function_calls:
                        fc = part.function_call
                        params = dict(fc.args) if fc.args else {}
                        params = _fix_latex_escapes(params)
                        logger.info(f"  WB → {fc.name}({params})")
                        cmd = {
                            "id": str(uuid.uuid4()),
                            "action": fc.name,
                            "params": params,
                        }
                        await self.on_whiteboard(cmd)
                        total_cmds += 1
                        function_response_parts.append(
                            types.Part.from_function_response(
                                name=fc.name,
                                response={"status": "ok"},
                            )
                        )

                    # Send text transcript if any
                    if text_parts:
                        full_text = " ".join(text_parts)
                        logger.info(f"  WB transcript: {full_text[:100]}...")
                        await self.on_transcript("tutor", full_text)
                        transcript_emitted = True

                    # If no function calls, model is done
                    if not function_calls:
                        break

                    # Send function responses — tell model drawing is complete
                    self._wb_history.append(types.Content(
                        role="user",
                        parts=function_response_parts,
                    ))
                    logger.info(f"  WB round {round_num + 1}: {len(function_calls)} tool calls")

                logger.info(f"[WB] Done — {total_cmds} total whiteboard commands")

                # If Gemini returned no spoken text, emit a fallback so TTS fires
                if not transcript_emitted and total_cmds > 0:
                    fallback = "I've worked through the solution step by step on the whiteboard. Check the board for the complete solution."
                    logger.info("[WB] No transcript from model — emitting fallback for TTS")
                    await self.on_transcript("tutor", fallback)

            except Exception as e:
                logger.error(f"[WB] Generation error: {e}", exc_info=True)
                if _is_retryable_error(e):
                    await self.on_status({
                        "error": "The AI tutor is under high demand right now. I retried automatically, but it still did not go through. Please try again in a moment."
                    })
                else:
                    await self.on_status({"error": f"Whiteboard error: {str(e)}"})
            finally:
                await self.on_status({"speaking": False, "turn_complete": True})

    # ═══════════════════════════════════════════════════════════
    #  LIVE API — voice / audio (native audio model)
    # ═══════════════════════════════════════════════════════════

    async def send_audio(self, audio_data: bytes):
        """Audio input → Live API (native audio model)."""
        try:
            await self.ensure_connected()
        except Exception as e:
            logger.error(f"Live API connect failed: {e}", exc_info=True)
            message = (
                "The voice tutor is under high demand right now. I retried automatically, but it still did not connect. Please try again in a moment."
                if _is_retryable_error(e)
                else f"Voice connection error: {e}"
            )
            await self.on_status({"error": message, "connected": False})
            return
        if self._session:
            try:
                await self._session.send_realtime_input(
                    audio={"data": audio_data, "mime_type": "audio/pcm"}
                )
            except Exception as e:
                # Live API session dropped mid-stream (e.g. 1011).
                # _receive_loop is responsible for reconnecting; just clear the dead session.
                logger.debug(f"Audio send failed (session dropped, reconnect pending): {e}")
                self._session = None

    async def ensure_connected(self):
        """Lazily connect the Live API on first audio use."""
        if self._session and not self._connecting:
            return
        if self._connecting:
            for _ in range(100):  # up to 10s
                await asyncio.sleep(0.1)
                if self._session and not self._connecting:
                    return
            logger.info("Timed out waiting for Live API reconnect; forcing new connection")
            self._connecting = False
        logger.info("Opening new Live API session for voice...")
        await self.connect()

    async def connect(self):
        """Open a Gemini Live API session (voice)."""
        self._connecting = True
        try:
            live_config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=types.Content(
                    parts=[types.Part(text=AUDIO_SYSTEM_INSTRUCTION)]
                ),
                tools=WHITEBOARD_TOOLS,
            )
            last_error: Exception | None = None
            for attempt in range(LIVE_CONNECT_RETRIES):
                try:
                    self._ctx = self._client.aio.live.connect(
                        model=AUDIO_MODEL, config=live_config
                    )
                    self._session = await self._ctx.__aenter__()
                    self._receive_task = asyncio.create_task(self._receive_loop())
                    return
                except Exception as e:
                    last_error = e
                    self._session = None
                    self._ctx = None
                    if attempt == LIVE_CONNECT_RETRIES - 1 or not _is_retryable_error(e):
                        raise
                    wait = 1.5 * (2 ** attempt)
                    logger.warning(
                        f"Live API busy on connect attempt {attempt + 1}/{LIVE_CONNECT_RETRIES}: {e}. "
                        f"Retrying in {wait:.1f}s"
                    )
                    await asyncio.sleep(wait)
            raise last_error or RuntimeError("Live API connection failed")
        finally:
            self._connecting = False

    async def _reconnect(self):
        """Reconnect Live API after internal error (called from _receive_loop)."""
        logger.info("Cleaning up old Live API session...")
        try:
            self._receive_task = None  # don't cancel — we ARE the receive task
            if self._session and self._ctx:
                await self._ctx.__aexit__(None, None, None)
        except Exception as e:
            logger.warning(f"Cleanup during reconnect: {e}")
        self._session = None
        self._ctx = None
        self._connecting = False

        for attempt in range(3):
            wait = 1.0 * (2 ** attempt)
            logger.info(f"Live API reconnect {attempt + 1}/3 in {wait}s...")
            await asyncio.sleep(wait)
            try:
                await self.connect()
                logger.info("Live API reconnected!")
                try:
                    await self.on_status({"connected": True, "reconnected": True})
                except Exception:
                    pass  # client may have left while we were reconnecting
                return True
            except Exception as e:
                logger.info(f"Reconnect attempt {attempt + 1} failed: {e}")
        logger.error("All Live API reconnect attempts failed")
        return False

    async def _receive_loop(self):
        """Receive responses from Live API."""
        try:
            while self._session:
                turn = self._session.receive()
                async for response in turn:
                    try:
                        await self._handle_response(response)
                    except Exception as e:
                        logger.error(f"Live API response error: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            error_str = str(e)

            # Code 1000 = normal close — the client disconnected cleanly.
            # There is nothing to report and nobody to report it to.
            if ("1000" in error_str and "None" in error_str) or "ConnectionClosedOK" in type(e).__name__:
                logger.info("Live API closed normally (1000) — client disconnected")
                return

            # 1011 and 1008 are expected from the native-audio model — reconnect quietly.
            if "1011" in error_str or "internal" in error_str.lower():
                logger.info(f"Live API session ended (expected): {error_str[:80]}")
                try:
                    await self.on_status({"reconnecting": True})
                except Exception:
                    return  # client already gone
                if await self._reconnect():
                    return
            elif "1008" in error_str or "policy" in error_str.lower():
                logger.info(f"Live API policy error (expected): {error_str[:80]}")
                try:
                    await self.on_status({"reconnecting": True})
                except Exception:
                    return
                if await self._reconnect():
                    return
            else:
                logger.error(f"Live API unexpected error: {error_str}")

            # Best-effort notification to client (may already be gone)
            try:
                await self.on_status({"error": f"Voice session lost: {error_str[:100]}", "connected": False})
            except Exception:
                pass

    async def _handle_response(self, response):
        """Process a single Live API response."""
        # Handle audio output
        if response.data is not None:
            await self.on_audio(response.data)
            if not self._speaking:
                self._speaking = True
                await self.on_status({"speaking": True})

        # Handle tool calls (whiteboard commands from voice)
        if response.tool_call:
            logger.info(f"[Voice] {len(response.tool_call.function_calls)} tool call(s)")
            function_responses = []
            for fc in response.tool_call.function_calls:
                params = dict(fc.args) if fc.args else {}
                params = _fix_latex_escapes(params)
                logger.info(f"  Voice → {fc.name}({params})")
                cmd = {
                    "id": str(uuid.uuid4()),
                    "action": fc.name,
                    "params": params,
                }
                await self.on_whiteboard(cmd)
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

        # Handle turn completion and text
        if response.server_content:
            if hasattr(response.server_content, 'interrupted') and response.server_content.interrupted:
                self._speaking = False
                await self.on_status({"speaking": False, "interrupted": True})

            # Capture text from voice model for context sync
            if response.server_content.model_turn:
                for part in response.server_content.model_turn.parts:
                    if hasattr(part, 'text') and part.text:
                        self._audio_transcript_buf.append(part.text)

            if hasattr(response.server_content, 'turn_complete') and response.server_content.turn_complete:
                self._speaking = False
                await self.on_status({"speaking": False, "turn_complete": True})
                # Sync voice context to whiteboard history for follow-up questions
                self._sync_voice_context()
                # Keep the Live API session alive for back-and-forth conversation.
                # The session will reconnect automatically via _reconnect() if it drops.

    def _sync_voice_context(self):
        """Add voice conversation context to whiteboard history so text follow-ups have context."""
        if self._audio_transcript_buf:
            transcript = " ".join(self._audio_transcript_buf)
            self._audio_transcript_buf = []
            # Add as a synthetic exchange so the whiteboard model knows what was discussed
            self._wb_history.append(types.Content(
                role="user",
                parts=[types.Part(text="[Student asked a question via voice]")],
            ))
            self._wb_history.append(types.Content(
                role="model",
                parts=[types.Part(text=f"[Voice response summary]: {transcript[:500]}")],
            ))
            logger.info(f"[WB] Synced voice context ({len(transcript)} chars)")

    # ═══════════════════════════════════════════════════════════
    #  Session lifecycle
    # ═══════════════════════════════════════════════════════════

    async def _teardown_session(self):
        """Tear down Live API session after a voice turn."""
        logger.debug("Tearing down Live API session post-turn")
        try:
            if self._receive_task:
                self._receive_task.cancel()
                self._receive_task = None
            if self._session and self._ctx:
                await self._ctx.__aexit__(None, None, None)
        except Exception as e:
            logger.debug(f"Teardown cleanup: {e}")
        self._session = None
        self._ctx = None
        self._connecting = False

    async def close(self):
        """Close all sessions."""
        # Close Live API
        if self._receive_task:
            self._receive_task.cancel()
            self._receive_task = None
        if self._session and self._ctx:
            try:
                await self._ctx.__aexit__(None, None, None)
            except Exception as e:
                logger.debug(f"Close cleanup: {e}")
            self._session = None
            self._ctx = None

