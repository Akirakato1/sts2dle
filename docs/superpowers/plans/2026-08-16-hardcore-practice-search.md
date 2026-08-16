# Hardcore Practice and Search Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore assistance-free Hardcore Practice and replace Practice Filter Mode with a persistent, dedicated Search tab that filters all snapshot cards and opens accessible base/upgraded card previews.

**Architecture:** Keep Search outside `PlayMode` and round persistence. First remove manual filters from Practice while restoring the historical pre-round Hardcore choice, then generalize the pure filter domain for Search-owned storage and UI. Search reads only the validated snapshot, uses candidate sprites for its list, and previews the snapshot's official-or-fallback full-card URLs without a runtime renderer.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, Zod, Playwright, CSS, browser `localStorage`, existing validated snapshot/card sprite contracts.

## Global Constraints

- Work directly on `master`; do not create a branch or pull request.
- Commit as `Akirakato1 <kato.a@husky.neu.edu>` only; never add `Co-Authored-By` trailers.
- Use bundled Node `v24.19.0` by prepending `C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH`.
- Use strict RED -> GREEN TDD for every task and preserve the observed RED evidence in the task report.
- Keep `PlayMode` exactly `"daily" | "hardcore-daily" | "practice"`; Search is shell UI, not a round.
- Do not migrate old Practice filter selections. Advance the Practice ruleset and delete incompatible saved Practice rounds safely.
- Persist only Search filter disabled/selected values. Do not persist query, modal, selected card, scroll position, card data, or images.
- Use snapshot `baseCardUrl` / `upgradedCardUrl`; do not add a runtime renderer, card-data API, or eager preload of every full-card image.
- Preserve Daily, Hardcore Daily, normal Practice, orb, share, hint, snapshot-validation, and offline-origin behavior.
- Every implementation task ends in a user-authored commit and an independent spec/quality review before the next task.
- Keep reports under `.superpowers/sdd/2026-08-16-hardcore-practice-search/`; they must remain ignored and untracked.

---

### Task 1: Restore Hardcore Practice and remove manual filters from rounds

**Files:**
- Modify: `src/client/game/game-reducer.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `src/client/game/use-game.ts`
- Modify: `src/client/components/PracticeControls.tsx`
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `src/client/App.tsx`
- Modify: `tests/client/game-reducer.test.ts`
- Modify: `tests/client/storage.test.ts`
- Modify: `tests/client/use-game.test.tsx`
- Modify: `tests/client/PracticeControls.test.tsx`
- Modify: `tests/client/CardSearch.test.tsx`
- Modify: `tests/client/app.test.tsx`

**Interfaces:**
- Consumes: existing `RoundState.hardcore`, `AssistanceState`, `createDefaultAssistance()`, `resolveHardcoreCardName()` and `CardSearchMode`.
- Produces: `canSetPracticeHardcore(round: RoundState): boolean`; game action `{ type: "set-practice-hardcore"; hardcore: boolean }`; hook controls `practiceHardcoreChoice: boolean` and `setPracticeHardcoreChoice(hardcore: boolean): void`.
- Removes: `RoundState.practiceFilter`, all `set-practice-filter-*` actions, all `UseGameResult.setPracticeFilter*` callbacks, and `CardSearchProps.practiceFilter`.

- [ ] **Step 1: Write reducer RED tests for the Practice difficulty boundary**

Add tests that prove Practice may be constructed in either difficulty, Daily invariants remain strict, and toggling is legal only before any guess or orb:

```ts
test("toggles untouched Practice between assisted and Hardcore", () => {
  const normal = practiceRound({ hardcore: false });
  expect(canSetPracticeHardcore(normal)).toBe(true);

  const hardcore = gameReducer(normal, { type: "set-practice-hardcore", hardcore: true });
  expect(hardcore).toMatchObject({ mode: "practice", hardcore: true, assistance: null });
  expect(canSetPracticeHardcore(hardcore)).toBe(true);

  const restored = gameReducer(hardcore, { type: "set-practice-hardcore", hardcore: false });
  expect(restored.hardcore).toBe(false);
  expect(restored.assistance).toEqual(createDefaultAssistance());
});

