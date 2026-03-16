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

# System prompt for Live API (voice — teacher mode: interactive, one step at a time)
AUDIO_SYSTEM_INSTRUCTION = """You are MathBoard, an interactive math tutor. You have a whiteboard.

You are in TEACHER MODE — guide the student step by step, checking understanding at each step.

RULES:
1. Draw ONE STEP at a time using tools, then STOP and ask the student a question.
2. NEVER draw the complete solution at once. Only draw the current step.
3. NEVER call clear_whiteboard(). The board preserves all work.
4. step_marker(step=N, x=30, y=Y) for each step heading.
5. draw_latex() for ALL math. Use \\frac{}{} for fractions, \\cdot or \\times for multiplication (NEVER *).
6. draw_text() for short annotations only (under 25 chars). NEVER start with "Step".
7. LAYOUT:
   - step_marker at x=30. All draw_latex/draw_text at x=80 (indented under the step).
   - Step 1 at y=60. Content starts 60px below its step marker.
   - Each subsequent line increments y by 60px.
   - New step marker starts 100px below the last content line.
   - NEVER put text at x > 200.
8. After drawing one step, end with a QUESTION:
   - "What rule should we apply next?"
   - "What do you get when you simplify this?"
9. When student is CORRECT: praise briefly ("Exactly!"), draw NEXT step, ask another question.
10. When student is WRONG: do NOT reveal the answer. Give a hint and re-ask.
11. FINAL ANSWER: Only after student has participated, draw_latex with \\boxed{}.
12. Keep spoken explanation brief — under 15 seconds per step. Speak the question, then wait.

GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
IMAGE: If student sends a photo, identify the math shown and help solve it step by step.
Draw Step 1 ONLY, then ask your first question."""

# System prompt for standard API (text/image — teacher mode: interactive)
WB_SYSTEM_INSTRUCTION = """You are MathBoard, an interactive math tutor. You have a whiteboard.

You are in TEACHER MODE — guide the student step by step, checking understanding at each step.

RULES:
1. Draw ONE STEP at a time, then STOP and ask the student a question before continuing.
2. NEVER draw the complete solution at once.
3. NEVER call clear_whiteboard(). The board preserves all work.
4. step_marker(step=N, x=30, y=Y) for each step heading.
5. draw_latex() for ALL math. Use \\frac{}{} with braces for fractions (NOT \\frac12). Use \\cdot or \\times for multiplication (NEVER *).
6. draw_text() for short annotations only (under 25 chars). NEVER start with "Step".
7. LAYOUT:
   - step_marker at x=30. All draw_latex/draw_text at x=80 (indented under the step).
   - Step 1 at y=60. Content starts 60px below its step marker.
   - Each subsequent line increments y by 60px.
   - New step marker starts 100px below the last content line.
   - NEVER put text at x > 200.
8. After drawing one step, ASK the student a question:
   - "What rule should we apply here?"
   - "What do you get when you differentiate this term?"
   - "Can you simplify this expression?"
9. When student is CORRECT: praise briefly ("Exactly!"), draw NEXT step, ask another question.
10. When student is WRONG: do NOT reveal the answer. Give a hint and re-ask.
11. FINAL ANSWER: Only after student has participated, draw_latex with \\boxed{}.
12. Use symbolic notation on the board, not prose.

GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
IMAGE: If student sends a photo, identify the math shown and help solve it step by step.
FOLLOW-UPS: If user says "[Q1]" or "[Q2]", answer about that previous question.
Draw Step 1 ONLY, then ask your first question."""

QUICK_WB_SYSTEM_INSTRUCTION = """You are MathBoard in QUICK mode. You have a whiteboard.

RULES:
1. Give a DIRECT, CONCISE answer. Skip long step-by-step breakdowns.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. Use step_marker(step=N, x=30, y=Y) for 1-2 key steps max.
4. draw_latex() for ALL math. Use \\frac{}{} for fractions. Use \\cdot or \\times for multiplication (NEVER *).
5. draw_text() for short annotations only (under 25 chars). NEVER start with "Step".
6. LAYOUT:
   - step_marker at x=30. All draw_latex/draw_text at x=80 (indented).
   - Step 1 at y=60. Content 60px below step marker. Lines increment y by 60px.
   - New step marker 100px below last content. NEVER x > 200.
7. FINAL ANSWER: draw_latex() with \\boxed{} around the result.
8. Return ALL tool calls needed. 2-3 steps max for most problems.
9. Use symbolic notation, not prose.

GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
IMAGE: If student sends a photo, identify the math shown and solve it step by step.
START DRAWING IMMEDIATELY. Be fast and direct."""

