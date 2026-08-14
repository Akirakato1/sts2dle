# Practice Manual Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Hardcore Practice and add a persisted, Practice-only Manual Filter Mode that filters candidate cards by independently matching their complete base or upgraded feature vectors.

**Architecture:** Keep manual filters separate from orb `AssistanceState`. A pure `practice-filter.ts` module owns serializable filter state, snapshot-derived options, and base/upgraded classification; the Practice reducer/hook/storage own durability; a dedicated panel owns checklist/help UI; and `CardSearch` selects either manual-filter presentation or the existing orb presentation. Practice save compatibility is isolated with a Practice ruleset bump while Daily and Hardcore Daily envelopes remain loadable.

**Tech Stack:** React 19, TypeScript, Zod 4, Testing Library, Vitest 3, Playwright, Vite 7, browser localStorage.

## Global Constraints

- Manual Filter Mode exists only in Practice.
- Practice rounds are always non-Hardcore; Daily and Hardcore Daily behavior must not change.
- Manual filtering changes candidate presentation only; answer selection, accepted equivalents, comparisons, and wins remain unchanged.
- Class, Type, Mana, and Rarity selections use OR within their group.
- Keyword selections use AND within Keywords.
- Enabled groups use AND with one another.
- Base and upgraded forms are evaluated independently; cross-form mixtures do not pass.
- An enabled group with no selections matches no candidates.
- A disabled group accepts any value and preserves its prior selections.
- Manual Filter Mode suppresses all orb-derived colors and category visibility while preserving the underlying orb state.
- The synthetic preview card is out of scope.
- Existing saved Practice is reset once; Daily and Hardcore Daily progress and statistics are preserved.
- Controls must remain accessible and contained at 390, 768, and 1440 pixel viewports.
- Use the bundled supported Node runtime (Node `>=22.12`; final gates use the bundled Node 24 runtime).
- Do not add `Co-Authored-By` trailers.
- Commit each task directly on `master`; do not create a branch or pull request.
- Do not push during individual tasks. The controller performs the pre-execution and final pushes to `origin/main`.

---

## File Structure

**Create**

- `src/client/game/practice-filter.ts` — serializable state, option derivation, deterministic ordering, per-form matching, and candidate form classification.
- `src/client/components/PracticeFilterPanel.tsx` — responsive checklist panel, enabled-empty warnings, first-use help dialog, focus management, and dismissal preference.
- `tests/client/practice-filter.test.ts` — pure filter option and matching contract.
- `tests/client/PracticeFilterPanel.test.tsx` — checklist, help, accessibility, and action contract.

**Modify**

- `src/client/game/game-reducer.ts` — add round-owned Practice filter state/actions; remove Practice Hardcore action/editability.
- `src/client/game/storage.ts` — persist/strictly validate filters, bump only the Practice ruleset, and preserve older Daily envelopes.
- `src/client/game/use-game.ts` — remove pending Hardcore choice and expose Practice filter actions.
- `src/client/components/PracticeControls.tsx` — replace Hardcore toggle with Filter Mode toggle.
- `src/client/components/CardSearch.tsx` — manual candidate inclusion, form badges, and suppression of orb categories.
- `src/client/App.tsx` — wire the filter panel/state/actions and disabled orb/category presentation.
- `src/client/components/GameGuide.tsx` — remove Hardcore Practice copy and add concise Manual Filter guidance.
- `src/client/styles/search.css` — panel, group, warning, disabled, help, and form-badge styling.
- `src/client/styles/shell.css` — Practice Filter Mode toggle styling and removal of Hardcore-toggle rules.
- Existing client unit tests and `tests/e2e/game.spec.ts` — update contracts and add end-to-end coverage.

---

### Task 1: Pure Practice Filter Domain

**Files:**
- Create: `src/client/game/practice-filter.ts`
- Create: `tests/client/practice-filter.test.ts`

