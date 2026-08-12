# Compact Feature Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `Unplayable` from STS-dle's feature-set algorithm while retaining every card, simplify comparison output, and compact the ten-column guess grid so it fits on desktop.

**Architecture:** Make the ten-field `FeatureVector` the single source of truth for normalization, feature keys, groups, comparisons, validation, persistence, and sharing. Keep renderer-only Unplayable handling at the raw Spiral Codex boundary, then update the React grid and CSS around the smaller result contract. Rebuild snapshots normally; there is no merge or migration pass because `baseKey` and `pairKey` already serialize `FEATURE_ORDER`.

**Tech Stack:** TypeScript, Zod, React 19, Fastify 5, Sharp, Vitest, Testing Library, Playwright, CSS.

## Global Constraints

- Keep every source card eligible as a guess and answer, including all cards whose raw keywords contain `Unplayable`.
- `FEATURE_ORDER` contains exactly ten fields: `cardClass`, `cardType`, `mana`, `rarity`, `eternal`, `ethereal`, `exhaust`, `innate`, `retain`, `sly`.
- Feature-set keys are generated normally from those ten fields; do not add a merge, migration, or hidden Unplayable field.
- Mana meanings are exact: numeric `0` remains `0`, other fixed costs remain numbers, true variable costs are `X`, and no mana cost is `None`.
- Absent keywords have no visible dash; result marks and mana direction hints are removed.
- Red/yellow/green paired base-upgrade comparison semantics do not change.
- Screen-reader labels retain the guessed value/state and comparison color.
- Existing eleven-result Daily rounds are invalidated safely; Daily streak statistics remain intact.
- Runtime and final verification use Node.js `>=22.12`.
- Do not add `Co-Authored-By` trailers.

---

### Task 1: Revise the canonical feature domain and generated feature-set keys

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/snapshot-schema.ts`
- Modify: `src/server/sync/normalize-card.ts`
- Modify: `tests/shared/domain.test.ts`
- Modify: `tests/shared/groups.test.ts`
- Modify: `tests/server/normalize-card.test.ts`
- Modify: `tests/client/load-snapshot.test.ts`
- Modify: feature-vector fixtures in `tests/shared/selection.test.ts`, `tests/shared/comparison.test.ts`, `tests/server/build-sprites.test.ts`, `tests/client/AnswerReveal.test.tsx`, `tests/client/CardSearch.test.tsx`, `tests/client/GuessGrid.stale.test.tsx`, `tests/client/GuessGrid.test.tsx`, `tests/client/app.test.tsx`, `tests/client/game-reducer.test.ts`, `tests/client/storage.test.ts`, and `tests/client/use-game.test.tsx`

**Interfaces:**
- Produces: `ManaValue = number | "X" | "None"`.
- Produces: a ten-property `FeatureVector` with no `unplayable` property.
- Preserves: `baseKey(vector)` and `pairKey(card)` signatures; their output changes automatically through `FEATURE_ORDER`.
- Consumes later: Task 2 uses raw card keywords for renderer-only Unplayable behavior; Tasks 3-5 consume the ten-field vectors.

- [ ] **Step 1: Write failing domain, schema, normalization, and key tests**

Update the exact-order test and add explicit absence/mana cases:

```ts
expect(FEATURE_ORDER).toEqual([
  "cardClass", "cardType", "mana", "rarity",
  "eternal", "ethereal", "exhaust", "innate", "retain", "sly",
]);