test.each(["reveal", "filter", "negation"] as const)("locks after %s Orb use", (orb) => {
  const target = orb === "reveal"
    ? { feature: "mana" as const }
    : { guessIndex: 0, cardId: guessCard.id, feature: orb === "filter" ? "rarity" as const : "mana" as const };
  const played = orb === "reveal"
    ? practiceRound({ hardcore: false })
    : gameReducer(practiceRound({ hardcore: false }), { type: "submit", cardId: guessCard.id, cardsById });
  const used = gameReducer(played, orb === "reveal"
    ? { type: "consume-reveal", target }
    : orb === "filter"
      ? { type: "consume-filter", target }
      : { type: "consume-negation", target });
  expect(canSetPracticeHardcore(used)).toBe(false);
  expect(gameReducer(used, { type: "set-practice-hardcore", hardcore: true })).toBe(used);
});
```

Also assert a first guess locks the choice, candidate-visibility changes alone do not lock it, terminal rounds are locked, and Daily/Hardcore Daily reject inconsistent construction.

- [ ] **Step 2: Run reducer tests and record the intended RED**

Run:

```powershell
npm exec vitest run tests/client/game-reducer.test.ts
```

Expected: FAIL because Practice currently rejects `hardcore: true`, has no `set-practice-hardcore` action, and still carries `practiceFilter`.

- [ ] **Step 3: Implement the minimal reducer contract**

Export:

```ts
export function canSetPracticeHardcore(round: RoundState): boolean {
  if (round.mode !== "practice" || round.status !== "playing" || round.guesses.length !== 0) return false;
  if (round.hardcore) return round.assistance === null;
  return round.assistance !== null
    && round.assistance.reveal === null
    && round.assistance.filter === null
    && round.assistance.negation === null;
}
```

Permit `hardcore` for Practice in `createRoundState()`, keep Daily fixed false and Hardcore Daily fixed true, set every hardcore round's assistance to `null`, remove `practiceFilter`, and add the reducer action that swaps between `null` and `createDefaultAssistance()` only while `canSetPracticeHardcore()` is true.

- [ ] **Step 4: Write storage RED tests for Practice v4 and old-filter deletion**

Set the intended constants/behavior in tests:

```ts
expect(PRACTICE_RULESET_VERSION).toBe("practice-v4");

test("rejects old Practice filter saves without migrating them", () => {
  storage.setItem(CURRENT_ROUND_KEYS.practice, JSON.stringify(oldPracticeV3Envelope));
  expect(loadCurrentRound(storage, practiceV4Identity, cardsById, pairGroupsByKey)).toBeNull();
  expect(storage.getItem(CURRENT_ROUND_KEYS.practice)).toBeNull();
});

test("keeps legacy null filter fields harmless for Daily restoration", () => {
  storage.setItem(CURRENT_ROUND_KEYS.daily, JSON.stringify(dailyEnvelopeWithPracticeFilterNull));
  expect(loadCurrentRound(storage, dailyIdentity, cardsById, pairGroupsByKey)?.mode).toBe("daily");
});
```

Assert new serialized rounds omit `practiceFilter`, Hardcore Practice requires `assistance: null`, normal Practice requires valid assistance, and `hardcore` round state round-trips.

- [ ] **Step 5: Run storage tests and record RED**

Run:

```powershell
npm exec vitest run tests/client/storage.test.ts
```

Expected: FAIL because Practice is still `practice-v3`, serialization writes `practiceFilter`, and restoration validates the old filter object.

- [ ] **Step 6: Implement strict storage removal without invalidating Daily saves**

Advance only `PRACTICE_RULESET_VERSION` to `practice-v4`. Remove filter-object restoration and serialization. Let the strict input schema accept only an optional legacy `practiceFilter: null` so existing Daily/Hardcore Daily envelopes remain parseable, while an old Practice filter object fails closed. Return a `RoundState` with no filter field.

- [ ] **Step 7: Write hook and controls RED tests**

Cover the restored public contract:

```ts
expect(result.current.practiceHardcoreChoice).toBe(false);
act(() => result.current.setPracticeHardcoreChoice(true));
expect(result.current.round).toMatchObject({ mode: "practice", hardcore: true, assistance: null });
await waitFor(() => expect(savedPracticeRound().hardcore).toBe(true));