**Interfaces:**
- Consumes: `CardIdentity`, `CardClass`, `CardType`, `CardRarity`, `ManaValue`, and `FeatureVector` from `src/shared/domain.ts`.
- Produces:
  - `CORE_FILTER_GROUPS`
  - `KEYWORD_FILTER_FEATURES`
  - `PracticeFilterGroupName`
  - `KeywordFilterFeature`
  - `PracticeFilterValue`
  - `FilterGroup<T>`
  - `PracticeFilterState`
  - `PracticeFilterOptions`
  - `CandidateFormMatch`
  - `createDefaultPracticeFilter()`
  - `collectPracticeFilterOptions(cards)`
  - `classifyPracticeCandidate(card, filter)`
  - immutable group update helpers used by the reducer.

- [ ] **Step 1: Write failing default-state and option tests**

Create fixtures whose base/upgraded vectors contain duplicate and changing values. Assert the exact default and deterministic snapshot-derived options:

```ts
expect(createDefaultPracticeFilter()).toEqual({
  enabled: false,
  cardClass: { disabled: true, selected: [] },
  cardType: { disabled: true, selected: [] },
  mana: { disabled: true, selected: [] },
  rarity: { disabled: true, selected: [] },
  keywords: { disabled: true, selected: [] },
});

expect(collectPracticeFilterOptions(cards)).toEqual({
  cardClass: ["Ironclad", "Silent"],
  cardType: ["Attack", "Skill"],
  mana: [0, 2, "X", "None"],
  rarity: ["Basic", "Rare"],
  keywords: ["eternal", "retain"],
});
```

Use a fixture with numeric costs `0` and `2` but no `1`; require the result to remain `[0, 2, ...]` so gaps are not filled.

- [ ] **Step 2: Run the new test and record RED**

Run:

```powershell
npm exec vitest run tests/client/practice-filter.test.ts
```

Expected: FAIL because `practice-filter.ts` does not exist.

- [ ] **Step 3: Define serializable types and deterministic option collection**

Implement these public shapes:

```ts
export const CORE_FILTER_GROUPS = ["cardClass", "cardType", "mana", "rarity"] as const;
export const KEYWORD_FILTER_FEATURES = ["eternal", "ethereal", "exhaust", "innate", "retain", "sly"] as const;

export interface FilterGroup<T> {
  disabled: boolean;
  selected: T[];
}

export interface PracticeFilterState {
  enabled: boolean;
  cardClass: FilterGroup<CardClass>;
  cardType: FilterGroup<CardType>;
  mana: FilterGroup<ManaValue>;
  rarity: FilterGroup<CardRarity>;
  keywords: FilterGroup<KeywordFilterFeature>;
}

export interface PracticeFilterOptions {
  cardClass: CardClass[];
  cardType: CardType[];
  mana: ManaValue[];
  rarity: CardRarity[];
  keywords: KeywordFilterFeature[];
}
```

Collect values from both forms, deduplicate, and sort deterministically. Mana ordering is numeric ascending, then `X`, then `None`. Use the shared domain arrays for stable class/type/rarity ordering, filtered to values actually present.

- [ ] **Step 4: Write failing matching and update-helper tests**

Cover all required truth tables:

```ts
expect(classifyPracticeCandidate(bothCard, filter)).toBe("both");
expect(classifyPracticeCandidate(baseCard, filter)).toBe("base-only");
expect(classifyPracticeCandidate(upgradeCard, filter)).toBe("upgrade-only");
expect(classifyPracticeCandidate(hiddenCard, filter)).toBeNull();
```

Also assert:

- OR inside each core group;
- AND inside Keywords;
- AND across enabled groups;
- a disabled group always passes;
- an enabled empty group always fails;
- filters cannot mix a base-only Mana match with an upgrade-only Keyword match;
- no active groups returns `both`; and
- update helpers are immutable, deduplicate values, and preserve disabled selections.

- [ ] **Step 5: Implement matching and immutable state helpers**

Use exact per-form evaluation:

```ts
function formMatches(vector: FeatureVector, filter: PracticeFilterState): boolean {
  return coreGroupMatches(vector.cardClass, filter.cardClass)
    && coreGroupMatches(vector.cardType, filter.cardType)
    && coreGroupMatches(vector.mana, filter.mana)
    && coreGroupMatches(vector.rarity, filter.rarity)
    && keywordGroupMatches(vector, filter.keywords);
}

export function classifyPracticeCandidate(card: CardIdentity, filter: PracticeFilterState): CandidateFormMatch {
  const base = formMatches(card.base, filter);
  const upgraded = formMatches(card.upgraded, filter);
  if (base && upgraded) return "both";
  if (base) return "base-only";
  if (upgraded) return "upgrade-only";
  return null;
}
```

Do not consult `filter.enabled` inside the truth-table helper; callers choose whether Manual Filter Mode applies. This keeps classification testable and lets all-disabled state naturally return `both`.

- [ ] **Step 6: Verify Task 1 GREEN**

Run:

```powershell
npm exec vitest run tests/client/practice-filter.test.ts tests/client/assistance.test.ts
npm run typecheck
git diff --check
```

Expected: all pass; existing orb assistance remains unchanged.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- src/client/game/practice-filter.ts tests/client/practice-filter.test.ts
git commit -m "feat: define practice filter rules"
```

---

### Task 2: Durable Practice Filter State and Migration

**Files:**
- Modify: `src/client/game/game-reducer.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `src/client/game/use-game.ts`
- Modify: `tests/client/game-reducer.test.ts`
- Modify: `tests/client/storage.test.ts`
- Modify: `tests/client/use-game.test.tsx`

**Interfaces:**
- Consumes: Task 1 `PracticeFilterState`, `PracticeFilterGroupName`, `PracticeFilterValue`, `PracticeFilterOptions`, default/update helpers, and option collection.
- Produces:
  - `RoundState.practiceFilter: PracticeFilterState | null`
  - `UseGameResult.setPracticeFilterEnabled(enabled)`
  - `UseGameResult.setPracticeFilterGroupDisabled(group, disabled)`
  - `UseGameResult.setPracticeFilterValue(group, value, selected)`
  - `PRACTICE_RULESET_VERSION = "practice-v2"`.

- [ ] **Step 1: Write reducer RED tests for Practice-only actions**

Replace the old Practice Hardcore tests with assertions that a new Practice round has standard assistance and default filter state:

```ts
const round = practice();
expect(round.hardcore).toBe(false);
expect(round.assistance).toEqual(createDefaultAssistance());
expect(round.practiceFilter).toEqual(createDefaultPracticeFilter());
```

Add action tests requiring:

- enable/disable Filter Mode;
- group disable toggles preserve selections;
- value selection is immutable and idempotent;
- actions are ignored for Daily, Hardcore Daily, or terminal Practice; and
- `replace-round` and `submit` retain filter state.

- [ ] **Step 2: Run reducer tests and verify RED**

```powershell
npm exec vitest run tests/client/game-reducer.test.ts
```

Expected: FAIL on missing `practiceFilter` and filter actions, plus stale Hardcore Practice assertions.

- [ ] **Step 3: Modify RoundState and reducer actions**

Add:

```ts
practiceFilter: PracticeFilterState | null;
```

Use `null` for both Daily modes and `createDefaultPracticeFilter()` for Practice. Remove `set-practice-hardcore` and `isPracticeSettingsEditable`. Add exact Practice-only playing-state actions:

```ts
| { type: "set-practice-filter-enabled"; enabled: boolean }
| { type: "set-practice-filter-group-disabled"; group: PracticeFilterGroupName; disabled: boolean }
| { type: "set-practice-filter-value"; group: PracticeFilterGroupName; value: PracticeFilterValue; selected: boolean }
```

The reducer must return the same object on invalid or idempotent actions.

- [ ] **Step 4: Write storage migration and strict-validation RED tests**