expect(normalizeCard(card("DAZED"), BASE_URL).base.mana).toBe("None");
expect(normalizeCard(card("ALCHEMIZE"), BASE_URL).upgraded.mana).toBe(0);
expect(normalizeCard(card("MALAISE"), BASE_URL).base.mana).toBe("X");
expect(Object.hasOwn(normalizeCard(card("DAZED"), BASE_URL).base, "unplayable")).toBe(false);
```

Prove the normal key algorithm forgets raw Unplayable without a merge pass:

```ts
const rawWithKeyword = structuredClone(card("DAZED"));
const rawWithoutKeyword = structuredClone(rawWithKeyword);
rawWithoutKeyword.id = "DAZED_PLAYABLE_FIXTURE";
rawWithoutKeyword.name = "Dazed Playable Fixture";
rawWithoutKeyword.keywords_key = rawWithoutKeyword.keywords_key?.filter(
  (keyword) => keyword.toLowerCase() !== "unplayable",
) ?? [];
const first = normalizeCard(rawWithKeyword, BASE_URL);
const second = normalizeCard(rawWithoutKeyword, BASE_URL);
expect(baseKey(first.base)).toBe(baseKey(second.base));
expect(pairKey(first)).toBe(pairKey(second));
```

In `load-snapshot.test.ts`, assert that `mana: "None"` parses and that a feature vector containing `unplayable: true` or `mana: "\u2013"` is rejected.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npm exec vitest run tests/shared/domain.test.ts tests/shared/groups.test.ts tests/server/normalize-card.test.ts tests/client/load-snapshot.test.ts
```

Expected: failures show the eleventh feature, the en-dash no-cost value, and accepted `unplayable` input.

- [ ] **Step 3: Implement the ten-field domain and `None` normalization**

Change the canonical definitions to:

```ts
export const FEATURE_ORDER = [
  "cardClass", "cardType", "mana", "rarity",
  "eternal", "ethereal", "exhaust", "innate", "retain", "sly",
] as const;

export type ManaValue = number | "X" | "None";

export interface FeatureVector {
  cardClass: CardClass;
  cardType: CardType;
  mana: ManaValue;
  rarity: CardRarity;
  eternal: boolean;
  ethereal: boolean;
  exhaust: boolean;
  innate: boolean;
  retain: boolean;
  sly: boolean;
}
```

Make `featureVectorSchema` strict, accept `"None"`, and omit `unplayable`:

```ts
const featureVectorSchema = z.object({
  cardClass: z.enum(["Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event"]),
  cardType: z.enum(["Attack", "Skill", "Power", "Quest", "Status", "Curse"]),
  mana: z.union([z.number(), z.literal("X"), z.literal("None")]),
  rarity: z.enum(["Common", "Uncommon", "Rare", "None"]),
  eternal: z.boolean(),
  ethereal: z.boolean(),
  exhaust: z.boolean(),
  innate: z.boolean(),
  retain: z.boolean(),
  sly: z.boolean(),
}).strict();
```

Limit normalization keywords to the six retained keyword features and map an absent/invalid cost to `None`:

```ts
const KEYWORDS = ["eternal", "ethereal", "exhaust", "innate", "retain", "sly"] as const;

function normalizeMana(cost: number | null, isX: boolean | null | undefined): ManaValue {
  if (isX || cost === -1) return "X";
  if (!Number.isInteger(cost) || cost === null || cost < 0) return "None";
  return cost;
}
```

Remove `unplayable` from `buildFeatures`. Do not change `src/shared/feature-keys.ts` or `src/shared/groups.ts`; their existing `FEATURE_ORDER` iteration is the required algorithm.

- [ ] **Step 4: Mechanically update typed test fixtures**

Remove `unplayable: false` from every typed `FeatureVector` fixture listed in this task. For example, change:

```ts
const base: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false, unplayable: false,
};
```

to:

```ts
const base: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false,
};
```

Remove the `{ feature: "unplayable", ... }` `FeatureResult` fixture from GuessGrid/App arrays. Preserve all cards and raw Spiral Codex fixture keywords.

- [ ] **Step 5: Run focused domain tests**

Run:

```powershell
npm exec vitest run tests/shared/domain.test.ts tests/shared/groups.test.ts tests/server/normalize-card.test.ts tests/client/load-snapshot.test.ts
```

