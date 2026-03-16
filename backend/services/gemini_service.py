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
import re
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
AUDIO_SYSTEM_INSTRUCTION = """You are MathBoard, a math tutor. You have a whiteboard.

RULES:
1. Call tools IMMEDIATELY — start drawing right away.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. step_marker() for each step heading. Always start with Step 1 for each new question. Do NOT repeat "Step N" in any draw_text — the marker already renders it.
4. draw_latex() for ALL math. Always use \\frac{}{} with braces for fractions (NOT \\frac12, NOT inline /). Use \\cdot or \\times for multiplication (NEVER *). Write it how a human writes on a blackboard.
5. draw_text() for short annotations only (under 25 chars). NEVER start draw_text with "Step" — use step_marker for that. Example: draw_text("Use substitution") not draw_text("Step 1: Use substitution").
8. FINAL ANSWER: Write the final answer as a standalone draw_latex() call with a box: use \\boxed{} around the result. If the integral has + C, include it inside the boxed expression.
9. Use symbolic notation on the board, not prose: write "x → ∞" not "as x approaches infinity". Keep board content mathematical.
10. For simple arithmetic (e.g. 9×29), give a quick mental math breakdown in 2 steps max — don't over-explain.

GRAPHING: draw_graph() with JS Math syntax. Use width 300, height 220 to keep compact.
HOMEWORK: When student sends an image, grade each problem. Use ✓ or show corrections.
RE-EXPLAINING: Continue at y=60 incrementing normally. Add more detail.
START DRAWING IMMEDIATELY when asked a question."""

# System prompt for standard API (text/image — returns all tools at once)
WB_SYSTEM_INSTRUCTION = """You are MathBoard, a math tutor. You have a whiteboard.

RULES:
1. Call tools IMMEDIATELY — draw the COMPLETE solution in one response.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. step_marker() for each step heading. Always start with Step 1 for each new question. Do NOT repeat "Step N" in any draw_text — the marker already renders it.
4. draw_latex() for ALL math. Always use \\frac{}{} with braces for fractions (NOT \\frac12, NOT inline /). Use \\cdot or \\times for multiplication (NEVER *). Write it how a human writes on a blackboard.
5. draw_text() for short annotations only (under 25 chars). NEVER start draw_text with "Step" — use step_marker for that. Example: draw_text("Use substitution") not draw_text("Step 1: Use substitution").
6. LAYOUT: All content in a SINGLE column, x always between 30-80. y starts at 60, increment ~60px per line. NEVER put text at x > 200 — no side annotations.
7. FINAL ANSWER: Write the final answer as a standalone draw_latex() call with a box: use \\boxed{} around the result. If the integral has + C, include it inside the boxed expression.
8. Return ALL tool calls needed for the complete solution.
9. At the end, use draw_text() to add a brief reference like "Chain Rule" or "Integration by Parts" — name the theorem/technique used.
10. Use symbolic notation on the board, not prose: write "x \\to \\infty" not "as x approaches infinity". Keep board content mathematical.
11. For simple arithmetic (e.g. 9×29), give a quick mental math breakdown in 2 steps max — don't over-explain.

GRAPHING: draw_graph() with JS Math syntax. Use width 300, height 220 to keep compact.
HOMEWORK: When student sends an image, grade each problem. Use ✓ or show corrections.
RE-EXPLAINING: Continue at y=60 incrementing normally. Add more detail.
FOLLOW-UPS: If user says "[Q1]" or "[Q2]", they are asking about a previous question. Use context from your conversation history to answer.
START DRAWING IMMEDIATELY when asked a question."""

QUICK_WB_SYSTEM_INSTRUCTION = """You are MathBoard in QUICK mode. You have a whiteboard.

RULES:
1. Give a DIRECT, CONCISE answer. Skip long step-by-step breakdowns.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. Use step_marker() only for 1-2 key steps max. Jump straight to the solution.
4. draw_latex() for ALL math. Always use \\frac{}{} with braces for fractions (NOT \\frac12, NOT inline /). Use \\cdot or \\times for multiplication (NEVER *).
5. draw_text() for short annotations only (under 25 chars). NEVER start draw_text with "Step".
6. LAYOUT: All content in a SINGLE column, x always between 30-80. y starts at 60, increment ~60px per line. NEVER put text at x > 200.
7. FINAL ANSWER: Write the final answer as a standalone draw_latex() call with \\boxed{} around the result.
8. Return ALL tool calls needed. Keep it brief — 2-3 steps max for most problems.
9. Use symbolic notation on the board, not prose.
10. For simple arithmetic, give the answer directly in 1 step.

GRAPHING: draw_graph() with JS Math syntax. Use width 300, height 220 to keep compact.
HOMEWORK: When student sends an image, grade each problem. Use ✓ or show corrections.
START DRAWING IMMEDIATELY when asked a question. Be fast and direct."""

