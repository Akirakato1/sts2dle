# Orb Assistance, Hardcore Daily, and Progressive Name Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-use Reveal, Filter, and Negation orbs, progressive selected-answer name hints, independently seeded Hardcore Daily play, persistent Practice rounds, advisory candidate classification, and secret-safe sharing without changing the ten-feature answer model.

**Architecture:** Keep every durable rule in pure game modules and the reducer, serialize one strict current-round payload per mode, and derive candidate colors and name masks from validated snapshot data. A transient orb interaction provider owns pointer/keyboard selection and animation state, while `CardSearch`, `GuessGrid`, and `FeatureTile` expose semantic targets and dispatch idempotent reducer actions. Normal Daily, Hardcore Daily, and Practice resume independently; only presentation state is reset on round identity changes.

**Tech Stack:** TypeScript 5, React 19, Zod 4, Vitest 4 with Testing Library, Playwright 1.58, Vite 7, Fastify 5, browser `localStorage`, CSS/SVG animation, Node.js `>=22.12` (use the bundled Node 24 runtime for every gate).

## Global Constraints

- Work directly on local `master`; do not create a feature branch or pull request.
- The verified pre-feature baseline `192280553d8794851a9d1e43477d6b8e8c03c681` is already pushed to `origin/main`; do not push partial implementation commits.
- The final remote is exactly `git@github.com:Akirakato1/sts2dle.git`; after all implementation, review, and verification, push local `master` directly to `origin/main` over SSH.
- Do not add `Co-Authored-By` trailers.
- Before implementation, resolve `.tmp/live-backend.pid` and `.tmp/dev-site.pid`, verify each PID's listener and CIM command line belongs to this repository, stop only those verified process trees, and leave ports 3000/5173 stopped until final handoff.
- Preserve the ten-feature `FEATURE_ORDER`, paired base/upgraded comparison colors, equivalent-answer acceptance, and uniform base-feature-group-then-card answer sampling.
- Normal Daily and normal Practice have exactly one Reveal, one Filter, and one Negation orb per round; Hardcore Daily and Hardcore Practice have no orbs and no automatic name hint.
- Filter accepts only a fully revealed green feature tile; Negation accepts only a fully revealed red feature tile; neither accepts yellow, artwork, hidden, or animating tiles.
- Orb constraints compare typed base/upgraded feature pairs, never display strings; red Negation classification overrides green Filter classification.
- Candidate classification is advisory: never remove, disable, or prevent a candidate from being guessed. Visibility checkboxes affect presentation only.
- Name hints use the deterministically selected card name; equivalent accepted answers remain valid even when their names differ from the hint.
- Only spaces split name-hint words. Every non-space code point, including punctuation, is a hidden/revealable position; `F.T.L.` is one six-position word with one continuous underline.
- Persist current Normal Daily, Hardcore Daily, and Practice progress only in browser `localStorage`; add no database, account, server session, or network request.
- Use original inline SVG/CSS orb visuals; add no icon package and no remote orb asset.
- All new controls must be keyboard operable, have non-color accessible text, meet the existing 44-pixel target convention, and honor `prefers-reduced-motion: reduce`.
- Keep the search field first, Orb Tray second, category visibility controls third, Name Hint fourth, and bounded candidate list last; do not widen the 1280-pixel shell or the 830-pixel ten-feature grid.
- Normal Daily share shows fixed Reveal/Filter/Negation usage positions only; Hardcore Daily share omits the orb line; Practice has no share output.
- Errors exposed to the UI must not include storage payloads, card data, paths, URLs, tokens, or selected-answer secrets.
- Follow strict RED-GREEN-REFACTOR TDD for every task. A RED run must fail for the intended missing behavior before production code is edited.
- Preserve unrelated user changes. Stage only the files named by the current task.
- Final supported-runtime order is: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run check`, `git diff --check`.

---

## File Structure

### New files

- `src/client/game/assistance.ts` — orb kinds/targets, default durable assistance state, exact-pair candidate classification, red priority, and visibility predicates.
- `src/client/game/name-hints.ts` — space-only word segmentation, deterministic seeded reveal ordering, and pure wrong-guess-count display masks.
- `src/client/components/NameHint.tsx` — continuous proportional word lines and accessible revealed-position rendering.
- `src/client/components/PracticeControls.tsx` — Practice Hardcore setting, lock copy, forfeit button, and terminal next-round setup.
- `src/client/components/OrbInteractionContext.tsx` — transient selected/dragging orb state, pointer capture/hit testing, keyboard target activation, single-settlement, announcements, and poof lifecycle.
- `src/client/components/OrbVisual.tsx` — three original inline SVG orb motifs and compact badge variant.
- `src/client/components/OrbTray.tsx` — fixed three-slot inventory and accessible orb buttons.
- `src/client/styles/assistance.css` — tray, oversize orbs, target states, VFX, poof, candidate category controls, name hints, and reduced-motion overrides.
- `tests/client/assistance.test.ts` — typed exact-pair classification, red priority, visibility, and usage status.
- `tests/client/name-hints.test.ts` — all hint thresholds, punctuation/repetition, deterministic ordering, and exhaustion.
- `tests/client/NameHint.test.tsx` — continuous word-line DOM, position masks, and accessible text.
- `tests/client/PracticeControls.test.tsx` — toggle locking, forfeit availability, and terminal next-round choice.
- `tests/client/OrbInteractionContext.test.tsx` — click/keyboard/drag behavior, invalid returns, idempotence, announcements, poof, and cleanup.
- `tests/client/OrbTray.test.tsx` — exact one-of-each slots, availability labels, selection border state, and disabled/Hardcore omission behavior.

### Existing files to modify

- `src/shared/comparison.ts` and `tests/shared/comparison.test.ts` — export one canonical paired-feature formatter for tiles and Reveal bubbles.
- `src/shared/random.ts` and `tests/shared/selection.test.ts` — explicit Daily seed namespace and deterministic independent Daily answers.
- `src/shared/share.ts` and `tests/shared/share.test.ts` — Hardcore title and fixed-position usage-only orb line.
- `src/client/game/game-reducer.ts` and `tests/client/game-reducer.test.ts` — three modes, forfeited status, round identity, durable assistance transitions, and Practice lock semantics.
- `src/client/game/storage.ts` and `tests/client/storage.test.ts` — strict fixed-key current-round v4 persistence, owned-key migration, separate stats, and restoration validation.
- `src/client/game/use-game.ts` and `tests/client/use-game.test.tsx` — independent mode lifecycle, UTC replacement, persisted Practice, Hardcore preference, and semantic action API.
- `src/client/components/CardSearch.tsx` and `tests/client/CardSearch.test.tsx` — empty-focused results, candidate categories, persistent visibility controls, colored rows, and accessible labels.
- `src/client/components/GuessGrid.tsx`, `src/client/components/FeatureTile.tsx`, `tests/client/GuessGrid.test.tsx`, `tests/client/GuessGrid.stale.test.tsx`, and `tests/client/FeatureTile.test.tsx` — explicit header/tile orb targets, persistent badges/bubbles, fully revealed gating, and round cleanup.
- `src/client/components/SharePanel.tsx` and `tests/client/SharePanel.test.tsx` — normal/Hardcore Daily copy output and won/forfeited Practice next-round control.
- `src/client/components/GameGuide.tsx` and `tests/client/GameGuide.test.tsx` — complete orb, candidate, name-hint, Hardcore, and Practice rules.
- `src/client/App.tsx` and `tests/client/app.test.tsx` — three tabs, composed assistance area, provider wiring, terminal state, and local mode resumption.
- `src/client/styles/search.css`, `src/client/styles/grid.css`, `src/client/styles/shell.css`, and `src/client/main.tsx` — composed control layout, target/badge/bubble placement, and assistance stylesheet import.
- `tests/e2e/fixtures/build-test-snapshot.ts` and `tests/e2e/game.spec.ts` — deterministic normal/Hardcore answers, enough wrong guesses, complete orb/hint/persistence/accessibility/viewport acceptance.
- `README.md` — document the three modes and local-only progress behavior without adding any server-side setup.

---

### Task 1: Pure Assistance Rules and Deterministic Name Hints

**Files:**
- Create: `src/client/game/assistance.ts`
- Create: `src/client/game/name-hints.ts`
- Create: `tests/client/assistance.test.ts`
- Create: `tests/client/name-hints.test.ts`
- Modify: `src/shared/comparison.ts`
- Modify: `tests/shared/comparison.test.ts`
- Modify: `src/shared/random.ts`
- Modify: `tests/shared/selection.test.ts`

**Interfaces:**
- Consumes: `CardIdentity`, `FeatureName`, `TileColor`, `RandomSource`, and `SelectedAnswer` from the existing shared domain.
- Produces:

```ts
export const ORB_KINDS = ["reveal", "filter", "negation"] as const;
export type OrbKind = (typeof ORB_KINDS)[number];
export type CandidateCategory = "neutral" | "green" | "red";
export interface CandidateVisibility { neutral: boolean; green: boolean; red: boolean }
export interface RevealOrbTarget { feature: FeatureName }
export interface ConstraintOrbTarget {
  guessIndex: number;
  cardId: string;
  feature: FeatureName;
}
export interface AssistanceState {
  reveal: RevealOrbTarget | null;
  filter: ConstraintOrbTarget | null;
  negation: ConstraintOrbTarget | null;
  visibility: CandidateVisibility;
}
export const DEFAULT_CANDIDATE_VISIBILITY: Readonly<CandidateVisibility>;
export function createDefaultAssistance(): AssistanceState;
export function featurePairMatches(left: CardIdentity, right: CardIdentity, feature: FeatureName): boolean;
export function classifyCandidate(
  candidate: CardIdentity,
  assistance: AssistanceState,
  cardsById: ReadonlyMap<string, CardIdentity>,
): CandidateCategory;
export function isCandidateCategoryVisible(category: CandidateCategory, visibility: CandidateVisibility): boolean;
export function orbUsage(assistance: AssistanceState): Record<OrbKind, boolean>;

