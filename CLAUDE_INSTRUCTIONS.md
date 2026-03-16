# MathBoard — Fix Question Bar + Whiteboard End-to-End Flow

The Teacher/Quick mode interaction with the whiteboard is broken. Student answers in Teacher mode are sometimes treated as new questions. This doc is a step-by-step plan to fix the entire pipeline.

---

## THE PROBLEM

In Teacher mode, the AI asks a question after each step. When the student answers:
- Their answer should stay in the **same card/section** (student_answer command)
- Instead, it sometimes creates a **new card** (question_header command)

Root causes:
1. **Backend timing**: `awaiting_answer: true` is sent AFTER `turn_complete: true` (lines 484 vs 490+ in `gemini_service.py`), so the frontend may briefly clear the awaiting state
2. **Teacher prompt**: `WB_SYSTEM_INSTRUCTION` still says "draw the COMPLETE solution in one response" — identical to Quick mode
3. **Mode switching doesn't reset whiteboard state** cleanly

---

## STEP 1: Fix Backend — Send `awaiting_answer` BEFORE `turn_complete`

**File:** `backend/services/gemini_service.py` — `_generate_whiteboard()` method (around line 470-495)

Currently the code sends `turn_complete` first (in the `finally` block), then checks for questions after. Reverse this order:

```python
# CURRENT ORDER (broken):
# finally:
#     await self.on_status({"speaking": False, "turn_complete": True})
# ...then later:
#     if _asks_student_question(combined_text):
#         await self.on_status({"awaiting_answer": True})

# FIXED ORDER — detect question FIRST, then send turn_complete with awaiting_answer together:
```

Replace the entire finally block and question detection with:

```python
            except Exception as e:
                logger.error(f"[WB] Generation error: {e}", exc_info=True)
                await self.on_status({"error": f"Whiteboard error: {str(e)}"})
            finally:
                # Detect if the AI asked the student a question BEFORE signaling turn_complete
                is_asking = False
                if self._mode == "teacher" and text_parts:
                    combined_text = " ".join(text_parts)
                    if _asks_student_question(combined_text):
                        self._awaiting_student_answer = True
                        is_asking = True
                        logger.info("[WB] AI asked a question — next student input is a continuation")

                # Send everything in ONE status message so frontend processes atomically
                status: dict = {"speaking": False, "turn_complete": True}
                if is_asking:
                    status["awaiting_answer"] = True
                await self.on_status(status)
```

**Delete** the old question detection block (lines ~478-485) since it's now in the finally block.

---

## STEP 2: Fix Backend — `set_mode` Must Clear Awaiting and Notify Frontend

**File:** `backend/services/gemini_service.py` — `set_mode()` method

This is already partially done but verify it sends `awaiting_answer: false` to frontend:

```python
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
```

**NOTE:** `set_mode` is now async. Update `main.py` to `await` it:

```python
# main.py — around line 342
elif msg_type == "set_mode":
    new_mode = payload.get("mode", "teacher")
    await session.set_mode(new_mode)
```

---

## STEP 3: Rewrite Teacher System Prompts to Be Interactive

**File:** `backend/services/gemini_service.py`

### Replace `WB_SYSTEM_INSTRUCTION` (text/image — standard API):

```python
WB_SYSTEM_INSTRUCTION = """You are MathBoard, an interactive math tutor. You have a whiteboard.

You are in TEACHER MODE — guide the student step by step, checking their understanding at each step.

RULES:
1. Draw ONE STEP at a time using tools, then STOP and ask the student a question.
2. NEVER draw the complete solution at once. Only draw the current step.
3. NEVER call clear_whiteboard(). The board preserves all work.
4. step_marker() for each step heading. Always start with Step 1 for each new question.
5. draw_latex() for ALL math. Use \\\\frac{}{} for fractions. Use \\\\cdot or \\\\times for multiplication (NEVER *).
6. draw_text() for short annotations only (under 25 chars).
7. LAYOUT: Single column, x between 30-80, y starts at 60, increment ~60px per line.
8. After drawing one step, end your response with a QUESTION to test understanding:
   - "What rule should we apply next?"
   - "What do you get when you simplify this?"
   - "Can you factor this expression?"
9. When student answers CORRECTLY: briefly praise ("Exactly!") then draw the NEXT step and ask another question.
10. When student answers WRONG: do NOT reveal the answer. Give a hint and re-ask.
11. FINAL ANSWER: Only after the student has worked through all steps, write the answer with \\\\boxed{}.
12. Use symbolic notation, not prose.

HOMEWORK: When student sends an image, grade each problem. Use ✓ or show corrections.
GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
Draw Step 1 ONLY, then ask your first question."""
```