Update storage tests to require:

- new Practice round-trip includes complete `practiceFilter` state;
- `PRACTICE_RULESET_VERSION` is exactly `practice-v2`;
- legacy `practice-v1` and legacy Hardcore Practice are removed/replaced;
- the pre-update Daily and Hardcore Daily envelope shape still loads;
- unknown group keys, duplicate selections, invalid value types, values absent from snapshot options, missing groups, or non-null Daily filters are rejected;
- removing Practice legacy data never touches Daily, Hardcore Daily, or stats keys; and
- the obsolete `practiceHardcoreChoice` is not emitted in new Practice JSON.

Use a literal old Daily envelope fixture containing `version: 4`, `practiceHardcoreChoice: null`, and no `practiceFilter` to prove compatibility rather than regenerating it through current save code.

- [ ] **Step 5: Run storage tests and verify RED**

```powershell
npm exec vitest run tests/client/storage.test.ts
```

Expected: FAIL because the old schema has no manual filters and still requires a Practice Hardcore choice.

- [ ] **Step 6: Implement strict storage with Practice-only invalidation**

Keep existing Daily envelope compatibility. Bump only `PRACTICE_RULESET_VERSION` to `practice-v2`. Make legacy `practiceHardcoreChoice` optional for parsing older non-Practice envelopes but omit it from new output. Make `practiceFilter` optional/null for old Daily parsing, require it for Practice v2, and normalize non-Practice rounds to `null`.

Validate stored selections against `collectPracticeFilterOptions([...cardsById.values()])`:

```ts
function selectedValuesAreCanonical<T>(selected: readonly T[], allowed: readonly T[]): boolean {
  return new Set(selected).size === selected.length
    && selected.every((value) => allowed.includes(value));
}
```

Do not change the three fixed owned localStorage keys or either Daily stats key.

- [ ] **Step 7: Write hook RED tests and remove Hardcore Practice expectations**

Replace the pending-choice tests with:

- initial/restored Practice is always non-Hardcore;
- Filter Mode and selections persist after reducer transitions and refresh;
- terminal Practice retains filters, but `nextPracticeRound()` resets them;
- forfeit retains the completed round and filters until the new round is requested;
- filter actions do nothing outside active Practice; and
- rapid/stale new-round preparation cannot copy old filters into the replacement.

- [ ] **Step 8: Implement useGame filter actions and simplify Practice creation**

Remove `practiceHardcoreChoice` from `UseGameResult`, `HookState`, hook actions, persistence memoization, `startPractice`, retry, and next-round calls. Every Practice round is created with `hardcore: false`.

Expose stable callbacks through `applyToActive`:

```ts
setPracticeFilterEnabled: (enabled) => applyToActive({ type: "set-practice-filter-enabled", enabled }),
setPracticeFilterGroupDisabled: (group, disabled) => applyToActive({ type: "set-practice-filter-group-disabled", group, disabled }),
setPracticeFilterValue: (group, value, selected) => applyToActive({ type: "set-practice-filter-value", group, value, selected }),
```

Persistence memoization returns to comparing only each `RoundState` identity because no pending next-round choice remains.

- [ ] **Step 9: Verify Task 2 GREEN**

```powershell
npm exec vitest run tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx
npm run typecheck
git diff --check
```

Expected: all pass; Daily/Hardcore lifecycle and rollover tests remain green.

- [ ] **Step 10: Commit Task 2**

```powershell
git add -- src/client/game/game-reducer.ts src/client/game/storage.ts src/client/game/use-game.ts tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx
git commit -m "feat: persist practice manual filters"
```

---

### Task 3: Practice Filter Panel and First-Use Help

**Files:**
- Create: `src/client/components/PracticeFilterPanel.tsx`
- Create: `tests/client/PracticeFilterPanel.test.tsx`
- Modify: `src/client/styles/search.css`