export function formatFeatureValue(base: unknown, upgraded: unknown): string;

export interface NameHintCharacter { value: string; revealed: boolean; position: number }
export interface NameHintWord { characters: NameHintCharacter[]; length: number }
export interface NameHintView { words: NameHintWord[]; complete: boolean }
export function deriveNameHint(name: string, wrongGuessCount: number, seed: string): NameHintView | null;

export async function createDailyRandom(
  date: string,
  revision: string,
  namespace?: "daily" | "hardcore-daily",
): Promise<RandomSource>;
```

- `orbUsage` returns `true` when that orb has a non-null target, so sharing never receives target details.
- `deriveNameHint` returns `null` before five wrong guesses. At counts 5 and 6 it returns hidden word positions; from 7 onward it reveals word initials followed by a stable seeded shuffle of remaining positions.

- [ ] **Step 1: Write failing assistance and formatter tests**

Add table-driven tests that construct cards with exact paired values and assert typed equality, not display equality:

```ts
const assistance: AssistanceState = {
  reveal: null,
  filter: { guessIndex: 0, cardId: "FILTER_SOURCE", feature: "mana" },
  negation: { guessIndex: 1, cardId: "NEGATION_SOURCE", feature: "rarity" },
  visibility: { neutral: true, green: true, red: true },
};

expect(classifyCandidate(filterMatch, assistance, cardsById)).toBe("green");
expect(classifyCandidate(negationMatch, assistance, cardsById)).toBe("red");
expect(classifyCandidate(matchesBoth, assistance, cardsById)).toBe("red");
expect(classifyCandidate(neither, assistance, cardsById)).toBe("neutral");
expect(featurePairMatches(baseOnlyMatch, filterSource, "mana")).toBe(false);
expect(formatFeatureValue("Basic", "Basic")).toBe("Basic");
expect(formatFeatureValue(false, true)).toBe("false → true");
```

Also assert all eight visibility combinations, fresh object allocation from `createDefaultAssistance`, and fixed Reveal/Filter/Negation usage ordering.

- [ ] **Step 2: Run the assistance RED tests**

Run:

```powershell
npm exec vitest run tests/client/assistance.test.ts tests/shared/comparison.test.ts
```

Expected: FAIL because `assistance.ts`, `featurePairMatches`, and exported `formatFeatureValue` do not exist.

- [ ] **Step 3: Implement canonical paired-value helpers and candidate classification**

Move the existing private comparison formatter to the exported signature and implement red-first classification:

```ts
export function featurePairMatches(left: CardIdentity, right: CardIdentity, feature: FeatureName): boolean {
  return left.base[feature] === right.base[feature]
    && left.upgraded[feature] === right.upgraded[feature];
}

export function classifyCandidate(candidate: CardIdentity, assistance: AssistanceState, cardsById: ReadonlyMap<string, CardIdentity>): CandidateCategory {
  const negated = assistance.negation ? cardsById.get(assistance.negation.cardId) : undefined;
  if (negated && featurePairMatches(candidate, negated, assistance.negation!.feature)) return "red";
  const filtered = assistance.filter ? cardsById.get(assistance.filter.cardId) : undefined;
  if (filtered && featurePairMatches(candidate, filtered, assistance.filter!.feature)) return "green";
  return "neutral";
}
```

Use a new visibility object in every `createDefaultAssistance()` call. Do not infer consumption from a separate boolean or count.

- [ ] **Step 4: Write failing name-hint and independent-Daily tests**

Cover these exact masks:

```ts
expect(deriveNameHint("Alpha Beta", 4, "round-a")).toBeNull();
expect(revealedText(deriveNameHint("Alpha Beta", 5, "round-a"))).toEqual(["     ", "    "]);
expect(revealedText(deriveNameHint("Alpha Beta", 6, "round-a"))).toEqual(["     ", "    "]);
expect(revealedText(deriveNameHint("Alpha Beta", 7, "round-a"))).toEqual(["A    ", "    "]);
expect(revealedText(deriveNameHint("Alpha Beta", 8, "round-a"))).toEqual(["A    ", "B   "]);
expect(deriveNameHint("F.T.L.", 7, "punctuation")!.words).toHaveLength(1);
expect(deriveNameHint("F.T.L.", 7, "punctuation")!.words[0]!.length).toBe(6);
```

Add assertions that one post-initial guess reveals exactly one position, repeated letters reveal only one index, the same seed/count is stable, a different seed changes a non-initial order, every position is eventually visible, and extra guesses after exhaustion do not change the mask. Stub SHA-256 deterministically and prove the `daily` and `hardcore-daily` namespaces produce different streams for the same date/revision.

- [ ] **Step 5: Run the hint/namespace RED tests**

Run:

```powershell
npm exec vitest run tests/client/name-hints.test.ts tests/shared/selection.test.ts
```

Expected: FAIL because `deriveNameHint` and the Daily namespace parameter do not exist.

- [ ] **Step 6: Implement the pure hint schedule and seed namespace**

Split only on runs of non-space code points, preserve punctuation, and build a stable reveal order:

```ts
const words = [...name.matchAll(/\S+/gu)].map((match) => Array.from(match[0]));
const initialRevealCount = Math.min(words.length, Math.max(0, wrongGuessCount - 6));
const randomRevealCount = Math.max(0, wrongGuessCount - (6 + words.length));
```

Represent each position internally as `{ wordIndex, characterIndex }`. Add each word's index zero in word order, then apply an FNV-1a-seeded Fisher-Yates shuffle to all remaining positions using `seed + "\u0000" + name`; reveal the first `randomRevealCount` shuffled positions. Do not use `Math.random`, and do not persist the mask. Change the Daily digest input to:

```ts
["stsdle", "v2", namespace, date, revision].join(":")
```

Keep the optional namespace default as `daily` so existing callers compile until Task 2 explicitly supplies it.

- [ ] **Step 7: Run Task 1 verification**

Run:

```powershell
npm exec vitest run tests/client/assistance.test.ts tests/client/name-hints.test.ts tests/shared/comparison.test.ts tests/shared/selection.test.ts
npm run typecheck
git diff --check
```

Expected: all focused tests PASS, typecheck exits 0, and diff check reports no whitespace errors.

- [ ] **Step 8: Review and commit Task 1**

Review the exact staged diff for typed equality, red priority, Unicode code-point handling, and absence of target text in usage output. Then run:

```powershell
git add src/client/game/assistance.ts src/client/game/name-hints.ts src/shared/comparison.ts src/shared/random.ts tests/client/assistance.test.ts tests/client/name-hints.test.ts tests/shared/comparison.test.ts tests/shared/selection.test.ts
git commit -m "feat: add assistance rules and name hints"
```

---

### Task 2: Durable Round State, Strict Storage, and Three-Mode Lifecycle

**Files:**
- Modify: `src/client/game/game-reducer.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `src/client/game/use-game.ts`
- Modify: `tests/client/game-reducer.test.ts`
- Modify: `tests/client/storage.test.ts`
- Modify: `tests/client/use-game.test.tsx`

