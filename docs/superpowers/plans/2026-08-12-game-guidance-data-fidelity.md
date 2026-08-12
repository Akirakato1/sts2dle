# Game Guidance and Data Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible game rules and color meanings, use Spire Codex's canonical type/rarity values, preload both sprite atlases before gameplay, show keyword existence with SVG icons, and render newest guesses first.

**Architecture:** Keep canonical source domains in the shared model so source parsing, normalization, client parsing, validation, grouping, and persistence agree. Make atlas readiness an explicit asynchronous boundary in `loadSnapshot`, keep game guidance and keyword icons in focused presentation components, and reverse only the `GuessGrid` view while preserving chronological reducer/storage/share data.

**Tech Stack:** TypeScript, React 19, Zod 4, Fastify 5, Vitest 3, Testing Library, Playwright, Sharp, PowerShell, Node.js 22.12 or newer.

## Global Constraints

- Keep `FEATURE_ORDER` at exactly ten entries: Class, Type, Mana, Rarity, Eternal, Ethereal, Exhaust, Innate, Retain, and Sly.
- Use Spire Codex `type_key` and `rarity_key` directly; unknown or missing values fail closed.
- Preserve the seven player-facing classes by mapping Codex structural `color` identifiers as specified in the design.
- Rarity has no `None` fallback; Falling Star is `Basic`.
- Keyword state uses decorative inline SVG X/checkmark icons; tile color remains the independent correctness result.
- Both local sprite atlases must load and decode before the game becomes interactive.
- Store guesses and share rows chronologically; reverse only the visible guess-row order.
- Preserve Daily statistics under `stsdle:stats:v1`, but advance the Daily round ruleset/version for the corrected feature domain.
- Do not add an icon dependency, mana direction hints, correctness marks, full-card preloading, or a feature-group migration pass.
- Use bundled/supported Node for every verification command and do not restart the local trial site until the final acceptance task.
- Do not add `Co-Authored-By` trailers.

---

## File Structure

- `src/shared/domain.ts`: owns the canonical public card-type and rarity tuples/types.
- `src/server/spire-codex/schema.ts`: strictly admits Codex `type_key` and `rarity_key` values.
- `src/server/sync/normalize-card.ts`: maps class color only and passes canonical type/rarity through.
- `src/shared/snapshot-schema.ts` and `src/server/sync/validate-snapshot.ts`: enforce the same public domains at client/server activation boundaries.
- `src/client/game/storage.ts`: advances the Daily round identity/version without changing stats storage.
- `src/client/api/preload-sprite-atlases.ts`: owns abortable load/decode readiness for the two atlases.
- `src/client/api/load-snapshot.ts`: awaits strict runtime parsing, cross-reference checks, then atlas readiness.
- `src/client/components/GameGuide.tsx`: owns the visible color legend and native rules disclosure.
- `src/client/components/KeywordStateIcons.tsx`: owns decorative SVG keyword-state rendering and no accessibility text.
- `src/client/components/FeatureTile.tsx`: selects text vs keyword-icon presentation while retaining explicit labels.
- `src/client/components/GuessGrid.tsx`: derives newest-first render rows with original chronological indices.
- `tests/fixtures/spire-cards.json`: provides canonical source keys including Falling Star/Basic for integration snapshots.
- Unit and browser files under `tests/`: prove each boundary and the complete offline experience.

---

### Task 1: Canonical Spire Codex Type and Rarity Domains

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/snapshot-schema.ts`
- Modify: `src/server/spire-codex/schema.ts`
- Modify: `src/server/sync/normalize-card.ts`
- Modify: `src/server/sync/validate-snapshot.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `tests/fixtures/spire-cards.json`
- Test: `tests/shared/domain.test.ts`
- Test: `tests/server/spire-codex-client.test.ts`
- Test: `tests/server/normalize-card.test.ts`
- Test: `tests/server/validate-snapshot.test.ts`
- Test: `tests/client/load-snapshot.test.ts`
- Test: `tests/client/storage.test.ts`

**Interfaces:**
- Produces: `CARD_TYPES`, `CardType`, `CARD_RARITIES`, and `CardRarity` from `src/shared/domain.ts`.
- Produces: `RawSpireCard.type_key: CardType` and `RawSpireCard.rarity_key: CardRarity` after Zod parsing.
- Produces: Daily ruleset `v3` and stored Daily round `version: 3`; `DAILY_STATS_KEY` remains unchanged.
- Consumes: existing `FeatureVector`, normal feature-key/group generation, and structural Codex `color` mapping.