act(() => result.current.nextPracticeRound());
await waitFor(() => expect(result.current.round.roundId).not.toBe(previousId));
expect(result.current.round.hardcore).toBe(true);
```

Add component tests that the checkbox is named `Hardcore Practice`, locks after a guess/orb/terminal state, and `End game` / `New Practice Round` behavior remains. Remove assertions for Filter Mode.

- [ ] **Step 8: Run hook/control tests and record RED**

Run:

```powershell
npm exec vitest run tests/client/use-game.test.tsx tests/client/PracticeControls.test.tsx
```

Expected: FAIL because the hook has no Hardcore Practice choice and controls still render Filter Mode.

- [ ] **Step 9: Implement hook, controls, and App wiring**

Reintroduce `practiceHardcoreChoice` in hook state. Initialize it from a restored Practice round, transition the current untouched round through `set-practice-hardcore`, and pass the current choice into every forced new Practice round. Expose `setPracticeHardcoreChoice`.

Replace `PracticeControls` filter props with:

```ts
interface PracticeControlsProps {
  round: RoundState;
  selectedHardcore: boolean;
  settingsEditable: boolean;
  disabled: boolean;
  onHardcoreChange(hardcore: boolean): void;
  onForfeit(): void;
  onNextRound(): void;
}
```

In `App.tsx`, remove Practice filter callbacks/panel integration. Use the memory-entry `CardSearchMode` whenever `round.hardcore`, not only for `hardcore-daily`. Pass no assistance, visibility controls, orb tray, or name hint for a hardcore round. Remove `practiceFilter` from `CardSearch` and from candidate filtering.

- [ ] **Step 10: Run the complete Task 1 GREEN gate**

Run independently and require each exit code to be zero:

```powershell
npm exec vitest run tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx tests/client/PracticeControls.test.tsx tests/client/CardSearch.test.tsx tests/client/app.test.tsx
npm run typecheck
git diff --check
```

Expected: all focused tests pass; typecheck and diff check pass.

- [ ] **Step 11: Report, review, and commit Task 1**

Write `.superpowers/sdd/2026-08-16-hardcore-practice-search/task-1-report.md`, obtain independent spec and quality approval, then commit only Task 1 files:

```powershell
git add src/client/game/game-reducer.ts src/client/game/storage.ts src/client/game/use-game.ts src/client/components/PracticeControls.tsx src/client/components/CardSearch.tsx src/client/App.tsx tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx tests/client/PracticeControls.test.tsx tests/client/CardSearch.test.tsx tests/client/app.test.tsx
git commit -m "feat: restore hardcore practice"
```

---

### Task 2: Generalize card filters and add strict Search storage

**Files:**
- Create: `src/client/game/card-filter.ts`
- Create: `src/client/game/search-storage.ts`
- Create: `tests/client/card-filter.test.ts`
- Create: `tests/client/search-storage.test.ts`
- Delete: `src/client/game/practice-filter.ts`
- Delete: `tests/client/practice-filter.test.ts`

**Interfaces:**
- Produces: `CardFilterState`, `CardFilterOptions`, `CardFilterGroupName`, `CardFilterValue`, `CardFormMatch`; `createDefaultCardFilter()`, `collectCardFilterOptions(cards)`, `classifyCardCandidate(card, filter)`, `updateCardFilterGroupDisabled()`, `updateCardFilterGroupValue()`, `validCardFilter(filter, options)`.
- Produces: `SEARCH_FILTER_STORAGE_KEY = "stsdle:search:filters:v1"`, `SEARCH_FILTER_STORAGE_VERSION = 1`, `loadSearchFilter(storage, options)`, and `saveSearchFilter(storage, state)`.
- Consumes: shared card classes/types/mana/rarities/targets/powers/keywords and the approved existing OR/AND/None semantics.

- [ ] **Step 1: Move existing filter tests to generic names and write RED storage tests**

Create `card-filter.test.ts` with the complete former practice-filter behavior, renamed to the new API. Add validation tests for every group and snapshot-derived option.

Create `search-storage.test.ts`:

```ts
test("round-trips only the versioned Search filter", () => {
  const state = updateCardFilterGroupValue(
    updateCardFilterGroupDisabled(createDefaultCardFilter(), "mana", false),
    "mana", 2, true,
  );
  saveSearchFilter(storage, state);
  expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!)).toEqual({
    version: 1,
    filter: state,
  });
  expect(loadSearchFilter(storage, options)).toEqual(state);
});