**Interfaces:**
- Consumes: `AssistanceState`, `OrbKind`, `RevealOrbTarget`, `ConstraintOrbTarget`, `CandidateCategory`, `createDefaultAssistance`, `createDailyRandom`, `createPracticeRandom`, `selectAnswer`, `compareGuess`.
- Produces:

```ts
export type PlayMode = "daily" | "hardcore-daily" | "practice";
export type RoundStatus = "playing" | "won" | "forfeited";

export interface RoundState {
  mode: PlayMode;
  hardcore: boolean;
  roundId: string;
  hintSeed: string;
  answer: SelectedAnswer;
  guesses: SubmittedGuess[];
  status: RoundStatus;
  terminalGuessCount: number | null;
  error: string | null;
  assistance: AssistanceState | null;
}

export type GameAction =
  | { type: "submit"; cardId: string; cardsById: ReadonlyMap<string, CardIdentity> }
  | { type: "consume-reveal"; target: RevealOrbTarget }
  | { type: "consume-filter"; target: ConstraintOrbTarget }
  | { type: "consume-negation"; target: ConstraintOrbTarget }
  | { type: "set-candidate-visibility"; category: CandidateCategory; visible: boolean }
  | { type: "set-practice-hardcore"; hardcore: boolean }
  | { type: "forfeit-practice" }
  | { type: "replace-round"; round: RoundState };

export function createRoundState(options: {
  mode: PlayMode;
  hardcore: boolean;
  roundId: string;
  hintSeed: string;
  answer: SelectedAnswer;
  guesses?: SubmittedGuess[];
  status?: RoundStatus;
  terminalGuessCount?: number | null;
  assistance?: AssistanceState | null;
}): RoundState;
export function isPracticeSettingsEditable(round: RoundState): boolean;

export const CURRENT_ROUND_VERSION = 4;
export const CURRENT_ROUND_KEYS: Readonly<Record<PlayMode, string>>;
export const DAILY_RULESET_VERSION = "v4";
export const HARDCORE_DAILY_RULESET_VERSION = "hardcore-v1";
export const PRACTICE_RULESET_VERSION = "practice-v1";
export const DAILY_STATS_KEY = "stsdle:stats:v1";
export const HARDCORE_DAILY_STATS_KEY = "stsdle:stats:hardcore:v1";

export interface RoundStorageIdentity {
  mode: PlayMode;
  sourceRevision: string;
  ruleset: string;
  utcDate: string | null;
}
export function saveCurrentRound(storage: Storage, identity: RoundStorageIdentity, round: RoundState): void;
export function loadCurrentRound(
  storage: Storage,
  identity: RoundStorageIdentity,
  cardsById: ReadonlyMap<string, CardIdentity>,
  pairGroupsByKey: ReadonlyMap<string, PairGroup>,
  expectedAnswer?: SelectedAnswer,
): RoundState | null;
export function removeLegacyCurrentRoundKeys(storage: Storage): void;

export interface UseGameResult {
  round: RoundState;
  roundToken: number;
  dailyUtcDate: string;
  error: string | null;
  practiceHardcoreChoice: boolean;
  submit(cardId: string): void;
  setMode(mode: PlayMode): void;
  consumeReveal(target: RevealOrbTarget): void;
  consumeFilter(target: ConstraintOrbTarget): void;
  consumeNegation(target: ConstraintOrbTarget): void;
  setCandidateVisibility(category: CandidateCategory, visible: boolean): void;
  setPracticeHardcoreChoice(hardcore: boolean): void;
  forfeitPractice(): void;
  nextPracticeRound(): void;
}
```

- Daily round IDs are `daily:<utcDate>:<sourceRevision>` and `hardcore-daily:<utcDate>:<sourceRevision>`; persisted Practice round IDs are `practice:<crypto UUID>`.
- `hardcore` is always true for `hardcore-daily`; Daily is always false. Practice may be either.
- `assistance` is `null` exactly for Hardcore rounds; normal rounds receive `createDefaultAssistance()`.

- [ ] **Step 1: Write reducer RED tests for all semantic actions**

Add tests for valid one-time consumption, repeat rejection, wrong-color rejection, terminal rejection, visibility changes, Practice toggle lock predicate, and forfeit:

```ts
const started = gameReducer(normalPractice, { type: "consume-filter", target: greenTarget });
expect(started.assistance?.filter).toEqual(greenTarget);
expect(gameReducer(started, { type: "consume-filter", target: otherGreenTarget })).toBe(started);
expect(gameReducer(normalPractice, { type: "consume-negation", target: greenTarget })).toBe(normalPractice);
expect(isPracticeSettingsEditable(normalPractice)).toBe(true);
expect(isPracticeSettingsEditable(started)).toBe(false);
expect(gameReducer(normalPractice, { type: "forfeit-practice" }).status).toBe("forfeited");
expect(gameReducer(dailyRound, { type: "forfeit-practice" })).toBe(dailyRound);
```

Use actual `SubmittedGuess.results` colors to validate Filter/Negation targets by chronological `guessIndex`, `cardId`, and `feature`. Assert a visibility-only action does not lock Practice, while an accepted guess and valid orb use do.

- [ ] **Step 2: Run reducer RED**

Run:

```powershell
npm exec vitest run tests/client/game-reducer.test.ts
```

Expected: FAIL because the new modes, statuses, state fields, and actions are absent.

- [ ] **Step 3: Implement reducer-owned round and assistance transitions**

Resolve a constraint target only when all of these hold: playing non-Hardcore round, unused matching orb, integer in-range guess index, exact card ID match, exact feature result present, and result color green for Filter/red for Negation. Return the same state object for invalid or duplicate actions. On accepted submission append canonical results and set `won` only when `answer.acceptedCardIds` contains the guessed ID; set `terminalGuessCount` to the resulting guess count. Forfeit sets the marker to the current count. Reject submissions and orb actions after won/forfeited. `set-practice-hardcore` is valid only for an unstarted, nonterminal Practice round and replaces `assistance` with `null` or a fresh default. Make `isPracticeSettingsEditable` true only for Practice when `guesses.length === 0` and all non-null assistance targets are absent; terminal state does not mutate the completed round.

- [ ] **Step 4: Write strict persistence RED tests**

Use a real in-memory `Storage` double and assert these exact fixed keys:

```ts
expect(CURRENT_ROUND_KEYS).toEqual({
  daily: "stsdle:round:daily:v1",
  "hardcore-daily": "stsdle:round:hardcore-daily:v1",
  practice: "stsdle:round:practice:v1",
});
```

Test a complete round-trip for each mode, including Practice answer/hint seed/orb targets/visibility/won and forfeited states. Tamper one field at a time: schema version, source revision, ruleset, UTC date, answer, accepted IDs, result value/color, duplicate guesses, post-win guess, post-forfeit guess, target card, target feature, target result color, visibility extra/missing key, orb target in Hardcore, and mode/hardcore inconsistency. Each must return null and remove only that exact current-round key. Set `unrelated:key`, `stsdle:stats:v1`, and `stsdle:stats:hardcore:v1`; assert cleanup preserves them. Seed exact legacy keys matching `stsdle:daily:v2:*` and `stsdle:daily:v3:*`; assert only those application-owned current-round keys are removed.

- [ ] **Step 5: Run storage RED**

Run:

```powershell
npm exec vitest run tests/client/storage.test.ts
```

Expected: FAIL because fixed three-mode v4 storage and strict orb/forfeit validation are absent.

- [ ] **Step 6: Implement strict fixed-key persistence and independent streak domains**

Use Zod `.strict()` schemas for the envelope, answer, guess, target, visibility, and assistance objects. After parsing, recompute every guess using `compareGuess`, require exact ordered equality with `FEATURE_ORDER`, verify `answer.pairKey` and accepted IDs against `pairGroupsByKey`, enforce no duplicate guesses or guesses after the first winning guess, and derive the expected status. Require `terminalGuessCount === null` while playing and exact equality with `guesses.length` when won/forfeited; won must end on the first accepted answer, while forfeited is allowed only for Practice without a prior winning guess. Validate each consumed target against its referenced canonical guess/result. Catch storage exceptions and continue play. Change the existing stats helpers to accept a `statsKey` parameter defaulting to `DAILY_STATS_KEY`, then pass `HARDCORE_DAILY_STATS_KEY` for Hardcore; do not rename or clear the existing normal stats key.

- [ ] **Step 7: Write useGame RED tests for independent mode lifecycle**

Mock `createDailyRandom`, `createPracticeRandom`, storage, and UTC timers. Assert:

```ts
expect(dailyRandomCalls).toContainEqual([date, revision, "daily"]);
expect(dailyRandomCalls).toContainEqual([date, revision, "hardcore-daily"]);
expect(result.current.round.mode).toBe("daily");
act(() => result.current.setMode("hardcore-daily"));
expect(result.current.round.mode).toBe("hardcore-daily");
expect(result.current.round.answer.selectedCardId).not.toBe(dailyAnswerId);
```

Cover resuming each mode, normal/Hardcore UTC replacement without touching the other mode, Practice refresh restoration, Practice Hardcore pre-start toggle, lock after guess/orb, terminal choice affecting only the next new round, forfeit persistence, visibility persistence, and transient `roundToken` increments on mode switch/UTC rollover/new Practice but not ordinary rerender or submission. Verify the two Daily streak writers receive different stats keys.

- [ ] **Step 8: Run useGame RED**

Run:

```powershell
npm exec vitest run tests/client/use-game.test.tsx
```

Expected: FAIL because `useGame` exposes only Daily/Practice and does not persist Practice or orb state.

- [ ] **Step 9: Implement the three-mode useGame lifecycle**

Create/load both deterministic Daily rounds at initialization with explicit namespaces, then create/load Practice. Store all three in a `Map<PlayMode, RoundState>` owned by the hook and persist only the changed mode after reducer transitions. Keep `practiceHardcoreChoice` separate from the completed round; before-start toggle replaces the current unstarted round's `hardcore` and `assistance`, while terminal toggle updates only the choice used by `nextPracticeRound()`. Call `crypto.randomUUID()` once per new Practice round and use it for both round identity and name-hint seed. On UTC timer/visibility change replace only Daily/Hardcore identities whose date changed. Clear hook generations and async image preload work exactly as the current implementation does.

- [ ] **Step 10: Run Task 2 verification**

Run:

```powershell
npm exec vitest run tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx
npm run typecheck
git diff --check
```

Expected: all focused tests PASS and no type/whitespace errors.

- [ ] **Step 11: Review and commit Task 2**

Inspect the staged diff for fail-closed exact-key deletion, no target display text, no historical Daily key accumulation, and unchanged normal stats key. Then run:

```powershell
git add src/client/game/game-reducer.ts src/client/game/storage.ts src/client/game/use-game.ts tests/client/game-reducer.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx
git commit -m "feat: persist assisted game modes"
```

---

### Task 3: Candidate Classification, Visibility Controls, and Empty-Focus Search

**Files:**
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `src/client/styles/search.css`
- Modify: `tests/client/CardSearch.test.tsx`

**Interfaces:**
- Consumes: `AssistanceState`, `CandidateCategory`, `classifyCandidate`, `isCandidateCategoryVisible`, `CardIdentity`, and `SpriteMap`.
- Produces:

```ts
export interface ClassifiedCandidate {
  card: CardIdentity;
  category: CandidateCategory;
}

export function searchCards(
  cards: readonly CardIdentity[],
  query: string,
  guessedCardIds: ReadonlySet<string>,
  assistance: AssistanceState | null,
  cardsById: ReadonlyMap<string, CardIdentity>,
): ClassifiedCandidate[];

export interface CardSearchProps {
  cards: readonly CardIdentity[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  spriteMap: SpriteMap;
  guessedCardIds: ReadonlySet<string>;
  assistance: AssistanceState | null;
  roundKey: string | number;
  disabled?: boolean;
  assistanceSlot?: React.ReactNode;
  nameHintSlot?: React.ReactNode;
  onVisibilityChange(category: CandidateCategory, visible: boolean): void;
  onSelect(cardId: string): void;
}
```

- An empty trimmed query includes every unguessed checked category; a non-empty query applies the existing case-insensitive prefix match after category visibility.
- `assistance === null` means Hardcore: every candidate is neutral, controls are omitted, and the slots remain absent.

- [ ] **Step 1: Write CardSearch RED tests**

Extend the existing keyboard and ordering tests with:

```tsx
fireEvent.focus(screen.getByRole("combobox", { name: "Guess a card" }));
expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(alphabeticalVisibleNames);
expect(screen.getByRole("option", { name: /matches Filter Orb/ })).toHaveClass("card-search__option--green");
expect(screen.getByRole("option", { name: /excluded by Negation Orb/ })).toHaveClass("card-search__option--red");
```

Uncheck Red and assert only red options disappear; uncheck all three and assert a non-option status `No visible candidates` while the input remains focused. Type a prefix and assert it narrows only the checked subset. Assert already-guessed cards stay absent, clicking a red candidate still calls `onSelect`, duplicate-name class labels remain, and Home/End/Arrow/Enter/Escape/blur retain existing behavior. Rerender with a new `roundKey` and assert query/menu state resets.

- [ ] **Step 2: Run CardSearch RED**

