# Set-Valued Card Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace six boolean keyword columns with canonical Target, Powers-set, and Keywords-set features throughout snapshot generation, comparison, Practice filtering, UI, persistence, and the committed deployment archive.

**Architecture:** Validate and normalize Codex Target, Powers, and Keywords at snapshot-build time so every downstream consumer receives strict canonical base/upgraded vectors. Shared comparison and grouping code treats Powers and Keywords as sets while keeping Target scalar; the client renders and filters those normalized values without parsing descriptions or raw API payloads. A schema-versioned storage reset and rebuilt committed archive complete the migration without restoring startup sync.

**Tech Stack:** TypeScript, Zod 4, React 19, Vitest/Testing Library, Playwright, Fastify, Sharp, deterministic snapshot/archive release tooling, Render Docker deployment.

## Global Constraints

- Run every command with bundled Node `C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` v24.19.0 first on `PATH`; package support remains Node `>=22.12`.
- Execute directly on clean `master`; do not create a branch or pull request.
- Do not add `Co-Authored-By` trailers.
- The ordered feature domain is exactly Class, Type, Mana, Rarity, Target, Powers, Keywords.
- Target accepts exactly `Self`, `AnyEnemy`, `AllEnemies`, `RandomEnemy`, `AnyAlly`, `AllAllies`, and `None`.
- Count each `power_key` once per distinct card; a count of one normalizes to `Unique Buff`, while a count greater than one retains the Codex display name.
- Direction is not encoded: Resonance has `Strength`, not separate buff/debuff values.
- Powers and Keywords are sorted, duplicate-free sets; empty sets display and filter as `None`.
- Keywords include Eternal, Ethereal, Exhaust, Innate, Retain, Sly, and Unplayable.
- Powers and Target use the same value in both forms until Codex supplies explicit upgrade-specific data; the paired schema and arrow renderer remain future-ready.
- Set comparison is Green for two exact corresponding sets, Yellow for any corresponding exact match or overlap, and Red for no corresponding match or overlap.
- Target and other scalar features keep direct paired comparison.
- Practice scalar groups use OR, Powers and Keywords use AND, and enabled groups combine with AND.
- Bump snapshot manifest schema to `2`, current round envelope to `5`, Daily ruleset to `v5`, Hardcore Daily ruleset to `hardcore-v2`, and Practice ruleset to `practice-v3`.
- Incompatible active rounds reset cleanly; unrelated local preferences and Daily statistics remain untouched.
- Render stays serve-only through committed `deploy/snapshot-data.tar.gz` and `STSDLE_SKIP_SYNC=1`; do not add startup synchronization.
- Use strict RED-to-GREEN TDD and preserve the official-origin offline browser guard.

---

### Task 1: Build the Canonical Snapshot Feature Domain

**Files:**
- Modify: `src/shared/domain.ts`
- Modify: `src/shared/snapshot-schema.ts`
- Modify: `src/server/spire-codex/schema.ts`
- Modify: `src/server/sync/normalize-card.ts`
- Modify: `src/server/sync/build-snapshot.ts`
- Modify: `src/server/sync/validate-snapshot.ts`
- Modify: `tests/fixtures/spire-cards.json`
- Modify: `tests/server/normalize-card.test.ts`
- Modify: `tests/server/build-snapshot.test.ts`
- Modify: `tests/server/validate-snapshot.test.ts`
- Modify: `tests/server/spire-codex-client.test.ts`
- Modify: `tests/server/app.test.ts`
- Modify: `tests/server/prune-e2e-snapshots.test.ts`
- Modify: `tests/server/production-sync-boundary.test.ts`
- Modify: `tests/server/build-sprites.test.ts`
- Modify: `tests/client/load-snapshot.test.ts`
- Modify: `tests/client/use-game.test.tsx`
- Modify: `tests/shared/domain.test.ts`

