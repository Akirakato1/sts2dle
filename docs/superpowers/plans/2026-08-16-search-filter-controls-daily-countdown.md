# Search Filter Controls and Daily Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent Search filter collapse/reset controls, replace the old all-disabled Search default with an all-enabled empty default, and show a second-accurate UTC Daily countdown in the hero.

**Architecture:** The canonical filter default remains in the pure `card-filter` domain module. A strict Search preferences envelope v2 stores `{ filter, collapsed }`, while `SearchWorkspace` coordinates persistence and passes controlled props to `SearchFilterPanel`. A separate `DailyCountdown` component derives every displayed value from the current clock so throttled timers cannot accumulate drift.

**Tech Stack:** React 19, TypeScript, Zod, CSS, Vitest/Testing Library, Playwright, browser `localStorage`.

## Global Constraints

- Work directly on `master`; do not create a branch or pull request.
- Do not add `Co-Authored-By` trailers. Author commits as `Akirakato1 <kato.a@husky.neu.edu>` only.
- Use bundled Node.js v24.19.0 for every gate.
- Search storage version 1 is invalidated, not migrated.
- The canonical Search filter default has all seven groups `disabled: false` with empty `selected` arrays.
- A fresh or reset Search intentionally returns zero results until values are selected or groups are disabled.
- The collapse preference persists across tab changes and reloads; Reset never changes it.
- Reset is rendered only while filters are expanded.
- Search query, result scroll position, and preview state remain transient.
- The visible hero text is exactly `NEXT DAILY HH:MM:SS`, counting down to UTC midnight once per second.
- Do not add server, snapshot, renderer, card-selection, seed, dependency, or deployment-format changes.
- Preserve the existing filter matching rules, Help dialog behavior, preview behavior, and game-round behavior.

---

## File Structure

- Modify `src/client/game/card-filter.ts`: define the new canonical empty/enabled filter default only.
- Modify `src/client/game/search-storage.ts`: define and strictly serialize Search preferences envelope v2.
- Modify `src/client/components/SearchWorkspace.tsx`: own controlled filter/collapse preferences, reset, and persistence.
- Modify `src/client/components/SearchFilterPanel.tsx`: render accessible collapse/reset controls and the collapsible group region.
- Modify `src/client/styles/search.css`: style the three-control header, chevron states, collapsed panel, and mobile containment.
- Create `src/client/components/DailyCountdown.tsx`: pure UTC countdown calculation/formatting and timer lifecycle.
- Modify `src/client/App.tsx`: replace the `Prototype` subtitle with `DailyCountdown`.
- Modify `src/client/styles/global.css`: give the countdown tabular digits and stable hero layout.
- Modify focused tests under `tests/client/`: prove every pure, storage, component, and integration contract.
- Modify `tests/e2e/game.spec.ts`: prove real persistence, reset, responsive controls, and ticking countdown behavior.
- Modify `README.md`: document the new Search defaults/controls and UTC countdown.

---

### Task 1: Canonical Filter Default and Search Preferences v2

**Files:**
- Modify: `src/client/game/card-filter.ts`
- Modify: `src/client/game/search-storage.ts`
- Modify: `tests/client/card-filter.test.ts`
- Modify: `tests/client/search-storage.test.ts`

**Interfaces:**
- Produces: `createDefaultCardFilter(): CardFilterState` returning seven enabled empty groups.
- Produces: `SearchPreferences` with `filter: CardFilterState` and `collapsed: boolean`.
- Produces: `createDefaultSearchPreferences(): SearchPreferences`.
- Produces: `loadSearchPreferences(storage, options): SearchPreferences`.
- Produces: `saveSearchPreferences(storage, preferences): void`.
- Consumes: existing `validCardFilter(filter, options)` strict snapshot-option validation.

- [ ] **Step 1: Update the pure-domain tests for the new default**

Change the first default assertion in `tests/client/card-filter.test.ts` to:

```ts
expect(createDefaultCardFilter()).toEqual({
  cardClass: { disabled: false, selected: [] },
  cardType: { disabled: false, selected: [] },
  mana: { disabled: false, selected: [] },
  rarity: { disabled: false, selected: [] },
  target: { disabled: false, selected: [] },
  powers: { disabled: false, selected: [] },
  keywords: { disabled: false, selected: [] },
});
```

Add a test-local `passThroughFilter()` helper for classification cases that are intended to ignore unspecified groups:

```ts
function passThroughFilter(): CardFilterState {
  return {
    cardClass: { disabled: true, selected: [] },
    cardType: { disabled: true, selected: [] },
    mana: { disabled: true, selected: [] },
    rarity: { disabled: true, selected: [] },
    target: { disabled: true, selected: [] },
    powers: { disabled: true, selected: [] },
    keywords: { disabled: true, selected: [] },
  };
}
```

Replace classification-test setup calls that depended on the old all-disabled default with `passThroughFilter()`. Keep explicit enabled-empty tests on `createDefaultCardFilter()` and assert that the new default classifies every card as `null`.

- [ ] **Step 2: Write Search preferences v2 storage tests before implementation**

Replace the v1 round-trip assertions in `tests/client/search-storage.test.ts` with:

```ts
const preferences = {
  filter: updateCardFilterGroupValue(createDefaultCardFilter(), "mana", 2, true),
  collapsed: true,
};
saveSearchPreferences(storage, preferences);
expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!)).toEqual({
  version: 2,
  filter: preferences.filter,
  collapsed: true,
});
expect(loadSearchPreferences(storage, options)).toEqual(preferences);
```

Add strict regressions for:

```ts
test.each([
  "not-json",
  JSON.stringify({ version: 1, filter: createDefaultCardFilter() }),
  JSON.stringify({ version: 2, filter: createDefaultCardFilter() }),
  JSON.stringify({ version: 2, filter: createDefaultCardFilter(), collapsed: "yes" }),
  JSON.stringify({ version: 2, filter: { ...createDefaultCardFilter(), mana: { disabled: false, selected: [99] } }, collapsed: false }),
])("removes stale or invalid Search preferences", (raw) => {
  const storage = new MemoryStorage();
  storage.setItem(SEARCH_FILTER_STORAGE_KEY, raw);
  expect(loadSearchPreferences(storage, options)).toEqual(createDefaultSearchPreferences());
  expect(storage.getItem(SEARCH_FILTER_STORAGE_KEY)).toBeNull();
});
```

Also pass a runtime object with `query`, `modal`, `card`, `imageBytes`, and extra group fields to `saveSearchPreferences`; assert the stored object has exactly `version`, `filter`, and `collapsed`, and every filter group has exactly `disabled` and `selected`.

- [ ] **Step 3: Run the focused RED tests**

Run:

```powershell
npm exec vitest run tests/client/card-filter.test.ts tests/client/search-storage.test.ts
```

Expected: FAIL because the default still disables groups and Search preferences v2 exports do not exist.

- [ ] **Step 4: Implement the canonical empty/enabled default**

Change `createDefaultCardFilter()` in `src/client/game/card-filter.ts` to construct independent enabled groups:

```ts
export function createDefaultCardFilter(): CardFilterState {
  return {
    cardClass: { disabled: false, selected: [] },
    cardType: { disabled: false, selected: [] },
    mana: { disabled: false, selected: [] },
    rarity: { disabled: false, selected: [] },
    target: { disabled: false, selected: [] },
    powers: { disabled: false, selected: [] },
    keywords: { disabled: false, selected: [] },
  };
}
```

Do not change `formMatches`, `scalarGroupMatches`, `setGroupMatches`, OR/AND semantics, or None behavior.

- [ ] **Step 5: Implement strict Search preferences v2**

In `src/client/game/search-storage.ts`, define:

```ts
export const SEARCH_FILTER_STORAGE_VERSION = 2;

export interface SearchPreferences {
  filter: CardFilterState;
  collapsed: boolean;
}

export function createDefaultSearchPreferences(): SearchPreferences {
  return { filter: createDefaultCardFilter(), collapsed: false };
}
```