test.each([
  "not-json",
  JSON.stringify({ version: 2, filter: createDefaultCardFilter() }),
  JSON.stringify({ version: 1, filter: { ...createDefaultCardFilter(), mana: { disabled: false, selected: [99] } } }),
  JSON.stringify({ version: 1, filter: { ...createDefaultCardFilter(), powers: { disabled: false, selected: ["None", "Strength"] } } }),
])(
  "resets invalid Search storage",
  (value) => {
    storage.setItem(SEARCH_FILTER_STORAGE_KEY, value);
    expect(loadSearchFilter(storage, options)).toEqual(createDefaultCardFilter());
    expect(storage.getItem(SEARCH_FILTER_STORAGE_KEY)).toBeNull();
  },
);
```

Assert the envelope contains no query, modal, card data, or image bytes.

- [ ] **Step 2: Run the new suites and record RED**

Run:

```powershell
npm exec vitest run tests/client/card-filter.test.ts tests/client/search-storage.test.ts
```

Expected: FAIL because the generic module and Search storage do not exist.

- [ ] **Step 3: Implement the generic filter domain**

Define:

```ts
export interface CardFilterState {
  cardClass: FilterGroup<CardClass>;
  cardType: FilterGroup<CardType>;
  mana: FilterGroup<ManaValue>;
  rarity: FilterGroup<CardRarity>;
  target: FilterGroup<CardTarget>;
  powers: FilterGroup<PowerFilterValue>;
  keywords: FilterGroup<KeywordFilterValue>;
}

export type CardFormMatch = "both" | "base-only" | "upgrade-only" | null;
```

Carry forward the exact semantics from the approved spec, but omit the former top-level `enabled` flag. Keep `None` last for Mana/Powers/Keywords and mutually exclusive with concrete Powers/Keywords values.

- [ ] **Step 4: Implement strict Search storage**

Use a strict Zod envelope and validate parsed selections against `CardFilterOptions`. `loadSearchFilter()` returns the all-disabled default when storage is unavailable; malformed/obsolete stored data is removed best-effort. `saveSearchFilter()` writes only `{ version, filter }` and catches storage exceptions.

- [ ] **Step 5: Run Task 2 GREEN and repository audits**

Run:

```powershell
npm exec vitest run tests/client/card-filter.test.ts tests/client/search-storage.test.ts
npm run typecheck
rg -n "PracticeFilter|practice-filter|Filter Mode" src/client/game tests/client/card-filter.test.ts tests/client/search-storage.test.ts
git diff --check
```

Expected: both suites pass; typecheck passes; no old filter-domain symbols remain in `src/client/game`; diff check passes.

- [ ] **Step 6: Report, review, and commit Task 2**

```powershell
git add src/client/game/card-filter.ts src/client/game/search-storage.ts tests/client/card-filter.test.ts tests/client/search-storage.test.ts src/client/game/practice-filter.ts tests/client/practice-filter.test.ts
git commit -m "feat: define persistent search filters"
```

---

### Task 3: Build the Search filter panel and always-visible result list

**Files:**
- Create: `src/client/components/SearchFilterPanel.tsx`
- Create: `src/client/components/SearchCardList.tsx`
- Create: `src/client/components/SearchWorkspace.tsx`
- Create: `tests/client/SearchFilterPanel.test.tsx`
- Create: `tests/client/SearchCardList.test.tsx`
- Create: `tests/client/SearchWorkspace.test.tsx`
- Delete: `src/client/components/PracticeFilterPanel.tsx`
- Delete: `tests/client/PracticeFilterPanel.test.tsx`

**Interfaces:**
- `SearchFilterPanelProps`: `state`, `options`, `onGroupDisabledChange`, `onValueChange`.
- `SearchCardResult`: `{ card: CardIdentity; formMatch: Exclude<CardFormMatch, null> }`.
- `SearchCardListProps`: `results`, `spriteMap`, `onPreview(card)`, `onWarmPreview(card)`.
- `SearchWorkspaceProps`: `cards`, `spriteMap`, and `storage?: Storage | null`. Task 4 adds modal selection and preview warming internally without widening the public App boundary.

- [ ] **Step 1: Write panel RED tests by migrating the existing accessibility contract**

Rename visible and accessible labels from Practice to Search while preserving the complete checklist/help behavior:

```ts
expect(screen.getByRole("region", { name: "Search filters" })).toBeVisible();
expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual([
  "Class", "Type", "Mana", "Rarity", "Target", "Powers", "Keywords",
]);
```

Assert first-time help, Close-first focus, Tab/Shift+Tab trap, Escape, true backdrop, focus return, the new `stsdle:search-filter-help-dismissed:v1` key, disabled-group visual state, warnings for enabled empty groups, and 44px controls.

- [ ] **Step 2: Write result-list and workspace RED tests**

Use fixture cards that produce all three form outcomes:

```ts
expect(screen.getAllByRole("button", { name: /Preview/ })).toHaveLength(cards.length);
expect(screen.getByRole("button", { name: "Preview Apparition — Base only" })).toBeVisible();
expect(screen.getByRole("button", { name: "Preview Alchemize — Upgrade only" })).toBeVisible();
expect(screen.getByRole("button", { name: "Preview Afterimage" })).toBeVisible();
```

Assert an empty query shows all matches, typing narrows by normalized card name, an enabled empty group shows zero results, result order is stable by name/id, no guessed-card input exists, candidate sprites render, and pointer/focus invokes `onWarmPreview` while click/Enter invokes `onPreview`.

For workspace persistence, change filters, remount with the same storage, and assert filters restore while query and result scroll reset.

- [ ] **Step 3: Run the three component suites and record RED**

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx
```