- [ ] **Step 1: Write failing domain/source/normalization tests**

Add literal expectations that fail against the collapsed domain:

```ts
expect(CARD_TYPES).toEqual(["Attack", "Skill", "Power", "Quest", "Status", "Curse"]);
expect(CARD_RARITIES).toEqual([
  "Ancient", "Basic", "Common", "Curse", "Event",
  "Quest", "Rare", "Status", "Token", "Uncommon",
]);

const fallingStar = rawCard({
  id: "FALLING_STAR",
  name: "Falling Star",
  color: "regent",
  type: "Attack",
  type_key: "Attack",
  rarity: "Basic",
  rarity_key: "Basic",
});
expect(normalizeCard(fallingStar, BASE_URL).base).toMatchObject({
  cardClass: "Regent",
  cardType: "Attack",
  rarity: "Basic",
});
```

In `spire-codex-client.test.ts`, mutate otherwise-valid responses to omit `type_key`/`rarity_key` and to use `FutureType`/`FutureRarity`; require the client to reject with the fixed invalid-response error. In `normalize-card.test.ts`, cover all ten rarity keys and all six type keys as literal table rows.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```powershell
npm exec vitest run tests/shared/domain.test.ts tests/server/spire-codex-client.test.ts tests/server/normalize-card.test.ts
```

Expected: FAIL because the tuples and raw canonical fields do not exist and Falling Star becomes `None`.

- [ ] **Step 3: Define shared canonical tuples and strict raw fields**

In `src/shared/domain.ts`, replace the hand-written type union and collapsed rarity union:

```ts
export const CARD_TYPES = ["Attack", "Skill", "Power", "Quest", "Status", "Curse"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_RARITIES = [
  "Ancient", "Basic", "Common", "Curse", "Event",
  "Quest", "Rare", "Status", "Token", "Uncommon",
] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];
```

In `src/server/spire-codex/schema.ts`, import the tuples and require canonical keys:

```ts
type_key: z.enum(CARD_TYPES),
rarity_key: z.enum(CARD_RARITIES),
```

Keep localized/source display `type` and nullable `rarity` fields for the renderer, but do not use them for feature construction.

- [ ] **Step 4: Pass canonical values through normalization and validation**

In `buildFeatures`, replace independent type/rarity normalization:

```ts
return {
  cardClass: normalizeClass(raw.color),
  cardType: raw.type_key,
  mana,
  rarity: raw.rarity_key,
  ...flags,
};
```

Delete `normalizeType` and `normalizeRarity`. In client Zod and server validation, derive accepted values from `CARD_TYPES` and `CARD_RARITIES`; numeric mana constraints and exact feature-key enforcement remain unchanged.

- [ ] **Step 5: Update fixtures and Daily version tests**

Add `type_key` and `rarity_key` to every raw fixture. Add a minimal `FALLING_STAR` fixture with `type_key: "Attack"`, `rarity_key: "Basic"`, Regent color, cost `0`, star cost `2`, and its numeric damage upgrade.

In storage, change:

```ts
export const DAILY_RULESET_VERSION = "v3";
interface StoredDailyRound { version: 3; /* unchanged fields */ }
```

Update writer/parser literal checks to `3`. Extend storage tests so v2 rows are removed before restoration/streak processing while `stsdle:stats:v1` still round-trips.

- [ ] **Step 6: Verify strict snapshot behavior and GREEN**

Run:

```powershell
npm exec vitest run tests/shared/domain.test.ts tests/server/spire-codex-client.test.ts tests/server/normalize-card.test.ts tests/server/validate-snapshot.test.ts tests/client/load-snapshot.test.ts tests/client/storage.test.ts
npm run typecheck
```