Run:

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx
```

Expected: FAIL because empty queries currently produce no results and candidate categories/controls do not exist.

- [ ] **Step 3: Implement classified search and visibility presentation**

Derive and sort unguessed candidates first, preserving the existing `name.localeCompare("en-US")` plus code-unit ID tiebreak. Render the composed order:

```tsx
<input ... onFocus={() => setIsOpen(!disabled)} />
{assistanceSlot}
{assistance && <fieldset className="candidate-visibility" aria-label="Candidate visibility">...</fieldset>}
{nameHintSlot}
{isOpen && (results.length > 0 ? <ul role="listbox">...</ul> : <p role="status">No visible candidates</p>)}
```

Checkbox labels must be `Neutral`, `Green`, and `Red`, bind directly to persisted `assistance.visibility`, and call only `onVisibilityChange`. Candidate rows receive `--neutral`, `--green`, or `--red` class and visually hidden text `unhighlighted candidate`, `matches Filter Orb`, or `excluded by Negation Orb`. Keep every option selectable.

- [ ] **Step 4: Style categories and composed search layout**

Keep the bounded list and existing artwork geometry. Add green/red border-plus-hue states, a compact wrapping checkbox fieldset, and a zero-result panel. Set the search section stacking context so later drag avatars can overlay the list without changing shell width. Provide `:focus-visible` outlines at least 2px wide and ensure checkbox labels have a minimum 44px height.

- [ ] **Step 5: Run Task 3 verification**

Run:

```powershell
npm exec vitest run tests/client/CardSearch.test.tsx tests/client/SpriteArt.test.tsx
npm run typecheck
git diff --check
```

Expected: focused tests PASS and no type/whitespace errors.

- [ ] **Step 6: Review and commit Task 3**

Verify no classification removes cards from the source collection or disables red options. Then run:

```powershell
git add src/client/components/CardSearch.tsx src/client/styles/search.css tests/client/CardSearch.test.tsx
git commit -m "feat: classify and filter card candidates"
```

---

### Task 4: Hardcore/Practice Controls, Name-Hint UI, Sharing, and Rules

**Files:**
- Create: `src/client/components/NameHint.tsx`
- Create: `src/client/components/PracticeControls.tsx`
- Create: `tests/client/NameHint.test.tsx`
- Create: `tests/client/PracticeControls.test.tsx`
- Modify: `src/shared/share.ts`
- Modify: `tests/shared/share.test.ts`
- Modify: `src/client/components/SharePanel.tsx`
- Modify: `tests/client/SharePanel.test.tsx`
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `tests/client/GameGuide.test.tsx`
- Modify: `src/client/App.tsx`
- Modify: `tests/client/app.test.tsx`
- Modify: `src/client/styles/shell.css`
- Modify: `src/client/styles/search.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: `PlayMode`, `RoundState`, `NameHintView`, `deriveNameHint`, `orbUsage`, and Task 2's useGame API.
- Produces:

```ts
export interface NameHintProps { hint: NameHintView | null; cardName: string }

export interface PracticeControlsProps {
  round: RoundState;
  selectedHardcore: boolean;
  settingsEditable: boolean;
  disabled: boolean;
  onHardcoreChange(hardcore: boolean): void;
  onForfeit(): void;
  onNextRound(): void;
}

export interface FormatDailyShareOptions {
  utcDate: string;
  guesses: readonly ShareGuess[];
  siteUrl: string;
  hardcore: boolean;
  orbUsage?: Readonly<Record<OrbKind, boolean>>;
}
```

- Normal Daily orb symbols are fixed `[Reveal, Filter, Negation] = [🟣, 🟢, 🔴]`; replace each consumed position with `⚫`. Hardcore omits the entire line.
- NameHint receives only the selected card name and derived mask; it never changes answer acceptance.

- [ ] **Step 1: Write NameHint and PracticeControls RED tests**

Assert one `.name-hint__word` per space-separated word, one continuous line element per word, a CSS `--hint-length` equal to character count, hidden positions with no visible punctuation, revealed positions at exact indexes, and an accessible label such as `Card name hint: A blank blank blank blank; B blank blank blank`. For Practice controls assert toggle enabled only when `settingsEditable`, `End game` appears only for nonterminal Practice, terminal state shows `New Practice Round`, terminal toggle changes only the callback choice, and `disabled` blocks forfeit during reveal/drag.

- [ ] **Step 2: Run component RED**

Run:

```powershell
npm exec vitest run tests/client/NameHint.test.tsx tests/client/PracticeControls.test.tsx
```

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement proportional NameHint and Practice controls**

Render each word as one positioned box with a continuous `border-bottom`; place every character in an equal-width CSS grid cell above it and render hidden cells as an empty `aria-hidden` span. Use `--hint-length` only to compute proportional minimum width, not separate underscore glyphs. Render the Hardcore checkbox and End game button adjacent inside `.practice-controls`; use explicit lock help text after the first accepted guess/orb. Terminal controls pass the chosen setting to the next-round callback without mutating the completed answer panel.

- [ ] **Step 4: Write share RED tests**

Add exact output assertions:

```ts
expect(formatDailyShare({ utcDate, guesses, siteUrl, hardcore: false, orbUsage: {
  reveal: false, filter: true, negation: false,
}})).toBe([
  `STS-dle ${utcDate} 2/∞`,
  firstGuessRow,
  secondGuessRow,
  "Orbs: 🟣 ⚫ 🔴",
  "https://example.test/",
].join("\n"));

expect(formatDailyShare({ utcDate, guesses, siteUrl, hardcore: true })).toBe([
  `STS-dle Hardcore ${utcDate} 2/∞`,
  firstGuessRow,
  secondGuessRow,
  "https://example.test/",
].join("\n"));
```

Assert chronological guess symbols remain ten columns and neither output includes card names, target features, target card IDs, or revealed letters.

- [ ] **Step 5: Run share RED and implement secret-safe output**

Run:

```powershell
npm exec vitest run tests/shared/share.test.ts tests/client/SharePanel.test.tsx
```

Expected: FAIL because Hardcore and orb usage options are missing.

Implement the exact title/line rules. Require all three normal orb usage booleans; throw a fixed sanitized error if normal Daily calls omit them. Keep Practice outside `formatDailyShare` and render no copy control.

- [ ] **Step 6: Write App/guide RED tests for modes, hints, and terminal Practice**

Mock `useGame` with each mode and assert three top tabs named `Daily`, `Hardcore Daily`, and `Practice`. Assert normal rounds pass the derived NameHint after five wrong accepted guesses; Hardcore passes neither hint nor assistance slots. Assert win/forfeit reveals accepted answers, Daily/Hardcore use the correct share options, and Practice renders the controls. Extend guide tests to require exact concepts: one-use permanent orb consumption, drag plus click/tap/keyboard, Reveal headers/full pair, Filter green exact pair, Negation red exclusion/red priority, advisory candidate controls, empty-focus list, 5/7/progressive name schedule, separate Hardcore Daily, Practice lock/persistence/forfeit/new round.

- [ ] **Step 7: Run App/guide RED**

Run:

```powershell
npm exec vitest run tests/client/app.test.tsx tests/client/GameGuide.test.tsx tests/client/SharePanel.test.tsx
```

Expected: FAIL because App has two modes and does not render the new hint/control/share behavior.

- [ ] **Step 8: Implement the three-mode shell and documentation**

Update `GameShell` to render the three top-level buttons and pass mode changes to `useGame`. Calculate wrong guesses as submitted cards not in `answer.acceptedCardIds`; derive hints only when `!round.hardcore`. Keep the search area order via Task 3 slots. Update SharePanel for won Daily/Hardcore and won/forfeited Practice. Extend README's gameplay section with the three modes, local-only browser persistence, no account/database, and Practice End game behavior. Do not add deployment or server state.

- [ ] **Step 9: Run Task 4 verification**

Run:

```powershell
npm exec vitest run tests/client/NameHint.test.tsx tests/client/PracticeControls.test.tsx tests/client/app.test.tsx tests/client/GameGuide.test.tsx tests/client/SharePanel.test.tsx tests/shared/share.test.ts
npm run typecheck
git diff --check
```

Expected: all focused tests PASS and no type/whitespace errors.

- [ ] **Step 10: Review and commit Task 4**

Verify the hint name cannot affect `answer.acceptedCardIds`, Practice has no share, Hardcore has no orb line, and the normal Daily stats/share title remains intact. Then run:

```powershell
git add src/client/components/NameHint.tsx src/client/components/PracticeControls.tsx src/shared/share.ts src/client/components/SharePanel.tsx src/client/components/GameGuide.tsx src/client/App.tsx src/client/styles/shell.css src/client/styles/search.css README.md tests/client/NameHint.test.tsx tests/client/PracticeControls.test.tsx tests/shared/share.test.ts tests/client/SharePanel.test.tsx tests/client/GameGuide.test.tsx tests/client/app.test.tsx
git commit -m "feat: add hardcore and progressive hints"
```

---

### Task 5: Accessible Orb Tray and Transient Interaction Engine

**Files:**
- Create: `src/client/components/OrbInteractionContext.tsx`
- Create: `src/client/components/OrbVisual.tsx`
- Create: `src/client/components/OrbTray.tsx`
- Create: `src/client/styles/assistance.css`
- Create: `tests/client/OrbInteractionContext.test.tsx`
- Create: `tests/client/OrbTray.test.tsx`
- Modify: `src/client/main.tsx`

**Interfaces:**
- Consumes: `OrbKind`, `AssistanceState`, `FeatureName`, `TileColor`, `ConstraintOrbTarget`.
- Produces:

```ts
export type OrbTargetDescriptor =
  | { kind: "header"; feature: FeatureName }
  | { kind: "tile"; guessIndex: number; cardId: string; feature: FeatureName; color: TileColor; revealed: boolean };

export interface OrbUseResult {
  accepted: boolean;
  announcement: string;
}

export interface OrbInteractionProviderProps {
  roundKey: string | number;
  assistance: AssistanceState | null;
  disabled: boolean;
  onUse(orb: OrbKind, target: OrbTargetDescriptor): OrbUseResult;
  hitTest?: (x: number, y: number) => readonly Element[];
  children: React.ReactNode;
}

export interface OrbTargetBinding {
  active: boolean;
  valid: boolean;
  selectedOrb: OrbKind | null;
  targetProps: {
    "data-orb-target": string;
    tabIndex?: number;
    role?: "button";
    "aria-label"?: string;
    onClick?: React.MouseEventHandler;
    onKeyDown?: React.KeyboardEventHandler;
  };
}

export function useOrbInteraction(): {
  selectedOrb: OrbKind | null;
  draggingOrb: OrbKind | null;
  poof: { orb: OrbKind; x: number; y: number; id: number } | null;
  announcement: string;
  getOrbButtonProps(orb: OrbKind, available: boolean): React.ButtonHTMLAttributes<HTMLButtonElement>;
  bindTarget(target: OrbTargetDescriptor, validFor: readonly OrbKind[], label: string): OrbTargetBinding;
};

export interface OrbVisualProps { kind: OrbKind; compact?: boolean }
export interface OrbTrayProps { assistance: AssistanceState; disabled: boolean }
```

- `hitTest` defaults to `document.elementsFromPoint`. Tests inject it; production code does not query DOM by text.
- Pointer drag starts after six CSS pixels of movement. Pointer-up without reaching the threshold acts as select/cancel click behavior.

- [ ] **Step 1: Write OrbVisual/OrbTray RED tests**

Assert exactly three slots in Reveal, Filter, Negation order; each available button has a 44px-or-larger hit target, `aria-label="Reveal Orb, available"`, and `aria-pressed=false`; consumed slots render a grayscale compact remnant with `aria-label="Reveal Orb, used"` and no button. Assert provider-disabled buttons are disabled and a selected button sets `aria-pressed=true` plus `.orb-button--selected`. Inspect SVGs for local `data-orb-kind`, visible motif elements, and no `<image>`, external href, or package icon component.

- [ ] **Step 2: Run tray RED**

Run:

```powershell
npm exec vitest run tests/client/OrbTray.test.tsx
```

Expected: FAIL because orb components do not exist.

- [ ] **Step 3: Implement original SVG orbs and fixed tray**

Create one SVG viewBox per orb with shared spherical gradients and distinct motifs: Reveal eye/star, Filter funnel/check scan, Negation barred X/ember. Add `data-icon` only to internal shapes needed for tests. Render 48px slots and 52px orb visuals using CSS, label each slot visibly, and keep the oversize within the tray. Do not fetch assets or add dependencies.

- [ ] **Step 4: Write interaction-engine RED tests**

Use a harness with one valid header, green tile, red tile, yellow tile, and empty space. Cover:

```tsx
await user.click(screen.getByRole("button", { name: "Reveal Orb, available" }));
expect(button).toHaveAttribute("aria-pressed", "true");
await user.click(validHeader);
expect(onUse).toHaveBeenCalledTimes(1);

fireEvent.pointerDown(filterButton, { pointerId: 4, clientX: 10, clientY: 10 });
fireEvent.pointerMove(filterButton, { pointerId: 4, clientX: 30, clientY: 30 });
fireEvent.pointerUp(filterButton, { pointerId: 4, clientX: 80, clientY: 80 });
expect(onUse).toHaveBeenCalledWith("filter", greenDescriptor);
```

Assert tray slot looks empty during drag, avatar follows pointer, valid target highlights, Escape/pointercancel/lost capture/invalid release restore availability, invalid click leaves selected, activating selected orb cancels, duplicate pointer-up calls settle once, successful use creates then clears one poof, announcement text is present in an `aria-live` region, roundKey change/unmount clears selection/drag/poof, and disabled transition cancels pending drag. Keyboard Enter/Space on selected valid targets must consume; invalid yellow target must announce and remain selected.

- [ ] **Step 5: Run interaction RED**

Run:

```powershell
npm exec vitest run tests/client/OrbInteractionContext.test.tsx
```

Expected: FAIL because selection, drag, targets, poof, and announcements are absent.

- [ ] **Step 6: Implement pointer/click/keyboard interaction with single settlement**

Keep ephemeral state inside the provider:

```ts
interface DragState {
  orb: OrbKind;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  settled: boolean;
}
```

Call `setPointerCapture` after pointer down when available, promote to dragging after Euclidean distance reaches 6px, and use `hitTest(x, y)` to find the nearest element with `data-orb-target`. Store descriptors in a provider registry keyed by opaque generated target IDs; never JSON-parse attacker-controlled DOM attributes. All exit paths call one guarded settle function. A successful `onUse` clears selection and emits poof; rejection restores/retains selection and announces. Escape cancels via a document key listener cleaned on round change/unmount.

- [ ] **Step 7: Add type-specific VFX and reduced-motion behavior**

In `assistance.css`, add namespaced keyframes for Reveal twinkle/glitter, Filter scan/rings/motes, Negation ember/sparks/smoke, and matched poof classes. Drag avatar uses `position: fixed; pointer-events: none; z-index` above the candidate list. In:

```css
@media (prefers-reduced-motion: reduce) {
  .orb-visual, .orb-vfx *, .orb-poof * { animation: none !important; transition-duration: 0s !important; }
  .orb-poof { opacity: 0; }
}
```

retain static color/glow and all text/borders. Import the stylesheet once from `src/client/main.tsx` after existing component styles and before `global.css`.

- [ ] **Step 8: Run Task 5 verification**

Run:

```powershell
npm exec vitest run tests/client/OrbTray.test.tsx tests/client/OrbInteractionContext.test.tsx
npm run typecheck
git diff --check
```

Expected: focused tests PASS and no type/whitespace errors.

- [ ] **Step 9: Review and commit Task 5**

Review pointer cleanup, idempotence, target registry lifetime, absence of remote assets, and reduced-motion semantics. Then run:

```powershell
git add src/client/components/OrbInteractionContext.tsx src/client/components/OrbVisual.tsx src/client/components/OrbTray.tsx src/client/styles/assistance.css src/client/main.tsx tests/client/OrbInteractionContext.test.tsx tests/client/OrbTray.test.tsx
git commit -m "feat: add interactive orb tray"
```