**Interfaces:**
- Produces `CARD_TARGETS`, `CardTarget`, `CARD_KEYWORDS`, `CardKeyword`, `UNIQUE_POWER = "Unique Buff"`, and the seven-entry `FEATURE_ORDER` from `src/shared/domain.ts`.
- Produces `analyzeSourceFeatures(cards: readonly RawSpireCard[]): SourceFeatureAnalysis`, containing the immutable per-card power frequency map and the release-audit summary consumed by Task 5.
- Changes `normalizeCard(raw, baseUrl, powerCardCounts)` to require the completed frequency table.
- Produces `FeatureVector` with `target: CardTarget`, `powers: string[]`, and `keywords: CardKeyword[]` instead of six keyword booleans.
- Produces snapshot manifest schema version `2` for all later tasks.

- [ ] **Step 1: Write raw-schema and normalization RED tests**

Extend the raw fixture with exact `target` and `powers_applied` fields. Add tests requiring:

```ts
expect(() => RawSpireCardsSchema.parse([{ ...raw, target: "Hand" }])).toThrow();
expect(() => RawSpireCardsSchema.parse([{ ...raw, powers_applied: [{ power: "Weak" }] }])).toThrow();

const analysis = analyzeSourceFeatures([abrasive, comet, resonance, duplicateStrengthEntry]);
const counts = analysis.powerCardCounts;
expect(counts.get("Strength")).toBe(2);
expect(counts.get("Afterimage")).toBe(1);

expect(normalizeCard(afterimage, BASE_URL, counts).base.powers).toEqual(["Unique Buff"]);
expect(normalizeCard(comet, BASE_URL, counts).base.powers).toEqual(["Vulnerable", "Weak"]);
expect(normalizeCard(dazed, BASE_URL, counts).base.keywords).toContain("Unplayable");
expect(normalizeCard(apparition, BASE_URL, counts).upgraded.keywords).not.toContain("Ethereal");
expect(normalizeCard(resonance, BASE_URL, counts).base.target).toBe("AllEnemies");
```

- [ ] **Step 2: Run normalization RED**

```powershell
$env:PATH='C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:PATH
npm exec vitest run tests/server/normalize-card.test.ts tests/shared/domain.test.ts
```

Expected: FAIL because Target/Powers are passthrough data, the frequency helper is absent, and `FeatureVector` still contains six booleans.

- [ ] **Step 3: Define the strict shared and raw contracts**

Replace the feature domain with:

```ts
export const CARD_TARGETS = [
  "Self", "AnyEnemy", "AllEnemies", "RandomEnemy",
  "AnyAlly", "AllAllies", "None",
] as const;
export type CardTarget = (typeof CARD_TARGETS)[number];

export const CARD_KEYWORDS = [
  "Eternal", "Ethereal", "Exhaust", "Innate", "Retain", "Sly", "Unplayable",
] as const;
export type CardKeyword = (typeof CARD_KEYWORDS)[number];
export const UNIQUE_POWER = "Unique Buff" as const;

export const FEATURE_ORDER = [
  "cardClass", "cardType", "mana", "rarity", "target", "powers", "keywords",
] as const;
```

Define `powersAppliedSchema` as a strict object with nonempty `power`, nonempty `power_key`, and finite numeric `amount`. Add `target: z.enum(CARD_TARGETS)` and `powers_applied: z.array(powersAppliedSchema).nullable()` to `RawSpireCardSchema`.

- [ ] **Step 4: Implement two-pass normalization**

Implement `analyzeSourceFeatures` using one `Set` of `power_key` values per card. Reject one `power_key` mapping to conflicting display names. Return `powerCardCounts` plus observed Targets, observed Keywords, singleton count, recurring count, and public card names containing more than one singleton key. Build powers with stable source display names, replace singleton keys with `UNIQUE_POWER`, deduplicate after replacement, and sort recurring values with `localeCompare("en-US")` while placing `Unique Buff` last.