Expected: all focused tests PASS; no `CardRarity` assignment contains `None`; Falling Star is `Basic`; unknown values are rejected.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/shared/domain.ts src/shared/snapshot-schema.ts src/server/spire-codex/schema.ts src/server/sync/normalize-card.ts src/server/sync/validate-snapshot.ts src/client/game/storage.ts tests/fixtures/spire-cards.json tests/shared/domain.test.ts tests/server/spire-codex-client.test.ts tests/server/normalize-card.test.ts tests/server/validate-snapshot.test.ts tests/client/load-snapshot.test.ts tests/client/storage.test.ts
git commit -m "fix: preserve Spire Codex feature values"
```

---

### Task 2: Block Gameplay Until Both Sprite Atlases Are Decoded

**Files:**
- Create: `src/client/api/preload-sprite-atlases.ts`
- Modify: `src/client/api/load-snapshot.ts`
- Create: `tests/client/preload-sprite-atlases.test.ts`
- Modify: `tests/client/load-snapshot.test.ts`
- Modify: `tests/client/app.test.tsx`

**Interfaces:**
- Produces: `preloadSpriteAtlases(spriteMap: SpriteMap, signal?: AbortSignal): Promise<void>`.
- Produces: `loadSnapshot(fetchImpl?, signal?, preloadImpl?)`, where `preloadImpl` defaults to `preloadSpriteAtlases` and is injectable only for deterministic unit testing.
- Consumes: strict `SpriteMap` from Task 1/client schema and the existing App loading/retry lifecycle.

- [ ] **Step 1: Write deterministic preload RED tests**

Use a small fake `Image` class that records assigned `src`, exposes `load`/`error` dispatch, and supplies controlled `decode()` promises. Assert literal behavior:

```ts
const loading = preloadSpriteAtlases(spriteMap, controller.signal, () => images.shift()!);
expect(created.map((image) => image.src)).toEqual(["/candidate.webp", "/guess.webp"]);
expectSettled(loading, false);
candidate.resolveLoad(); candidate.resolveDecode();
expectSettled(loading, false);
guess.resolveLoad(); guess.resolveDecode();
await expect(loading).resolves.toBeUndefined();
```

Add separate tests for duplicate URLs (one image), load failure, decode failure, no-`decode` success, already-aborted signal, mid-load abort clearing `src`, listener cleanup, and fixed messages containing neither atlas URL.

- [ ] **Step 2: Run preload test to verify RED**

Run:

```powershell
npm exec vitest run tests/client/preload-sprite-atlases.test.ts
```

Expected: FAIL because the module/function does not exist.

- [ ] **Step 3: Implement one abortable image readiness operation**

Create a focused helper with a test-only factory parameter:

```ts
export type SpriteImageFactory = () => HTMLImageElement;

export async function preloadSpriteAtlases(
  spriteMap: SpriteMap,
  signal?: AbortSignal,
  createImage: SpriteImageFactory = () => new Image(),
): Promise<void> {
  const urls = [...new Set([spriteMap.candidate.url, spriteMap.guess.url])];
  await Promise.all(urls.map((url) => preloadOne(url, signal, createImage)));
}
```

`preloadOne` must attach `load`, `error`, and abort handlers before assigning `src`; await `decode()` after load when available; settle once; remove every listener in one cleanup function; clear `src` on abort; reject aborts with `new DOMException("Sprite preload aborted", "AbortError")`; and replace image/decode errors with `new Error("Unable to prepare card artwork")` without a `cause` or URL.

- [ ] **Step 4: Write `loadSnapshot` RED integration tests**

Inject a controlled `preloadImpl`. Require that it receives the parsed sprite map and original signal, starts only after JSON/schema/cross-reference validation, prevents `loadSnapshot` from resolving until released, and is never called for invalid snapshot JSON.

- [ ] **Step 5: Await readiness at the snapshot boundary**

Update the signature and final return path:

```ts
export type SpriteAtlasPreloader = (spriteMap: SpriteMap, signal?: AbortSignal) => Promise<void>;

