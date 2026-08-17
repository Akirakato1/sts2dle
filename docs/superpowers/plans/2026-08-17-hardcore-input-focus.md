# Hardcore Input Focus Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore focus to the cleared Hardcore guess input after an accepted guess finishes its reveal lock.

**Architecture:** `CardSearch` owns the focus lifecycle because it owns both the input and Hardcore submission. Refs record a successful submission and the subsequent disabled reveal; an effect focuses the same input only after it re-enables, while `roundKey` changes cancel stale restoration.

**Tech Stack:** React 19, TypeScript, Testing Library/Vitest, Playwright.

## Global Constraints

- Apply to Hardcore Daily and Hardcore Practice only through the existing `hardcore-name` search mode.
- Keep the input disabled during guess-row reveals.
- Preserve invalid-name focus, query clearing, candidate search, animations, and submission rules.
- Cancel pending focus restoration on every `roundKey` change.
- Use bundled Node.js v24.19.0 for verification.
- Commit and push direct `master` to `origin/main` without a pull request or `Co-Authored-By` trailer.

---

### Task 1: Restore Hardcore input focus after reveal

**Files:**
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `tests/client/CardSearch.test.tsx`
- Modify: `tests/e2e/game.spec.ts`

**Interfaces:**
- Consumes: existing `CardSearchProps.disabled`, `CardSearchProps.roundKey`, and `CardSearchMode` `{ kind: "hardcore-name"; submitExactName(query): boolean }`.
- Produces: no new public API; successful Hardcore submissions restore focus after the existing disabled-to-enabled reveal cycle.

- [ ] **Step 1: Add failing unit coverage for restoration and cancellation**

Extend the accepted-name unit test so it stores the render result, focuses the input, submits successfully, rerenders with `disabled`, moves focus to an outside button, then rerenders enabled and expects the input to regain focus. Define this local render function inside the test so every required prop stays explicit:

```tsx
const hardcoreSearch = (disabled: boolean, roundKey = "hardcore-round") => <>
  <button type="button">Outside</button>
  <CardSearch
    cards={cards}
    cardsById={cardsById}
    spriteMap={spriteMap}
    guessedCardIds={new Set()}
    assistance={null}
    roundKey={roundKey}
    disabled={disabled}
    searchMode={{ kind: "hardcore-name", submitExactName }}
    onVisibilityChange={vi.fn()}
    onSelect={onSelect}
  />
</>;
const view = render(hardcoreSearch(false));
const input = screen.getByRole("searchbox", { name: "Guess a card" });
input.focus();
fireEvent.change(input, { target: { value: "Known Card" } });
fireEvent.keyDown(input, { key: "Enter" });

view.rerender(hardcoreSearch(true));
screen.getByRole("button", { name: "Outside" }).focus();
expect(input).not.toHaveFocus();

view.rerender(hardcoreSearch(false));
expect(input).toHaveFocus();
```

Add a second test that follows the same successful-submit and disabled sequence, but rerenders with `roundKey="next-hardcore-round"` before enabling. Keep the outside button focused and assert the input does not regain focus.

- [ ] **Step 2: Run the focused unit tests to verify RED**

Run:

```powershell
$env:PATH = "C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
node node_modules/vitest/vitest.mjs run tests/client/CardSearch.test.tsx
```

Expected: restoration fails because the enabled Hardcore input is not automatically focused; the existing invalid-submission test remains green.

- [ ] **Step 3: Implement the component-local focus lifecycle**

In `CardSearch`, add refs beside the existing interaction refs:

```tsx
const inputRef = useRef<HTMLInputElement>(null);
const restoreHardcoreFocus = useRef(false);
const sawHardcoreRevealLock = useRef(false);
```

Move the existing `roundKey` reset effect before the `disabled` effect and clear both lifecycle markers in it:

```tsx
useEffect(() => {
  restoreHardcoreFocus.current = false;
  sawHardcoreRevealLock.current = false;
  pointerSelecting.current = false;
  visibilityPointerDown.current = false;
  setQuery("");
  setActiveCardId(null);
  setIsOpen(false);
  setInvalidAttempt(0);
}, [roundKey]);
```

Update the disabled effect so it observes the reveal lock and restores focus only after that lock ends:

```tsx
useEffect(() => {
  if (!disabled) {
    if (restoreHardcoreFocus.current && sawHardcoreRevealLock.current) {
      restoreHardcoreFocus.current = false;
      sawHardcoreRevealLock.current = false;
      inputRef.current?.focus();
    }
    return;
  }
  if (restoreHardcoreFocus.current) sawHardcoreRevealLock.current = true;
  pointerSelecting.current = false;
  visibilityPointerDown.current = false;
  setQuery("");
  setActiveCardId(null);
  setIsOpen(false);
  setInvalidAttempt(0);
}, [disabled]);
```

When `submitHardcoreName()` succeeds, set `restoreHardcoreFocus.current = true` before clearing state. Attach `ref={inputRef}` to the search input.

- [ ] **Step 4: Run focused unit tests to verify GREEN**

Run the Step 2 command.

Expected: all `CardSearch` tests pass, including accepted restoration, round cancellation, and invalid-name retention.

- [ ] **Step 5: Add real-browser focus acceptance**

In `tests/e2e/game.spec.ts`, inside `Hardcore memory entry rejects invalid and already-guessed names but accepts complete normalized names`, add this assertion immediately after `submitHardcoreGuessAndWait(...)` and the accepted row checks:

```ts
await expect(search).toHaveValue("");
await expect(search).toBeFocused();
```

This must use the existing helper that waits for the complete reveal cycle, so it proves focus after re-enable rather than immediately after Enter.

- [ ] **Step 6: Run browser test to verify RED/GREEN mutation fidelity**

Before the production change, or by temporarily removing only `inputRef.current?.focus()` after GREEN, run:

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/game.spec.ts --grep "Hardcore memory entry" --workers=1
```

Expected RED: the accepted guess clears the query but the input is not focused. Restore the implementation and rerun; expected GREEN: 1 test passes. Remove the temporary mutation completely.

- [ ] **Step 7: Run final verification**

Run serially under bundled Node 24.19.0:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Expected: typecheck passes; all unit tests pass; client/server production build passes; all browser tests pass; diff check reports no errors.

- [ ] **Step 8: Review, commit, push, and verify sync**

Review the complete feature diff against `docs/superpowers/specs/2026-08-17-hardcore-input-focus-design.md`, then run:

```powershell
git add -- src/client/components/CardSearch.tsx tests/client/CardSearch.test.tsx tests/e2e/game.spec.ts
git commit -m "fix: restore hardcore guess focus"
git push origin master:main
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git status --short --branch
```

Expected: divergence is `0 0`, the tree is clean, and every local commit is authored and committed by the user without co-author trailers.