Expected: FAIL because all three Search components are missing.

- [ ] **Step 4: Implement `SearchFilterPanel`**

Port the proven dialog/focus behavior from `PracticeFilterPanel`, rename classes and copy to Search, remove any external disabled/game-state prop, and call the generic filter update callbacks. The help copy must describe Disable, empty-enabled groups, scalar OR, set AND, cross-group AND, per-form matching, and `None`.

- [ ] **Step 5: Implement pure result derivation and `SearchCardList`**

Export from `SearchWorkspace.tsx` for direct tests:

```ts
export function deriveSearchResults(
  cards: readonly CardIdentity[],
  filter: CardFilterState,
  query: string,
): SearchCardResult[];
```

Normalize the query with `NFKC`, English lowercase, and trim; match it as a substring of the equivalently normalized card name. Classify each card with `classifyCardCandidate`, remove `null`, then sort by `name.localeCompare(..., "en-US")` and `id`.

Render results as an always-present scrollable list of buttons using `SpriteArt kind="candidate"`. Include accessible Base only/Upgrade only badges but no badge for both.

- [ ] **Step 6: Implement Search workspace state and persistence**

Initialize options from cards and state from `loadSearchFilter(storage, options)`. Persist filter changes with `saveSearchFilter`; keep query and selected result in component memory only. When the active filter excludes all cards, render `No cards match these filters.` as a status.

- [ ] **Step 7: Run Task 3 GREEN**

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx tests/client/card-filter.test.ts tests/client/search-storage.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 8: Report, review, and commit Task 3**

```powershell
git add src/client/components/SearchFilterPanel.tsx src/client/components/SearchCardList.tsx src/client/components/SearchWorkspace.tsx tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx src/client/components/PracticeFilterPanel.tsx tests/client/PracticeFilterPanel.test.tsx
git commit -m "feat: add persistent card search workspace"
```

---

### Task 4: Add snapshot-backed card preview modal

**Files:**
- Create: `src/client/components/CardPreviewModal.tsx`
- Create: `src/client/game/preload-card-preview.ts`
- Create: `tests/client/CardPreviewModal.test.tsx`
- Create: `tests/client/preload-card-preview.test.ts`
- Modify: `src/client/components/SearchWorkspace.tsx`
- Modify: `tests/client/SearchWorkspace.test.tsx`

**Interfaces:**
- `CardPreviewModalProps`: `{ card: CardIdentity; onClose(): void }`.
- `preloadCardPreview(card: CardIdentity, load?: (url: string) => Promise<void>): Promise<void>` loads unique non-null face URLs concurrently and resolves after all settle.
- Search result hover/focus warms URLs; activation sets the selected card and opens the modal immediately.

- [ ] **Step 1: Write preload RED tests**

```ts
test("preloads unique available snapshot faces concurrently", async () => {
  const pending = new Map<string, () => void>();
  const load = vi.fn((url: string) => new Promise<void>((resolve) => pending.set(url, resolve)));
  const promise = preloadCardPreview(upgradedCard, load);
  expect(load.mock.calls.map(([url]) => url)).toEqual([
    upgradedCard.baseCardUrl,
    upgradedCard.upgradedCardUrl,
  ]);
  for (const resolve of pending.values()) resolve();
  await expect(promise).resolves.toBeUndefined();
});
```

Assert cards without upgrades load only base, duplicate URLs are deduplicated, null/empty URLs are skipped, and one face failure does not reject the warmup operation.

- [ ] **Step 2: Write modal RED tests**

Cover:

