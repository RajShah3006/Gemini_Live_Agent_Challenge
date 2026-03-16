# MathBoard — Remaining Improvements for Claude

Copy-paste this into Claude. Each item is self-contained with the exact file, location, and what to change.

---

## 1. 🔴 Rewrite Teacher Mode Prompt to Be Interactive

**File:** `backend/services/gemini_service.py`
**Lines:** 135–154 (`WB_SYSTEM_INSTRUCTION`) AND 117–132 (`AUDIO_SYSTEM_INSTRUCTION`)

**Problem:** Both Teacher prompts say "draw the COMPLETE solution in one response" / "start drawing right away." This makes Teacher mode identical to Quick mode — the AI dumps everything at once instead of pausing to ask questions.

**Change `WB_SYSTEM_INSTRUCTION` to:**

```python
WB_SYSTEM_INSTRUCTION = """You are MathBoard, an interactive math tutor. You have a whiteboard.

You are in TEACHER MODE — guide the student through the solution step by step, pausing to check understanding.

RULES:
1. Draw ONE STEP at a time, then STOP and ask the student a question before continuing.
2. NEVER call clear_whiteboard(). The board preserves all work.
3. step_marker() for each step heading. Always start with Step 1 for each new question.
4. draw_latex() for ALL math. Always use \\frac{}{} with braces for fractions. Use \\cdot or \\times for multiplication (NEVER *).
5. draw_text() for short annotations only (under 25 chars). NEVER start draw_text with "Step".
6. LAYOUT: All content in a SINGLE column, x always between 30-80. y starts at 60, increment ~60px per line. NEVER put text at x > 200.
7. After drawing one step, ASK the student a question to test understanding. Examples:
   - "What rule should we apply here?"
   - "What do you get when you differentiate this term?"
   - "Can you simplify this expression?"
8. When the student answers CORRECTLY: praise briefly ("Exactly!", "Nice!") → draw the next step → ask next question.
9. When the student answers WRONG: do NOT reveal the answer. Instead:
   - Point out what went wrong
   - Give a hint ("Remember the chain rule says...")
   - Re-ask or rephrase the question
10. FINAL ANSWER: Only after the student has participated, write the final answer with \\boxed{} and draw_circle().
11. Use symbolic notation on the board, not prose.

GRAPHING: draw_graph() with JS Math syntax. Use width 300, height 220.
HOMEWORK: When student sends an image, grade each problem. Use ✓ or show corrections.
START by drawing Step 1 only, then ask your first question."""
```

**Change `AUDIO_SYSTEM_INSTRUCTION` similarly** — same interactive rules but add:
```
Keep your spoken explanation brief. Draw one step, speak the question, then wait.
```

---

## 2. 🔴 Add Auto-Scroll on Whiteboard

**File:** `frontend/src/components/whiteboard/Whiteboard.tsx` (or `QuestionBoardCards.tsx` — whichever renders the solution sections)

**Problem:** When the AI draws new content below the visible viewport, the student has to manually scroll to see it.

**What to add:**
```typescript
// After a new whiteboard command is rendered, scroll to show it
useEffect(() => {
  if (commands.length > 0) {
    const lastCmd = commands[commands.length - 1];
    // Only auto-scroll if user hasn't manually scrolled recently
    const container = scrollContainerRef.current;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        requestAnimationFrame(() => {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        });
      }
    }
  }
}, [commands.length]);
```

Add a `scrollContainerRef` on the whiteboard's scrollable container div.

---

## 3. 🟡 Add "Your Turn" Chip When Awaiting Answer

**File:** `frontend/src/components/voice/VoicePanel.tsx`

**Problem:** The pulsing amber border is subtle. Add a visible chip above the input area.

**Add this JSX right before the input field div (around line ~278):**
```tsx
{awaitingAnswer && (
  <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-full text-xs font-medium animate-pulse"
    style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
    <span className="h-2 w-2 rounded-full" style={{ background: "#fbbf24" }} />
    Your turn — answer the question above 🤔
  </div>
)}
```

---

## 4. 🟡 Mobile Responsive Layout

**File:** `frontend/src/app/page.tsx` + `frontend/src/app/globals.css`

**Problem:** The site is desktop-only. No responsive breakpoints at all.

**Changes needed:**
1. **Sidebar**: Already has mobile slide-out logic (line ~500-507). Add a hamburger button visible on mobile:
```tsx
{isMobile && (
  <button onClick={() => setShowSidebar(true)} className="md:hidden p-2 rounded-lg hover:bg-white/5">
    <span className="text-lg">☰</span>
  </button>
)}
```
Place this in the header, before the MathBoard logo.

2. **Bottom control bar**: Already has `flex-col sm:flex-row`. Verify the mode toggles and controls stack properly on narrow screens.

3. **Right-side floating tools** (Draw/Formulas): Hide on mobile or move into a bottom sheet:
```css
@media (max-width: 768px) {
  .floating-tools { display: none; }
}
```

4. **Whiteboard/cards area**: Should be `w-full` on mobile without sidebar competing for space.

---

## 5. 🟡 Fix Zoom Display

**File:** `frontend/src/components/whiteboard/WhiteboardToolbar.tsx` (or wherever zoom is displayed)

**Problem:** The zoom shows "200%" when the actual rendered scale is 100% (because the code does `scale(zoom/2)`). This confuses users.

**Fix:** Either:
- Display `Math.round(zoom / 2 * 100)` as the percentage, OR
- Change the default zoom from 200 to 100 and remove the `/2` division

---

## 6. 🟢 Error Toast System

**File:** `frontend/src/app/page.tsx`

**Problem:** Errors go to `console.log` or show as inline text. Add a simple toast.

**Add a lightweight toast component:**
```tsx
const [toast, setToast] = useState<string | null>(null);

useEffect(() => {
  if (errorMessage) {
    setToast(errorMessage);
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }
}, [errorMessage]);

// In JSX, above the bottom bar:
{toast && (
  <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-fadeIn"
    style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", backdropFilter: "blur(12px)" }}>
    {toast}
  </div>
)}
```

---

## Priority Order

1. **Teacher prompt rewrite** (#1) — This is THE differentiating feature. Without it, Teacher and Quick mode behave identically.
2. **Auto-scroll** (#2) — Students shouldn't have to chase content.
3. **Your Turn chip** (#3) — Makes the interactive flow obvious.
4. **Mobile responsive** (#4) — Required for competition.
5. **Zoom fix** (#5) — Quick cosmetic fix.
6. **Error toasts** (#6) — Nice polish.