**Interfaces:**
- Consumes: Task 1 `PracticeFilterState`, `PracticeFilterOptions`, `PracticeFilterGroupName`, `PracticeFilterValue`.
- Produces:
  - `FILTER_HELP_DISMISSED_KEY = "stsdle:filter-help-dismissed:v1"`
  - `PracticeFilterPanel` props for group disable/value changes.

- [ ] **Step 1: Write panel checklist RED tests**

Render a panel with representative options and require:

- five groups named Class, Type, Mana, Rarity, Keywords in that order;
- `Disable` is the first checkbox in each group;
- disabled groups retain checked values but disable and mute every value control;
- enabled groups dispatch group-specific value changes;
- core groups permit multiple checked values;
- Keywords permits multiple checked features;
- enabled-empty groups show `Choose at least one.` and disabled groups do not; and
- `disabled={true}` prevents every mutation without hiding state.

Use role queries and accessible group names, not CSS-only selectors, for the behavioral contract.

- [ ] **Step 2: Run panel tests and verify RED**

```powershell
npm exec vitest run tests/client/PracticeFilterPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement responsive checklist groups**

Define exact props:

```ts
export interface PracticeFilterPanelProps {
  state: PracticeFilterState;
  options: PracticeFilterOptions;
  disabled: boolean;
  onGroupDisabledChange(group: PracticeFilterGroupName, disabled: boolean): void;
  onValueChange(group: PracticeFilterGroupName, value: PracticeFilterValue, selected: boolean): void;
}
```

Keep the group `fieldset` operable so its `Disable` checkbox can always be unchecked; disable only the value inputs when `group.disabled || disabled`. Format Mana as `0`, `1`, `X`, or `None`; format keywords with existing feature labels.

- [ ] **Step 4: Write Filter Help RED tests**

Use a fresh localStorage mock and require:

- first mount for an enabled panel auto-opens a dialog named `Filter help`;
- exact OR, AND, Disable, empty-group, and separate-form explanations are visible;
- close button, Escape, and true-backdrop close it;
- closing writes only `FILTER_HELP_DISMISSED_KEY`;
- remount with the key does not auto-open;
- the `?` button always reopens it;
- focus initially moves to Close, Tab and Shift+Tab remain trapped, and close returns focus to `?`; and
- clicking inside the dialog does not close it.

- [ ] **Step 5: Implement best-effort dismissal and accessible modal behavior**

Follow the established `GameGuide` dialog pattern, but keep the code local to this component. Read/write the fixed key inside guarded `try/catch`. Set the key for every close path. Use `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, a top-right `Close filter help` button, and a question-mark trigger with `aria-label="Filter help"`.

- [ ] **Step 6: Add site-matched responsive styling**

Add `.practice-filter` rules in `search.css`:

- light-yellow translucent background and gold border;
- header containing title and top-right `?` control;
- `display: grid` checklist groups with responsive `auto-fit/minmax` tracks;
- inherited Kreon/site fonts;
- minimum 44px interactive targets where a control stands alone;
- existing gold focus-ring language;
- muted labels and reduced opacity for disabled value lists;
- concise warning styling with sufficient contrast; and
- no fixed width that can overflow 390px.

- [ ] **Step 7: Verify Task 3 GREEN**

```powershell
npm exec vitest run tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx
npm run typecheck
git diff --check
```