Build keyword sets in `CARD_KEYWORDS` order. For every canonical keyword, apply its corresponding `add_<lowercase>` and `remove_<lowercase>` upgrade flags, with removal taking precedence if malformed source sets both:

```ts
for (const keyword of CARD_KEYWORDS) {
  const suffix = keyword.toLowerCase();
  if (upgrade[`add_${suffix}`]) upgradedKeywords.add(keyword);
  if (upgrade[`remove_${suffix}`]) upgradedKeywords.delete(keyword);
}
```

Have `buildSnapshotLocked` sort raw cards, reject duplicate IDs, call `analyzeSourceFeatures(rawCards)`, then pass its immutable frequency map into every `normalizeCard` call. Emit manifest `schemaVersion: 2`.

- [ ] **Step 5: Write strict snapshot RED tests**

Require snapshot schema/validator acceptance for canonical arrays and rejection for unknown Target, missing feature keys, extra legacy boolean keys, duplicate/unsorted Powers, duplicate/out-of-order Keywords, unknown keywords, and manifest schema `1`.

Include a non-upgradable card whose cloned arrays have equal contents but distinct references; it must validate. Include a non-upgradable card with a different set member; it must fail.

- [ ] **Step 6: Implement strict snapshot validation**

Update `snapshot-schema.ts`, `domain.ts`, and `validate-snapshot.ts` to require manifest version `2` and validate all seven values. Compare arrays by length and element equality, not reference identity. Validate canonical power order with `Unique Buff` last and keyword order with `CARD_KEYWORDS`. Update `featureVectorsEqual` and `isFeatureVector` to understand arrays. Mechanically update every strict manifest fixture in the files listed above from version `1` to `2`; do not leave a dual-version acceptance path.

- [ ] **Step 7: Verify and commit Task 1**

```powershell
npm exec vitest run tests/server/normalize-card.test.ts tests/server/build-snapshot.test.ts tests/server/validate-snapshot.test.ts tests/server/spire-codex-client.test.ts tests/server/app.test.ts tests/server/prune-e2e-snapshots.test.ts tests/server/production-sync-boundary.test.ts tests/server/build-sprites.test.ts tests/client/load-snapshot.test.ts tests/client/use-game.test.tsx tests/shared/domain.test.ts
git diff --check
git add -- src/shared/domain.ts src/shared/snapshot-schema.ts src/server/spire-codex/schema.ts src/server/sync/normalize-card.ts src/server/sync/build-snapshot.ts src/server/sync/validate-snapshot.ts tests/fixtures/spire-cards.json tests/server/normalize-card.test.ts tests/server/build-snapshot.test.ts tests/server/validate-snapshot.test.ts tests/server/spire-codex-client.test.ts tests/server/app.test.ts tests/server/prune-e2e-snapshots.test.ts tests/server/production-sync-boundary.test.ts tests/server/build-sprites.test.ts tests/client/load-snapshot.test.ts tests/client/use-game.test.tsx tests/shared/domain.test.ts
git commit -m "feat: normalize target power and keyword features"
```

Expected: focused snapshot/domain tests pass. The repository-wide typecheck is intentionally deferred until Task 4 completes the atomic client-side `FeatureName` exhaustiveness migration; no compatibility feature aliases are introduced.

---

### Task 2: Generalize Comparison, Grouping, Sharing, and Orb Equality

**Files:**
- Modify: `src/shared/comparison.ts`
- Modify: `src/shared/feature-keys.ts`
- Modify: `src/client/game/assistance.ts`
- Modify: `tests/shared/comparison.test.ts`
- Modify: `tests/shared/groups.test.ts`
- Modify: `tests/shared/selection.test.ts`
- Modify: `tests/shared/share.test.ts`
- Modify: `tests/client/assistance.test.ts`

