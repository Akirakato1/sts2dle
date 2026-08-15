# Hardcore Memory Input and Guess-Grid Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hardcore Daily a candidate-free exact-name memory challenge, add invalid-entry feedback, prevent guess-tile text selection, expose horizontal grid overflow, and reorganize help copy.

**Architecture:** Add one pure Hardcore name resolver under `src/client/game`, then let `RoundGameBoard` adapt it to the existing `CardSearch` through an explicit discriminated search mode. Keep guess rendering semantics unchanged; add selection suppression in grid CSS and isolate overflow measurement/controls in a focused `GuessGridOverflowFrame` component. Move help copy without changing filter logic.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, CSS, Playwright, Vite, bundled Node 24.19.0, Git/Render direct-main deployment.

## Global Constraints

- Work directly on `master`; do not create a branch or pull request.
- Never add a `Co-Authored-By` trailer; author and commit as `Akirakato1` only.
- Use bundled Node 24.19.0 by prepending `C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH` before every npm command.
- Use strict RED -> GREEN TDD for every production behavior change and record the intended RED evidence.
- Hardcore shows no candidate/listbox DOM; Daily and Practice candidate behavior must remain byte-for-byte equivalent at the public interface.
- Normalize Hardcore input with NFKC, English lowercase, and removal of every non-Unicode-letter/non-Unicode-number code point; require complete ordered equality.
- Strike and Defend are shared names across classes; an accepted matching identity wins, otherwise use the stable name/id-first representative.
- Invalid feedback lasts approximately 220-260 ms, preserves input/focus, restarts on every invalid Enter, and suppresses shake under reduced motion.
- Guess-tile selection suppression must not block Reveal, Filter, or Negation Orb pointer/keyboard interaction.
- Overflow cues appear only for measured overflow; the text hint disappears after first horizontal movement, while directional cues track remaining content.
- Keep all normal application E2E tests offline from the two official Spire Codex origins.
- Push only after the complete Node 24 gate and independent review are green; verify Render deploys the exact pushed SHA.

---

## File Map

- Create `src/client/game/hardcore-name.ts`: pure normalization and shared-name resolution.
- Create `tests/client/hardcore-name.test.ts`: exhaustive resolver contract.
- Modify `src/client/components/CardSearch.tsx`: discriminated candidate/Hardcore input modes and invalid feedback state.
- Modify `src/client/App.tsx`: resolve Hardcore names against the current round and pass the explicit mode.
- Modify `src/client/styles/search.css`: red fade, buzzer shake, and reduced-motion override.
- Modify `tests/client/CardSearch.test.tsx`: Hardcore DOM, Enter, feedback, and normal-search regressions.
- Modify `tests/client/app.test.tsx`: real RoundGameBoard wiring and shared-name acceptance.
- Modify `src/client/styles/grid.css`: selection suppression plus overflow frame styling.
- Modify `tests/client/GuessGrid.test.tsx`: non-selectable structure/orb-target regression.
- Create `src/client/components/GuessGridOverflowFrame.tsx`: measured overflow state, hint, fades, and scroll buttons.
- Create `tests/client/GuessGridOverflowFrame.test.tsx`: deterministic geometry/scroll behavior.
- Modify `src/client/components/GuessGrid.tsx`: wrap existing table in the overflow frame.
- Modify `src/client/components/GameGuide.tsx`: dedicated Practice Filter Mode section and Hardcore copy.
- Modify `tests/client/GameGuide.test.tsx`: exact section ownership/copy.
- Modify `README.md`: current Hardcore behavior.
- Modify `tests/e2e/game.spec.ts`: end-to-end memory input, invalid feedback, tile selection, and viewport overflow acceptance.
- Create `.superpowers/sdd/2026-08-16-hardcore-memory-input-grid-affordances/progress.md`: ignored execution ledger.
- Create ignored task reports beneath the same SDD directory; never force-add them.

---

### Task 1: Pure Hardcore Name Resolution

**Files:**
- Create: `src/client/game/hardcore-name.ts`
- Create: `tests/client/hardcore-name.test.ts`

**Interfaces:**
- Consumes: `CardIdentity` from `src/shared/domain.ts`.
- Produces:

```ts
export function normalizeHardcoreCardName(value: string): string;

export interface HardcoreNameResolutionInput {
  readonly cards: readonly CardIdentity[];
  readonly guessedCardIds: ReadonlySet<string>;
  readonly acceptedCardIds: ReadonlySet<string>;
  readonly query: string;
}

export function resolveHardcoreCardName(input: HardcoreNameResolutionInput): string | null;
```