Make the Zod envelope strict:

```ts
const envelopeSchema = z.object({
  version: z.literal(SEARCH_FILTER_STORAGE_VERSION),
  filter: filterSchema,
  collapsed: z.boolean(),
}).strict();
```

Replace the old load/save functions with:

```ts
export function loadSearchPreferences(
  storage: Storage | null | undefined,
  options: CardFilterOptions,
): SearchPreferences {
  if (storage == null) return createDefaultSearchPreferences();
  let raw: string | null;
  try { raw = storage.getItem(SEARCH_FILTER_STORAGE_KEY); }
  catch { return createDefaultSearchPreferences(); }
  if (raw === null) return createDefaultSearchPreferences();
  try {
    const parsed = envelopeSchema.parse(JSON.parse(raw));
    const filter = parsed.filter as CardFilterState;
    if (!validCardFilter(filter, options)) throw new Error("Invalid stored Search filter");
    return { filter, collapsed: parsed.collapsed };
  } catch {
    removeSearchFilter(storage);
    return createDefaultSearchPreferences();
  }
}
```

`saveSearchPreferences` must build a fresh canonical object through `persistenceFilter()` and must not spread the caller object.

- [ ] **Step 6: Run focused GREEN tests and typecheck**

Run:

```powershell
npm exec vitest run tests/client/card-filter.test.ts tests/client/search-storage.test.ts
npm run typecheck
git diff --check
```

Expected: focused tests PASS; typecheck may identify Task 2 call sites that still import the old storage API. If so, update only compile-time call-site names in `SearchWorkspace` without adding Task 2 behavior, then rerun until green.

- [ ] **Step 7: Review and commit Task 1**

Review the diff for canonical serialization, strict v1 invalidation, no extra storage fields, and unchanged matching logic. Then:

```powershell
git add -- src/client/game/card-filter.ts src/client/game/search-storage.ts src/client/components/SearchWorkspace.tsx tests/client/card-filter.test.ts tests/client/search-storage.test.ts
git commit -m "feat: reset search filter defaults"
```

---

### Task 2: Persistent Collapse and Expanded-Only Reset Controls

**Files:**
- Modify: `src/client/components/SearchFilterPanel.tsx`
- Modify: `src/client/components/SearchWorkspace.tsx`
- Modify: `src/client/styles/search.css`
- Modify: `tests/client/SearchFilterPanel.test.tsx`
- Modify: `tests/client/SearchWorkspace.test.tsx`

**Interfaces:**
- Consumes: `SearchPreferences`, `loadSearchPreferences`, `saveSearchPreferences`, and `createDefaultCardFilter` from Task 1.
- Adds props: `collapsed: boolean`, `onCollapsedChange(collapsed: boolean): void`, and `onReset(): void` to `SearchFilterPanelProps`.
- Preserves: existing group-disable/value callbacks and Help dialog contract.

- [ ] **Step 1: Write panel RED tests for collapse and reset**

Extend the panel harness with controlled props and callbacks:

```tsx
function renderPanel(filter = state(), collapsed = false) {
  const onGroupDisabledChange = vi.fn();
  const onValueChange = vi.fn();
  const onCollapsedChange = vi.fn();
  const onReset = vi.fn();
  return {
    ...render(<SearchFilterPanel
      state={filter}
      options={OPTIONS}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      onReset={onReset}
      onGroupDisabledChange={onGroupDisabledChange}
      onValueChange={onValueChange}
    />),
    onCollapsedChange,
    onReset,
  };
}
```

Add assertions:

```ts
const expanded = renderPanel(state(), false);
const collapse = screen.getByRole("button", { name: "Collapse filters" });
expect(collapse).toHaveAttribute("aria-expanded", "true");
expect(screen.getByRole("button", { name: "Reset filters" })).toBeVisible();
fireEvent.click(collapse);
expect(expanded.onCollapsedChange).toHaveBeenCalledWith(true);
expanded.unmount();

const collapsed = renderPanel(state(), true);
expect(screen.getByRole("button", { name: "Expand filters" })).toHaveAttribute("aria-expanded", "false");
expect(screen.queryByRole("group", { name: "Class" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Reset filters" })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "Filter help" })).toBeVisible();
```