**Interfaces:**
- Produces `sameFeatureValue(feature, left, right): boolean` for scalar/array-aware equality.
- Produces `setsOverlap(left: readonly string[], right: readonly string[]): boolean`.
- Keeps `compareFeature(feature, guess, answer): FeatureResult` and `featurePairMatches(left, right, feature): boolean` signatures stable.
- Produces seven ordered comparison results and seven-symbol shares.

- [ ] **Step 1: Write set-comparison RED tests**

Cover exact, partial, disjoint, and empty cases with corresponding forms:

```ts
expect(compareFeature("powers", card(["Strength"], ["Strength"]), answer).color).toBe("green");
expect(compareFeature("powers", card(["Strength"], ["Weak"]), answer).color).toBe("yellow");
expect(compareFeature("powers", card(["Poison"], []), answer).color).toBe("red");
expect(compareFeature("keywords", card([], ["Innate"]), emptyBaseAnswer).color).toBe("yellow");
```

Require display strings `None`, `Strength, Weak`, and `Ethereal, Exhaust → Exhaust`.

- [ ] **Step 2: Run comparison RED**

```powershell
npm exec vitest run tests/shared/comparison.test.ts tests/client/assistance.test.ts
```

Expected: FAIL because arrays compare by identity and stringify with comma coercion rather than canonical formatting.

- [ ] **Step 3: Implement shared equality and formatting**

Use `feature === "powers" || feature === "keywords"` to route to array logic. Compute:

```ts
const green = baseExact && upgradeExact;
const yellow = !green && (baseExact || upgradeExact || baseOverlap || upgradeOverlap);
const color = green ? "green" : yellow ? "yellow" : "red";
```

Format arrays as `None` or comma-separated canonical values before applying the existing arrow formatter. Make `featurePairMatches` reuse `sameFeatureValue` for both forms so orbs and comparisons cannot drift.

- [ ] **Step 4: Write grouping/share/orb RED tests**

Require equal arrays with different identities to generate the same `baseKey` and `pairKey`; reordered/noncanonical arrays must be rejected before grouping. Require seven `FeatureResult` entries and a seven-character share row. Require Filter/Negation pair matching to distinguish complete set differences.

- [ ] **Step 5: Update canonical serialization and fixtures**

Keep `JSON.stringify` serialization in `feature-keys.ts`, but route every vector through the strict canonical domain. Mechanically replace legacy boolean fixture vectors throughout tests with:

```ts
target: "Self",
powers: [],
keywords: [],
```

Do not add compatibility aliases for the six removed feature names.

- [ ] **Step 6: Verify and commit Task 2**

```powershell
npm exec vitest run tests/shared/comparison.test.ts tests/shared/groups.test.ts tests/shared/selection.test.ts tests/shared/share.test.ts tests/client/assistance.test.ts
git diff --check
git add -- src/shared/comparison.ts src/shared/feature-keys.ts src/client/game/assistance.ts tests/shared/comparison.test.ts tests/shared/groups.test.ts tests/shared/selection.test.ts tests/shared/share.test.ts tests/client/assistance.test.ts
git commit -m "feat: compare set-valued card features"
```

Expected: focused comparison/group/share/orb tests pass. Repository-wide typecheck remains deferred to Task 4 because exhaustive client label/render records still target the old feature union.

---

### Task 3: Migrate Practice Filters and Browser Storage

**Files:**
- Modify: `src/client/game/practice-filter.ts`
- Modify: `src/client/game/storage.ts`
- Modify: `src/client/game/use-game.ts`
- Modify: `src/client/game/game-reducer.ts`
- Modify: `src/client/components/CardSearch.tsx`
- Modify: `tests/client/practice-filter.test.ts`
- Modify: `tests/client/storage.test.ts`
- Modify: `tests/client/use-game.test.tsx`
- Modify: `tests/client/game-reducer.test.ts`
- Modify: `tests/client/CardSearch.test.tsx`

