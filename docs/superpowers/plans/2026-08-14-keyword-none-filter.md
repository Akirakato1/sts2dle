# Keyword `None` Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mutually exclusive `None` choice, displayed last, to the Practice Manual Filter Keywords group.

**Architecture:** Extend the existing serializable keyword-filter domain with one `none` sentinel while keeping the six real feature keys separate for vector access. The pure update and match helpers enforce exclusivity and per-form keyword-free matching; storage accepts only canonical states. Existing panel, help, README, and offline browser acceptance expose and verify the behavior without changing localStorage keys or versions.

**Tech Stack:** TypeScript, React 19, Zod, Vitest/Testing Library, Playwright, CSS, localStorage.

## Global Constraints

- `None` is displayed last in Keywords.
- `None` matches a form only when Eternal, Ethereal, Exhaust, Innate, Retain, and Sly are all false.
- Selecting `None` clears every real keyword; selecting a real keyword clears `None`.
- Disabled Keywords still accepts anything; enabled Keywords with zero selections still matches nothing.
- Base and upgraded forms remain independently evaluated.
- Existing Practice saves remain valid; do not change storage keys, `CURRENT_ROUND_VERSION`, or `PRACTICE_RULESET_VERSION` (`practice-v2`).
- No synthetic preview card, database, live Spire Codex browser request, answer-ID disclosure, branch, PR, or `Co-Authored-By` trailer.
- Use bundled Node 24 and strict RED→GREEN TDD.

---

### Task 1: Extend the Pure Domain and Storage Contract

**Files:**
- Modify: `src/client/game/practice-filter.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `tests/client/practice-filter.test.ts`
- Modify: `tests/client/storage.test.ts`

**Interfaces:**
- Produces `KEYWORD_FILTER_NONE = "none"`.
- Produces `KeywordFilterValue = KeywordFilterFeature | typeof KEYWORD_FILTER_NONE`.
- Changes `PracticeFilterState.keywords` and `PracticeFilterOptions.keywords` to `FilterGroup<KeywordFilterValue>` and `KeywordFilterValue[]`.
- Keeps `KEYWORD_FILTER_FEATURES` limited to actual `FeatureVector` boolean keys.

- [ ] **Step 1: Write domain RED tests**

Add focused tests requiring:

```ts
expect(collectPracticeFilterOptions(cards).keywords).toEqual([
  "eternal",
  "retain",
  "none",
]);

const none = updatePracticeFilterGroupValue(filterWithRetain, "keywords", "none", true);
expect(none.keywords.selected).toEqual(["none"]);

const retain = updatePracticeFilterGroupValue(none, "keywords", "retain", true);
expect(retain.keywords.selected).toEqual(["retain"]);
```

Add form-classification cases where a card with no keyword flags in both forms returns `both`, and a card that gains Innate on upgrade returns `base-only` for selected `none`.

- [ ] **Step 2: Run the domain RED test**

```powershell
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vitest\vitest.mjs run tests/client/practice-filter.test.ts
```

Expected: FAIL because `none` is neither an option nor a valid keyword value, updates do not enforce exclusivity, and matching indexes only feature keys.

- [ ] **Step 3: Implement the minimal pure-domain change**

Add exact domain values:

```ts
export const KEYWORD_FILTER_NONE = "none" as const;
export type KeywordFilterValue = KeywordFilterFeature | typeof KEYWORD_FILTER_NONE;
```

Always append `KEYWORD_FILTER_NONE` after the snapshot-present real keywords. In `updatePracticeFilterGroupValue`, selecting `none` yields `["none"]`; selecting a real keyword first removes `none`, then adds the requested keyword. Deselecting remains ordinary immutable removal.

Match `none` with:

```ts
const hasNoKeywords = KEYWORD_FILTER_FEATURES.every((keyword) => !vector[keyword]);
```

Require exactly one selected sentinel when `none` is present; otherwise retain the current AND rule for real keywords.

- [ ] **Step 4: Write storage RED tests**

Add a Practice round-trip with `keywords.selected: ["none"]`. Add rejection cases for `keywords.selected: ["none", "retain"]`, duplicate `none`, and an unknown keyword value. Keep the literal legacy Daily envelope test unchanged and green.

- [ ] **Step 5: Run storage RED**

```powershell
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vitest\vitest.mjs run tests/client/storage.test.ts
```

Expected: FAIL because the Zod keyword enum and canonical filter validator reject or mishandle `none`.

- [ ] **Step 6: Implement strict storage compatibility**

Extend only the keyword selection schema to include `none`. Update `validPracticeFilter` so a selection containing `none` is valid only when its length is exactly one, in addition to existing canonical-value and duplicate checks. Do not bump or rename any storage constant.

- [ ] **Step 7: Verify and commit Task 1**

```powershell
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vitest\vitest.mjs run tests/client/practice-filter.test.ts tests/client/storage.test.ts tests/client/game-reducer.test.ts tests/client/use-game.test.tsx
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\typescript\bin\tsc -p tsconfig.base.json --noEmit
git diff --check
git add -- src/client/game/practice-filter.ts src/client/game/storage.ts tests/client/practice-filter.test.ts tests/client/storage.test.ts
git commit -m "feat: add keyword none filter"
```

Expected: focused tests and typecheck pass; commit contains no UI/docs files.

---

### Task 2: Expose `None` in the Panel and Help

**Files:**
- Modify: `src/client/components/PracticeFilterPanel.tsx`
- Modify: `tests/client/PracticeFilterPanel.test.tsx`
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `tests/client/GameGuide.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes Task 1 `KeywordFilterValue` and `KEYWORD_FILTER_NONE`.
- Keeps the existing `PracticeFilterPanelProps` callbacks unchanged.

