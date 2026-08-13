# Compact Help and Game-Control Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-game rules block with a concise, sectioned top-right help modal and center the name hint, candidate controls, and orb artwork without changing game behavior.

**Architecture:** `GameGuide` will own an accessible local modal state and render the existing visual vocabulary through compact section rows. `App` will place that guide in the persistent hero so help remains available during loading and errors. `CardSearch` and `OrbTray` retain their public APIs; their DOM order and CSS geometry change only at presentation boundaries.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Playwright.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-08-13-compact-help-layout-design.md`.
- Use Spire Codex `rarity_key` unchanged; the Snakebite rarity investigation is explicitly out of scope.
- Do not change game rules, answer selection, persisted round schemas, assistance consumption, candidate classification, sharing, or Daily/Hardcore/Practice behavior.
- Preserve at least 44 by 44 pixel interactive targets.
- Preserve continuous one-line-per-word hints, accessible hint text, orb VFX, drag and keyboard use, used remnants, and the slightly oversized orb artwork.
- Use the bundled supported Node runtime at `C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`; `package.json` requires Node `>=22.12`.
- Use strict test-driven development: every production behavior change must first be demonstrated by a meaningful failing test.
- Do not add dependencies.
- Do not add `Co-Authored-By` trailers.
- Work directly on `master`; do not create a branch or pull request. Do not push until all tasks, review, and final verification are complete.

## File Structure

- `src/client/components/GameGuide.tsx`: help trigger, modal lifecycle, focus handling, and compact section content.
- `src/client/App.tsx`: persistent hero placement; removes the guide from the game panel.
- `src/client/styles/global.css`: header trigger, modal, help section, color legend, and responsive presentation.
- `src/client/components/CardSearch.tsx`: name-hint slot ordering relative to the label/input.
- `src/client/styles/search.css`: centered name hint and candidate-visibility group.
- `src/client/components/OrbTray.tsx`: shared orb sizing hook; removes conflicting inline geometry.
- `src/client/styles/assistance.css`: common well/button/artwork centering geometry.
- `tests/client/GameGuide.test.tsx`: dialog lifecycle, compact contents, focus, and close behavior.
- `tests/client/app.test.tsx`: persistent header placement and legend removal from the live board.
- `tests/client/CardSearch.test.tsx`: assisted-control DOM order.
- `tests/client/OrbTray.test.tsx`: inventory structure and shared geometry hook.
- `tests/e2e/game.spec.ts`: real browser help, focus, responsive containment, centering, and orb geometry.

---

### Task 1: Accessible, Sectioned Header Help Modal

**Files:**
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles/global.css`
- Test: `tests/client/GameGuide.test.tsx`
- Test: `tests/client/app.test.tsx`
- Test: `tests/e2e/game.spec.ts`

**Interfaces:**
- Produces: `GameGuide(): React.JSX.Element`, with a button named `How to play` and a conditional modal `role="dialog"`, `aria-modal="true"`, labelled by `how-to-play-title`.
- Consumes: `KeywordStateIcons({ displayValue })`, `OrbVisual({ kind, compact })`, and `ORB_LABELS` without changing their APIs.
- Preserves: `GameShell` and `RoundGame` public behavior; no game hook or state interface changes.

- [ ] **Step 1: Replace the old disclosure expectations with failing modal tests**

In `tests/client/GameGuide.test.tsx`, replace the `<details>` assertions with tests that require:

```tsx
const view = render(<GameGuide />);
const trigger = screen.getByRole("button", { name: "How to play" });
expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();

fireEvent.click(trigger);
const dialog = screen.getByRole("dialog", { name: "How to play" });
expect(dialog).toHaveAttribute("aria-modal", "true");
for (const heading of ["Basics", "Result colors", "Keyword icons", "Orbs and filtering", "Name hints", "Modes"]) {
  expect(within(dialog).getByRole("heading", { name: heading })).toBeVisible();
}
expect(within(dialog).getByText("Both base and upgraded features match")).toBeVisible();
expect(within(dialog).getByText("Exactly one version matches")).toBeVisible();
expect(within(dialog).getByText("Neither version matches")).toBeVisible();
expect(dialog.querySelectorAll(".result-legend__swatch[aria-hidden='true']")).toHaveLength(3);
expect(dialog.querySelectorAll("svg[data-orb-kind]")).toHaveLength(3);
expect(dialog.querySelectorAll(".keyword-state-icons")).toHaveLength(4);
```