Expected: focused tests pass and no test fixture in this task still constructs `FeatureVector.unplayable`.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/shared/domain.ts src/shared/snapshot-schema.ts src/server/sync/normalize-card.ts tests
git commit -m "feat: revise card feature domain"
```

---

### Task 2: Preserve renderer fidelity and enforce the new snapshot shape

**Files:**
- Modify: `src/server/images/renderer-adapter.ts`
- Modify: `src/server/images/build-sprites.ts`
- Modify: `src/server/sync/validate-snapshot.ts`
- Modify: `tests/server/renderer-adapter.test.ts`
- Modify: `tests/server/build-sprites.test.ts`
- Modify: `tests/server/validate-snapshot.test.ts`
- Modify: `tests/server/build-snapshot.test.ts`
- Modify: `tests/client/SpriteArt.test.tsx`

**Interfaces:**
- Produces: `effectiveRawKeyword(raw, keyword, upgraded): boolean` scoped to the renderer adapter.
- Preserves: renderer `cost` uses the card-image generator's existing no-cost token rather than the UI-facing word `None`.
- Produces: guess sprite metadata with `displayScale: 0.45` (160px source cells display at 72px); candidate scale remains `0.5`.
- Enforces: validated feature vectors contain exactly the ten `FEATURE_ORDER` keys.

- [ ] **Step 1: Write failing renderer, sprite-scale, and validator tests**

Add raw keyword tests that do not read `FeatureVector.unplayable`:

```ts
it("keeps renderer-only Unplayable text for a raw unplayable card", () => {
  expect(buildRendererConfig(card("DAZED"), false).description).toMatch(/^Unplayable\./);
});

it("applies raw upgrade keyword deltas in the fallback renderer", () => {
  const raw = structuredClone(card("DAZED"));
  raw.upgrade = { ...raw.upgrade, remove_unplayable: true };
  expect(buildRendererConfig(raw, true).description).not.toMatch(/^Unplayable\./);
});
```

Update sprite expectations:

```ts
expect(spriteMap.guess.displayScale).toBe(0.45);
expect(screen.getByRole("img", { name: "Apotheosis guess artwork" })).toHaveStyle({
  width: "72px",
  height: "72px",
  backgroundPosition: "-72px -144px",
  backgroundSize: "288px 216px",
});
```

Add validator mutations that rehash a snapshot after injecting `base.unplayable = true`, `upgraded.unplayable = false`, or an en-dash mana value, and expect `SnapshotValidationError` with no activation.

Add a build assertion that the fixture's raw Unplayable card is still present in emitted `cards.json` and has candidate/guess sprite cells.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm exec vitest run tests/server/renderer-adapter.test.ts tests/server/build-sprites.test.ts tests/server/validate-snapshot.test.ts tests/server/build-snapshot.test.ts tests/client/SpriteArt.test.tsx
```

Expected: renderer indexing fails after Task 1, guess scale remains `0.5`, and validator expectations still reflect eleven fields/en-dash mana.

- [ ] **Step 3: Derive renderer keywords from raw source data**

Add a renderer-only helper:

```ts
type RendererKeyword = (typeof PREFIX_KEYWORDS)[number] | (typeof SUFFIX_KEYWORDS)[number];

function effectiveRawKeyword(raw: RawSpireCard, keyword: RendererKeyword, upgraded: boolean): boolean {
  const base = new Set(raw.keywords_key?.map((value) => value.toLowerCase()) ?? []);
  let present = base.has(keyword);
  if (upgraded && raw.upgrade?.[`add_${keyword}`]) present = true;
  if (upgraded && raw.upgrade?.[`remove_${keyword}`]) present = false;
  return present;
}
```

Use it for every prefix/suffix renderer keyword, including `unplayable`. Derive the renderer `cost` directly from raw base/upgrade cost plus `is_x_cost`; keep the existing generator-compatible no-cost rendering token instead of passing `"None"` onto the card face.

```ts
function rendererCost(raw: RawSpireCard, upgraded: boolean): string {
  const upgradedCost = raw.upgrade?.cost;
  const cost = upgraded && typeof upgradedCost === "number" ? upgradedCost : raw.cost;
  if (raw.is_x_cost || cost === -1) return "X";
  if (!Number.isInteger(cost) || cost === null || cost < 0) return "\u2013";
  return String(cost);
}
```