---

### Task 6: Grid Targets, Persistent Orb Results, and Complete App Wiring

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `src/client/components/GuessGrid.tsx`
- Modify: `src/client/components/FeatureTile.tsx`
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `src/client/styles/grid.css`
- Modify: `src/client/styles/search.css`
- Modify: `src/client/styles/assistance.css`
- Modify: `tests/client/app.test.tsx`
- Modify: `tests/client/CardSearch.test.tsx`
- Modify: `tests/client/GuessGrid.test.tsx`
- Modify: `tests/client/GuessGrid.stale.test.tsx`
- Modify: `tests/client/FeatureTile.test.tsx`
- Modify: `tests/client/GameGuide.test.tsx`

**Interfaces:**
- Consumes: every Task 1-5 interface.
- Produces:

```ts
export interface GuessGridProps {
  guesses: readonly SubmittedGuess[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  selectedAnswer: CardIdentity;
  assistance: AssistanceState | null;
  spriteMap: SpriteMap;
  roundKey: string | number;
  animateFromIndex: number;
  onRevealComplete?: () => void;
}

export interface FeatureTileProps {
  result: FeatureResult;
  cardId: string;
  chronologicalGuessIndex: number;
  revealIndex: number;
  animate?: boolean;
  orbBadge?: "filter" | "negation";
  onRevealEnd?: (event: React.TransitionEvent<HTMLDivElement>) => void;
}
```

- Column headers register Reveal targets and render the selected answer's full paired value through `formatFeatureValue`; keyword bubbles use `KeywordStateIcons` plus absent/present accessible wording.
- Tiles register Filter only for fully revealed green and Negation only for fully revealed red. Yellow registers neither.

- [ ] **Step 1: Write grid/FeatureTile RED tests**

Select Reveal in the provider harness and activate each of the ten feature headers; assert Card/artwork is not a target and only the chosen feature dispatches. After durable Reveal state rerender, assert one persistent bubble uses the selected answer pair and keyword icons in correct X/check direction. For settled guesses, assert green exposes a Filter target, red exposes Negation, yellow exposes neither, and animating tiles are not operable. After durable Filter/Negation state rerender, assert compact accessible badges appear only on the exact chronological guess/card/feature target even though newest rows render first.

- [ ] **Step 2: Run grid RED**

Run:

```powershell
npm exec vitest run tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx
```

Expected: FAIL because headers/tiles do not bind orb targets or render durable badges/bubbles.

- [ ] **Step 3: Implement explicit grid targets without disturbing reveal completion**

Add a small internal `FeatureHeader` component that calls `bindTarget({kind:"header", feature}, ["reveal"], ...)`. Compute the bubble from `selectedAnswer.base[feature]` and `selectedAnswer.upgraded[feature]`. Pass chronological indexes into FeatureTile and bind a descriptor containing result color and `revealed = !animate || local revealed state`. Preserve table semantics: keep the outer elements as `columnheader`/`cell`, and mount the returned operable target props on an absolute nested button only while a selected orb can use that target. Keep the final transform transition controller, fallback timeout, target/property filters, and once guard unchanged. Persistent badge matching must compare all three stable fields.

- [ ] **Step 4: Write full App integration RED tests**

Render a normal round and assert the exact assistance order under the input: tray, visibility controls, Name Hint. Exercise click Reveal to header, Filter to green tile, Negation to red tile, and verify semantic useGame callbacks. Assert invalid target callbacks leave orb available and show the fixed live message. Rerender with durable targets and verify bubble/badges/candidate colors. Create a candidate matching both rules and assert red class. Assert search and all orbs disable while the newest row reveals and re-enable once; win/forfeit omit interaction. Rerender Hardcore and assert no tray, controls, hint, orb targets, or orb share line.

- [ ] **Step 5: Run App RED**

Run:

```powershell
npm exec vitest run tests/client/app.test.tsx tests/client/CardSearch.test.tsx
```

Expected: FAIL because the provider/tray/grid/search are not wired together.

- [ ] **Step 6: Wire RoundGame through one interaction provider**

Key `OrbInteractionProvider` by `round.roundId` and pass `disabled={isRevealing || round.status !== "playing"}`. Implement `onUse` as a total switch:

```ts
switch (orb) {
  case "reveal":
    if (target.kind !== "header") return rejected("Reveal Orb can only be used on a feature heading.");
    game.consumeReveal({ feature: target.feature });
    return accepted(`Reveal Orb showed ${FEATURE_LABELS[target.feature]}.`);
  case "filter":
    if (target.kind !== "tile" || target.color !== "green" || !target.revealed) return rejected("Filter Orb requires a revealed green feature tile.");
    game.consumeFilter({ guessIndex: target.guessIndex, cardId: target.cardId, feature: target.feature });
    return accepted(`Filter Orb now marks candidates matching ${FEATURE_LABELS[target.feature]}.`);
  case "negation":
    if (target.kind !== "tile" || target.color !== "red" || !target.revealed) return rejected("Negation Orb requires a revealed red feature tile.");
    game.consumeNegation({ guessIndex: target.guessIndex, cardId: target.cardId, feature: target.feature });
    return accepted(`Negation Orb now marks candidates excluded by ${FEATURE_LABELS[target.feature]}.`);
}
```

The reducer remains the final idempotent validator. Put `OrbTray` in CardSearch's assistance slot, visibility fields below it, and `NameHint` below visibility. Disable `End game` when the provider reports an active drag or a tile reveal is pending. Clear transient provider state automatically on round key/mode/terminal change.

- [ ] **Step 7: Complete target/bubble/badge layout and guide wording**

Position bubbles above headers without changing grid column widths; allow the grid scroller to own horizontal overflow. Give active valid targets a non-color outline and cursor; invalid selected-orb targets retain normal cursor. Keep compact badges within tile bounds and out of the value's reading order. Update guide text to state that badges persist, red has priority, colored candidates remain guessable, and category checkboxes only hide list rows.

- [ ] **Step 8: Run Task 6 verification**

Run:

```powershell
npm exec vitest run tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/CardSearch.test.tsx tests/client/app.test.tsx tests/client/GameGuide.test.tsx
npm run typecheck
npm test
git diff --check
```

Expected: focused tests, full unit suite, typecheck, and diff check all PASS.

- [ ] **Step 9: Review and commit Task 6**

Review that presentation never mutates constraints, fully revealed gating is real, newest-first DOM does not corrupt chronological target identity, and transient state clears on every boundary. Then run:

```powershell
git add src/client/App.tsx src/client/components/CardSearch.tsx src/client/components/GuessGrid.tsx src/client/components/FeatureTile.tsx src/client/components/GameGuide.tsx src/client/styles/grid.css src/client/styles/search.css src/client/styles/assistance.css tests/client/app.test.tsx tests/client/CardSearch.test.tsx tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/FeatureTile.test.tsx tests/client/GameGuide.test.tsx
git commit -m "feat: connect orbs to card deductions"
```

---

### Task 7: Offline Browser Acceptance, Review, Runtime Handoff, and Direct Publication

**Files:**
- Modify: `tests/e2e/fixtures/build-test-snapshot.ts`
- Modify: `tests/e2e/game.spec.ts`
- Modify: `README.md` only if the final browser workflow exposes a command or copy mismatch not already documented in Task 4
- Create: `.superpowers/sdd/2026-08-13-orbs-hardcore-name-hints/task-7-report.md` (ignored verification report; do not include it in the scoped test commit)

**Interfaces:**
- Consumes: the complete implemented application, existing offline official-origin guard, fixture SnapshotStore builder, Playwright config, current validated production snapshot path in `.tmp/live-data-path.txt`, and SSH `origin`.
- Produces: deterministic offline acceptance for all new behavior, a clean reviewed `master`, a healthy local site on ports 3000/5173, and a successful direct push to `origin/main`.