- [ ] **Step 1: Write normalization RED tests**

Create table-driven tests that require:

```ts
expect(normalizeHardcoreCardName("  F.T.L.  ")).toBe("ftl");
expect(normalizeHardcoreCardName("Snake-Bite")).toBe("snakebite");
expect(normalizeHardcoreCardName("AFTER IMAGE")).toBe("afterimage");
expect(normalizeHardcoreCardName("Re\u0301sonance")).toBe("r\u00e9sonance");
```

- [ ] **Step 2: Write resolution RED tests**

Use small `CardIdentity` fixtures and assert:

```ts
expect(resolveHardcoreCardName({ ...input, query: "after" })).toBeNull();
expect(resolveHardcoreCardName({ ...input, query: "image after" })).toBeNull();
expect(resolveHardcoreCardName({ ...input, query: "afterimaje" })).toBeNull();
expect(resolveHardcoreCardName({ ...input, query: "after image" })).toBe("AFTERIMAGE");
```

Add five Strike and five Defend identities. Prove an accepted Strike identity wins regardless of stable ordering, a non-answer Strike resolves to the first stable name/id representative, and any earlier Strike guess makes every Strike identity unavailable.

- [ ] **Step 3: Run RED**

Run:

```powershell
$env:PATH='C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
npm exec vitest run tests/client/hardcore-name.test.ts
```

Expected: FAIL because `hardcore-name.ts` and its exports do not exist.

- [ ] **Step 4: Implement the minimal pure resolver**

Implement normalization exactly as:

```ts
return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
```

Build a set of normalized names represented by `guessedCardIds`; reject the query when that set contains it. Sort matches with existing name ordering and a code-unit ID tiebreaker. Return an accepted matching ID first, otherwise the first sorted matching ID, otherwise `null`.

- [ ] **Step 5: Run GREEN and focused regressions**

Run:

```powershell
npm exec vitest run tests/client/hardcore-name.test.ts tests/shared/selection.test.ts tests/client/game-reducer.test.ts
```

Expected: all tests pass; no selection/reducer production file changes.

- [ ] **Step 6: Review and commit**

Verify no answer/card names are logged and run `git diff --check`, then:

```powershell
git add src/client/game/hardcore-name.ts tests/client/hardcore-name.test.ts
git commit -m "feat: resolve hardcore names from memory"
```

---

### Task 2: Candidate-Free Hardcore Input and Invalid Feedback

**Files:**
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles/search.css`
- Modify: `tests/client/CardSearch.test.tsx`
- Modify: `tests/client/app.test.tsx`

**Interfaces:**
- Consumes: `resolveHardcoreCardName()` from Task 1.
- Produces this discriminated prop boundary:

```ts
export type CardSearchMode =
  | { readonly kind: "candidates" }
  | { readonly kind: "hardcore-name"; readonly submitExactName: (query: string) => boolean };

// CardSearchProps addition
searchMode?: CardSearchMode;
```

The omitted default is `{ kind: "candidates" }` for existing callers.

- [ ] **Step 1: Write CardSearch RED tests for hidden candidates**

Render `searchMode={{ kind: "hardcore-name", submitExactName }}` and prove:

- the labeled input exists as a searchbox/textbox, not a combobox;
- `aria-controls`, `aria-expanded`, `aria-activedescendant`, and `aria-autocomplete` are absent;
- focus and typing never create a listbox, option, sprite, or `No visible candidates` status;
- Arrow/Home/End do not select or navigate anything;
- valid Enter calls `submitExactName(query)` once, then clears the input only when it returns `true`.

- [ ] **Step 2: Write invalid-feedback RED tests**

For a callback returning `false`, press Enter twice and assert each attempt:

- does not call `onSelect`;
- preserves input value and focus;
- increments a stable `data-invalid-attempt` value;
- renders a keyed `role="status"` with `No matching unguessed card name.`;
- alternates `card-search__input--invalid-a` and `--invalid-b` so identical consecutive attempts restart CSS animation.

- [ ] **Step 3: Write App integration RED tests**

Create a Hardcore round fixture with five Strike identities. Prove that entering punctuation/case/space variants submits the accepted Strike ID, a wrong shared name submits the deterministic representative, and a repeated shared name produces invalid feedback without calling `game.submit` again. Prove Daily and Practice still expose options and use candidate click/keyboard submission.

- [ ] **Step 4: Run RED**

Run:

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx tests/client/app.test.tsx
```

Expected: FAIL because `searchMode`, Hardcore exact-name handling, and invalid feedback do not exist.