Expected: all pass; existing help behavior remains unchanged.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- src/client/components/PracticeFilterPanel.tsx src/client/styles/search.css tests/client/PracticeFilterPanel.test.tsx
git commit -m "feat: add practice filter panel"
```

---

### Task 4: Candidate Search Filtering and Form Badges

**Files:**
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `src/client/styles/search.css`
- Modify: `tests/client/CardSearch.test.tsx`

**Interfaces:**
- Consumes: Task 1 `PracticeFilterState`, `CandidateFormMatch`, and `classifyPracticeCandidate`.
- Produces: `CardSearch` support for optional `practiceFilter`, manual form badges, and an `assistanceControlsDisabled` prop that disables only Neutral/Green/Red controls without disabling the guess input.

- [ ] **Step 1: Write search-function RED tests**

Extend `searchCards` inputs with `practiceFilter: PracticeFilterState | null`. Require:

- manual mode omits neither-form matches entirely;
- returns `formMatch: "base-only"`, `"upgrade-only"`, or `"both"` for shown cards;
- all-disabled Manual Filter Mode shows every unguessed card with `both`;
- an enabled-empty group shows no candidates;
- manual mode ignores Neutral/Green/Red visibility flags;
- manual mode returns category `neutral` even when orb constraints would classify red/green;
- turning manual mode off restores exact orb classification and visibility; and
- guessed exclusion, empty-focus behavior, deterministic sorting, and live prefix filtering remain unchanged.

Extend `CardSearchProps` with:

```ts
practiceFilter?: PracticeFilterState | null;
assistanceControlsDisabled?: boolean;
```

Require `assistanceControlsDisabled` to disable and dim only the Candidate visibility fieldset. It must not disable, blur, close, or clear the search input/listbox.

Use this result shape:

```ts
export interface ClassifiedCandidate {
  card: CardIdentity;
  category: CandidateCategory;
  formMatch: CandidateFormMatch | null;
}
```

- [ ] **Step 2: Run CardSearch tests and verify RED**

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx
```

Expected: FAIL on the missing prop/result and absent manual matching.

- [ ] **Step 3: Implement mutually exclusive presentation paths**

When `practiceFilter?.enabled`:

1. classify with `classifyPracticeCandidate`;
2. omit `null` matches;
3. force category to `neutral`; and
4. do not call `isCandidateCategoryVisible`.

Otherwise retain the existing orb classification/visibility path byte-for-byte where practical. Apply typed prefix matching after either presentation path.

- [ ] **Step 4: Write candidate badge and accessibility RED tests**

Require:

- `Base only` and `Upgrade only` visible badges on the correct rows;
- no badge for `both`;
- badge text is part of the option's accessible description;
- no `matches Filter Orb` / `excluded by Negation Orb` text while manual mode is enabled;
- no red/green candidate class while manual mode is enabled; and
- pointer/keyboard selection still chooses the underlying base card ID exactly once.

- [ ] **Step 5: Render right-aligned form badges**

Add a final candidate-row element only for one-form matches:

```tsx
{formMatch === "base-only" && <span className="card-search__form-badge">Base only</span>}
{formMatch === "upgrade-only" && <span className="card-search__form-badge">Upgrade only</span>}
```

Adjust the option grid so the badge remains right-aligned while duplicate-name class text stays readable. Style it as a compact bordered gold/muted-yellow label with readable selected/hover colors.

- [ ] **Step 6: Verify Task 4 GREEN**

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx tests/client/assistance.test.ts
npm run typecheck
git diff --check
```

Expected: all pass, including every existing combobox keyboard/pointer regression.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/client/components/CardSearch.tsx src/client/styles/search.css tests/client/CardSearch.test.tsx
git commit -m "feat: filter practice candidates by form"
```

---

### Task 5: Practice Controls, App Wiring, and Help Copy

**Files:**
- Modify: `src/client/components/PracticeControls.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `src/client/styles/shell.css`
- Modify: `tests/client/PracticeControls.test.tsx`
- Modify: `tests/client/app.test.tsx`
- Modify: `tests/client/GameGuide.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 filter state/options/actions, `PracticeFilterPanel`, and `CardSearch.practiceFilter`.
- Produces: the complete visible Practice experience and removal of every Hardcore Practice UI/copy path.

- [ ] **Step 1: Write PracticeControls RED tests**

Replace Hardcore-toggle tests with:

- playing Practice shows `Filter Mode` and `End game`;
- terminal Practice shows a disabled `Filter Mode` control and `New Practice Round`;
- the toggle reflects `filterEnabled` and dispatches `onFilterEnabledChange`;
- reveal/drag disabling blocks toggle and round-ending actions; and
- no `Hardcore Practice`, lock message, or Hardcore change callback remains.