- [ ] **Step 1: Extend the deterministic fixture model before editing the browser assertions**

Keep the existing seven source fixtures and paired copies, which provide fourteen guessable IDs and at least twelve wrong candidates after a two-card accepted pair is selected. Change `loadFixtureModel` to select both answers explicitly:

```ts
const normalSource = await createDailyRandom(FIXED_UTC_DATE, manifest.sourceRevision, "daily");
const hardcoreSource = await createDailyRandom(FIXED_UTC_DATE, manifest.sourceRevision, "hardcore-daily");
const dailyAnswer = selectAnswer(groups, cardsById, normalSource);
const hardcoreAnswer = selectAnswer(groups, cardsById, hardcoreSource);
if (dailyAnswer.selectedCardId === hardcoreAnswer.selectedCardId) {
  throw new Error("Fixture namespaces must select distinct Daily answers");
}
```

Derive wrong candidates by excluding both normal accepted IDs and select exact fixture cards that supply a green target, red target, a candidate matching both constraints, and at least eight accepted wrong submissions. Fail the fixture helper with fixed messages if those invariants are not met; never hard-code expected tile color without validating through `compareGuess`.

- [ ] **Step 2: Write the offline Playwright RED scenarios**

Add focused scenarios that fail against the pre-Task-7 browser suite unless all new behavior is exercised:

1. Normal Daily: both atlases finish before interaction; focused empty search lists all candidates alphabetically; drag Reveal to a header; select Filter then keyboard-activate green; click-select Negation then red; assert bubble/badges/poofs/live status; assert red priority and all three visibility checkboxes; reload and confirm durable targets/visibility/guesses.
2. Name hints: submit five wrong guesses and assert continuous word lines; six has same mask; seven reveals first word initial; continue through another word initial and one deterministic post-initial position; reload and assert identical mask; win using an equivalent answer whose name differs.
3. Hardcore Daily: separate selected answer and storage key; no orbs/visibility/name hint at eight wrong guesses; share title starts `STS-dle Hardcore`; no `Orbs:` line; normal Daily progress remains intact after switching back.
4. Practice: toggle Hardcore before start, submit a guess and assert toggle locked; end game and see accepted answers; choose normal for next round, start it, consume an orb, assert toggle locks; reload and confirm same Practice round; New Practice Round replaces it.
5. Accessibility/motion: select and consume without pointer drag using keyboard, inspect `aria-pressed`, accessible classification/status/badge labels, emulate reduced motion and assert no running orb/poof animation.
6. Viewports: at 390, 768, and 1440, assert document width is contained, the grid alone owns horizontal overflow when needed, tray/controls/hint remain inside shell, and candidate list remains bounded.

Retain the existing dual official-origin abort probe and require zero ordinary requests to both `https://spire-codex.com` and `https://cdn.spire-codex.com`.

- [ ] **Step 3: Run browser RED**

First ensure no old local site owns the Playwright port. Run:

```powershell
npm run test:e2e
```

Expected: FAIL on the newly added behavior assertions before any E2E-only support adjustments.

- [ ] **Step 4: Make only deterministic fixture/test-harness corrections needed for GREEN**

If the two SHA-256 namespaces happen to select the same fixture card, reorder the existing fixture `baseGroups` deterministically in the E2E builder or add one explicit E2E-only seed card with canonical raw Spire fields; do not special-case production selection. Use Playwright Pointer Events coordinates from real bounding boxes for drag. Use exact persisted storage keys and inspect only usage booleans, never answer names in share output. Keep the Date-only fixed UTC harness so ResourceTiming remains available for sprite preload assertions.

- [ ] **Step 5: Run the complete supported-Node gate in exact order**

Resolve the bundled runtime with `codex_app__load_workspace_dependencies`, prepend its Node directory to the process `Path`, and verify `node --version` is supported. Then run serially:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: every command exits 0; Playwright passes every functional and viewport scenario; only documented dependency warnings may appear.

- [ ] **Step 6: Perform security, persistence, and whole-diff review**

Inspect `git diff 192280553d8794851a9d1e43477d6b8e8c03c681..HEAD` plus the Task 7 working diff. Confirm:

- no server-side user state, new network destination, dependency, or remote SVG asset;
- storage cleanup matches only owned exact keys/prefixes and catches quota/security errors;
- persisted targets are stable IDs and fail closed on revision/card/result mismatch;
- share strings contain no card names, target features/IDs, hint masks, or answer secrets;
- all transient listeners, pointer capture, timers, animation callbacks, and poof cleanup settle on round/unmount;
- Hardcore answer/progress/streak domains remain separate;
- candidate hiding never affects answer selection or guess submission;
- all ten features remain in comparison/share order and accepted-answer equivalence remains unchanged.

Request a read-only code review using `superpowers:requesting-code-review`. Fix every Critical/Important finding with a new RED test and rerun the full gate before continuing.

- [ ] **Step 7: Commit the E2E acceptance changes**

Stage only the fixture/spec and any verified README correction:

```powershell
git add tests/e2e/fixtures/build-test-snapshot.ts tests/e2e/game.spec.ts README.md
git commit -m "test: verify orb-assisted game modes"
```

If README did not change in this task, omit it from `git add`. Confirm the commit has no `Co-Authored-By` trailer.

- [ ] **Step 8: Validate or reuse the production snapshot and start the final local site**

Because this plan changes no production snapshot/data code, read `.tmp/live-data-path.txt`, require the directory and active manifest to exist, and run the existing strict snapshot validator before reuse. Start `dist/server/main.js` on `127.0.0.1:3000` with `STSDLE_SKIP_SYNC=1` and that exact data root using bundled Node 24. Start Vite on `localhost:5173` using bundled Node 24. Record owned launcher/listener PIDs in `.tmp/live-backend.pid` and `.tmp/dev-site.pid`; hide process windows. Do not stop unrelated processes.

- [ ] **Step 9: Run final local browser smoke**

Use the in-app browser workflow against `http://localhost:5173/`. Verify normal Daily empty-focus search, one Reveal and one constraint orb interaction, candidate toggles, refresh persistence, name hint at five wrong guesses, normal orb usage share, separate Hardcore answer/no assistance/Hardcore share, Practice toggle/forfeit/new round, and 390/768/1440 containment. Confirm `/`, `/health`, `/runtime/cards.json`, `/runtime/candidate.webp`, and `/runtime/guess.webp` return 200 through both 3000 and 5173; card count/revision/generatedAt match disk. Confirm final frontend/backend stderr files are empty and CIM command lines point to this repository with bundled Node 24.

- [ ] **Step 10: Write the verification report and check repository state**

Record commit SHAs, exact gate counts, E2E scenarios, snapshot identity, endpoint results, browser observations, PIDs/ports/command lines, and stderr sizes in `.superpowers/sdd/2026-08-13-orbs-hardcore-name-hints/task-7-report.md`. Then run:

```powershell
git status --short
git log --format=fuller -8
git remote get-url origin
git diff --check origin/main..HEAD
```

Expected: tracked worktree clean, no co-author trailers, remote exactly `git@github.com:Akirakato1/sts2dle.git`, and only intentional feature commits ahead of `origin/main`.

- [ ] **Step 11: Push final verified master directly to remote main**

Run:

```powershell
git push origin master:main
```

Expected: SSH push succeeds and reports the final local master commit on `origin/main`. Verify with:

```powershell
git fetch origin main
git rev-parse master
git rev-parse origin/main
```

Both SHAs must be identical. Do not create a branch or pull request.

- [ ] **Step 12: Final handoff**

Report the final pushed SHA, full verification results, local URLs, running owned PIDs, local-only persistence behavior, and any non-blocking documented warnings. Include Git push/commit directives only after those operations actually succeeded.