Click Reset in the expanded render and assert `onReset` once. Assert collapse/reset/help are each button elements with stable accessible names.

- [ ] **Step 2: Write workspace RED tests for persistence and reset boundaries**

In `tests/client/SearchWorkspace.test.tsx`, start from a `MemoryStorage`, render Search, and assert the fresh default has zero preview buttons and the no-match status. Disable enough irrelevant groups and select one valid Class value to produce results, collapse, unmount, and remount.

Assert after remount:

```ts
expect(screen.getByRole("button", { name: "Expand filters" })).toHaveAttribute("aria-expanded", "false");
expect(screen.queryByRole("button", { name: "Reset filters" })).not.toBeInTheDocument();
```

Expand, click Reset, and assert:

```ts
expect(screen.getByRole("status")).toHaveTextContent("No cards match these filters.");
for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!).collapsed).toBe(false);
```

Set a nonempty query before Reset and assert Reset does not change the query. Retain the existing remount assertion that query and list scroll reset while stored preferences survive.

- [ ] **Step 3: Run the component RED tests**

Run:

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchWorkspace.test.tsx
```

Expected: FAIL because the controlled collapse/reset interface and v2 persistence wiring are absent.

- [ ] **Step 4: Implement the controlled panel header**

Add props to `SearchFilterPanelProps` and a stable groups ID from `useId()`. Render the header in this order:

```tsx
<header className="search-filter__header">
  <button
    type="button"
    className="search-filter__collapse"
    aria-label={collapsed ? "Expand filters" : "Collapse filters"}
    aria-expanded={!collapsed}
    aria-controls={groupsId}
    onClick={() => onCollapsedChange(!collapsed)}
  >
    <span aria-hidden="true" className="search-filter__chevron">›</span>
  </button>
  <h2>Filters</h2>
  <div className="search-filter__actions">
    {!collapsed && <button type="button" className="search-filter__reset" aria-label="Reset filters" onClick={onReset}>↺</button>}
    <button ref={triggerRef} type="button" className="search-filter__help-trigger" aria-label="Filter help" onClick={() => setHelpOpen(true)}>?</button>
  </div>
</header>
```

Render `search-filter__groups` only when expanded and assign `id={groupsId}`. Keep Help outside the collapsible region so it remains available.

- [ ] **Step 5: Wire SearchWorkspace preferences atomically**

Replace separate filter loading with:

```ts
const [preferences, setPreferences] = useState(() => loadSearchPreferences(storage, options));
const { filter, collapsed } = preferences;

function update(next: SearchPreferences): void {
  setPreferences(next);
  saveSearchPreferences(storage, next);
}
```

Pass:

```tsx
collapsed={collapsed}
onCollapsedChange={(nextCollapsed) => update({ filter, collapsed: nextCollapsed })}
onReset={() => update({ filter: createDefaultCardFilter(), collapsed })}
```

Filter value/disable callbacks must call `update({ filter: nextFilter, collapsed })`. Do not persist query, preview, or list scroll.

- [ ] **Step 6: Add polished responsive styles**

Change the filter header to a three-column grid:

```css
.search-filter__header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: .55rem;
  margin-bottom: .7rem;
}

.search-filter__actions { display: inline-flex; gap: .45rem; }
.search-filter__collapse,
.search-filter__reset,
.search-filter__help-trigger {
  display: inline-grid;
  min-width: 44px;
  min-height: 44px;
  place-items: center;
}