QUICK_AUDIO_SYSTEM_INSTRUCTION = """You are MathBoard in QUICK mode. You have a whiteboard.

RULES:
1. Give a DIRECT, CONCISE answer. Get to the point fast.
2. Call tools IMMEDIATELY — start drawing right away.
3. NEVER call clear_whiteboard(). The board preserves all work.
4. step_marker(step=N, x=30, y=Y) for 1-2 key steps max.
5. draw_latex() for ALL math. Use \\frac{}{} for fractions. Use \\cdot or \\times for multiplication.
6. draw_text() for short annotations only (under 25 chars).
7. LAYOUT:
   - step_marker at x=30. All draw_latex/draw_text at x=80 (indented).
   - Step 1 at y=60. Content 60px below step marker. Lines increment y by 60px.
   - New step marker 100px below last content. NEVER x > 200.
8. FINAL ANSWER: draw_latex() with \\boxed{}.
9. Keep spoken explanation brief — under 15 seconds.
10. For simple arithmetic, give the answer directly.

GRAPHING: draw_graph() with JS Math syntax. Use width 300, height 220.
START DRAWING IMMEDIATELY. Be fast and direct."""

AUDIO_MODEL = cfg.__dict__.get("AUDIO_MODEL") or "gemini-2.5-flash-native-audio-latest"
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



def _asks_student_question(text: str) -> bool:
    """Return True if the AI's response asks the student a direct question.
    
    In teacher mode (the only caller), any response ending with '?' is
    almost certainly a question directed at the student, since the system
    prompt explicitly instructs the AI to ask after each step.
    """
    if not text:
        return False
    # Check the last ~300 chars (the tail of the response is where questions live)
    tail = text[-300:].strip()
    # In teacher mode, ending with "?" is sufficient — the prompt tells the AI to ask
    return tail.endswith("?")