- accessible dialog name includes the card;
- focus starts on Close;
- Tab/Shift+Tab trap;
- Escape and true-backdrop close;
- inside click stays open;
- background inertness while open;
- upgraded card shows Base and Upgraded side by side;
- no-upgrade card shows only centered Base;
- reserved `400 × 520` face geometry;
- loading state until each image loads;
- per-face error and Retry reload only that face;
- missing URL shows an unavailable status and no external request.

- [ ] **Step 3: Run preview suites and record RED**

```powershell
npm exec vitest run tests/client/preload-card-preview.test.ts tests/client/CardPreviewModal.test.tsx tests/client/SearchWorkspace.test.tsx
```

Expected: FAIL because preload helper and modal do not exist and Search has no selected preview.

- [ ] **Step 4: Implement best-effort preload helper**

The browser default loader creates `new Image()`, sets `decoding = "async"`, resolves on load/decode, rejects on error, and sanitizes failures to the caller by using `Promise.allSettled`. It must use only snapshot URLs and never derive or fetch a card-data endpoint.

- [ ] **Step 5: Implement modal lifecycle and face state**

Use the proven How to Play modal pattern for focus capture/trap/return and backdrop handling. Keep `{ status: "loading" | "ready" | "error"; attempt: number }` per face. Increment only the failed face's attempt on Retry and key its `<img>` by face/attempt.

- [ ] **Step 6: Integrate preview with Search**

Call `void preloadCardPreview(card)` on result pointer enter and focus. On activation, store the opening result element, set the selected card, and render `CardPreviewModal`. Clear selection on close and return focus through the modal's captured opener.

- [ ] **Step 7: Run Task 4 GREEN**

```powershell
npm exec vitest run tests/client/preload-card-preview.test.ts tests/client/CardPreviewModal.test.tsx tests/client/SearchWorkspace.test.tsx tests/client/SearchCardList.test.tsx
npm run typecheck
git diff --check
```

- [ ] **Step 8: Report, review, and commit Task 4**

```powershell
git add src/client/components/CardPreviewModal.tsx src/client/game/preload-card-preview.ts src/client/components/SearchWorkspace.tsx tests/client/CardPreviewModal.test.tsx tests/client/preload-card-preview.test.ts tests/client/SearchWorkspace.test.tsx
git commit -m "feat: preview filtered cards"
```

---

### Task 5: Integrate the fourth tab and responsive presentation

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles/search.css`
- Modify: `src/client/styles/shell.css`
- Modify: `tests/client/app.test.tsx`
- Modify: `tests/client/PracticeControls.test.tsx`
- Modify: `tests/client/SearchWorkspace.test.tsx`

**Interfaces:**
- Defines shell-only `type ShellTab = PlayMode | "search"`.
- `GameShell` owns `activeTab`; `useGame.activeMode` remains a `PlayMode`.
- Search receives `snapshot.cards`, `snapshot.spriteMap`, and browser storage only.

- [ ] **Step 1: Write App RED integration tests**

Assert exact tab order and round preservation:

```ts
expect(screen.getAllByRole("button", { name: /^(Daily|Hardcore Daily|Practice|Search)$/ })
  .map((button) => button.textContent)).toEqual(["Daily", "Hardcore Daily", "Practice", "Search"]);

fireEvent.click(screen.getByRole("button", { name: "Search" }));
expect(screen.getByRole("region", { name: "Card search workspace" })).toBeVisible();
expect(game.setMode).not.toHaveBeenCalledWith("search");