Define props:

```ts
export interface PracticeControlsProps {
  round: RoundState;
  filterEnabled: boolean;
  disabled: boolean;
  onFilterEnabledChange(enabled: boolean): void;
  onForfeit(): void;
  onNextRound(): void;
}
```

- [ ] **Step 2: Implement simplified PracticeControls and styles**

Render the Filter Mode checkbox label beside the terminal/nonterminal button. Remove `.practice-controls__hardcore` and `.practice-controls__lock-help` rules; replace them with `.practice-controls__filter` using the same minimum target, border, font, focus, and disabled styling.

- [ ] **Step 3: Write App wiring RED tests**

Extend the ready-game mock with the three filter callbacks. Require:

- Filter Mode exists only in Practice;
- enabling it renders `PracticeFilterPanel` between Practice controls and CardSearch;
- panel options are derived from the loaded snapshot;
- visibility checkboxes and orb buttons stay visible but become disabled/dimmed;
- CardSearch receives the active `practiceFilter` and shows manual candidates/badges;
- disabling Filter Mode removes the panel and restores orb colors/visibility;
- a new Practice round gets the default filter state;
- Daily assisted controls do not show Filter Mode or panel; and
- Hardcore Daily remains assistance-free.

- [ ] **Step 4: Wire RoundGame without leaking Practice concepts into Daily**

Compute options once from `snapshot.cards` with `useMemo` in the Practice board path. Pass filter state to CardSearch only for Practice. Render:

```tsx
{round.mode === "practice" && round.practiceFilter?.enabled && (
  <PracticeFilterPanel
    state={round.practiceFilter}
    options={practiceFilterOptions}
    disabled={interactionDisabled}
    onGroupDisabledChange={onPracticeFilterGroupDisabled}
    onValueChange={onPracticeFilterValue}
  />
)}
```

Set candidate-visibility inputs and `OrbTray` disabled when `interactionDisabled || round.practiceFilter?.enabled === true`. Keep the guess input enabled while Manual Filter Mode is on. Do not clear or mutate `round.assistance` when toggling.

Pass `assistanceControlsDisabled={round.practiceFilter?.enabled === true}` separately from CardSearch's existing `disabled={interactionDisabled}` prop; do not reuse the whole-search disabled boundary for Manual Filter Mode.

Remove `practiceHardcoreChoice`, `onPracticeHardcoreChange`, and their fallback handlers from every App interface and call site.

- [ ] **Step 5: Write and implement GameGuide copy changes**

Update the Modes section to retain only:

- Daily;
- Hardcore Daily; and
- Practice repeat/restore/End game behavior.

Remove the lock icon/type and all Hardcore Practice text. Add a concise Manual Filter row under Orbs and filtering explaining that Practice Filter Mode uses OR for ordinary values, AND for keywords/groups, checks base/upgraded separately, and temporarily disables orb/category presentation.

- [ ] **Step 6: Verify Task 5 GREEN**

```powershell
npm exec vitest run tests/client/PracticeControls.test.tsx tests/client/app.test.tsx tests/client/GameGuide.test.tsx tests/client/PracticeFilterPanel.test.tsx tests/client/CardSearch.test.tsx
npm run typecheck
git diff --check
```

Expected: all focused component/integration tests pass.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- src/client/components/PracticeControls.tsx src/client/App.tsx src/client/components/GameGuide.tsx src/client/styles/shell.css tests/client/PracticeControls.test.tsx tests/client/app.test.tsx tests/client/GameGuide.test.tsx
git commit -m "feat: integrate practice filter mode"
```

---

### Task 6: Offline Browser Acceptance and Release Gates

**Files:**
- Modify: `tests/e2e/game.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete integrated feature from Tasks 1–5.
- Produces: deterministic browser coverage and final release evidence.

- [ ] **Step 1: Write the full Practice browser RED flow**