- [ ] **Step 5: Implement mode-aware CardSearch**

Keep the current candidate path unchanged behind `searchMode.kind === "candidates"`. In Hardcore mode:

- do not calculate/render candidate results for UI use;
- keep `isOpen` false and omit every combobox/listbox attribute;
- on Enter call `submitExactName(query)`;
- on success use the existing query reset path;
- on failure increment an invalid-attempt counter without changing query/focus.

Render the status as a visually hidden keyed node so repeated attempts are announced.

- [ ] **Step 6: Wire RoundGameBoard without leaking answer data**

Memoize the guessed and accepted ID sets. Create a callback that calls `resolveHardcoreCardName({ cards: snapshot.cards, guessedCardIds, acceptedCardIds, query })`; when it returns an ID, call existing `onSubmit(id)` and return `true`, otherwise return `false`. Pass Hardcore mode only for `round.mode === "hardcore-daily"`.

- [ ] **Step 7: Add the paired red/shake animations**

Add two identical normal-motion keyframes with distinct names so alternating classes restart the effect. Use a 240 ms ease-out sequence with at most 4px horizontal displacement and red border/background at the middle. Add two reduced-motion keyframes/classes that animate only border/background. Do not clear focus outlines.

- [ ] **Step 8: Run GREEN and accessibility regressions**

Run:

```powershell
npm exec vitest run tests/client/hardcore-name.test.ts tests/client/CardSearch.test.tsx tests/client/app.test.tsx tests/client/use-game.test.tsx tests/client/storage.test.ts
npm run typecheck
```

Expected: all pass; no Daily/Practice storage or game lifecycle changes.

- [ ] **Step 9: Review and commit**

Inspect the DOM assertions for secret safety, run `git diff --check`, then:

```powershell
git add src/client/components/CardSearch.tsx src/client/App.tsx src/client/styles/search.css tests/client/CardSearch.test.tsx tests/client/app.test.tsx
git commit -m "feat: add hardcore memory input"
```

---

### Task 3: Prevent Guess-Tile Text Selection

**Files:**
- Modify: `src/client/components/FeatureTile.tsx`
- Modify: `src/client/styles/grid.css`
- Modify: `tests/client/GuessGrid.test.tsx`
- Test interaction: `tests/client/OrbInteractionContext.test.tsx`

**Interfaces:**
- Consumes: existing GuessGrid/FeatureTile markup and orb-target buttons.
- Produces: selection-free decorative tile surfaces with unchanged interactive target elements.

- [ ] **Step 1: Write the structural RED test**

Assert that rendered card-name/value/badge elements carry a shared `guess-grid__noninteractive-text` class while Reveal/Filter/Negation target buttons remain outside that class and retain their roles/names.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm exec vitest run tests/client/GuessGrid.test.tsx tests/client/OrbInteractionContext.test.tsx
```

Expected: FAIL only on the missing noninteractive-text contract.

- [ ] **Step 3: Apply minimal markup/CSS**

Add the shared class to the card-name overlay, feature values, and decorative orb badge. Apply:

```css
.guess-grid,
.guess-grid__noninteractive-text {
  -webkit-user-select: none;
  user-select: none;
}

.guess-grid__noninteractive-text {
  pointer-events: none;
}
```

Keep `.guess-grid__header-target` and `.feature-tile__target` pointer-enabled and above decorative text.

- [ ] **Step 4: Run GREEN and commit**

Run the focused command again plus `npm run typecheck` and `git diff --check`, then:

```powershell
git add src/client/styles/grid.css src/client/components/GuessGrid.tsx src/client/components/FeatureTile.tsx tests/client/GuessGrid.test.tsx
git commit -m "fix: prevent guess tile text selection"
```

---

### Task 4: Measured Horizontal Overflow Cues

**Files:**
- Create: `src/client/components/GuessGridOverflowFrame.tsx`
- Create: `tests/client/GuessGridOverflowFrame.test.tsx`
- Modify: `src/client/components/GuessGrid.tsx`
- Modify: `src/client/styles/grid.css`
- Modify: `tests/client/GuessGrid.test.tsx`

**Interfaces:**
- Consumes: `reducedMotion`, `roundKey`, and the existing `.guess-grid` child.
- Produces:

```ts
export interface GuessGridOverflowFrameProps {
  readonly children: React.ReactNode;
  readonly resetKey: string | number;
  readonly reducedMotion: boolean;
}