- [ ] **Step 4: Update sprite metadata and strict snapshot validation**

Keep atlas cell sizes unchanged, but emit:

```ts
guess: {
  url: "/runtime/guess.webp",
  width: columns * 160,
  height: rows * 160,
  displayScale: 0.45,
}
```

In `validate-snapshot.ts`, set `KEYWORDS` to the same six retained keyword features. Keep its exact-own-key check against `FEATURE_ORDER`; do not special-case or strip `unplayable`. Update the mana validation branch to accept numbers, `X`, and `None` only.

- [ ] **Step 5: Run focused server-boundary tests**

```powershell
npm exec vitest run tests/server/renderer-adapter.test.ts tests/server/build-sprites.test.ts tests/server/validate-snapshot.test.ts tests/server/build-snapshot.test.ts tests/client/SpriteArt.test.tsx
```

Expected: all focused renderer, sprite, validator, builder, and SpriteArt tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/server/images/renderer-adapter.ts src/server/images/build-sprites.ts src/server/sync/validate-snapshot.ts tests/server tests/client/SpriteArt.test.tsx
git commit -m "fix: preserve renderer-only card keywords"
```

---

### Task 3: Remove mana hints from comparison, sharing, and Daily persistence

**Files:**
- Modify: `src/shared/comparison.ts`
- Modify: `src/shared/share.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `src/client/components/FeatureTile.tsx`
- Modify: `tests/shared/comparison.test.ts`
- Modify: `tests/shared/share.test.ts`
- Modify: `tests/client/storage.test.ts`
- Modify: `tests/client/SharePanel.test.tsx`
- Modify: `tests/client/FeatureTile.test.tsx`
- Modify: `tests/client/app.test.tsx`
- Modify: `tests/client/GuessGrid.stale.test.tsx`
- Modify: `tests/client/GuessGrid.test.tsx`

**Interfaces:**
- Produces: `FeatureResult = { feature: FeatureName; color: TileColor; displayValue: string }`.
- Removes: `ManaHint`, `FeatureResult.hint`, hint symbols, and hint validation.
- Produces: `DAILY_RULESET_VERSION = "v2"` and stored round `version: 2`.
- Preserves: `DAILY_STATS_KEY = "stsdle:stats:v1"` so streak history is not reset.
- Produces: blank visible state for absent keywords and accessible `absent`/`present` labels.

- [ ] **Step 1: Write failing comparison and share tests**

Replace direction tests with result-shape tests:

```ts
expect(compareFeature("mana", guess, answer)).toEqual({
  feature: "mana",
  color: "yellow",
  displayValue: "2 \u2192 1",
});
expect(Object.hasOwn(compareFeature("mana", guess, answer), "hint")).toBe(false);
expect(compareGuess(guess, answer)).toHaveLength(10);
```

Add the simplified tile contract:

```tsx
const view = render(<FeatureTile
  result={{ feature: "exhaust", color: "red", displayValue: "false" }}
  revealIndex={0}
/>);
expect(view.getByRole("cell")).toHaveTextContent("");
expect(view.getByRole("cell")).toHaveAccessibleName("Exhaust: absent. Result: red.");
expect(view.container.querySelector(".feature-tile__result-mark")).toBeNull();
expect(view.container.querySelector(".feature-tile__hint")).toBeNull();
```

Assert a Daily share row contains ten color symbols and no arrows/dash hints:

```ts
const row = formatDailyShare(options).split("\n")[1]!;
expect(Array.from(row)).toHaveLength(10);
expect(row).not.toMatch(/[\u2191\u2193\u2013]/u);
```

- [ ] **Step 2: Write failing storage-version tests**

Persist a valid version-2 ten-result round, then test that version 1, eleven results, a `hint` own property, or the old ruleset key does not restore:

```ts
expect(DAILY_RULESET_VERSION).toBe("v2");
expect(JSON.parse(storage.getItem(dailyStorageKey(identity))!).version).toBe(2);

storage.setItem(key, JSON.stringify({ ...validRound, version: 1 }));
expect(loadDailyRound(storage, identity, cardsById, answer)).toBeNull();
expect(storage.getItem(key)).toBeNull();
```