Add separate cases for Close, Escape, backdrop-only clicks, focus entry/return, and Tab wrapping:

```tsx
fireEvent.click(trigger);
const close = screen.getByRole("button", { name: "Close help" });
expect(close).toHaveFocus();
fireEvent.keyDown(document, { key: "Tab" });
expect(close).toHaveFocus();
fireEvent.keyDown(document, { key: "Escape" });
expect(trigger).toHaveFocus();

fireEvent.click(trigger);
const backdrop = view.container.querySelector(".game-guide__backdrop")!;
fireEvent.click(screen.getByRole("dialog", { name: "How to play" }));
expect(screen.getByRole("dialog", { name: "How to play" })).toBeVisible();
fireEvent.click(backdrop);
expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Add failing App placement and availability tests**

In `tests/client/app.test.tsx`, change the old legend/disclosure test so it asserts:

```tsx
const trigger = await screen.findByRole("button", { name: "How to play" });
expect(trigger.closest(".hero")).toBeTruthy();
expect(view.container.querySelector(".game-panel .game-guide")).toBeNull();
expect(screen.queryByText("Both base and upgraded features match")).not.toBeInTheDocument();
fireEvent.click(trigger);
expect(screen.getByRole("dialog", { name: "How to play" })).toBeVisible();
```

Add a loading-state case using a pending `loadSnapshot` promise and a mode-error case using the existing mocked `useGame` setup; both must still find the header trigger.

- [ ] **Step 3: Run the focused tests and verify RED**

Before implementation, also replace the old disclosure assertions in the full Daily/Practice E2E flow with:

```ts
await expect(page.getByText("Both base and upgraded features match", { exact: true })).toHaveCount(0);
await page.getByRole("button", { name: "How to play" }).click();
const help = page.getByRole("dialog", { name: "How to play" });
await expect(help).toBeVisible();
await expect(help.getByText("Both base and upgraded features match", { exact: true })).toBeVisible();
await page.keyboard.press("Escape");
await expect(help).toBeHidden();
await expect(page.getByRole("button", { name: "How to play" })).toBeFocused();
```

If ports 3000 or 5173 are occupied, first verify process ownership from the PID files and command lines. Stop only processes proven to belong to this workspace, or use a temporary ignored Playwright config with a free port and confirmed-absent Local Temp data root.

Run with the bundled Node directory prepended to `PATH`:

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx tests/client/app.test.tsx
npm exec playwright test tests/e2e/game.spec.ts --grep "Daily and Practice complete"
```

Expected: Vitest and Playwright fail because `GameGuide` still renders an always-visible legend and `<details>`, lives inside `.game-panel`, and has no dialog lifecycle.

- [ ] **Step 4: Implement the modal state and focus lifecycle**

In `GameGuide.tsx`:

```tsx
export function GameGuide() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeGuide = useCallback(() => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeGuide();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeGuide, open]);

  return <section className="game-guide" aria-label="Game help">
    <button ref={triggerRef} type="button" className="game-guide__trigger" onClick={() => setOpen(true)}>
      <span aria-hidden="true">?</span><span>How to play</span>
    </button>
    {open && <div className="game-guide__backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) closeGuide();
    }}>
      <div ref={dialogRef} className="game-guide__dialog" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
        <header className="game-guide__dialog-header">
          <h2 id="how-to-play-title">How to play</h2>
          <button ref={closeRef} type="button" className="game-guide__close" aria-label="Close help" onClick={closeGuide}>×</button>
        </header>
        <div className="game-guide__sections">{/* six compact sections */}</div>
      </div>
    </div>}
  </section>;
}
```

Render the six approved sections with short `<ul>` rows. Use:

```tsx
<KeywordStateIcons displayValue="false" />
<KeywordStateIcons displayValue="true" />
<KeywordStateIcons displayValue="false → true" />
<KeywordStateIcons displayValue="true → false" />
```

and one compact `<OrbVisual kind={kind} compact />` for each `reveal`, `filter`, and `negation`. Keep text exactly at the approved content level; do not restore the old long paragraphs.

- [ ] **Step 5: Move the guide into the persistent hero**

In `App.tsx`, remove `<GameGuide />` from `GameShell` and render it inside the hero:

```tsx
<header className="hero">
  <GameGuide />
  <p className="eyebrow">Slay the Spire 2</p>
  <h1>STSDLE</h1>
  <p className="subtitle">A daily card deduction.</p>
</header>
```

This keeps help available while snapshot loading, load errors, or mode errors are shown.

- [ ] **Step 6: Replace disclosure CSS with responsive modal CSS**

In `global.css`:

```css
.hero { position: relative; }

.game-guide {
  position: absolute;
  z-index: 60;
  top: 0;
  right: 0;
}

.game-guide__trigger,
.game-guide__close {
  display: inline-flex;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.game-guide__backdrop {
  position: fixed;
  z-index: 2000;
  inset: 0;
  display: grid;
  padding: 1rem;
  place-items: center;
  background: rgb(4 4 4 / 78%);
}

.game-guide__dialog {
  width: min(44rem, 100%);
  max-height: min(88vh, 50rem);
  padding: 1rem;
  overflow-y: auto;
  border: 1px solid #9d7847;
  border-radius: .75rem;
  color: var(--ink);
  background: #18120f;
  box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 70%);
  text-align: left;
}

.game-guide__sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .75rem;
}

@media (max-width: 640px) {
  .game-guide__trigger span:last-child { display: none; }
  .game-guide__sections { grid-template-columns: 1fr; }
}
```

Delete the old `.game-rules` disclosure rules and the mobile in-game legend stacking rules. Keep `.result-legend` styling but scope its display to `.game-guide__dialog .result-legend` so no live-board legend can reappear accidentally.

- [ ] **Step 7: Run focused tests and verify GREEN**

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx tests/client/app.test.tsx
npm run typecheck
```

Expected: all focused tests and typecheck pass; no raw game-state test changes are needed.

- [ ] **Step 8: Commit Task 1**

```powershell
git add src/client/components/GameGuide.tsx src/client/App.tsx src/client/styles/global.css tests/client/GameGuide.test.tsx tests/client/app.test.tsx
git add tests/e2e/game.spec.ts
git commit -m "feat: add compact help modal"
```

---

### Task 2: Centered Name Hint and Candidate Controls

**Files:**
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `src/client/styles/search.css`
- Test: `tests/client/CardSearch.test.tsx`
- Test: `tests/client/app.test.tsx`
- Test: `tests/e2e/game.spec.ts`

**Interfaces:**
- Consumes unchanged `CardSearchProps.nameHintSlot?: ReactNode` and `assistanceSlot?: ReactNode`.
- Produces DOM order: name hint, label, input, orb tray, candidate visibility, then conditional results.
- Preserves search query, focus, live filtering, visibility state, and option selection behavior.

- [ ] **Step 1: Change the assisted-control composition test to the required order**

In `tests/client/CardSearch.test.tsx`:

```tsx
expect([...search.children].map((child) => child.getAttribute("aria-label") ?? child.tagName)).toEqual([
  "Test name hint",
  "LABEL",
  "INPUT",
  "Test orb tray",
  "Candidate visibility",
]);
```

Update the corresponding child-order assertion in `tests/client/app.test.tsx` so `.name-hint` precedes `.card-search__label`, which precedes `.card-search__input`.

- [ ] **Step 2: Run focused tests and verify RED**

Add browser assertions to the existing viewport tests after a visible `.name-hint` has been produced:

```ts
const centered = await page.evaluate(() => {
  const centerX = (selector: string) => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return rect.left + rect.width / 2;
  };
  const visibility = document.querySelector(".candidate-visibility")!;
  const labels = [...visibility.querySelectorAll(".candidate-visibility__label")];
  const left = Math.min(...labels.map((label) => label.getBoundingClientRect().left));
  const right = Math.max(...labels.map((label) => label.getBoundingClientRect().right));
  return {
    search: centerX(".card-search"),
    hint: centerX(".name-hint"),
    visibility: centerX(".candidate-visibility"),
    labels: (left + right) / 2,
  };
});
expect(Math.abs(centered.search - centered.hint)).toBeLessThanOrEqual(1);
expect(Math.abs(centered.visibility - centered.labels)).toBeLessThanOrEqual(2);
```

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx tests/client/app.test.tsx
npm exec playwright test tests/e2e/game.spec.ts --grep "keeps .* shell"
```

