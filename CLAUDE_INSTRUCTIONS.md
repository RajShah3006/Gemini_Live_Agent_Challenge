# MathBoard — Final Fixes (Interaction, Audio & Layout)

This document provides a complete, step-by-step plan for Claude to fix the remaining critical issues: Teacher mode flow, missing audio responses, voice input failures, and whiteboard layout overlap.

---

## 1. FIX INTERACTIVE FLOW (Teacher Mode)

**Problem:** Student answers create new Question cards instead of continuing in the same section.
**Cause:** Backend sends `turn_complete` before `awaiting_answer`, so frontend clears the "answering" state too early.

### Step 1.1: Backend — Send `awaiting_answer` Atomically
**File:** `backend/services/gemini_service.py` -> `_generate_whiteboard()` method.
Replace the `finally` block and old question detection with this atomic version:

```python
            finally:
                is_asking = False
                if self._mode == "teacher" and text_parts:
                    combined_text = " ".join(text_parts)
                    if _asks_student_question(combined_text):
                        self._awaiting_student_answer = True
                        is_asking = True

                status: dict = {"speaking": False, "turn_complete": True}
                if is_asking:
                    status["awaiting_answer"] = True
                await self.on_status(status)
```

### Step 1.2: Frontend — Process `awaiting_answer` First
**File:** `frontend/src/hooks/useSession.ts` -> `handleMessage` -> `case "status"`:
Move the `awaiting_answer` check **above** `turn_complete`:

```typescript
  if (msg.payload.awaiting_answer !== undefined) {
    awaitingAnswerRef.current = !!msg.payload.awaiting_answer;
    setAwaitingAnswer(!!msg.payload.awaiting_answer);
  }
  if (msg.payload.turn_complete) {
    setIsThinking(false);
  }
```

---

## 2. FIX WHITEBOARD OVERLAP & LAYOUT

**Problem:** "Step 1" markers overlap with the math drawn below them.
**Goal:** Indent the procedure and keep steps left-aligned with proper vertical spacing.

### Step 2.1: Update System Prompts (Layout Rules)
**File:** `backend/services/gemini_service.py` -> `WB_SYSTEM_INSTRUCTION` & `AUDIO_SYSTEM_INSTRUCTION`.
Update the **LAYOUT** and **STEP** rules in both:

```python
# Updated Layout Rules for both prompts:
# 1. step_marker(step=N, x=30, y=Y) -> Use x=30 for all step markers.
# 2. INDENT CONTENT: All draw_latex/draw_text must be at x=80 (50px indent).
# 3. VERTICAL SPACING: 
#    - Initial Step 1 at y=60.
#    - Content starts 60px below its step marker (e.g., if step at y=60, math at y=120).
#    - Subsequent lines increment y by 60px.
#    - New Step Marker starts 100px below previous content line.
```

---

## 3. FIX AUDIO (Response & Input)

**Problem:** 
1. AI doesn't speak back when using text input (Standard API doesn't have native audio).
2. Voice input (Push-to-Talk) is ignored sometimes.

### Step 3.1: Frontend — Enable Browser TTS (Text-to-Speech)
**File:** `frontend/src/hooks/useSession.ts`.
Update `useEffect` that listens for transcript changes to trigger `window.speechSynthesis` if `pendingAutoSpeakRef` is true.

```typescript
// Inside handleMessage -> case "transcript"
if (role === "tutor" && pendingAutoSpeakRef.current) {
    speakTranscript(content); // Implement this using browser SpeechSynthesis
    pendingAutoSpeakRef.current = false;
}
```

### Step 3.2: Backend — Make `set_mode` Async & Reconnect
**File:** `backend/services/gemini_service.py` -> `set_mode`.
Ensure it's `async` and clears `_awaiting_student_answer` when switching to `quick`. 
**File:** `backend/main.py`.
Update the call: `await session.set_mode(payload.get("mode"))`.

---

## 4. MOBILE RESPONSIVENESS (Quick Fix)

**File:** `frontend/src/app/globals.css`.
Ensure the sidebar and whiteboard scale correctly on small screens. Use `flex-col` for the main layout on screens `< 768px`.

---

## VERIFICATION CHECKLIST
1. **Teacher Flow**: Ask a question -> AI draws Step 1 -> AI asks a question -> Answer it -> **Stays in Q1 card**.
2. **Audio**: Ask via text -> **Browser speaks the response**.
3. **Layout**: Steps are at x=30, math is indented at x=80. No text overlap.
4. **Voice**: Click "Push to Talk" -> Speak -> **AI responds via Live API**.