Replace the existing Hardcore Practice E2E portion. In a deterministic Practice round:

1. enable Filter Mode;
2. close first-use Filter Help and verify it does not auto-open after reload;
3. reopen help with `?`, verify exact OR/AND/Disable/empty/separate-form rules, close with Escape, and require focus return;
4. verify Neutral/Green/Red and all available orb buttons are visible, disabled, dimmed, and have no active candidate color effect;
5. enable an empty Class group and require `Choose at least one.` plus zero candidates;
6. select multiple core values and require OR behavior;
7. select multiple Keywords and require AND behavior;
8. combine groups and require AND behavior;
9. require neither-form cards absent, plus exact `Base only` and `Upgrade only` badges;
10. type a name prefix and require live narrowing within the filtered list;
11. reload and require filter enabled/disabled groups/selections to restore;
12. turn Filter Mode off and require prior orb/category behavior to return;
13. forfeit, start a new Practice round, and require default Filter Mode state.

The browser test must never reveal answer IDs or add live Spire Codex requests.

Use the existing fixture cards rather than expanding the fixture: Alchemize supplies Mana `1 → 0`, Afterimage supplies Innate `false → true`, and Apparition supplies Ethereal `true → false`. Their paired copies continue to cover accepted-equivalent behavior.

- [ ] **Step 2: Run the targeted browser test and record RED**

Use the existing offline fixture and an owned free port/data directory when ports 3000 or 5173 are occupied. Run the specific Practice test with the established Playwright configuration.

Expected: FAIL on the old Hardcore Practice UI and missing filter panel.

- [ ] **Step 3: Add responsive geometry assertions**

For 390×844, 768×1024, and 1440×900:

- panel left/right remain inside the app shell;
- every group and warning remains inside the panel;
- no page-level horizontal overflow;
- Filter Help stays inside the viewport and scrolls internally if needed;
- `Base only` / `Upgrade only` badges remain within candidate rows; and
- all standalone controls retain at least 44×44 CSS-pixel hit areas.

- [ ] **Step 4: Run focused unit and browser GREEN gates**

Before the gates, replace README's Normal/Hardcore Practice paragraph with exact user-facing behavior: Practice has unlimited normal assisted rounds, `End game`, and optional persisted Manual Filter Mode; core choices use OR, Keywords use AND, forms are evaluated separately, and new Practice rounds reset filters. Do not add implementation or storage-schema details to README.

```powershell
npm exec vitest run tests/client/practice-filter.test.ts tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx tests/client/PracticeFilterPanel.test.tsx tests/client/PracticeControls.test.tsx tests/client/CardSearch.test.tsx tests/client/app.test.tsx tests/client/GameGuide.test.tsx
npm run typecheck
npm run build
npm run test:e2e
git diff --check
```

Expected: all pass under the bundled Node runtime, with all browser network guards still reporting zero normal-app requests to official Codex origins.

- [ ] **Step 5: Run the complete release gate**

Run serially with no overlapping Vitest/Playwright processes:

```powershell
npm run check
npm run test:e2e
git diff --check
git status --short
```

Expected: complete unit suite, typecheck, production client/server build, and full offline E2E pass; only the intended Task 6 files are uncommitted.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- tests/e2e/game.spec.ts README.md
git diff --cached --check
git commit -m "test: verify practice manual filters"
```

- [ ] **Step 7: Final controller review, push, and deployment verification**

The controller must:

1. inspect every task commit and the complete spec-to-HEAD diff;
2. run a fresh supported-runtime `npm run check` and `npm run test:e2e`;
3. verify no `Co-Authored-By` trailers and a clean worktree;
4. push `HEAD` directly to `origin/main` using the configured SSH remote;
5. wait for Render to deploy the exact final commit; and
6. open the public site and smoke-test Practice Filter Mode, candidate omission/badges, Filter Help, and reset behavior.

Expected: Render reports the final commit Live and the public site serves the complete feature without console errors.