QUICK_AUDIO_SYSTEM_INSTRUCTION = """You are MathBoard in QUICK mode. You have a whiteboard.

RULES:
1. Give a DIRECT, CONCISE answer. No long explanations. Get to the point fast.
2. Call tools IMMEDIATELY — start drawing right away.
3. NEVER call clear_whiteboard(). The board preserves all work.
4. Use step_marker() only for 1-2 key steps max. Skip unnecessary detail.
5. draw_latex() for ALL math. Always use \\frac{}{} with braces for fractions. Use \\cdot or \\times for multiplication.
6. draw_text() for short annotations only (under 25 chars).
7. FINAL ANSWER: Write as standalone draw_latex() with \\boxed{} around the result.
8. Keep your spoken explanation brief — under 15 seconds.
9. Use symbolic notation, not prose.
10. For simple arithmetic, give the answer directly.

GRAPHING: draw_graph() with JS Math syntax. Use width 300, height 220.
START DRAWING IMMEDIATELY. Be fast and direct."""

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


# Patterns that signal the AI is asking the student a direct question
_STUDENT_QUESTION_RE = re.compile(
    r"(?:"
    r"what do you (?:think|get|notice)|"
    r"can you (?:try|solve|figure|tell|find|calculate|simplify)|"
    r"how (?:would|do|did|can|might) you|"
    r"what (?:is|are|would|could|does|happens)|"
    r"do you (?:see|know|understand|remember|recall|agree)|"
    r"does that make sense|"
    r"your turn|give it a (?:try|shot)|try (?:this|it|solving)|"
    r"what(?:'s| is) (?:the (?:next|value|result|answer))|"
    r"which (?:one|method|step)|"
    r"why (?:do|does|is|are|did|would|might)|"
    r"where (?:do|does|did)|"
    r"how (?:many|much)|"
    r"ready\?|right\?|correct\?|see\?"
    r")",
    re.IGNORECASE,
)