- [ ] **Step 3: Run focused tests and confirm RED**

```powershell
npm exec vitest run tests/shared/comparison.test.ts tests/shared/share.test.ts tests/client/storage.test.ts tests/client/SharePanel.test.tsx
```

Expected: old hint fields/symbols and version 1 behavior fail the new expectations.

- [ ] **Step 4: Simplify comparison, sharing, and tile output**

Define the result contract as:

```ts
export interface FeatureResult {
  feature: FeatureName;
  color: TileColor;
  displayValue: string;
}
```

Delete `ManaHint`, `manaHint`, and `mergeHints`. Keep the current base/upgraded green/yellow/red calculation and `displayValue` transition. In `share.ts`, map `FEATURE_ORDER` directly to `COLOR_SYMBOLS[result.color]`; remove all hint imports and maps.

In `FeatureTile.tsx`, delete the `ManaHint` import, hint maps, result-mark map, and both result-mark/hint spans. Remove `Unplayable` from `FEATURE_LABELS`. Keep four core features literal; format keyword values with:

```ts
function keywordVisualValue(value: string): string {
  return value.split(" \u2192 ").map((part) => part === "true" ? "Yes" : "").join(" \u2192 ");
}

function keywordAccessibleValue(value: string): string {
  return value.split(" \u2192 ")
    .map((part) => part === "true" ? "present" : "absent")
    .join(" to ");
}
```

Build the label as `${FEATURE_LABELS[result.feature]}: ${accessibleValue}. Result: ${result.color}.` so visually blank keyword cells retain complete screen-reader information.

- [ ] **Step 5: Version and strictly validate saved rounds**

Set:

```ts
export const DAILY_RULESET_VERSION = "v2";

interface StoredDailyRound {
  version: 2;
  answer: SelectedAnswer;
  guesses: SubmittedGuess[];
  status: RoundStatus;
}
```

Make `isFeatureResult` require exactly `feature`, `color`, and `displayValue` own keys:

```ts
const keys = Object.keys(value).sort();
return keys.length === 3
  && keys[0] === "color"
  && keys[1] === "displayValue"
  && keys[2] === "feature"
  && value.feature === expectedFeature
  && COLORS.includes(value.color as TileColor)
  && typeof value.displayValue === "string";
```

Remove hint comparison from `sameResults`, write `version: 2`, and require `value.version === 2`. Update result fixtures in the listed React tests to the three-property shape.

- [ ] **Step 6: Run focused comparison and persistence tests**

```powershell
npm exec vitest run tests/shared/comparison.test.ts tests/shared/share.test.ts tests/client/storage.test.ts tests/client/SharePanel.test.tsx tests/client/FeatureTile.test.tsx tests/client/app.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/GuessGrid.test.tsx
rg -n --glob "*.ts" --glob "*.tsx" "ManaHint|\.hint" src tests
```

Expected: comparison/share/storage/tile tests pass and the `rg` audit returns no result.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/shared/comparison.ts src/shared/share.ts src/client/game/storage.ts src/client/components/FeatureTile.tsx tests/shared tests/client
git commit -m "feat: simplify feature comparison results"
```

---

### Task 4: Compact the ten-column layout

**Files:**
- Modify: `src/client/components/GuessGrid.tsx`
- Modify: `src/client/styles/grid.css`
- Modify: `src/client/styles/global.css`
- Modify: `tests/client/GuessGrid.test.tsx`
- Modify: `tests/client/app.test.tsx`

**Interfaces:**
- Produces: ten feature headers plus one artwork column (`aria-colcount={FEATURE_ORDER.length + 1}`).
- Removes: obsolete `.feature-tile__result-mark` and `.feature-tile__hint` CSS.

- [ ] **Step 1: Write failing grid structure tests**

Assert:

```ts
expect(screen.getByRole("table")).toHaveAttribute("aria-colcount", "11");
expect(screen.getAllByRole("columnheader")).toHaveLength(11);
expect(screen.getAllByRole("cell")).toHaveLength(10);
expect(screen.queryByRole("columnheader", { name: "Unplayable" })).not.toBeInTheDocument();
```

Assert guess artwork now displays as 72px from Task 2 metadata.

- [ ] **Step 2: Run the focused grid tests and confirm RED**

```powershell
npm exec vitest run tests/client/GuessGrid.test.tsx tests/client/app.test.tsx
```

Expected: the table still reports twelve columns and old CSS dimensions remain.

- [ ] **Step 3: Implement the compact responsive grid**

Use these values in `grid.css`:

```css
.guess-grid {
  grid-template-columns: 76px repeat(10, minmax(72px, 1fr));
  gap: .15rem;
  min-width: 830px;
}