export async function loadSnapshot(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  preloadImpl: SpriteAtlasPreloader = preloadSpriteAtlases,
): Promise<LoadedSnapshot> {
  // existing fetch, strict parse, counts, and reference checks
  await preloadImpl(spriteMap, signal);
  return { manifest, cards, baseGroups, pairGroups, spriteMap, cardsById, pairGroupsByKey };
}
```

Existing load-snapshot unit calls should pass an explicit resolved no-op preloader except the integration tests that exercise this boundary. App uses the production default.

- [ ] **Step 6: Verify App cleanup and retry behavior**

Extend `app.test.tsx` so a pending preload keeps `Loading card data…` visible, preload failure shows the existing sanitized retry panel, retry invokes a new preload, and StrictMode/unmount abort does not render an alert.

Run:

```powershell
npm exec vitest run tests/client/preload-sprite-atlases.test.ts tests/client/load-snapshot.test.ts tests/client/app.test.tsx
npm run typecheck
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/client/api/preload-sprite-atlases.ts src/client/api/load-snapshot.ts tests/client/preload-sprite-atlases.test.ts tests/client/load-snapshot.test.ts tests/client/app.test.tsx
git commit -m "fix: preload card sprite atlases"
```

---

### Task 3: Color Legend, Rules Disclosure, and Keyword SVG Icons

**Files:**
- Create: `src/client/components/GameGuide.tsx`
- Create: `src/client/components/KeywordStateIcons.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/FeatureTile.tsx`
- Modify: `src/client/styles/global.css`
- Modify: `src/client/styles/shell.css`
- Test: `tests/client/GameGuide.test.tsx`
- Create: `tests/client/KeywordStateIcons.test.tsx`
- Modify: `tests/client/FeatureTile.test.tsx`
- Modify: `tests/client/app.test.tsx`

**Interfaces:**
- Produces: `<GameGuide />`, a stateless always-visible legend plus native `<details>` disclosure.
- Produces: `<KeywordStateIcons displayValue: string />`, accepting only `"false"`, `"true"`, `"false → true"`, or `"true → false"` generated by canonical comparison.
- Consumes: `FeatureResult.displayValue` and the existing color-independent `aria-label` built by `FeatureTile`.

- [ ] **Step 1: Write GameGuide RED tests**

Assert the visible copy literally and verify native disclosure state:

```tsx
render(<GameGuide />);
expect(screen.getByText("Both base and upgraded features match")).toBeVisible();
expect(screen.getByText("Exactly one version matches")).toBeVisible();
expect(screen.getByText("Neither version matches")).toBeVisible();
const disclosure = screen.getByText("How to play").closest("details")!;
expect(disclosure).not.toHaveAttribute("open");
fireEvent.click(screen.getByText("How to play"));
expect(disclosure).toHaveAttribute("open");
expect(disclosure).toHaveTextContent(/multiple cards may be accepted/i);
expect(disclosure).toHaveTextContent(/UTC/i);
expect(disclosure).toHaveTextContent(/Practice/i);
```

Require three textual legend items and three decorative swatches (`aria-hidden="true"`).

- [ ] **Step 2: Run GameGuide test to verify RED**

Run:

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx
```

Expected: FAIL because `GameGuide` does not exist.

- [ ] **Step 3: Implement and place the guide**

Create `GameGuide.tsx` with a `section aria-label="Guess result legend and rules"`, a three-item list, and native `<details><summary>How to play</summary>…</details>`. Use the exact approved meanings. Replace the old `round-note` in `GameShell` with `<GameGuide />` and make `game-panel` label/reference relationships remain valid without duplicate IDs.

Add responsive styles for `.game-guide`, `.result-legend`, `.result-legend__swatch--green|yellow|red`, and `.game-rules`; use the existing tile colors and stack entries on narrow screens without changing `.app-shell` or `.guess-grid` widths. Remove the retired `.round-note` rules from both `global.css` and `shell.css` so there is no dead duplicate styling.

- [ ] **Step 4: Write keyword-icon RED tests**

Render the four canonical states and assert real SVG roles/test labels only at component-test level:

```ts
expect(renderIcons("false").container.querySelectorAll("svg[data-icon='x']")).toHaveLength(1);
expect(renderIcons("true").container.querySelectorAll("svg[data-icon='check']")).toHaveLength(1);
expect(iconNames("false → true")).toEqual(["x", "check"]);
expect(iconNames("true → false")).toEqual(["check", "x"]);
expect(screen.queryByRole("img")).not.toBeInTheDocument();
```

In `FeatureTile.test.tsx`, require accessible labels `absent`, `present`, `absent to present`, and `present to absent`, while visible text contains neither `Yes` nor raw `true`/`false`.

- [ ] **Step 5: Implement focused inline SVG icons**

Create two private icon functions using `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2.5}`, rounded caps/joins, `focusable="false"`, and `aria-hidden="true"`. `KeywordStateIcons` parses the canonical comparison string and renders:

```tsx
<span className="keyword-state-icons" aria-hidden="true">
  <StateIcon present={base === "true"} />
  {changed && <><span className="keyword-state-icons__arrow">→</span><StateIcon present={upgraded === "true"} /></>}
</span>
```

In `FeatureTile`, keep `keywordAccessibleValue` for the tile label. Replace `keywordVisualValue` with `<KeywordStateIcons displayValue={result.displayValue} />`; core features continue rendering `displayValue` text.