### Replace `AUDIO_SYSTEM_INSTRUCTION` (voice — Live API):

```python
AUDIO_SYSTEM_INSTRUCTION = """You are MathBoard, an interactive math tutor. You have a whiteboard.

You are in TEACHER MODE — guide students step by step, pausing to check understanding.

RULES:
1. Call tools to draw ONE STEP, then STOP and ask the student a question verbally.
2. NEVER draw the complete solution at once.
3. NEVER call clear_whiteboard(). The board preserves all work.
4. step_marker() for each step heading. Start with Step 1 for new questions.
5. draw_latex() for ALL math. Use \\\\frac{}{} for fractions, \\\\cdot for multiplication.
6. draw_text() for short annotations only (under 25 chars).
7. After drawing one step, ASK the student: "What do you think comes next?" or "What rule applies here?"
8. If student is CORRECT: praise briefly, draw next step, ask next question.
9. If student is WRONG: hint without revealing answer. Re-ask.
10. FINAL ANSWER: draw_latex() with \\\\boxed{}, only after student has participated.
11. Keep spoken explanations brief — under 15 seconds per step.

HOMEWORK: Grade each problem. Use ✓ or show corrections.
GRAPHING: draw_graph() with JS Math syntax. width 300, height 220.
Draw Step 1 ONLY, then ask your first question."""
```

### Keep Quick mode prompts as-is (they already say "draw COMPLETE solution")

---

## STEP 4: Fix Frontend — Atomic Status Handling

**File:** `frontend/src/hooks/useSession.ts` — `handleMessage` (around line 170)

The current code handles `turn_complete` and `awaiting_answer` separately. Since Step 1 now sends them in one message, this should work. But add a guard: if `awaiting_answer` is true in the same message as `turn_complete`, don't clear thinking yet:

```typescript
case "status":
  if (msg.payload.speaking !== undefined)
    setIsSpeaking(msg.payload.speaking as boolean);
  if (msg.payload.listening !== undefined)
    setIsListening(msg.payload.listening as boolean);
  if (msg.payload.reconnected) {
    console.log("[SESSION] Gemini auto-reconnected successfully");
  }
  if (msg.payload.reconnecting) {
    console.log("[SESSION] Gemini reconnecting (internal)...");
  }
  if (msg.payload.interrupted) {
    stopAudio();
    setIsThinking(false);
  }
  // Handle awaiting_answer BEFORE turn_complete
  if (msg.payload.awaiting_answer !== undefined) {
    awaitingAnswerRef.current = !!msg.payload.awaiting_answer;
    setAwaitingAnswer(!!msg.payload.awaiting_answer);
  }
  if (msg.payload.turn_complete) {
    setIsThinking(false);
  }
  if (msg.payload.error) {
    setErrorMessage(msg.payload.error as string);
    setTimeout(() => setErrorMessage(null), 6000);
  }
  break;
```

This ensures `awaitingAnswerRef` is set before any other logic runs.

---

## STEP 5: Fix Frontend — Correct `sendText` Logic

**File:** `frontend/src/hooks/useSession.ts` — `sendText` callback (around line 368)

This is the most critical function. It decides whether student input creates a new section or continues the current one:

```typescript
const sendText = useCallback(
  (text: string) => {
    const cleaned = normalizeInput(text);
    if (!cleaned.trim()) return;

    micActiveRef.current = false;
    setIsListening(false);
    pendingAutoSpeakRef.current = true;
    stopAudio();
    stopBrowserSpeech();

    // CRITICAL: Check if this is an answer to an AI question
    const isAnswer = awaitingAnswerRef.current;
    awaitingAnswerRef.current = false;
    setAwaitingAnswer(false);

    // student_answer → stays in same card (no new header)
    // question_header → creates a new card
    setWhiteboardCommands((prev) => [
      ...prev,
      {
        id: `${isAnswer ? "sa" : "qh"}-${Date.now()}`,
        action: isAnswer ? "student_answer" : "question_header",
        params: { text: cleaned },
      },
    ]);
    send("text", { text: cleaned });
    addTranscript("user", cleaned);
    setIsThinking(true);
  },
  [send, addTranscript],
);
```