.search-filter__chevron { transform: rotate(90deg); }
[aria-expanded="false"] .search-filter__chevron { transform: rotate(0); }
.search-filter:has(.search-filter__collapse[aria-expanded="false"]) .search-filter__header { margin-bottom: 0; }
```

Use the existing gold/brown palette, circular Help, and compact rounded-square collapse/reset buttons. Add `transition: transform 120ms ease` to the chevron and disable that transition under `prefers-reduced-motion`. Ensure a 320px-wide viewport contains all controls without shrinking below 44px.

- [ ] **Step 7: Run focused GREEN tests and typecheck**

Run:

```powershell
npm exec vitest run tests/client/card-filter.test.ts tests/client/search-storage.test.ts tests/client/SearchFilterPanel.test.tsx tests/client/SearchWorkspace.test.tsx
npm run typecheck
git diff --check
```

Expected: all focused tests PASS, typecheck PASS, diff check PASS.

- [ ] **Step 8: Review and commit Task 2**

Review keyboard order, Help focus return, collapsed DOM absence, persistence boundaries, Reset behavior, and 44px CSS. Then:

```powershell
git add -- src/client/components/SearchFilterPanel.tsx src/client/components/SearchWorkspace.tsx src/client/styles/search.css tests/client/SearchFilterPanel.test.tsx tests/client/SearchWorkspace.test.tsx
git commit -m "feat: add persistent search filter controls"
```

---

### Task 3: UTC Daily Countdown

**Files:**
- Create: `src/client/components/DailyCountdown.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles/global.css`
- Create: `tests/client/DailyCountdown.test.tsx`
- Modify: `tests/client/app.test.tsx`

**Interfaces:**
- Produces: `secondsUntilNextUtcDay(nowMs: number): number`.
- Produces: `formatCountdown(totalSeconds: number): string`.
- Produces: `DailyCountdown(): React.JSX.Element`.
- Consumes: browser `Date.now`, `setInterval`, and `clearInterval`; no game-hook state.

- [ ] **Step 1: Write pure calculation and fake-timer RED tests**

Create `tests/client/DailyCountdown.test.tsx` with jsdom and fake timers:

```tsx
test("formats a fixed-width UTC countdown", () => {
  expect(formatCountdown(0)).toBe("00:00:00");
  expect(formatCountdown(3_661)).toBe("01:01:01");
  expect(formatCountdown(86_399)).toBe("23:59:59");
});