**Interfaces:**
- Produces filter groups `cardClass`, `cardType`, `mana`, `rarity`, `target`, `powers`, and `keywords`.
- Produces independent sentinels `POWER_FILTER_NONE = "power:none"` and `KEYWORD_FILTER_NONE = "keyword:none"` so persisted unions cannot confuse the two groups.
- Keeps `classifyPracticeCandidate(card, filter): "both" | "base-only" | "upgrade-only" | null`.
- Bumps storage/ruleset constants to the exact values in Global Constraints.

- [ ] **Step 1: Write pure-filter RED tests**

Require option collection from snapshot values, including Target ordering, `Unique Buff`, and group-specific None last. Require scalar OR and set AND:

```ts
filter.target = { disabled: false, selected: ["Self", "AnyEnemy"] };
filter.powers = { disabled: false, selected: ["Strength", "Dexterity"] };
filter.keywords = { disabled: false, selected: ["Exhaust", "Unplayable"] };
```

Add Base-only and Upgrade-only keyword cases. Require each None sentinel to clear ordinary values in only its own group and match only a complete empty form.

- [ ] **Step 2: Run filter RED**

```powershell
npm exec vitest run tests/client/practice-filter.test.ts tests/client/CardSearch.test.tsx
```

Expected: FAIL because Target/Powers groups are absent and Keywords still indexes removed boolean fields.

- [ ] **Step 3: Implement the seven filter groups**

Collect Target from both vectors in `CARD_TARGETS` order. Collect Powers in canonical display order and Keywords in `CARD_KEYWORDS` order. Use `group.selected.every((value) => formSet.includes(value))` for enabled set groups; keep scalar `selected.includes(value)`. Preserve the rule that an enabled empty group matches no cards.

- [ ] **Step 4: Write storage migration RED tests**

Require `CURRENT_ROUND_VERSION === 5`, `DAILY_RULESET_VERSION === "v5"`, `HARDCORE_DAILY_RULESET_VERSION === "hardcore-v2"`, and `PRACTICE_RULESET_VERSION === "practice-v3"`. Verify an old version-4 envelope is removed and returns no round, while Daily stats and help-dismissal keys remain. Require strict rejection of duplicate, unknown, cross-group, noncanonical, and mixed-None filter values.

- [ ] **Step 5: Implement strict persistence reset**

Replace the Practice filter Zod shape with all seven groups. Do not migrate old guesses or filters. Existing load failure handling must remove only the incompatible current-round key. Keep `CURRENT_ROUND_KEYS`, Daily stats keys, and help dismissal keys unchanged.

- [ ] **Step 6: Verify and commit Task 3**

```powershell
npm exec vitest run tests/client/practice-filter.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx tests/client/game-reducer.test.ts tests/client/CardSearch.test.tsx
git diff --check
git add -- src/client/game/practice-filter.ts src/client/game/storage.ts src/client/game/use-game.ts src/client/game/game-reducer.ts src/client/components/CardSearch.tsx tests/client/practice-filter.test.ts tests/client/storage.test.ts tests/client/use-game.test.tsx tests/client/game-reducer.test.ts tests/client/CardSearch.test.tsx
git commit -m "feat: migrate practice filters to feature sets"
```

Expected: focused filter/storage/game tests pass and old rounds reset without touching unrelated local data. Task 4 completes the remaining UI exhaustiveness work before the first repository-wide typecheck.

---