- [ ] **Step 6: Verify guide/icon accessibility and GREEN**

Run:

```powershell
npm exec vitest run tests/client/GameGuide.test.tsx tests/client/KeywordStateIcons.test.tsx tests/client/FeatureTile.test.tsx tests/client/app.test.tsx
npm run typecheck
```

Expected: all focused tests PASS; no keyword state depends on visible text or color; no correctness mark/hint returns.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/client/components/GameGuide.tsx src/client/components/KeywordStateIcons.tsx src/client/App.tsx src/client/components/FeatureTile.tsx src/client/styles/global.css src/client/styles/shell.css tests/client/GameGuide.test.tsx tests/client/KeywordStateIcons.test.tsx tests/client/FeatureTile.test.tsx tests/client/app.test.tsx
git commit -m "feat: explain results and show keyword states"
```

---

### Task 4: Render Newest Guesses First Without Reordering History

**Files:**
- Modify: `src/client/components/GuessGrid.tsx`
- Modify: `tests/client/GuessGrid.test.tsx`
- Modify: `tests/client/GuessGrid.stale.test.tsx`
- Modify: `tests/client/app.test.tsx`
- Test: `tests/shared/share.test.ts`
- Test: `tests/client/storage.test.ts`

**Interfaces:**
- Produces: internal render rows `{ guess: SubmittedGuess; chronologicalIndex: number }[]` in newest-first order.
- Consumes: chronological `guesses`, existing `animateFromIndex`, `roundKey`, reveal controller, storage, and share generation.
- Preserves: reducer array order, persisted order, and share-symbol row order.

- [ ] **Step 1: Write newest-first RED tests**

With three distinctly named guesses, require DOM rowheaders in newest-first order:

```ts
expect(screen.getAllByRole("rowheader").map((cell) => cell.getAttribute("aria-label"))).toEqual([
  "Third artwork and name",
  "Second artwork and name",
  "First artwork and name",
]);
```

Add a pending-reveal test where `animateFromIndex === 2`; only Third's ten cells may lack `feature-tile--immediate`, Third is the first body row, the valid final transform event completes once, and older rows never replay. Add a restored test where all three rows are newest-first and every cell is immediate.

- [ ] **Step 2: Run grid tests to verify RED**

Run:

```powershell
npm exec vitest run tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx
```

Expected: FAIL because the current map renders oldest-first.

- [ ] **Step 3: Derive a presentation-only reversed view**

Inside `GuessGrid`, add:

```ts
const renderedGuesses = useMemo(() => guesses
  .map((guess, chronologicalIndex) => ({ guess, chronologicalIndex }))
  .reverse(), [guesses]);