.guess-grid__art,
.feature-tile,
.feature-tile__surface {
  min-height: 72px;
}
```

Remove obsolete result-mark/hint selectors. In `global.css`, change both desktop/mobile shell caps from `980px` to `1280px`. In `GuessGrid.tsx`, calculate `aria-colcount={FEATURE_ORDER.length + 1}` rather than hardcoding it.

- [ ] **Step 4: Run focused UI tests and typecheck**

```powershell
npm exec vitest run tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx tests/client/app.test.tsx
npm run typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src/client/components/GuessGrid.tsx src/client/styles/grid.css src/client/styles/global.css tests/client
git commit -m "feat: compact the feature comparison grid"
```

---

### Task 5: Update offline snapshot and browser acceptance coverage

**Files:**
- Modify: `tests/e2e/fixtures/build-test-snapshot.ts`
- Modify: `tests/e2e/game.spec.ts`
- Modify: `tests/server/build-snapshot.test.ts`
- Modify: `README.md` only if its gameplay or snapshot-field description still states eleven features or mana arrows

**Interfaces:**
- Consumes: ten-field snapshots and three-property comparison results.
- Verifies: official Codex browser requests remain blocked during E2E.
- Verifies: desktop grid fits; tablet/phone overflow remains owned by `.guess-grid-scroll`.

- [ ] **Step 1: Revise the deterministic fixture to prove natural feature-key behavior**

In `pairedCopy`, toggle only the raw `unplayable` keyword for the Dazed pair while leaving the ten public features identical:

```ts
function pairedCopy(card: RawSpireCard): RawSpireCard {
  const copy = {
    ...structuredClone(card),
    id: `${card.id}_PAIR`,
    name: `${card.name} Pair`,
    image_url: `/fixture-art/${card.id.toLowerCase()}-pair.webp`,
    image_url_card: `${FULL_CARD_ORIGIN}/${card.id.toLowerCase()}_pair.webp`,
    image_url_card_upg: `${FULL_CARD_ORIGIN}/${card.id.toLowerCase()}_pair_upg.webp`,
  };
  if (card.id === "DAZED") {
    copy.keywords_key = copy.keywords_key?.filter(
      (keyword) => keyword.toLowerCase() !== "unplayable",
    ) ?? [];
  }
  return copy;
}
```

After `buildSnapshot`, read `cards.json`, find `DAZED` and `DAZED_PAIR`, and assert:

```ts
if (!dazed || !dazedPair) throw new Error("Dazed E2E pair was not retained");
if (baseKey(dazed.base) !== baseKey(dazedPair.base)) {
  throw new Error("Raw Unplayable state changed the generated base feature key");
}
if (pairKey(dazed) !== pairKey(dazedPair)) {
  throw new Error("Raw Unplayable state changed the generated pair feature key");
}
```

Do not add post-build grouping manipulation.

- [ ] **Step 2: Update the Playwright model and comparison assertions**

Select a wrong guess with a yellow result and a non-green mana result without reading a hint:

```ts
const wrongGuess = cards.find((card) => !answer.acceptedCardIds.includes(card.id)
  && compareGuess(card, answerCard).some((result) => result.color === "yellow")
  && compareGuess(card, answerCard).some(
    (result) => result.feature === "mana" && result.color !== "green",
  ));