### Task 4: Render the Seven-Column Grid, Filters, and Help

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/FeatureTile.tsx`
- Modify: `src/client/components/GuessGrid.tsx`
- Modify: `src/client/components/PracticeFilterPanel.tsx`
- Modify: `src/client/components/GameGuide.tsx`
- Delete: `src/client/components/KeywordStateIcons.tsx`
- Modify: `src/client/styles/grid.css`
- Modify: `src/client/styles/search.css`
- Modify: `src/client/styles/assistance.css`
- Modify: `README.md`
- Modify: `tests/client/app.test.tsx`
- Modify: `tests/client/AnswerReveal.test.tsx`
- Modify: `tests/client/FeatureTile.test.tsx`
- Modify: `tests/client/GuessGrid.test.tsx`
- Modify: `tests/client/GuessGrid.stale.test.tsx`
- Modify: `tests/client/PracticeFilterPanel.test.tsx`
- Modify: `tests/client/GameGuide.test.tsx`
- Delete: `tests/client/KeywordStateIcons.test.tsx`

**Interfaces:**
- Produces labels `Target`, `Powers`, and `Keywords` in `FEATURE_LABELS`.
- Removes boolean keyword icon rendering and `keywordAccessibleValue`.
- Keeps reveal/orb target roles and callbacks unchanged.
- Renders seven filter fieldsets in canonical feature order.

- [ ] **Step 1: Write component RED tests**

Require seven grid headers and `aria-colcount="8"`. Require textual Powers/Keywords values, complete accessible labels, `None`, and changed-set arrows. Require Practice panel order Class, Type, Mana, Rarity, Target, Powers, Keywords; Powers and Keywords None choices must be last.

Require the How to Play dialog to explain:

```text
Exact sets match green. Any corresponding overlap is yellow. No overlap is red.
```

Remove expectations for absent/present keyword icons.

- [ ] **Step 2: Run UI RED**

```powershell
npm exec vitest run tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx tests/client/app.test.tsx
```

Expected: FAIL because the UI still assumes ten columns and boolean keyword icons.

- [ ] **Step 3: Implement semantic textual rendering**

Render every feature through `result.displayValue`; no boolean icon conversion remains. Add modifier classes from the feature name:

```tsx
className={`feature-tile__value feature-tile__value--${result.feature}`}
```

Keep the existing full aria-label structure and reveal/orb targets. Render filter values through shared canonical Power/Keyword labels and this one explicit Target label map: `Self` = Self, `AnyEnemy` = Single Enemy, `AllEnemies` = All Enemies, `RandomEnemy` = Random Enemy, `AnyAlly` = Single Ally, `AllAllies` = All Allies, and `None` = None. Keep raw Target values in persistence and comparison; friendly labels are display-only.

- [ ] **Step 4: Implement compact responsive styling**

Change the grid to `76px repeat(7, minmax(86px, 1fr))` with a minimum width justified by browser measurement. Add smaller line-height/font rules for Powers and Keywords, permitting controlled wrapping. Add a `cardClass` modifier that reduces only `Necrobinder` enough to remain one line. Do not shrink tap targets below 44 CSS pixels.

- [ ] **Step 5: Update guide and README copy**

Replace the Keyword Icons section with one concise Set Features section. Update Manual Filter copy to state scalar OR, set AND, group AND, and group-specific None behavior. Update README feature/filter descriptions without exposing raw source schema details.

- [ ] **Step 6: Verify and commit Task 4**

```powershell
npm exec vitest run tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/AnswerReveal.test.tsx tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx tests/client/app.test.tsx
npm run typecheck
git diff --check
git add -- src/client/App.tsx src/client/components/FeatureTile.tsx src/client/components/GuessGrid.tsx src/client/components/PracticeFilterPanel.tsx src/client/components/GameGuide.tsx src/client/components/KeywordStateIcons.tsx src/client/styles/grid.css src/client/styles/search.css src/client/styles/assistance.css README.md tests/client/app.test.tsx tests/client/AnswerReveal.test.tsx tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx tests/client/GuessGrid.stale.test.tsx tests/client/PracticeFilterPanel.test.tsx tests/client/GameGuide.test.tsx tests/client/KeywordStateIcons.test.tsx
git commit -m "feat: render target power and keyword columns"
```

Expected: focused UI tests and typecheck pass; deleted keyword icon files are included.

---

### Task 5: Expose the Source-Feature Release Audit

**Files:**
- Modify: `src/server/release/release-snapshot.ts`
- Modify: `src/server/release/cli.ts`
- Modify: `tests/server/release-snapshot.test.ts`

**Interfaces:**
- Consumes Task 1 `analyzeSourceFeatures(cards)`.
- Adds `sourceFeatureAudit` to the released/unchanged `releaseSnapshot` result without exposing answer selection.
- Prints fixed-label Target, Power-frequency, multiple-singleton, and Keyword summaries before the final release status.

- [ ] **Step 1: Write release-audit RED tests**

Require both unchanged and forced releases to return:

```ts
sourceFeatureAudit: {
  targets: ["Self", "AnyEnemy", "AllEnemies"],
  singletonPowerKeyCount: 50,
  recurringPowerKeyCount: 11,
  cardsWithMultipleSingletonPowers: [],
  keywords: ["Eternal", "Ethereal", "Exhaust", "Innate", "Retain", "Sly", "Unplayable"],
}
```

Use small synthetic counts in unit fixtures rather than coupling tests to the live 577-card response. Add a CLI case with two singleton powers on one synthetic card and require its public card name in a fixed `Multiple unique powers:` line. Require raw errors, URLs, filesystem paths, and selected answer IDs to remain absent.

- [ ] **Step 2: Run release-audit RED**

```powershell
npm exec vitest run tests/server/release-snapshot.test.ts
```

Expected: FAIL because release results currently contain only status and source revision and the CLI prints one status line.

- [ ] **Step 3: Thread and print the immutable audit**

Immediately after `fetchCards`, call `analyzeSourceFeatures(fetched.cards)` once in `releaseSnapshot`. Return its serializable audit for unchanged and released results. Print only canonical fixed-label summaries:

```text
Targets: Self, AnyEnemy, AllEnemies, RandomEnemy, AnyAlly, AllAllies, None
Power keys: 50 singleton; 11 recurring
Multiple unique powers: none
Keywords: Eternal, Ethereal, Exhaust, Innate, Retain, Sly, Unplayable
```

When the multiple-singleton list is nonempty, print sorted public card names. Do not print descriptions, raw payloads, request metadata, or any game answer.

- [ ] **Step 4: Verify and commit Task 5**

```powershell
npm exec vitest run tests/server/release-snapshot.test.ts tests/server/normalize-card.test.ts
npm run typecheck
git diff --check
git add -- src/server/release/release-snapshot.ts src/server/release/cli.ts tests/server/release-snapshot.test.ts
git commit -m "feat: report snapshot feature audit"
```

Expected: focused tests/typecheck pass and the release transaction semantics remain unchanged.

---

### Task 6: Update Offline Fixtures and Browser Acceptance

**Files:**
- Modify: `tests/e2e/fixtures/cards.ts`
- Modify: `tests/e2e/fixtures/build-test-snapshot.ts`
- Modify: `tests/e2e/game.spec.ts`
- Modify: any fixture module imported by the E2E snapshot builder that still constructs legacy feature vectors

**Interfaces:**
- Produces a deterministic offline snapshot containing all seven Target values, a no-power card, singleton power, recurring power, two-power card, unchanged keywords, gained keyword, lost keyword, and `Unplayable`.
- Produces browser acceptance for seven columns, set colors, filters, orbs, shares, responsive layout, and storage reset.

- [ ] **Step 1: Write browser RED assertions against the old fixture**

Add deterministic flows that require:

1. seven feature headers and no individual keyword columns;
2. exact Powers/Keywords sets Green, partial overlap Yellow, and disjoint sets Red;
3. Keywords `base → upgraded` text;
4. Target direct comparison;
5. Reveal Orb displaying a full set;
6. Filter/Negation Orb matching canonical set pairs;
7. Practice Target OR, Powers AND, Keywords AND, and each None choice;
8. Base-only/Upgrade-only badges;
9. seven-symbol shares;
10. one-line `Necrobinder` and contained long set text at 390x844, 768x1024, and 1440x900.

- [ ] **Step 2: Run browser RED on an owned isolated server**

Use a free owned port and fresh Local Temp data root when port 3000 or the repository-local OneDrive path is unavailable. Preserve the normal-app official-request guard.

```powershell
npm run test:e2e
```

Expected: FAIL on the old ten-column fixture or missing new values before fixture migration.

- [ ] **Step 3: Migrate the fixture and make the flow deterministic**

Add explicit raw `target` and `powers_applied` values to fixture cards. Use known fixture identities rather than answer IDs discovered from secret runtime data. Keep both official-origin abort probes and require zero attempted official requests in every ordinary test.

- [ ] **Step 4: Run the full supported-runtime gate**

Run serially with no other test process:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: typecheck passes; all Vitest files pass; client/server production builds pass; all Playwright cases pass offline; diff check is clean.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- tests/e2e
git diff --cached --check
git commit -m "test: verify set-valued feature gameplay"
```