This is already correct in the code. The issue was the backend timing (Step 1 fixes it).

---

## STEP 6: Verify `groupWhiteboardCommands` Handles All Cases

**File:** `frontend/src/app/page.tsx` — `groupWhiteboardCommands()` function (lines 31-67)

This function is already correct:
- `question_header` → new card
- `student_answer` → append to last card
- Other commands → append to last card

No changes needed here.

---

## STEP 7: Verify VoicePanel Passes `awaitingAnswer` Correctly

**File:** `frontend/src/app/page.tsx` — VoicePanel props (around line 543)

Verify this line exists:
```tsx
awaitingAnswer={awaitingAnswer}
```

Already done ✅

---

## COMPLETE FLOW AFTER FIXES

### Teacher Mode — Student Asks "Solve x² - 5x + 6 = 0"

```
1. Student types "Solve x² - 5x + 6 = 0" → Enter
2. Frontend:
   - awaitingAnswerRef is false → emit question_header("Solve x² - 5x + 6 = 0")
   - New card Q1 created
   - Send { type: "text", text: "Solve x² - 5x + 6 = 0" }

3. Backend (Teacher prompt):
   - AI draws Step 1 only (step_marker + draw_latex for factoring setup)
   - AI text response ends with "What two numbers multiply to 6 and add to -5?"
   - _asks_student_question() → True
   - Sends ONE status: { speaking: false, turn_complete: true, awaiting_answer: true }

4. Frontend:
   - awaitingAnswerRef = true
   - awaitingAnswer state = true
   - UI shows "Your turn 🤔" chip, placeholder = "Type your answer…"
   - Whiteboard shows Q1 with Step 1 only

5. Student types "-2 and -3" → Enter
   - awaitingAnswerRef is true → emit student_answer("-2 and -3")
   - Same Q1 card, no new card created
   - Send { type: "text", text: "-2 and -3" }

6. Backend:
   - AI says "Exactly!" + draws Step 2 (the solution)
   - If more steps: asks another question → awaiting_answer: true again
   - If final step: draws boxed answer → no question → awaiting_answer not sent

7. Repeat until solution complete
```

### Quick Mode — Same Question

```
1. Student types "Solve x² - 5x + 6 = 0" → Enter
2. Frontend: emit question_header → new card Q1
3. Backend (Quick prompt): AI draws ALL steps at once, circles answer, done
4. Status: { speaking: false, turn_complete: true } — no awaiting_answer
5. Student can ask a new question → new card Q2
```

### Mode Switch Mid-Conversation

```
1. Student is in Teacher mode, Q1 Step 2, AI is waiting for answer
2. Student clicks ⚡ Quick
3. Frontend: awaitingAnswerRef = false, awaitingAnswer = false, send set_mode
4. Backend: clear _awaiting_student_answer, reconnect Live API with Quick prompt
5. Student types new question → question_header → new card Q2
6. AI answers in Quick mode (all steps, no questions)
```

---

## FILES TO MODIFY (Summary)

| File | Change |
|------|--------|
| `backend/services/gemini_service.py` | (1) Rewrite Teacher prompts, (2) Move question detection into finally block, (3) Send awaiting_answer + turn_complete atomically |
| `backend/main.py` | Make `session.set_mode()` call use `await` |
| `frontend/src/hooks/useSession.ts` | Process `awaiting_answer` before `turn_complete` in handleMessage |

Everything else (groupWhiteboardCommands, sendText, VoicePanel) is already correct.

---

## VERIFICATION

After making changes:
1. `cd frontend && npx next build` — should compile clean
2. Start session → Teacher mode → ask "derivative of x²"
   - ✅ Should draw Step 1 ONLY, then ask a question
   - ✅ Q1 card should show just Step 1
3. Answer the question (e.g. "2x")
   - ✅ Should stay in Q1 card (no Q2 created)
   - ✅ AI should say "Exactly!" and draw Step 2
4. Switch to Quick mode → ask "integral of sin(x)"
   - ✅ Should create Q2 card
   - ✅ Should draw ALL steps at once, no questions
5. Switch back to Teacher → ask another question
   - ✅ Should create Q3, interactive again