def _asks_student_question(text: str) -> bool:
    """Return True if the AI's response asks the student a direct question."""
    if not text:
        return False
    # Check the last ~300 chars (the tail of the response is where questions live)
    tail = text[-300:].strip()
    # Must end with "?" to be a question
    if not tail.endswith("?"):
        return False
    return bool(_STUDENT_QUESTION_RE.search(tail))


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
        self._wb_task: asyncio.Task | None = None
        self._reconnect_task: asyncio.Task | None = None
        self._awaiting_student_answer = False  # True when AI asked the student a question
        self._mode = "teacher"  # "teacher" or "quick"
        self._closed = False

    async def interrupt(self):
        """Immediately stop all generating tasks (both text and voice)."""
        logger.info("Interrupting session...")
        # Cancel standard API task
        if self._wb_task and not self._wb_task.done():
            self._wb_task.cancel()
            self._wb_task = None
            await self.on_status({"speaking": False, "turn_complete": True, "interrupted": True})
            
        # Nuke Voice API session to stop current output
        if self._session:
            reconnect_task = asyncio.create_task(self._reconnect())
            self._reconnect_task = reconnect_task

    async def set_mode(self, mode: str):
        """Switch between 'teacher' and 'quick' mode."""
        if mode not in ("teacher", "quick"):
            return
        old_mode = self._mode
        self._mode = mode
        logger.info(f"Mode changed to: {mode}")
        # Clear awaiting state when switching to quick — AI doesn't ask questions
        if mode == "quick" and self._awaiting_student_answer:
            self._awaiting_student_answer = False
            await self.on_status({"awaiting_answer": False})
        # If Live API session is active, reconnect with new system instruction
        if self._session and old_mode != mode:
            asyncio.create_task(self._reconnect())

    # ═══════════════════════════════════════════════════════════
    #  STANDARD API — text & image (zero connection issues)
    # ═══════════════════════════════════════════════════════════

    async def send_text(self, text: str):
        """Text input → standard generate_content API. No WebSocket, no 1011."""
        logger.info(f"[WB] Text question: {text[:80]}...")
        # If this is a student answer to an AI question, reset the flag.
        # The whiteboard model already has the conversation context in _wb_history,
        # so it will naturally continue the same problem.
        self._awaiting_student_answer = False
        if self._wb_task and not self._wb_task.done():
            self._wb_task.cancel()
        self._wb_task = asyncio.create_task(self._generate_whiteboard(text))

    async def send_image(self, base64_data: str, user_text: str = ""):
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
        prompt = user_text.strip() if user_text.strip() else (
            "Please analyze this image, identify the math problem(s), and solve them step by step on the whiteboard."
        )
        logger.info(f"[WB] Image uploaded — analyzing via standard API (prompt: {prompt[:60]})")
        await self._generate_whiteboard(prompt, image_parts=image_parts)

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

            wb_prompt = QUICK_WB_SYSTEM_INSTRUCTION if self._mode == "quick" else WB_SYSTEM_INSTRUCTION
            config = types.GenerateContentConfig(
                tools=WHITEBOARD_TOOLS,
                system_instruction=types.Content(
                    parts=[types.Part(text=wb_prompt)]
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
                    response = await self._client.aio.models.generate_content(
                        model=WHITEBOARD_MODEL,
                        contents=self._wb_history,
                        config=config,
                    )

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

                # Detect if the AI asked the student a question — tell frontend
                # so the next student input continues on the same whiteboard page.
                if text_parts:
                    combined_text = " ".join(text_parts)
                    if _asks_student_question(combined_text):
                        self._awaiting_student_answer = True
                        await self.on_status({"awaiting_answer": True})
                        logger.info("[WB] AI asked a question — next student input is a continuation")

            except Exception as e:
                logger.error(f"[WB] Generation error: {e}", exc_info=True)
                await self.on_status({"error": f"Whiteboard error: {str(e)}"})
            finally:
                await self.on_status({"speaking": False, "turn_complete": True})

    # ═══════════════════════════════════════════════════════════
    #  LIVE API — voice / audio (native audio model)
    # ═══════════════════════════════════════════════════════════

    async def send_audio(self, audio_data: bytes):
        """Audio input → Live API (native audio model)."""
        await self.ensure_connected()
        if self._session:
            await self._session.send_realtime_input(
                audio={"data": audio_data, "mime_type": "audio/pcm"}
            )

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
            audio_prompt = QUICK_AUDIO_SYSTEM_INSTRUCTION if self._mode == "quick" else AUDIO_SYSTEM_INSTRUCTION
            live_config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=types.Content(
                    parts=[types.Part(text=audio_prompt)]
                ),
                tools=WHITEBOARD_TOOLS,
            )
            self._ctx = self._client.aio.live.connect(
                model=AUDIO_MODEL, config=live_config
            )
            self._session = await self._ctx.__aenter__()
            self._receive_task = asyncio.create_task(self._receive_loop())
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
                await self.on_status({"connected": True, "reconnected": True})
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
            # 1011 and 1008 are expected for native audio model — just reconnect quietly
            if "1011" in error_str or "internal" in error_str.lower():
                logger.info(f"Live API session ended (expected): {error_str[:80]}")
                if await self._reconnect():
                    return
            elif "1008" in error_str or "policy" in error_str.lower():
                logger.info(f"Live API policy error (expected): {error_str[:80]}")
                if await self._reconnect():
                    return
            else:
                logger.error(f"Live API unexpected error: {error_str}")
            # Only notify frontend if ALL reconnect attempts failed
            await self.on_status({"error": f"Voice session lost — please try again", "speaking": False})

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
                # Check if voice AI asked the student a question before clearing buffers
                if self._audio_transcript_buf:
                    voice_text = " ".join(self._audio_transcript_buf)
                    if _asks_student_question(voice_text):
                        self._awaiting_student_answer = True
                        await self.on_status({"awaiting_answer": True})
                        logger.info("[Voice] AI asked a question — next input is a continuation")
                # Sync voice context to whiteboard history for follow-up questions
                self._sync_voice_context()

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