Expected: the order assertion fails because the hint currently follows the visibility controls, and the browser centering assertion fails because the hint and checkbox group are left aligned.

- [ ] **Step 3: Move the hint slot before the label/input**

In `CardSearch.tsx`, render:

```tsx
return <section className="card-search" aria-label="Card search">
  {assistance !== null && nameHintSlot}
  <label className="card-search__label" htmlFor={`${listboxId}-input`}>Guess a card</label>
  <input /* existing unchanged props and handlers */ />
  {assistance !== null && assistanceSlot}
  {assistance !== null && <fieldset className="candidate-visibility" aria-label="Candidate visibility">{/* unchanged controls */}</fieldset>}
  {/* existing conditional options or empty status */}
</section>;
```

Do not move or rewrite any input, pointer, keyboard, result, or visibility handler.

- [ ] **Step 4: Center the hint and candidate controls**

In `search.css`:

```css
.candidate-visibility {
  justify-content: center;
  text-align: center;
}

.name-hint {
  justify-content: center;
  margin: 0 0 .65rem;
  text-align: center;
}
```

Keep `.name-hint__characters { text-align: center; }`, word wrapping, and 44 pixel checkbox labels unchanged.

- [ ] **Step 5: Run focused and related tests and verify GREEN**

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx tests/client/NameHint.test.tsx tests/client/app.test.tsx
npm run typecheck
```

Expected: all tests pass; empty-focus candidates, category filtering, and keyboard navigation remain green.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/client/components/CardSearch.tsx src/client/styles/search.css tests/client/CardSearch.test.tsx tests/client/app.test.tsx
git add tests/e2e/game.spec.ts
git commit -m "fix: center search assistance controls"
```

---

### Task 3: Shared Orb-Well Centering Geometry

**Files:**
- Modify: `src/client/components/OrbTray.tsx`
- Modify: `src/client/styles/assistance.css`
- Test: `tests/client/OrbTray.test.tsx`
- Test: `tests/e2e/game.spec.ts`

**Interfaces:**
- Preserves `OrbTray({ assistance, disabled }: OrbTrayProps)` and all `getOrbButtonProps` behavior.
- Produces a `.orb-tray__well` whose direct `.orb-button` and `.orb-visual` use a common CSS sizing variable and share the same center point.
- Preserves 52 pixel normal artwork, 30 pixel compact remnants, selection borders, drag source hiding, VFX, and labels.

- [ ] **Step 1: Add a failing structural geometry test**

In `tests/client/OrbTray.test.tsx`, add:

```tsx
const view = renderTray();
for (const well of view.container.querySelectorAll(".orb-tray__well")) {
  const button = well.querySelector<HTMLButtonElement>(":scope > .orb-button");
  expect(button).not.toBeNull();
  expect(button).not.toHaveAttribute("style");
  expect(button!.querySelector(":scope > .orb-visual")).not.toBeNull();
}
```

This test makes the current inline `minHeight`/`minWidth` geometry fail and locks the shared nesting that the browser measurement relies on.

In the same viewport E2E cases, measure both axes rather than relying on visual inspection:

```ts
const orbCenters = await page.locator(".orb-tray__well").evaluateAll((wells) => wells.map((well) => {
  const center = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  return {
    well: center(well),
    button: center(well.querySelector(":scope > .orb-button")!),
    art: center(well.querySelector(":scope > .orb-button > .orb-visual")!),
  };
}));
for (const orb of orbCenters) {
  expect(Math.abs(orb.well.x - orb.button.x)).toBeLessThanOrEqual(.5);
  expect(Math.abs(orb.well.y - orb.button.y)).toBeLessThanOrEqual(.5);
  expect(Math.abs(orb.well.x - orb.art.x)).toBeLessThanOrEqual(.5);
  expect(Math.abs(orb.well.y - orb.art.y)).toBeLessThanOrEqual(.5);
}
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm exec vitest run tests/client/OrbTray.test.tsx
npm exec playwright test tests/e2e/game.spec.ts --grep "keeps .* shell"
```

Expected: the unit test fails because each orb button currently carries an inline sizing style. If the real browser centers already pass, stop and inspect the rendered bounding boxes and screenshot before changing CSS; do not claim the inline style is the visual root cause without a failing browser observation.

- [ ] **Step 3: Remove conflicting inline geometry**

In `OrbTray.tsx`, delete:

```tsx
style={{ ...buttonProps.style, minHeight: 48, minWidth: 48 }}
```

and preserve `buttonProps.style` only when it is defined:

```tsx
style={buttonProps.style}
```

Do not alter selection, pointer capture, disabled, pressed, drag-source, or tab-index props.

- [ ] **Step 4: Define one shared centered sizing system**

In `assistance.css`:

```css
.orb-tray__well {
  --orb-control-size: 48px;
  --orb-art-size: 52px;
  display: grid;
  width: var(--orb-control-size);
  height: var(--orb-control-size);
  place-items: center;
}

.orb-button {
  display: grid;
  width: var(--orb-control-size);
  height: var(--orb-control-size);
  min-width: var(--orb-control-size);
  min-height: var(--orb-control-size);
  padding: 0;
  place-items: center;
}

.orb-button > .orb-visual {
  width: var(--orb-art-size);
  height: var(--orb-art-size);
  max-width: none;
  margin: 0;
  transform: none;
}
```

Keep the 52 pixel visual deliberately 4 pixels larger than the 48 pixel well; CSS Grid centers that overflow equally on every side. Do not change motif coordinates in `OrbVisual.tsx`.

- [ ] **Step 5: Run orb interaction tests and verify GREEN**

```powershell
npm exec vitest run tests/client/OrbTray.test.tsx tests/client/OrbInteractionContext.test.tsx tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx
npm run typecheck
```

Expected: inventory, selection, dragging, invalid targets, VFX lifecycle, and typecheck all pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/client/components/OrbTray.tsx src/client/styles/assistance.css tests/client/OrbTray.test.tsx
git add tests/e2e/game.spec.ts
git commit -m "fix: align orb inventory artwork"
```

---

### Task 4: Responsive Browser Verification and Runtime Handoff

**Files:**
- Modify: `tests/e2e/game.spec.ts`
- Modify only if the visible setup text changed: `README.md`

**Interfaces:**
- Consumes final DOM classes from Tasks 1–3.
- Produces browser evidence at 390 by 844, 768 by 1024, and 1440 by 900 viewports.
- Does not change production game state or snapshot data.

- [ ] **Step 1: Extend the modal E2E assertions through every real close path**

In the full Daily/Practice experience test, assert the legend is absent before opening, then open and verify the dialog:

```ts
await expect(page.getByText("Both base and upgraded features match", { exact: true })).toHaveCount(0);
await page.getByRole("button", { name: "How to play" }).click();
const help = page.getByRole("dialog", { name: "How to play" });
await expect(help).toBeVisible();
for (const heading of ["Basics", "Result colors", "Keyword icons", "Orbs and filtering", "Name hints", "Modes"]) {
  await expect(help.getByRole("heading", { name: heading })).toBeVisible();
}
await expect(help.getByText("Both base and upgraded features match", { exact: true })).toBeVisible();
const close = help.getByRole("button", { name: "Close help" });
await expect(close).toBeFocused();
await page.keyboard.press("Tab");
await expect(close).toBeFocused();
await page.keyboard.press("Escape");
await expect(help).toBeHidden();
await expect(page.getByRole("button", { name: "How to play" })).toBeFocused();

await page.getByRole("button", { name: "How to play" }).click();
await page.getByRole("button", { name: "Close help" }).click();
await expect(help).toBeHidden();