```

Map `renderedGuesses`; replace every animation/key/index decision with `chronologicalIndex`:

```ts
const animate = !reducedMotion && chronologicalIndex >= animateFromIndex;
const isNewestChronologicalGuess = chronologicalIndex === guesses.length - 1;
const rowKey = `${String(roundKey)}:${guess.cardId}:${chronologicalIndex}`;
```

Attach the completion transition only when `animate && isNewestChronologicalGuess && featureIndex === FEATURE_ORDER.length - 1`. Keep the active reveal key based on chronological length/last submitted card.

- [ ] **Step 4: Prove storage/share chronology is unchanged**

Extend share/storage tests with two guesses whose symbol rows/card IDs differ. Assert serialized guesses and copied/share rows remain `[first, second]`, not DOM order. No production storage/share code should change in this task.

- [ ] **Step 5: Verify reveal lifecycle and GREEN**

Run:

```powershell
npm exec vitest run tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/app.test.tsx tests/shared/share.test.ts tests/client/storage.test.ts
npm run typecheck
```

Expected: all focused tests PASS, including fallback timeout, duplicate/bubbled transition events, reduced motion, round replacement, and unmount cleanup.

- [ ] **Step 6: Commit Task 4**

```powershell
git add src/client/components/GuessGrid.tsx tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/app.test.tsx tests/shared/share.test.ts tests/client/storage.test.ts
git commit -m "feat: show newest guesses first"
```

---

### Task 5: Offline Browser Acceptance, Live Snapshot Validation, and Final Handoff

**Files:**
- Modify: `tests/e2e/fixtures/build-test-snapshot.ts`
- Modify: `tests/e2e/game.spec.ts`
- Modify: `README.md` only if startup-loading behavior needs clarification after implementation
- Test: all project suites

**Interfaces:**
- Consumes: canonical domains from Task 1, preload boundary from Task 2, GameGuide/icons from Task 3, and newest-first view from Task 4.
- Produces: complete offline acceptance evidence and a fresh validated live snapshot; does not weaken the existing official-origin browser block.

- [ ] **Step 1: Add offline fixture assertions for canonical data**

After building fixture cards, require:

```ts
const fallingStar = builtCards.find((card) => card.id === "FALLING_STAR");
if (fallingStar?.base.rarity !== "Basic" || fallingStar.upgraded.rarity !== "Basic") {
  throw new Error("Falling Star fixture rarity was not preserved");
}
```

Also assert every built `cardType` and `rarity` belongs to `CARD_TYPES`/`CARD_RARITIES`. Retain the Dazed raw-Unplayable key invariants.

- [ ] **Step 2: Extend the browser flow and capture RED**

Before `page.goto`, listen for candidate/guess atlas responses. After gameplay becomes visible, require both responses finished successfully and inspect resource timing entries for both exact sprite-map URLs. Verify:

- three visible legend meanings;
- collapsed `How to play`, then expanded exact rules;
- keyword cells contain SVG X/check icons and both upgrade-direction arrangements from fixture guesses;
- Falling Star search/guess displays `Basic`;
- after two wrong guesses, DOM rowheaders are `[second, first]` while the copied Daily symbol rows remain chronological;
- first candidate and first guess sprite elements use already-complete atlas resources;
- existing 390/768/1440 document/grid overflow expectations remain unchanged;
- no request reaches either official Codex origin.

Run before implementation integration is complete:

```powershell
npm run test:e2e
```

Expected: the newly added legend/domain/preload/order assertions FAIL for the intended missing behavior.

- [ ] **Step 3: Make only fixture/test integration adjustments needed for GREEN**

Update fixture card choice/order so one deterministic wrong guess demonstrates `false → true` and another demonstrates `true → false` if the existing six-card fixture does not. Do not add production branches for E2E. Keep fixed UTC time, fixed randomness, trusted fixture origins, and official-origin abort guard.

- [ ] **Step 4: Run the complete supported-runtime gate**

Run in this exact order with Node 22.12+:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: every command exits `0`; all Vitest files/tests and all Playwright cases pass; no port/listener remains from E2E.

- [ ] **Step 5: Build and validate a fresh live snapshot separately**

Use a brand-new confirmed-absent data directory outside OneDrive, supported Node, production sync enabled, and the documented official source/CDN allowlists. Start on a free temporary port. Record the accepted revision, Last-Modified, card/upgrade/group counts, sprite bytes, and fallback count.

Independently load runtime artifacts and assert:

```ts
fallingStar.base.rarity === "Basic";
fallingStar.upgraded.rarity === "Basic";
cards.every((card) => CARD_TYPES.includes(card.base.cardType));
cards.every((card) => CARD_RARITIES.includes(card.base.rarity));
new Set(cards.flatMap((card) => [card.base.rarity, card.upgraded.rarity]));
```

Validate manifest hashes, exact recomputed groups, sprite bounds, and server acceptance before listen. Stop the temporary production server and confirm its port is free.

- [ ] **Step 6: Review and commit Task 5**

Run a read-only whole-diff review for contract mismatches, preload cleanup/security, accessible icon semantics, reveal ordering, browser isolation, and live-data evidence. Address Critical/Important findings test-first, rerun the full gate, then commit:

```powershell
git add tests/e2e/fixtures/build-test-snapshot.ts tests/e2e/game.spec.ts README.md
git commit -m "test: verify guided card experience"
```

If `README.md` did not change, omit it from `git add`.

- [ ] **Step 7: Start the reviewed local site only after final verification**

Build from the final branch, use the validated persistent data directory with `STSDLE_SKIP_SYNC=1`, and start backend `3000` plus Vite `5173` under supported Node. Record verified PID files/logs, require empty stderr, and verify `/`, `/health`, `/runtime/cards.json`, candidate atlas, and guess atlas all return `200`.

Open `http://localhost:5173`, expand the guide, search Falling Star, submit two guesses, and verify both atlas resources were complete before interaction, keyword icons/accessibility are correct, newest row is first, and the page/grid overflow contract holds. Leave the reviewed site running only after all checks pass.