export function GuessGridOverflowFrame(props: GuessGridOverflowFrameProps): React.JSX.Element;
```

- [ ] **Step 1: Write geometry-state RED tests**

Mock `clientWidth`, `scrollWidth`, writable `scrollLeft`, `scrollBy`, and `ResizeObserver`. Prove:

- 695/695 shows no hint/buttons/fades;
- 390/695 shows hint + right control only at `scrollLeft=0`;
- a real scroll to `scrollLeft=86` hides the one-time text and shows both controls;
- the right edge shows only the left control;
- changing `resetKey` restores the hint if overflow remains;
- resize/content observer callbacks recompute the state.

- [ ] **Step 2: Write scroll-button RED tests**

Click the buttons and assert calls of:

```ts
expect(scrollBy).toHaveBeenCalledWith({ left: 88, behavior: "smooth" });
expect(scrollBy).toHaveBeenCalledWith({ left: -88, behavior: "smooth" });
```

With `reducedMotion`, require `behavior: "auto"`. Assert stable accessible names and that both buttons meet the component's control class contract.

- [ ] **Step 3: Run RED**

Run:

```powershell
npm exec vitest run tests/client/GuessGridOverflowFrame.test.tsx tests/client/GuessGrid.test.tsx
```

Expected: FAIL because the overflow frame does not exist.

- [ ] **Step 4: Implement the focused overflow frame**

Use one scroll ref and a `measure()` callback with a one-pixel tolerance:

```ts
const overflowing = scrollWidth > clientWidth + 1;
const canScrollLeft = overflowing && scrollLeft > 1;
const canScrollRight = overflowing && scrollLeft + clientWidth < scrollWidth - 1;
```

Observe the scroller and grid child with `ResizeObserver`; also measure after children/reset-key changes and on `scroll`. Disconnect observers/listeners on unmount. Mark interaction only when horizontal position changes or a chevron is activated.

- [ ] **Step 5: Integrate GuessGrid and style without obstruction**

Move the existing `aria-label="Guess results"` section responsibility to the frame. Keep `.guess-grid-scroll` as the only overflow owner. Place the hint/buttons in a compact control row above the scroller and edge fades as pointer-inert overlays, so controls never cover headers, Reveal bubbles, sticky art, or orb targets. Set button minimum dimensions to 44px.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
npm exec vitest run tests/client/GuessGridOverflowFrame.test.tsx tests/client/GuessGrid.test.tsx tests/client/FeatureTile.test.tsx tests/client/OrbInteractionContext.test.tsx
npm run typecheck
git diff --check
```

Then:

```powershell
git add src/client/components/GuessGridOverflowFrame.tsx src/client/components/GuessGrid.tsx src/client/styles/grid.css tests/client/GuessGridOverflowFrame.test.tsx tests/client/GuessGrid.test.tsx
git commit -m "feat: expose horizontal guess details"
```

---

### Task 5: Reorganize Help and Documentation

**Files:**
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `tests/client/GameGuide.test.tsx`
- Modify: `README.md`

**Interfaces:**
- No new runtime interface; this task changes only section ownership and public copy.

- [ ] **Step 1: Write the help RED test**

Change the exact expected section map so `Orbs and filtering` owns only orb, red-priority, interaction, and Neutral/Green/Red visibility rows. Add `Practice Filter Mode` with exactly the three existing filter-rule rows. Require the Hardcore row to read:

```text
Hardcore Daily: a separate daily answer with no orbs, name hints, or candidate list; enter complete card names from memory.
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx
```

Expected: FAIL because Practice Filter Mode is not a separate section and Hardcore copy is stale.

- [ ] **Step 3: Move copy and update README**

Move, do not duplicate, the three filter rows. Preserve their wording and icons. Update the README's opening mode summary with candidate-free Hardcore name entry and retain all Practice filter semantics.

- [ ] **Step 4: Run GREEN and commit**