await page.getByRole("button", { name: "How to play" }).click();
await page.locator(".game-guide__backdrop").click({ position: { x: 4, y: 4 } });
await expect(help).toBeHidden();
```

- [ ] **Step 2: Add responsive geometry assertions**

In the existing viewport loop, after the scenario has produced a visible `.name-hint`, evaluate:

```ts
const layout = await page.evaluate(() => {
  const center = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const search = document.querySelector(".card-search")!;
  const hint = document.querySelector(".name-hint")!;
  const visibility = document.querySelector(".candidate-visibility")!;
  const labels = [...visibility.querySelectorAll(".candidate-visibility__label")];
  const labelLeft = Math.min(...labels.map((label) => label.getBoundingClientRect().left));
  const labelRight = Math.max(...labels.map((label) => label.getBoundingClientRect().right));
  const orbs = [...document.querySelectorAll(".orb-tray__well")].map((well) => ({
    well: center(well),
    button: center(well.querySelector(":scope > .orb-button")!),
    art: center(well.querySelector(":scope > .orb-button > .orb-visual")!),
  }));
  return {
    searchCenter: center(search).x,
    hintCenter: center(hint).x,
    visibilityCenter: center(visibility).x,
    labelGroupCenter: (labelLeft + labelRight) / 2,
    orbs,
  };
});
expect(Math.abs(layout.searchCenter - layout.hintCenter)).toBeLessThanOrEqual(1);
expect(Math.abs(layout.visibilityCenter - layout.labelGroupCenter)).toBeLessThanOrEqual(2);
for (const orb of layout.orbs) {
  expect(Math.abs(orb.well.x - orb.button.x)).toBeLessThanOrEqual(.5);
  expect(Math.abs(orb.well.y - orb.button.y)).toBeLessThanOrEqual(.5);
  expect(Math.abs(orb.well.x - orb.art.x)).toBeLessThanOrEqual(.5);
  expect(Math.abs(orb.well.y - orb.art.y)).toBeLessThanOrEqual(.5);
}
```

Open the modal at each viewport and assert its bounding rect remains within the page, its `scrollHeight` can exceed `clientHeight` without document overflow, and the trigger bounding box is at least 44 by 44 pixels with its center in the right half of `.app-shell`.

- [ ] **Step 3: Confirm the browser assertions retain the RED/GREEN evidence from Tasks 1–3**

Review the recorded runs from Tasks 1–3. The required old-state failures are: no dialog and legend visible on the board; hint below the input and left-aligned controls; and either a measured orb-center mismatch or a documented stop-and-investigate result if the original geometry test passed. Do not weaken assertions to manufacture RED evidence.

- [ ] **Step 4: Safely prepare the E2E runtime**

Before stock Playwright, inspect ports 3000 and 5173 plus `.tmp/live-backend.pid` and `.tmp/dev-site.pid`. Stop a process only when its PID, executable, and command line prove it belongs to this workspace. If unrelated processes occupy a port, use a temporary ignored Playwright config with a free port and a confirmed-absent Local Temp `STSDLE_DATA_DIR`; remove that temporary config afterward.

- [ ] **Step 5: Run the complete supported-runtime gate**

With bundled Node prepended to `PATH`, run in this order:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: every command exits 0; Playwright reports no page overflow, help/modal/focus failures, or official Spire Codex browser requests.

- [ ] **Step 6: Review the complete feature diff**

Inspect:

```powershell
git diff d0f796c^..HEAD --check
git diff d0f796c^..HEAD --stat
git status --short --branch
git log d0f796c^..HEAD --format='%h %s%n%b'
```

Confirm the diff contains only the approved help/layout work and design/plan documents, the worktree is clean after commit, and no commit contains `Co-Authored-By`.

- [ ] **Step 7: Commit Task 4**

```powershell
git add tests/e2e/game.spec.ts README.md
git commit -m "test: verify compact help layout"
```

If `README.md` did not require a visible setup change, omit it from `git add` and the commit.

- [ ] **Step 8: Restart and verify the local site after review**

Only after code review is clean, start the built backend with the existing strictly validated data directory from `.tmp/live-data-path.txt`, `STSDLE_SKIP_SYNC=1`, and bundled Node; start Vite on `localhost:5173` with bundled Node. Use hidden windows, write new stdout/stderr logs and owned PID files, then verify:

```text
http://127.0.0.1:3000/health        -> 200
http://localhost:5173/              -> 200
http://localhost:5173/health        -> 200
http://localhost:5173/runtime/cards.json -> 577 current cards
```

Confirm both stderr logs are empty and leave only these two verified project-owned processes running for the user.

---

## Final Review Checklist

- The header help button is top-right, at least 44 by 44 pixels, and available during loading/errors.
- The modal is sectioned, concise, icon-led, focus-trapped, internally scrollable, and dismissible through Close, backdrop, or Escape.
- The result legend is absent from the active game board and present inside the modal only.
- The name hint is immediately above the search label/input and centered.
- Neutral, Green, and Red controls are centered without changing their filtering semantics.
- Every orb visual, button, and well shares the same center at all tested viewports.
- No game-state, snapshot, rarity, persistence, sharing, or assistance-domain behavior changed.
- Full Vitest, Playwright, typecheck, build, diff, and runtime handoff evidence is fresh.