- [ ] **Step 1: Write panel/help RED tests**

Require the Keywords group option labels to end with `None`, and verify a click emits:

```ts
expect(onValueChange).toHaveBeenCalledWith("keywords", "none", true);
```

Require Filter Help and How to Play to state that `None` means no keywords and is exclusive with keyword choices.

- [ ] **Step 2: Run UI RED**

```powershell
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vitest\vitest.mjs run tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx
```

Expected: FAIL because `FEATURE_LABELS.none` does not exist and the explanatory copy is absent.

- [ ] **Step 3: Implement formatting and concise help copy**

In `formatValue`, return `None` for the sentinel before indexing `FEATURE_LABELS`. Keep the existing rendered option order from Task 1. Add one concise list item to Filter Help and one concise Manual Filter sentence to GameGuide. Update README's Practice paragraph without adding schema details.

- [ ] **Step 4: Verify and commit Task 2**

```powershell
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\vitest\vitest.mjs run tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx tests/client/app.test.tsx
& 'C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules\typescript\bin\tsc -p tsconfig.base.json --noEmit
git diff --check
git add -- src/client/components/PracticeFilterPanel.tsx src/client/components/GameGuide.tsx tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx README.md
git commit -m "docs: explain keyword none filter"
```

Expected: focused UI tests/typecheck pass; existing panel accessibility and layout are unchanged.

---

### Task 3: Browser Acceptance, Release, and Deployment

**Files:**
- Modify: `tests/e2e/game.spec.ts`

**Interfaces:**
- Consumes the complete Task 1–2 behavior.
- Produces deterministic offline acceptance and final release evidence.

- [ ] **Step 1: Write the browser RED flow**

Extend the existing Practice Manual Filter test to:

1. confirm `None` is the final Keywords choice;
2. select a real keyword, then `None`, and prove the keyword clears;
3. select a real keyword again and prove `None` clears;
4. select `None` and require Afterimage to show `Base only` because it gains Innate on upgrade;
5. require a keyword-free card in both forms to appear without a form badge;
6. reload and prove `None` persists;
7. start a new Practice round and prove `None` resets with all ordinary selections;
8. retain the official-origin zero-request assertions and responsive 44-pixel checks.

- [ ] **Step 2: Run targeted browser RED**

Use the existing offline fixture on an owned free port and fresh Local Temp data root if the stock Playwright server is unavailable.

```powershell
npm run test:e2e -- --grep "Practice manual filters"
```

Expected: FAIL because `None` is absent from Keywords.

- [ ] **Step 3: Make only the test/harness corrections required for GREEN**

Use existing fixture cards; do not add fixture cards or production behavior. Ensure locators are scoped to the Keywords group and candidate options so guess rows cannot satisfy assertions.

- [ ] **Step 4: Run final supported-runtime gates serially**

```powershell
npm run check
npm run test:e2e
git diff --check
git status --short
```

Expected: all unit tests, typecheck, production builds, and all 12 offline browser tests pass; official normal-app requests remain zero.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- tests/e2e/game.spec.ts
git diff --cached --check
git commit -m "test: verify keyword none filtering"
```

- [ ] **Step 6: Controller review, push, and live smoke**

The controller must review the full spec-to-HEAD diff, rerun fresh `npm run check` and `npm run test:e2e` under bundled Node 24, verify a clean tree and no `Co-Authored-By` trailers, then push direct `master` to `origin/main` over SSH. Wait for Render to mark the exact commit Live and smoke-test `None` ordering, exclusivity, filtering/badge behavior, persistence, reset, and console cleanliness at `https://sts2dle.onrender.com`.