test("ticks from the current clock and starts the next UTC cycle at midnight", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-16T23:59:58.250Z"));
  const view = render(<DailyCountdown />);
  expect(view.getByRole("timer")).toHaveTextContent("NEXT DAILY 00:00:02");
  act(() => vi.advanceTimersByTime(1_000));
  expect(view.getByRole("timer")).toHaveTextContent("NEXT DAILY 00:00:01");
  act(() => vi.advanceTimersByTime(1_000));
  expect(view.getByRole("timer")).toHaveTextContent("NEXT DAILY 23:59:59");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
```

Add a delayed-clock regression: jump system time forward without running every missed interval, run one pending tick, and assert the value derives from the new wall clock rather than subtracting one from stale state.

- [ ] **Step 2: Update the App integration test first**

Replace the `Prototype` assertion in `tests/client/app.test.tsx` with:

```ts
expect(screen.getByRole("timer", { name: /time remaining until the next Daily puzzle/i }))
  .toHaveTextContent(/^NEXT DAILY \d{2}:\d{2}:\d{2}$/);
expect(screen.queryByText("Prototype", { selector: ".subtitle" })).not.toBeInTheDocument();
```

Keep the timer present during snapshot loading and load errors because it lives in the hero independently from snapshot readiness.

- [ ] **Step 3: Run the countdown RED tests**

Run:

```powershell
npm exec vitest run tests/client/DailyCountdown.test.tsx tests/client/app.test.tsx
```

Expected: FAIL because `DailyCountdown` does not exist and the hero still says `Prototype`.

- [ ] **Step 4: Implement drift-resistant UTC helpers and component**

Create `src/client/components/DailyCountdown.tsx`:

```tsx
import React, { useEffect, useState } from "react";

const LAST_SECOND_OF_DAY = 86_399;

export function secondsUntilNextUtcDay(nowMs: number): number {
  const now = new Date(nowMs);
  const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.min(LAST_SECOND_OF_DAY, Math.max(0, Math.ceil((nextUtcDay - nowMs) / 1_000)));
}

export function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function DailyCountdown(): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = formatCountdown(secondsUntilNextUtcDay(nowMs));
  return <p className="subtitle daily-countdown" role="timer" aria-label="Time remaining until the next Daily puzzle">
    <span>Next Daily</span> <strong>{remaining}</strong>
  </p>;
}
```

The CSS text-transform supplies the visible uppercase label, or the JSX may use `NEXT DAILY` literally. The final accessible and visible text must match the approved copy.

- [ ] **Step 5: Integrate and style the hero timer**

Import `DailyCountdown` in `src/client/App.tsx` and replace:

```tsx
<p className="subtitle">Prototype</p>
```

with:

```tsx
<DailyCountdown />
```

In `src/client/styles/global.css`, retain the subtitle spacing/color and add:

```css
.daily-countdown {
  text-transform: uppercase;
  letter-spacing: .09em;
}
.daily-countdown strong {
  color: var(--gold);
  font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
```

Do not use `aria-live` or update document title/metadata every second.

- [ ] **Step 6: Run focused GREEN tests and timer cleanup checks**

Run:

```powershell
npm exec vitest run tests/client/DailyCountdown.test.tsx tests/client/app.test.tsx
npm run typecheck
git diff --check
```

Expected: countdown tests PASS, App tests PASS, typecheck PASS, diff check PASS.

- [ ] **Step 7: Review and commit Task 3**

Review UTC arithmetic, exact visible copy, no timer drift state, cleanup, no live-region spam, and hero containment. Then:

```powershell
git add -- src/client/components/DailyCountdown.tsx src/client/App.tsx src/client/styles/global.css tests/client/DailyCountdown.test.tsx tests/client/app.test.tsx
git commit -m "feat: show next Daily countdown"
```

---

### Task 4: Browser Acceptance, Documentation, and Release Verification

**Files:**
- Modify: `tests/e2e/game.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the Task 1 v2 storage key/envelope and Task 2 accessible button names.
- Consumes: the Task 3 `NEXT DAILY HH:MM:SS` hero contract.
- Produces: end-to-end evidence only; no new production interface.

- [ ] **Step 1: Add a fresh-storage Search browser acceptance flow**

Extend the existing Search E2E flow to clear only `SEARCH_FILTER_STORAGE_KEY`, reload, and assert:

```ts
await expect(page.getByRole("button", { name: /^Preview / })).toHaveCount(0);
await expect(page.getByRole("status")).toHaveText("No cards match these filters.");
for (const groupName of ["Class", "Type", "Mana", "Rarity", "Target", "Powers", "Keywords"]) {
  const group = page.getByRole("group", { name: groupName });
  await expect(group.getByRole("checkbox", { name: "Disable" })).not.toBeChecked();
}
```

Select or disable every required group so at least one deterministic fixture card appears. Preserve the existing OR/AND/None/form-badge checks after adapting their setup to the new empty default.

- [ ] **Step 2: Add real collapse/reset/reload acceptance**

In the same flow:

```ts
await page.getByRole("button", { name: "Collapse filters" }).click();
await expect(page.getByRole("button", { name: "Expand filters" })).toHaveAttribute("aria-expanded", "false");
await expect(page.getByRole("button", { name: "Reset filters" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "Filter help" })).toBeVisible();
await page.reload();
await page.getByRole("button", { name: "Search", exact: true }).click();
await expect(page.getByRole("button", { name: "Expand filters" })).toBeVisible();
```

Expand, set the name query, click Reset, and assert selections clear/results become empty while the query remains unchanged. Reload and assert filters remain reset, the collapsed preference remains expanded, and the query resets.

- [ ] **Step 3: Add timer and responsive acceptance**

Using the suite's fixed browser clock, assert the hero timer text exactly. Advance the browser clock or use the existing time harness to prove a one-second decrement and UTC rollover without waiting in wall-clock time.

At 390×844, 768×1024, and 1440×900, measure:

- collapse, Reset, and Help controls are at least 44×44;
- the filter header and every control remain inside the Search panel and application shell;
- the document has no horizontal overflow;
- the collapsed panel removes the group grid and excess bottom spacing;
- the timer remains within the hero.

- [ ] **Step 4: Capture mandatory browser RED mutations**

Temporarily apply and restore each mutation, running the narrow Playwright test after each:

1. Force `createDefaultCardFilter()` back to `disabled: true`; expect the fresh-storage zero-result/default assertion to fail.
2. Stop saving `collapsed`; expect reload persistence to fail.
3. Render Reset while collapsed; expect its absence assertion to fail.
4. Decrement countdown state instead of deriving from `Date.now`; expect delayed-clock recovery to fail.

After every mutation, restore production and confirm `git diff` contains no mutation residue.

- [ ] **Step 5: Update README behavior documentation**

Document:

- Search initially enables every group with no values selected, so no cards appear until filters are configured;
- Disable accepts any value and Reset restores the empty enabled state;
- collapse/expand state and filters persist locally, while query/scroll/preview do not;
- the hero timer counts down to the shared UTC Daily/Hardcore Daily rollover.

Do not mention the shelved client-renderer benchmark.

- [ ] **Step 6: Run the supported-runtime release gate serially**

Prepend the bundled Node v24.19.0 runtime to `PATH`, then run each command separately:

```powershell
node --version
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
git status --short
```

Expected:

- Node prints `v24.19.0`.
- Every command exits 0.
- Vitest and Playwright report zero failures.
- The tracked status contains only the intended README/E2E changes before commit.

- [ ] **Step 7: Review and commit Task 4**

Review the complete feature diff against the approved design, including storage cardinality, accessibility, responsive containment, timer cleanup, and absence of renderer/server/snapshot changes. Then:

```powershell
git add -- README.md tests/e2e/game.spec.ts
git commit -m "test: verify search controls and Daily timer"
git show --check HEAD
git status --short
```

- [ ] **Step 8: Request final read-only review and fix blocking findings**

Request a whole-feature review from the design commit through Task 4. Treat Critical and Important findings as blockers. For every accepted fix, use a new focused RED test, minimal GREEN implementation, full relevant regression gate, and a separate user-only commit.

- [ ] **Step 9: Push direct master and verify Render**

After final review and fresh gates:

```powershell
git push origin master:main
git rev-parse HEAD
git rev-parse origin/main
git status --short --branch
```

Verify the exact pushed SHA reaches a successful Render deployment. Check `/`, `/health`, `/runtime/manifest.json`, and the Search UI. In the in-app browser verify:

- fresh v2 storage starts with zero results;
- collapse survives a Search tab detour and reload;
- Reset is expanded-only and preserves the query;
- the timer visibly ticks and matches UTC midnight;
- 390px, 768px, and 1440px layouts have no horizontal overflow;
- console warning/error count is zero.

Expected final state: local `master`, `origin/main`, and Render use the same SHA; tracked worktree is clean.

---

## Final Acceptance Checklist

- [ ] Old version 1 Search storage is invalidated once.
- [ ] New default has all Disable and value checkboxes unchecked.
- [ ] Fresh/reset Search shows no cards.
- [ ] Collapse/expand preference survives tabs and reloads.
- [ ] Reset appears only expanded and preserves collapse/query boundaries.
- [ ] Help remains available collapsed.
- [ ] Every icon control is keyboard-accessible and at least 44×44.
- [ ] Hero displays `NEXT DAILY HH:MM:SS` and ticks from the current UTC clock.
- [ ] Timer cleanup, delayed-tab recovery, and midnight rollover are covered.
- [ ] Query, result scroll, and preview remain transient.
- [ ] No server, snapshot, renderer, card selection, or seed behavior changed.
- [ ] Full Node v24.19.0 unit/build/E2E/check gates pass.
- [ ] Final review is clean at Critical/Important severity.
- [ ] Direct `master` push and exact-SHA Render deployment are verified.