fireEvent.click(screen.getByRole("button", { name: "Practice" }));
expect(game.setMode).toHaveBeenCalledWith("practice");
expect(screen.getByText("Dazed")).toBeVisible();
```

Build this App fixture with an existing Practice guess whose visible card name is `Dazed`, so the final assertion proves the round survived the Search detour.

Assert Search shows no guess grid, answer, share, or orb controls; game tabs show no Search filters; Practice shows Hardcore Practice and never Filter Mode; Hardcore Practice DOM has no candidate list, category controls, orb tray, or name hint.

- [ ] **Step 2: Run App tests and record RED**

```powershell
npm exec vitest run tests/client/app.test.tsx tests/client/PracticeControls.test.tsx tests/client/SearchWorkspace.test.tsx
```

Expected: FAIL because navigation has three game tabs and Search is not mounted.

- [ ] **Step 3: Implement shell-only tab switching**

Add `activeTab` state initialized to `"daily"`. Search activation updates only this state. A game-tab activation updates `activeTab` and calls `game.setMode(mode)`. Render Search without passing a fake round. Render existing mode loading/errors only for the active game tab.

- [ ] **Step 4: Implement responsive Search and preview CSS**

Add themed classes for the workspace, filter groups, result list, form badges, modal, image loading/error states, and mobile stacking. Requirements:

- every standalone control is at least 44px;
- results own vertical overflow;
- no document horizontal overflow at 390, 768, or 1440px;
- side-by-side cards fit or become a vertical stack inside the modal on narrow screens;
- modal content scrolls internally and remains inside the viewport;
- loading/error containers reserve the same aspect ratio as the ready image;
- focus outlines remain visible;
- reduced motion removes modal motion without hiding loading/error feedback.

- [ ] **Step 5: Run Task 5 GREEN**

```powershell
npm exec vitest run tests/client/app.test.tsx tests/client/PracticeControls.test.tsx tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx tests/client/CardPreviewModal.test.tsx
npm run typecheck
git diff --check
```

- [ ] **Step 6: Report, review, and commit Task 5**

```powershell
git add src/client/App.tsx src/client/styles/search.css src/client/styles/shell.css tests/client/app.test.tsx tests/client/PracticeControls.test.tsx tests/client/SearchWorkspace.test.tsx
git commit -m "feat: integrate search tab"
```

---

### Task 6: Update help, README, fixtures, and browser acceptance

**Files:**
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `tests/client/GameGuide.test.tsx`
- Modify: `README.md`
- Modify: `tests/e2e/game.spec.ts`
- Modify if required by deterministic identities: `tests/e2e/fixtures/cards.ts`

**Interfaces:**
- Documents Search as a utility tab and Hardcore Practice as optional, pre-play, assistance-free Practice.
- Exercises only fixture/local snapshot endpoints in ordinary E2E; official-origin probes remain explicit and aborted.

- [ ] **Step 1: Write help-copy RED tests**

Replace `Practice Filter Mode` with a `Search` section. Assert exact concise semantics:

```ts
const searchSection = within(screen.getByRole("dialog", { name: "How to play" }))
  .getByRole("heading", { name: "Search" })
  .closest("section")!;
expect([...searchSection.querySelectorAll("li")].map((item) => item.textContent?.replace(/\s+/g, " ").trim())).toEqual([
  "Search filters all snapshot cards and is not a game round.",
  "Disable accepts any value; an enabled empty group matches no cards.",
  "Scalar choices use OR, Powers and Keywords use AND, and groups combine with AND.",
  "Base and upgraded forms are checked separately; None matches an empty set.",
  "Open a result to compare its Base and Upgraded cards.",
]);
```

Assert Modes explains Hardcore Practice lock after the first guess or orb and assistance-free memory entry. Assert no `Practice Filter Mode` text remains.

- [ ] **Step 2: Run help tests and record RED**

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx
```

- [ ] **Step 3: Update help and README**

README must describe the four tabs, Search filter persistence/query reset, snapshot-backed preview URLs, no runtime renderer, Hardcore Practice locking/persistence, and the unchanged release-time fallback renderer.

- [ ] **Step 4: Add deterministic browser acceptance before production mutations**

Extend `game.spec.ts` with flows that prove:

1. Practice can toggle Hardcore before play, candidate/orb/category/hint DOM disappears, normalized exact-name entry works, reload preserves the choice, and the next Practice round inherits it.
2. A normal Practice first guess locks the checkbox; a fresh normal Practice orb use also locks it.
3. Normal Practice retains candidates/orbs and contains no manual filter UI.
4. Search opens without changing the stored/current game round.
5. Empty Search shows every fixture card; filters reproduce scalar OR, Powers/Keywords AND, cross-group AND, None, Base only, Upgrade only, and neither-form omission.
6. Search filters survive reload while query and modal reset.
7. Pointer and keyboard activation open previews; upgrade/no-upgrade layouts, close paths, focus return, and retry behavior work.
8. Preview network requests equal the selected card's snapshot URLs and no card-data API/runtime-renderer request occurs.
9. 390×844, 768×1024, and 1440×900 contain filters/results/modal without page overflow and maintain 44px targets.
10. Daily, Hardcore Daily, and normal Practice baseline flows remain green; console warning/error count is zero.

- [ ] **Step 5: Capture meaningful browser REDs**

Run the focused new Search/Practice tests against the pre-change or deliberately mutated implementation. Preserve at least these RED proofs in the report:

- exposing candidates in Hardcore Practice;
- letting an orb-used round change difficulty;
- treating Search as a game mode/replacing the current round;
- accepting an invalid/unknown stored filter;
- failing to distinguish Base only from Upgrade only;
- opening a flipping stack instead of side-by-side faces;
- requesting an origin or endpoint not present in the snapshot URLs.

Restore every mutation and verify no production mutation remains in `git diff`.

- [ ] **Step 6: Run focused and complete browser GREEN**

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx tests/client/app.test.tsx tests/client/use-game.test.tsx tests/client/storage.test.ts tests/client/SearchWorkspace.test.tsx tests/client/CardPreviewModal.test.tsx
npm run typecheck
npm run build
npm run test:e2e
git diff --check
```

Expected: every command exits zero; official-origin guards report no ordinary app attempts.

- [ ] **Step 7: Report, review, and commit Task 6**

```powershell
git add src/client/components/GameGuide.tsx tests/client/GameGuide.test.tsx README.md tests/e2e/game.spec.ts tests/e2e/fixtures/cards.ts
git commit -m "test: verify hardcore practice search"
```

If `tests/e2e/fixtures/cards.ts` is unchanged, omit it from `git add`.

---

### Task 7: Final review, full gate, push, and live verification

**Files:**
- Create ignored: `.superpowers/sdd/2026-08-16-hardcore-practice-search/final-report.md`
- Update ignored: `.superpowers/sdd/2026-08-16-hardcore-practice-search/ledger.md`

**Interfaces:**
- Consumes the complete approved design-to-implementation range.
- Produces a synchronized direct `master` / remote `main` and exact-SHA verified Render deployment.

- [ ] **Step 1: Run the exact supported-runtime gate serially**

Run each command separately and stop immediately on any nonzero exit:

```powershell
$env:PATH='C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
node --version
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
git status --short
```

Expected: Node `v24.19.0`; every gate exits zero; tracked status is empty.

- [ ] **Step 2: Request independent whole-feature review**

Review exact spec/plan/diff for:

- Search/PlayMode isolation and preservation of all game rounds;
- strict filter storage and no Practice migration;
- Hardcore Practice locking, persistence, secrecy, and assistance invariants;
- filter OR/AND/None/per-form correctness;
- full-card URL trust boundary, preload scope, error/retry, and no runtime renderer;
- modal focus/inertness and responsive containment;
- no regression to Daily, Hardcore Daily, normal Practice, or offline guards;
- test/mutation quality, authorship, scope, and ignored reports.

Fix every Critical or Important issue through a separate RED -> GREEN commit and scoped re-review. Minor optional hardening does not block only when the reviewer explicitly marks it non-blocking.

- [ ] **Step 3: Audit repository identity and scope**

```powershell
git remote get-url origin
git log origin/main..HEAD --format='%H%x09%an <%ae>%x09%cn <%ce>%x09%B'
git log origin/main..HEAD --format='%B' | Select-String 'Co-Authored-By'
git ls-files '.superpowers/**'
git diff origin/main...HEAD --check
```

Expected: exact SSH origin `git@github.com:Akirakato1/sts2dle.git`; only the user is author/committer; zero co-author trailers; zero tracked reports; diff check exits zero.

- [ ] **Step 4: Push direct master**

```powershell
git push origin master:main
```

Record the exact pushed SHA and range. Do not create a branch or pull request.

- [ ] **Step 5: Verify exact-SHA deployment and live app**

Wait for the GitHub/Render deployment tied to the exact pushed SHA to report success. Verify HTTP 200 and consistent schema/revision/counts for `/health`, manifest, cards, groups, sprite map, candidate atlas, and guess atlas.

Use the connected in-app browser—never production Playwright as a substitute—to hard reload the public site and smoke:

- Hardcore Practice suppression, lock, normalized entry, refresh, and new-round inheritance;
- Search persistence/query reset, always-visible list, form badges, preview side-by-side/single layout, close/focus paths, and snapshot URL requests;
- 390, 768, and 1440 responsive containment;
- separate Search help and updated mode copy;
- zero console warnings/errors.

- [ ] **Step 6: Final report and synchronization proof**

Record commits, RED/GREEN evidence, exact gate counts, review verdict, push/deployment SHA, endpoint/browser evidence, and any environment limitation. End with:

```powershell
git rev-parse HEAD
git rev-parse origin/main
git status --short --branch
```

Expected: local `master` and `origin/main` are the same exact SHA with zero divergence and no tracked changes.