Expected: the commit contains fixture/browser acceptance only.

---

### Task 7: Rebuild, Audit, Publish, and Deploy the Snapshot Archive

**Files:**
- Modify through release tooling: `deploy/snapshot-data.tar.gz`
- Verify without editing: `Dockerfile`
- Verify without editing: `render.yaml`
- Verify without editing: `.dockerignore`

**Interfaces:**
- Consumes the complete snapshot generator and committed release CLI.
- Produces one strictly validated archive commit and pushes exact `master` to `origin/main` over SSH.

- [ ] **Step 1: Perform the pre-release review and clean-tree gate**

Review the complete design-to-HEAD diff for schema, comparison, persistence, secret safety, path containment, and official-network boundaries. Run:

```powershell
git status --short
git log --format="%H%n%B" origin/main..HEAD
npm run check
npm run test:e2e
git diff origin/main...HEAD --check
```

Expected: clean tree, all gates pass, and no commit contains `Co-Authored-By`.

- [ ] **Step 2: Push verified feature code to main**

```powershell
git remote -v
git push origin master:main
```

Expected: SSH origin is `git@github.com:Akirakato1/sts2dle.git` and `origin/main` advances to the verified feature HEAD.

- [ ] **Step 3: Run the forced snapshot release**

From clean synchronized `master`, run:

```powershell
npm run release:snapshot -- --force
```

Expected: the CLI fetches current stable English Codex data, builds the new schema-2 snapshot, reports source revision/counts/Target domain/power frequencies/multiple-singleton audit/keyword domain/groups/images, validates the archive, commits only `deploy/snapshot-data.tar.gz`, and pushes that commit to `main`.

- [ ] **Step 4: Independently validate the committed archive**

Run the committed artifact and deployment contracts:

```powershell
npm exec vitest run tests/deployment/committed-snapshot.test.ts tests/deployment/render-config.test.ts tests/server/release-snapshot.test.ts
npm run typecheck
git status --short
git diff --check
```

Extract the archive to a fresh Local Temp directory, run strict `validateSnapshot`, and record compressed/uncompressed sizes, archive SHA-256, source revision, 577-style card counts from the actual release, all seven Targets, singleton/recurring power totals, multiple-singleton card list, complete keyword domain including Unplayable, group counts, and sprite/fallback invariants. Remove only the owned extraction directory afterward.

- [ ] **Step 5: Verify Render and live gameplay**

Wait for Render to mark the archive commit Live. Confirm `/health`, `/runtime/cards.json`, candidate atlas, and guess atlas return 200 and the health revision matches the committed manifest. In a real browser, smoke-test the seven headers, Powers/Keywords set colors, arrow text, Target, Practice filters, orbs, seven-symbol share, `Necrobinder`, all three viewport widths, and zero console errors.

- [ ] **Step 6: Final handoff**

Report exact feature and archive commit SHAs, source revision, test counts, archive hash/size, Render deploy status, and any current multiple-singleton cards. Confirm the tracked tree is clean, no local server remains unless the user explicitly requests one, and no startup sync or production Playwright dependency was introduced.