def _build_image_prompt(user_text: str | None) -> str:
    cleaned = (user_text or "").strip()
    base = (
        "The student uploaded a photo. Identify the math problem(s) visible in the image, "
        "then solve step by step on the whiteboard using the photo as context."
    )
    if cleaned:
        return f"{base} The student also says: {cleaned}"
    return base


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
        self._health_task: asyncio.Task | None = None
        self._connecting = False
        self._speaking = False
        self._closed = False
        self._audio_transcript_buf: list[str] = []  # capture voice model text

        # ── Standard API state (text/image → whiteboard) ──
        self._wb_history: list[types.Content] = []
        self._wb_lock = asyncio.Lock()  # prevent concurrent whiteboard generation
        self._wb_task: asyncio.Task | None = None
        self._reconnect_task: asyncio.Task | None = None
        self._awaiting_student_answer = False  # True when AI asked the student a question
        self._mode = "teacher"  # "teacher" or "quick"

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
            # Cancel any in-progress reconnect before starting a new one
            if self._reconnect_task and not self._reconnect_task.done():
                self._reconnect_task.cancel()
            self._reconnect_task = asyncio.create_task(self._reconnect())

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

    async def start_voice(self):
        """Eagerly connect the Live API so voice is ready immediately.
        Also starts a background health monitor that auto-reconnects if the session drops.
        """
        try:
            await self.connect()
            await self.on_status({"voice_ready": True})
            logger.info("[Voice] Eagerly connected — voice ready")
        except Exception as e:
            logger.warning(f"[Voice] Eager connect failed (will retry on first audio): {e}")
        # Start the health monitor regardless — it will reconnect if needed
        if not self._health_task or self._health_task.done():
            self._health_task = asyncio.create_task(self._health_loop())

    async def _health_loop(self):
        """Background monitor: keeps Live API alive and auto-reconnects if down."""
        # 90 bytes of silence (16-bit PCM, mono) — enough to reset idle timer
        SILENCE = b"\x00" * 90
        while not self._closed:
            await asyncio.sleep(15)
            if self._closed:
                break
            # Session alive → send silent keepalive to prevent idle timeout
            if self._session and not self._connecting:
                try:
                    await self._session.send(input={"data": SILENCE, "mime_type": "audio/pcm"})
                    logger.debug("[Voice] Keepalive sent")
                except Exception as e:
                    logger.info(f"[Voice] Keepalive failed (session likely dead): {e}")
                    # Clean up stale session so reconnect block below picks it up
                    try:
                        if self._ctx:
                            await self._ctx.__aexit__(None, None, None)
                    except Exception:
                        pass
                    self._session = None
                    self._ctx = None
            # Session down → reconnect
            if not self._session and not self._connecting:
                logger.info("[Voice] Health check: session down — reconnecting...")
                await self.on_status({"voice_ready": False})
                try:
                    await self.connect()
                    await self.on_status({"voice_ready": True, "reconnected": True})
                    logger.info("[Voice] Health check: reconnected successfully")
                except Exception as e:
                    logger.warning(f"[Voice] Health check reconnect failed: {e}")

    # ═══════════════════════════════════════════════════════════
    #  STANDARD API — text & image (zero connection issues)
    # ═══════════════════════════════════════════════════════════

    async def send_text(self, text: str, request_id: str | None = None):
        """Text input → standard generate_content API. No WebSocket, no 1011."""
        logger.info(f"[WB] Text question: {text[:80]}...")
        # If this is a student answer to an AI question, reset the flag.
        # The whiteboard model already has the conversation context in _wb_history,
        # so it will naturally continue the same problem.
        self._awaiting_student_answer = False
        if self._wb_task and not self._wb_task.done():
            self._wb_task.cancel()
        self._wb_task = asyncio.create_task(self._generate_whiteboard(text, request_id=request_id))

    async def send_image(self, base64_data: str, user_text: str = "", request_id: str | None = None):
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
        await self._generate_whiteboard(prompt, image_parts=image_parts, request_id=request_id)

    async def _generate_whiteboard(self, text: str, image_parts: list | None = None, request_id: str | None = None):
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

            status_start: dict = {"speaking": True}
            if request_id:
                status_start["request_id"] = request_id
            await self.on_status(status_start)
            total_cmds = 0
            transcript_emitted = False
            all_text_parts: list[str] = []  # accumulate across ALL rounds

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
                        status_err: dict = {"error": "No response from AI — please try again."}
                        if request_id:
                            status_err["request_id"] = request_id
                        await self.on_status(status_err)
                        break

                    model_content = response.candidates[0].content
                    self._wb_history.append(model_content)

                    # Separate function calls from text
                    function_calls = []
                    round_text_parts = []
                    for part in (model_content.parts or []):
                        if part.function_call:
                            function_calls.append(part)
                        elif part.text:
                            round_text_parts.append(part.text)
                    all_text_parts.extend(round_text_parts)

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
                    if round_text_parts:
                        full_text = " ".join(round_text_parts)
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
                status_err: dict = {"error": f"Whiteboard error: {str(e)}"}
                if request_id:
                    status_err["request_id"] = request_id
                await self.on_status(status_err)
            finally:
                # Detect if AI asked a question BEFORE signaling turn_complete
                is_asking = False
                if self._mode == "teacher" and all_text_parts:
                    combined_text = " ".join(all_text_parts)
                    if _asks_student_question(combined_text):
                        self._awaiting_student_answer = True
                        is_asking = True
                        logger.info("[WB] AI asked a question — next student input is a continuation")

                # Send everything in ONE status message so frontend processes atomically
                status: dict = {"speaking": False, "turn_complete": True}
                if request_id:
                    status["request_id"] = request_id
                # In teacher mode, bias toward continuity: if we asked a question, expect an answer.
                if is_asking:
                    status["awaiting_answer"] = True
                await self.on_status(status)

    # ═══════════════════════════════════════════════════════════
    #  LIVE API — voice / audio (native audio model)
    # ═══════════════════════════════════════════════════════════

    async def send_audio(self, audio_data: bytes):
        """Audio input → Live API (native audio model)."""
        try:
            await self.ensure_connected()
            if self._session:
                await self._session.send_realtime_input(
                    audio={"data": audio_data, "mime_type": "audio/pcm"}
                )
        except Exception as e:
            # Surface the *real* cause to the UI so it's debuggable
            msg = str(e)
            logger.error(f"[Voice] send_audio failed: {msg}", exc_info=True)
            await self.on_status({
                "error": f"Voice session lost — {msg[:180]}",
                "speaking": False,
            })
            # Force reconnect on next audio chunk
            self._session = None
            self._ctx = None
            self._connecting = False

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
        except Exception as e:
            logger.error(f"[Voice] Live connect failed: {e}", exc_info=True)
            raise
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

        last_err = None
        for attempt in range(5):
            wait = 1.0 * (2 ** min(attempt, 3))  # cap backoff at 8s
            logger.info(f"Live API reconnect {attempt + 1}/5 in {wait}s...")
            await asyncio.sleep(wait)
            try:
                await self.connect()
                logger.info("Live API reconnected!")
                await self.on_status({"connected": True, "reconnected": True, "voice_ready": True})
                return True
            except Exception as e:
                last_err = e
                logger.info(f"Reconnect attempt {attempt + 1} failed: {e}")
        logger.error("All Live API reconnect attempts failed")
        if last_err:
            await self.on_status({"error": f"Voice session lost — {str(last_err)[:180]}", "speaking": False, "voice_ready": False})
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
            # 1000, 1011, 1008 are all expected closures — clean up silently
            recoverable = any(code in error_str for code in ("1000", "1011", "1008")) or \
                          any(kw in error_str.lower() for kw in ("internal", "policy", "normal closure"))
            if recoverable:
                logger.info(f"Live API session ended (expected): {error_str[:80]}")
                # Clean up stale session — health loop will reconnect within 15s
                try:
                    self._receive_task = None
                    if self._ctx:
                        await self._ctx.__aexit__(None, None, None)
                except Exception:
                    pass
                self._session = None
                self._ctx = None
                await self.on_status({"voice_ready": False, "speaking": False})
                return  # health loop handles reconnect
            else:
                logger.error(f"Live API unexpected error: {error_str}")
                # Only notify frontend of truly unexpected errors
                await self.on_status({"error": f"Voice session lost — {error_str[:180]}", "speaking": False})

    async def _handle_response(self, response):
        """Process a single Live API response."""
        # Handle audio output
        if response.data is not None:
            await self.on_audio(response.data)
            if not self._speaking:
                self._speaking = True
                await self.on_status({"speaking": True})

        # Handle tool calls (whiteboard commands from voice)
        if response.tool_call and response.tool_call.function_calls:
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
                # Buffer text content from tool calls for question detection
                for val in params.values():
                    if isinstance(val, str) and len(val) > 2:
                        self._audio_transcript_buf.append(val)
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
                        # Bound buffer to prevent memory leak on long voice sessions
                        if len(self._audio_transcript_buf) > 100:
                            self._audio_transcript_buf = self._audio_transcript_buf[-50:]

            if hasattr(response.server_content, 'turn_complete') and response.server_content.turn_complete:
                self._speaking = False
                # In teacher mode, the prompt always ends with a question after each step.
                # Voice model speaks the question (audio) — we may not have text to parse.
                # Check tool-call text first; fall back to assuming a question in teacher mode.
                is_asking = False
                if self._mode == "teacher":
                    if self._audio_transcript_buf:
                        voice_text = " ".join(self._audio_transcript_buf)
                        is_asking = _asks_student_question(voice_text)
                    # Fallback: teacher mode prompt always asks a question per turn
                    if not is_asking:
                        is_asking = True
                        logger.info("[Voice] Teacher mode turn complete — assuming question (prompt guarantees it)")
                    if is_asking:
                        self._awaiting_student_answer = True
                        logger.info("[Voice] AI asked a question — awaiting student answer")
                # Send everything in ONE atomic status message
                status: dict = {"speaking": False, "turn_complete": True}
                if is_asking:
                    status["awaiting_answer"] = True
                await self.on_status(status)
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

    async def close(self):
        """Close all sessions."""
        self._closed = True
        # Stop health monitor
        if self._health_task:
            self._health_task.cancel()
            self._health_task = None
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