Run:

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx tests/client/PracticeFilterPanel.test.tsx
npm run typecheck
git diff --check
```

Then:

```powershell
git add src/client/components/GameGuide.tsx tests/client/GameGuide.test.tsx README.md
git commit -m "docs: explain hardcore memory mode"
```

---

### Task 6: Browser Acceptance and Responsive Polish

**Files:**
- Modify: `tests/e2e/game.spec.ts`

**Interfaces:**
- Consumes all prior tasks' public DOM/accessibility contracts.
- Produces executable offline acceptance for the complete user flow.

- [ ] **Step 1: Replace stale Hardcore candidate helpers with memory entry**

Add a helper that fills the Hardcore searchbox and presses Enter without querying candidate options. In the Hardcore flow assert zero `listbox`/`option` elements before and after typing.

- [ ] **Step 2: Add invalid-feedback browser RED**

Enter an empty, partial, reordered, and misspelled name. For each, assert no new guess row, preserved text/focus, changing `data-invalid-attempt`, red-animation class, and the live status. Use computed animation name/duration to prove normal motion includes the buzzer class; emulate reduced motion and prove the reduced animation has no transform shake.

- [ ] **Step 3: Add valid/duplicate browser acceptance**

Submit a punctuation/case/space variant of a known full fixture-card name and prove exactly one newest-first row appears. Keep accepted and deterministic non-answer Strike/Defend behavior in the pure/App integration tests from Tasks 1-2, where the answer can be controlled without changing the global E2E snapshot hash.

- [ ] **Step 4: Add tile-selection browser RED**

Attempt pointer drag selection across card-name and feature text. Assert `window.getSelection()?.toString()` remains empty, computed `user-select` is `none`, and a subsequent orb interaction still succeeds with the expected announcement/use count.

- [ ] **Step 5: Add overflow acceptance at all three viewports**

At 390x844 and 768x1024, assert real overflow, initial hint/right cue, 44px control size, one-column movement, hint disappearance, left cue appearance, right-cue disappearance at the end, no page overflow, and unobstructed header/orb target geometry. At 1440x900, assert no hint, fades, or controls because the table fits.

- [ ] **Step 6: Prove the browser assertions detect regressions**

After adding the browser assertions, temporarily apply one test mutation at a time: expose the Hardcore candidate list, remove the invalid animation class, remove `user-select: none`, and force overflow state false. Run the targeted Playwright case for each mutation and record its intended failure, then restore production and confirm `git diff` contains none of the mutations. Use an owned temporary data root/port if 3000 is occupied; never stop an unowned process.

- [ ] **Step 7: Run final browser GREEN**

Run the targeted flows and then:

```powershell
npm run test:e2e
```

Expected: every E2E test passes and every ordinary app test reports zero attempted official Spire Codex requests.

- [ ] **Step 8: Review and commit**

Run `git diff --check`, verify no secrets/answer IDs in assertions or output, then:

```powershell
git add tests/e2e/game.spec.ts
git diff --cached --check
git commit -m "test: verify hardcore memory entry"
```

---

### Task 7: Final Review, Push, and Deployment Verification

**Files:**
- Create ignored: `.superpowers/sdd/2026-08-16-hardcore-memory-input-grid-affordances/final-report.md`
- Update ignored: `.superpowers/sdd/2026-08-16-hardcore-memory-input-grid-affordances/progress.md`

**Interfaces:**
- Consumes the complete feature branch range from design commit `8339e5b` through final implementation HEAD.
- Produces a clean, pushed `master` and verified live Render deployment.

- [ ] **Step 1: Run the exact supported-runtime gate serially**

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

Expected: Node 24.19.0; every command exits 0; tracked tree clean after reports remain ignored.

- [ ] **Step 2: Request independent whole-feature review**

Review the exact design/plan/commit range for spec compliance, name secrecy, duplicate-name fairness, candidate suppression, animation accessibility, orb compatibility, overflow geometry, help ownership, and test quality. Fix every Critical/Important finding with a separate RED -> GREEN commit and re-review until clean.

- [ ] **Step 3: Verify authorship and repository scope**

Confirm zero `Co-Authored-By` trailers, user-only author/committer metadata, ignored reports absent from `git ls-files`, exact SSH origin, and `git diff origin/main...HEAD --check` success.

- [ ] **Step 4: Push direct master**

```powershell
git push origin master:main
```

Record the exact SHA and push range. Do not create a branch or PR.

- [ ] **Step 5: Verify Render and the live application**

Wait for the GitHub deployment tied to the exact pushed SHA to reach `success`. Verify `/health`, runtime manifest/cards/atlases, schema/count/revision consistency, and current cache headers. In the in-app browser, hard reload the public site and smoke:

- Hardcore has no candidate DOM;
- invalid Enter visibly flashes/shakes without submitting;
- normalized exact name submits;
- tile text cannot be selected;
- overflow cues behave at 390, 768, and 1440 widths;
- help has a separate Practice Filter Mode section;
- console warnings/errors are empty.

- [ ] **Step 6: Final report**

Record commits, RED/GREEN evidence, exact gate counts, review verdict, push/deployment SHA, live endpoint/browser evidence, process cleanup, and any environment limitation in the ignored report. End only with a clean tracked tree and synchronized `master`/`origin/main`.
