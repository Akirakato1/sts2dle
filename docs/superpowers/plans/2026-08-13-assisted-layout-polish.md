# Assisted Layout Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the assistance controls and remove Reveal Orb spacing from the feature-grid geometry by turning its answer bubble into a true overlay.

**Architecture:** `CardSearch` remains the owner of control and listbox order, but renders visibility, tray, optional name hint, and input in the approved sequence. `GuessGrid` keeps the bubble inside the selected semantic columnheader while CSS centers it over that header without reserving layout space.

**Tech Stack:** React 19, TypeScript, CSS Grid/Flexbox, Vitest Testing Library, Playwright.

## Global Constraints

- Assisted control order is checkboxes, orb tray, active name hint, Guess a card label/input.
- Hardcore continues to omit checkboxes, orbs, and name hints.
- The Reveal bubble retains `role="note"`, accessible paired values, keyword icons, persistence, and restoration.
- The grid remains the sole horizontal overflow owner.
- Verify 390×844, 768×1024, and 1440×900.
- Do not change game state, filtering, persistence, card data, or answer selection.
- Do not add branches, pull requests, or `Co-Authored-By` trailers.

---

### Task 1: Reorder assisted search controls

**Files:**
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `tests/client/app.test.tsx`
- Modify: `tests/client/CardSearch.test.tsx`

**Interfaces:**
- Consumes: existing `assistanceSlot`, `nameHintSlot`, `assistance`, and `onVisibilityChange` props.
- Produces: unchanged `CardSearchProps` and search behavior with new direct-child order.

- [ ] **Step 1: Change the existing App order test to the approved order**

Resolve direct-child indexes and assert:

```ts
expect([visibilityIndex, trayIndex, hintIndex, labelIndex, inputIndex]).toEqual([0, 1, 2, 3, 4]);
```

Add a CardSearch test that focuses the now-last input with an empty query and verifies the visible candidate list still opens and arrow-key selection still works.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm exec vitest run tests/client/app.test.tsx tests/client/CardSearch.test.tsx
```

Expected: the order assertion fails because the current order is hint, label, input, tray, visibility.

- [ ] **Step 3: Reorder only CardSearch JSX**

Render in this sequence:

```tsx
{assistance !== null && <fieldset className="candidate-visibility" ... />}
{assistance !== null && assistanceSlot}
{assistance !== null && nameHintSlot}
<label className="card-search__label" ...>Guess a card</label>
<input className="card-search__input" ... />
{menuOpen && (...) }
```

Move existing blocks intact; do not alter handlers or search logic.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same two Vitest files. Expected: all tests PASS.

- [ ] **Step 5: Commit the control order**

```powershell
git add src/client/components/CardSearch.tsx tests/client/app.test.tsx tests/client/CardSearch.test.tsx
git commit -m "fix: reorder assisted search controls"
```

### Task 2: Overlay Reveal answers without reserved grid space

**Files:**
- Modify: `src/client/styles/grid.css`
- Modify: `tests/client/GuessGrid.test.tsx`
- Modify: `tests/e2e/game.spec.ts`

**Interfaces:**
- Consumes: existing `.guess-grid__reveal-bubble` inside `.guess-grid__header`.
- Produces: unchanged semantic DOM with compact geometry and overlay-only visual placement.

- [ ] **Step 1: Add failing unit and browser geometry assertions**

In the GuessGrid test, retain the exact role/name/icon checks and assert the bubble remains a descendant of the revealed columnheader.

In each existing viewport case, evaluate:

```ts
const grid = document.querySelector<HTMLElement>(".guess-grid")!;
const header = document.querySelector<HTMLElement>(".guess-grid__header")!;
const gridStyle = getComputedStyle(grid);
return {
  paddingTop: Number.parseFloat(gridStyle.paddingTop),
  paddingLeft: Number.parseFloat(gridStyle.paddingLeft),
  headerHeight: header.getBoundingClientRect().height,
};
```

Expect top and left padding to be equal within 0.5 CSS pixels. After using Reveal, capture the header row before and after the bubble appears and expect its top/height to remain unchanged within 0.5 pixels.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm exec vitest run tests/client/GuessGrid.test.tsx
npm run test:e2e -- --grep "Normal Daily|keeps 390|keeps 768|keeps 1440"
```

Expected: viewport geometry fails because top padding is 3rem while side padding is `.45rem`.

- [ ] **Step 3: Make the Reveal bubble an in-header overlay**

Change the grid padding and bubble placement:

```css
.guess-grid-scroll .guess-grid {
  padding: .45rem;
}

.guess-grid__reveal-bubble {
  z-index: 8;
  top: 50%;
  bottom: auto;
  left: 50%;
  transform: translate(-50%, -50%);
}
```

Remove `.guess-grid__reveal-bubble::after` so no pointer implies space outside the header. Keep the existing color, border, size, role, and content styles.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused unit/browser commands. Expected: all selected tests PASS at all three viewports.

- [ ] **Step 5: Run the complete project gate**

Under Node 24, run:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: all commands exit 0, with no official Spire Codex browser requests in E2E.

- [ ] **Step 6: Commit the overlay and acceptance coverage**

```powershell
git add src/client/styles/grid.css tests/client/GuessGrid.test.tsx tests/e2e/game.spec.ts
git commit -m "fix: overlay revealed feature answers"
```