```

Expect ten feature cells before and after reload, no direction text, no result-mark/hint elements, and a ten-symbol share row. Confirm an Unplayable raw fixture card still appears in the combobox candidates and can be selected.

- [ ] **Step 3: Update viewport expectations**

For 390px and 768px viewports, require `scrollerScrollWidth > scrollerClientWidth`. For 1440px, require `scrollerScrollWidth <= scrollerClientWidth`. Continue requiring page-level containment at all widths.

- [ ] **Step 4: Run the offline acceptance sequence**

```powershell
npm run build
npm run test:e2e
```

Expected: build succeeds, all Playwright tests pass, and the network guard records zero normal application requests to either official Codex origin.

- [ ] **Step 5: Commit Task 5**

```powershell
git add tests/e2e tests/server/build-snapshot.test.ts README.md
git commit -m "test: verify compact feature experience"
```

---

### Task 6: Run final verification and refresh the local trial site

**Files:**
- Verify only: all tracked source, tests, plan, and spec files
- Runtime output: a fresh directory under `%TEMP%`, outside the OneDrive workspace
- Runtime process metadata/logs: existing ignored `.tmp` files in the workspace

**Interfaces:**
- Consumes: a supported Node.js runtime located through the bundled workspace dependency loader when the system Node is below `22.12`.
- Produces: a fresh validated live snapshot and a working frontend at `http://localhost:5173/`.

- [ ] **Step 1: Run the complete supported-runtime gate**

Run in this exact order:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: every command exits 0. Record unit test file/test counts, built module count, and Playwright count from fresh output.

- [ ] **Step 2: Perform a feature-domain audit**

```powershell
rg -n "ManaHint|feature-tile__result-mark|feature-tile__hint|unplayable" src tests
```

Expected: no `ManaHint`, result-mark, or hint UI references. `unplayable` appears only in raw-source renderer logic and tests that prove raw Unplayable cards remain retained; it does not appear in `FeatureVector`, `FEATURE_ORDER`, snapshot vectors, feature keys, or client headers.

- [ ] **Step 3: Build a fresh live snapshot outside OneDrive**

Use the new contained directory `%TEMP%\stsdle-live-data-compact-v2-20260812`. Confirm it does not already exist before startup. Start the built server once with production sync enabled and the official default source/CDN allowlists. Wait for the structured snapshot-acceptance log before considering the server ready.

- [ ] **Step 4: Verify live runtime artifacts**

Read `/health`, `/runtime/cards.json`, `/runtime/base-groups.json`, `/runtime/pair-groups.json`, and `/runtime/sprite-map.json`. Assert:

```text
cards.json contains every fetched card
every base/upgraded vector has exactly ten keys
no vector has an unplayable own property
no vector has the en-dash mana sentinel
raw Unplayable card ID DAZED remains present
every card has candidate and guess sprite rectangles
all group keys equal baseKey/pairKey recomputation from cards.json
```

- [ ] **Step 5: Replace the old local backend safely**

Resolve the exact PID from `.tmp/live-backend.pid`, verify its command line belongs to this STS-dle workspace, stop only that process, and start the new backend on port 3000 using the fresh data directory. Preserve/update `.tmp/live-backend.pid` and payload-safe logs. Keep the Vite frontend on port 5173 if it is healthy; otherwise restart only the recorded STS-dle frontend process after verifying its command line.

- [ ] **Step 6: Smoke-test the trial site**

Verify `http://localhost:5173/`, its proxied `/health`, and `/runtime/cards.json`. Submit a guess in the browser and confirm ten columns, no Unplayable header, `None` only for absent mana, blank absent-keyword cells, no marks/arrows, and desktop fit at 1440px.

- [ ] **Step 7: Check repository state and commit any verification-only documentation change**

```powershell
git status --short
git log -6 --oneline
```

Expected: no untracked runtime artifacts and no unstaged tracked edits. If Task 6 changed no tracked file, do not create an empty commit.
