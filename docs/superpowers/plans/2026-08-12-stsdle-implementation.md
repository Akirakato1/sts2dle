# STS-dle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable Slay the Spire 2 daily/practice card guessing game that synchronizes Spire Codex data at server startup, compares base and upgraded card features together, and uses local artwork sprites plus CDN full-card reveals.

**Architecture:** A Fastify TypeScript server performs one atomic synchronization before listening, then serves a Vite/React client and the active snapshot. Shared pure TypeScript modules own card features, deterministic two-stage answer selection, paired comparison, and share output so server and browser use identical rules.

**Tech Stack:** Node.js 22+, TypeScript, npm, Fastify, React, Vite, Zod, Sharp, Playwright Chromium, Vitest, Testing Library, and Playwright Test.

## Global Constraints

- Use stable English data from `https://spire-codex.com/api/cards?lang=eng`.
- Identify a source revision with SHA-256 of the exact cards response body; record `Last-Modified` separately.
- Respect Spire Codex rate limits with one card-data request and artwork concurrency no greater than four.
- Do not copy the dashboard's PolyForm Noncommercial Spire Codex parser code.
- Vendor only the existing JavaScript card renderer, required render assets/fonts, and their attribution for missing full-card fallbacks.
- There is one paired-card ruleset. Do not add Base, Mixed, or Version modes/columns.
- Candidates are base card identities only.
- Keep feature order fixed as Class, Type, Mana, Rarity, Eternal, Ethereal, Exhaust, Innate, Retain, Sly, Unplayable.
- Select a base feature group uniformly, then a card uniformly within that group.
- Daily rollover is `00:00 UTC`; Practice never changes Daily progress.
- Ordinary gameplay is client-side and uses no database or per-guess server request.
- Host only the two sprite atlases and exceptional renderer fallbacks; load ordinary full cards directly from Spire Codex CDN URLs.
- Use test-driven development and make the focused commit listed at the end of each task.
- Do not add `Co-Authored-By` trailers to commits.

---

## Planned file structure

```text
package.json                         npm scripts and dependencies
package-lock.json                    reproducible dependency graph
tsconfig.base.json                   shared strict TypeScript options
tsconfig.server.json                 server build target
vite.config.ts                       React build and development proxy
vitest.config.ts                     node/jsdom test configuration
tests/setup.ts                       Testing Library DOM matchers
playwright.config.ts                 browser acceptance configuration
.gitignore                           generated snapshots, builds, coverage
.env.example                         port/data-directory settings

src/shared/domain.ts                 canonical card/snapshot types and feature order
src/shared/feature-keys.ts           stable base/pair serialization
src/shared/groups.ts                 base and paired group construction
src/shared/random.ts                 deterministic/practice random sources
src/shared/selection.ts              approved two-stage answer selection
src/shared/comparison.ts             green/yellow/red paired comparison and mana hints
src/shared/share.ts                  non-spoiling Daily clipboard text
src/shared/snapshot-schema.ts        Zod schemas for browser-loaded snapshots

src/server/config.ts                 environment parsing
src/server/spire-codex/schema.ts     hosted API Zod schemas
src/server/spire-codex/client.ts     cards fetch and response metadata
src/server/sync/normalize-card.ts    raw API card to domain identity
src/server/sync/build-snapshot.ts    synchronization orchestration
src/server/sync/validate-snapshot.ts complete snapshot validation/report
src/server/sync/snapshot-store.ts    staging and atomic active pointer
src/server/images/build-sprites.ts   bounded downloads and two WebP atlases
src/server/images/renderer-adapter.ts public-schema to renderer config adapter
src/server/images/fallback-renderer.ts Playwright wrapper around vendored renderer
src/server/app.ts                    Fastify static application factory
src/server/main.ts                   sync-before-listen process entry point

src/client/main.tsx                  React browser entry point
src/client/App.tsx                   Daily/Practice application shell
src/client/api/load-snapshot.ts      active snapshot loader
src/client/game/game-reducer.ts      round state transitions
src/client/game/use-game.ts          Daily/Practice orchestration
src/client/game/storage.ts           versioned localStorage persistence
src/client/game/preload-images.ts    hidden accepted-answer image preloader
src/client/components/CardSearch.tsx prefix autocomplete/listbox
src/client/components/SpriteArt.tsx  coordinate-based sprite display
src/client/components/GuessGrid.tsx  sticky art plus eleven feature columns
src/client/components/FeatureTile.tsx flip tile and mana hint
src/client/components/AnswerReveal.tsx accepted-answer collection
src/client/components/CardStack.tsx  base/upgraded swap interaction
src/client/components/SharePanel.tsx Daily share and Practice replay actions
src/client/styles/*.css              focused shell/search/grid/reveal styles

vendor/card-renderer/renderer.js     existing MIT JavaScript renderer
vendor/card-renderer/assets/**       existing dashboard render assets
vendor/card-renderer/fonts/**        Kreon fonts used by the renderer
THIRD_PARTY_NOTICES.md               Spire Codex, renderer, game-data attribution

tests/fixtures/spire-cards.json      minimal raw API fixture with edge cases
tests/shared/*.test.ts               rules and selection tests
tests/server/*.test.ts               sync, image, store, and server tests
tests/client/*.test.tsx              component and state tests
tests/e2e/game.spec.ts               browser acceptance path
README.md                            development, synchronization, and deployment guide
```

### Task 1: Project foundation and canonical domain contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `.gitignore`
- Create: `src/shared/domain.ts`
- Create: `tests/shared/domain.test.ts`

**Interfaces:**
- Produces: `FEATURE_ORDER`, `FeatureVector`, `CardIdentity`, `SnapshotManifest`, `BaseGroup`, `PairGroup`, and `SpriteMap`.
- Consumes: none.

- [ ] **Step 1: Add package/build configuration and the first failing domain test**

Create `package.json` with these scripts and dependencies:

```json
{
  "name": "stsdle",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -k \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch src/server/main.ts",
    "dev:client": "vite",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "start": "node dist/server/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.base.json --noEmit",
    "check": "npm run typecheck && npm test && npm run build"
  },
  "dependencies": {
    "@fastify/static": "^8",
    "fastify": "^5",
    "playwright": "^1",
    "react": "^19",
    "react-dom": "^19",
    "sharp": "^0.34",
    "zod": "^4"
  },
  "devDependencies": {
    "@playwright/test": "^1",
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@types/node": "^24",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^5",
    "concurrently": "^9",
    "jsdom": "^26",
    "tsx": "^4",
    "typescript": "^5",
    "vite": "^7",
    "vitest": "^3"
  }
}
```

Configure strict ESM TypeScript in `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "*.config.ts", "vite.config.ts"]
}
```

Create `tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/server/**/*.ts", "src/shared/**/*.ts"]
}
```

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { proxy: { "/runtime": "http://127.0.0.1:3000", "/health": "http://127.0.0.1:3000" } },
});
```

Create `vitest.config.ts` and `tests/setup.ts`:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});

// tests/setup.ts
import "@testing-library/jest-dom/vitest";
```

Client test files begin with `// @vitest-environment jsdom`; server/shared tests remain in Node.

Create `.gitignore` with generated/runtime-only paths:

```gitignore
node_modules/
dist/
var/
.tmp/
coverage/
.env
playwright-report/
test-results/
```

Write `tests/shared/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FEATURE_ORDER } from "../../src/shared/domain.js";

describe("FEATURE_ORDER", () => {
  it("keeps the approved eleven-column order", () => {
    expect(FEATURE_ORDER).toEqual([
      "cardClass", "cardType", "mana", "rarity",
      "eternal", "ethereal", "exhaust", "innate",
      "retain", "sly", "unplayable",
    ]);
  });
});
```

- [ ] **Step 2: Install dependencies and verify the test fails**

Run:

```powershell
npm install
npx playwright install chromium
npm test -- tests/shared/domain.test.ts
```

Expected: FAIL because `src/shared/domain.ts` does not exist.

- [ ] **Step 3: Add the canonical shared types**

Create `src/shared/domain.ts` with the exact feature names and serializable contracts:

```ts
export const FEATURE_ORDER = [
  "cardClass", "cardType", "mana", "rarity",
  "eternal", "ethereal", "exhaust", "innate",
  "retain", "sly", "unplayable",
] as const;

export type FeatureName = (typeof FEATURE_ORDER)[number];
export type CardClass =
  | "Ironclad" | "Silent" | "Defect" | "Necrobinder"
  | "Regent" | "Neutral" | "Event";
export type CardType = "Attack" | "Skill" | "Power" | "Quest" | "Status" | "Curse";
export type CardRarity = "Common" | "Uncommon" | "Rare" | "None";
export type ManaValue = number | "X" | "–";

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
  unplayable: boolean;
}

export interface CardIdentity {
  id: string;
  name: string;
  hasUpgrade: boolean;
  artUrl: string;
  baseCardUrl: string | null;
  upgradedCardUrl: string | null;
  base: FeatureVector;
  upgraded: FeatureVector;
}

export interface BaseGroup { key: string; cardIds: string[] }
export interface PairGroup { key: string; cardIds: string[] }

export interface SpriteRect { x: number; y: number; width: number; height: number }
export interface SpriteAtlasMeta { url: string; width: number; height: number; displayScale: number }
export interface SpriteMap {
  candidate: SpriteAtlasMeta;
  guess: SpriteAtlasMeta;
  cards: Record<string, { candidate: SpriteRect; guess: SpriteRect }>;
}

export interface SnapshotManifest {
  schemaVersion: 1;
  sourceRevision: string;
  sourceLastModified: string | null;
  fetchedAt: string;
  generatedAt: string;
  cardCount: number;
  upgradeCount: number;
  baseGroupCount: number;
  pairGroupCount: number;
  files: Record<string, string>;
}
```

- [ ] **Step 4: Run unit and type checks**

Run:

```powershell
npm test -- tests/shared/domain.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json tsconfig.base.json tsconfig.server.json vite.config.ts vitest.config.ts tests/setup.ts .gitignore src/shared/domain.ts tests/shared/domain.test.ts
git commit -m "chore: scaffold STS-dle domain"
```

### Task 2: Spire Codex schema and card normalization

**Files:**
- Create: `src/server/spire-codex/schema.ts`
- Create: `src/server/sync/normalize-card.ts`
- Create: `tests/fixtures/spire-cards.json`
- Create: `tests/server/normalize-card.test.ts`

**Interfaces:**
- Consumes: `CardIdentity`, `FeatureVector`, and enums from `src/shared/domain.ts`.
- Produces: `RawSpireCard`, `RawSpireCardsSchema`, and `normalizeCard(raw, baseUrl): CardIdentity`.

- [ ] **Step 1: Add a focused API fixture and failing normalization tests**

The fixture must contain complete raw records for:

- Alchemize: numeric cost upgrade.
- Afterimage: `add_innate` with no upgraded description.
- Apparition: `remove_ethereal`.
- Mad Science: Event class, missing full-card URLs, and `type_variants`.
- One non-upgradable Status or Curse card.
- One X-cost card.

Use this minimal schema-valid fixture shape; retain the named edge cases exactly:

```json
[
  {"id":"ALCHEMIZE","name":"Alchemize","color":"colorless","type":"Skill","rarity":"Rare","cost":1,"is_x_cost":null,"description":"Create a potion.","upgrade_description":null,"keywords_key":["Exhaust"],"upgrade":{"cost":0},"image_url":"/static/images/cards/alchemize.webp","image_url_card":"https://cdn.test/alchemize.webp","image_url_card_upg":"https://cdn.test/alchemize_upg.webp"},
  {"id":"AFTERIMAGE","name":"Afterimage","color":"silent","type":"Power","rarity":"Rare","cost":1,"is_x_cost":null,"description":"Whenever you play a card, gain 1 Block.","upgrade_description":null,"keywords_key":null,"upgrade":{"add_innate":1},"image_url":"/static/images/cards/afterimage.webp","image_url_card":"https://cdn.test/afterimage.webp","image_url_card_upg":"https://cdn.test/afterimage_upg.webp"},
  {"id":"APPARITION","name":"Apparition","color":"event","type":"Skill","rarity":"Event","cost":1,"is_x_cost":null,"description":"Gain 1 Intangible.","upgrade_description":null,"keywords_key":["Exhaust","Ethereal"],"upgrade":{"remove_ethereal":1},"image_url":"/static/images/cards/apparition.webp","image_url_card":"https://cdn.test/apparition.webp","image_url_card_upg":"https://cdn.test/apparition_upg.webp"},
  {"id":"MAD_SCIENCE","name":"Mad Science","color":"event","type":"Attack","rarity":"Event","cost":1,"is_x_cost":null,"description":"Deal 12 damage.","upgrade_description":null,"keywords_key":null,"upgrade":{"add_innate":1},"image_url":"/static/images/cards/mad_science_attack.webp","image_url_card":null,"image_url_card_upg":null,"type_variants":{"attack":{"type":"Attack","description":"Deal 12 damage."}}},
  {"id":"DAZED","name":"Dazed","color":"status","type":"Status","rarity":"Status","cost":-2,"is_x_cost":null,"description":"","upgrade_description":null,"keywords_key":["Unplayable","Ethereal"],"upgrade":null,"image_url":"/static/images/cards/dazed.webp","image_url_card":"https://cdn.test/dazed.webp","image_url_card_upg":null},
  {"id":"MALAISE","name":"Malaise","color":"silent","type":"Skill","rarity":"Rare","cost":-1,"is_x_cost":true,"description":"Apply X Weak.","upgrade_description":"Apply X+1 Weak.","keywords_key":["Exhaust"],"upgrade":{"weak":"+1"},"image_url":"/static/images/cards/malaise.webp","image_url_card":"https://cdn.test/malaise.webp","image_url_card_upg":"https://cdn.test/malaise_upg.webp"}
]
```

Write tests asserting:

```ts
expect(normalizeCard(afterimage, BASE_URL).upgraded.innate).toBe(true);
expect(normalizeCard(apparition, BASE_URL).upgraded.ethereal).toBe(false);
expect(normalizeCard(alchemize, BASE_URL).upgraded.mana).toBe(0);
expect(normalizeCard(status, BASE_URL).base.cardClass).toBe("Neutral");
expect(normalizeCard(madScience, BASE_URL).base.cardClass).toBe("Event");
expect(normalizeCard(xCost, BASE_URL).base.mana).toBe("X");
expect(normalizeCard(nonUpgradable, BASE_URL).upgraded)
  .toEqual(normalizeCard(nonUpgradable, BASE_URL).base);
```

- [ ] **Step 2: Run the normalization test and verify it fails**

Run: `npm test -- tests/server/normalize-card.test.ts`

Expected: FAIL because the schema and normalizer do not exist.

- [ ] **Step 3: Define a permissive-but-validated hosted API schema**

Create `RawSpireCardSchema` with required `id`, `name`, `color`, `type`, `rarity`, `cost`, and image/upgrade fields. Allow unknown dynamic upgrade variables while validating their values:

```ts
const UpgradeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const UpgradeSchema = z.record(z.string(), UpgradeValueSchema);

export const RawSpireCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  type: z.string().min(1),
  rarity: z.string().nullable(),
  cost: z.number().nullable(),
  is_x_cost: z.boolean().nullable().optional(),
  star_cost: z.union([z.number(), z.string()]).nullable().optional(),
  description: z.string().default(""),
  upgrade_description: z.string().nullable().optional(),
  keywords_key: z.array(z.string()).nullable().optional(),
  upgrade: UpgradeSchema.nullable().optional(),
  image_url: z.string().nullable(),
  image_url_card: z.string().nullable(),
  image_url_card_upg: z.string().nullable(),
  type_variants: z.unknown().nullable().optional(),
}).passthrough();

export const RawSpireCardsSchema = z.array(RawSpireCardSchema);
export type RawSpireCard = z.infer<typeof RawSpireCardSchema>;
```

- [ ] **Step 4: Implement exact class, type, rarity, mana, and keyword normalization**

Use these rules in `normalize-card.ts`:

```ts
const CLASS_BY_COLOR = {
  ironclad: "Ironclad",
  silent: "Silent",
  defect: "Defect",
  necrobinder: "Necrobinder",
  regent: "Regent",
  event: "Event",
  colorless: "Neutral",
  token: "Neutral",
  quest: "Neutral",
  status: "Neutral",
  curse: "Neutral",
} as const;

const KEYWORDS = [
  "eternal", "ethereal", "exhaust", "innate",
  "retain", "sly", "unplayable",
] as const;

function normalizeMana(cost: number | null, isX: boolean | null | undefined): ManaValue {
  if (isX || cost === -1) return "X";
  if (!Number.isInteger(cost) || cost === null || cost < 0) return "–";
  return cost;
}
```

Normalize type and rarity with rejecting switches so future source enums cannot silently enter feature keys:

```ts
function normalizeType(value: string): CardType {
  if (["Attack", "Skill", "Power", "Quest", "Status", "Curse"].includes(value)) {
    return value as CardType;
  }
  throw new Error("Unsupported card type: " + value);
}

function normalizeRarity(value: string | null): CardRarity {
  if (value === "Common" || value === "Uncommon" || value === "Rare") return value;
  return "None";
}
```

Build base keyword flags from case-insensitive `keywords_key`. Copy them for upgrade, then apply truthy `add_<keyword>` and `remove_<keyword>` values. A non-empty `upgrade` object is the authoritative `hasUpgrade` signal; do not use `upgrade_description` because 105 current upgrades change only cost/keywords. Use `upgrade.cost` when numeric, otherwise base cost. Require `image_url` and resolve it with `new URL(path, baseUrl)`; retain nullable full-card URLs for the later fallback stage.

- [ ] **Step 5: Run tests and type checking**

Run:

```powershell
npm test -- tests/server/normalize-card.test.ts
npm run typecheck
```

Expected: PASS, including exact effective-upgrade fallback equality.

- [ ] **Step 6: Commit**

```powershell
git add src/server/spire-codex/schema.ts src/server/sync/normalize-card.ts tests/fixtures/spire-cards.json tests/server/normalize-card.test.ts
git commit -m "feat: normalize Spire Codex cards"
```

### Task 3: Canonical keys, grouping, selection, and paired comparison

**Files:**
- Create: `src/shared/feature-keys.ts`
- Create: `src/shared/groups.ts`
- Create: `src/shared/random.ts`
- Create: `src/shared/selection.ts`
- Create: `src/shared/comparison.ts`
- Create: `tests/shared/groups.test.ts`
- Create: `tests/shared/selection.test.ts`
- Create: `tests/shared/comparison.test.ts`

**Interfaces:**
- Consumes: normalized `CardIdentity[]`.
- Produces: `baseKey`, `pairKey`, `buildGroups`, `RandomSource`, `selectAnswer`, and `compareGuess`.

- [ ] **Step 1: Write failing key and grouping tests**

Test that object property order cannot change a key, cards with equal base vectors share a base group, and only cards with both equal base and upgraded vectors share a pair group:

```ts
expect(baseKey(cardA.base)).toBe(baseKey(cardB.base));
expect(pairKey(cardA)).not.toBe(pairKey(cardWithDifferentUpgrade));
expect(buildGroups([cardB, cardA]).baseGroups[0]?.cardIds)
  .toEqual([cardA.id, cardB.id].sort());
```

- [ ] **Step 2: Run grouping tests and verify they fail**

Run: `npm test -- tests/shared/groups.test.ts`

Expected: FAIL because key/group modules do not exist.

- [ ] **Step 3: Implement stable serialization and group construction**

Serialize values only in `FEATURE_ORDER` and encode the pair as two canonical keys:

```ts
export function baseKey(vector: FeatureVector): string {
  return FEATURE_ORDER.map((name) => JSON.stringify(vector[name])).join("|");
}

export function pairKey(card: Pick<CardIdentity, "base" | "upgraded">): string {
  return baseKey(card.base) + "||" + baseKey(card.upgraded);
}
```

`buildGroups(cards)` must sort group keys and every `cardIds` array. Return `baseGroups`, `pairGroups`, and lookup maps for later selection.

- [ ] **Step 4: Write failing deterministic and two-stage selection tests**

Use a scripted random source:

```ts
const scriptedValues = [1, 0];
const scripted: RandomSource = {
  nextUint32: () => scriptedValues.shift() ?? 0,
};

const result = selectAnswer(groups, cardsById, scripted);
expect(result.baseGroupKey).toBe(groups.baseGroups[1]?.key);
expect(result.selectedCardId).toBe(groups.baseGroups[1]?.cardIds[0]);
expect(result.acceptedCardIds).toEqual(
  groups.pairGroupsByKey.get(result.pairKey)?.cardIds,
);
```

Also test that `nextIndex` rejects modulo-bias tail values instead of using `value % max` blindly.

- [ ] **Step 5: Implement random sources and approved answer selection**

Define:

```ts
export interface RandomSource { nextUint32(): number }

export function nextIndex(source: RandomSource, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError("maxExclusive must be a positive integer");
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  let value: number;
  do value = source.nextUint32() >>> 0;
  while (value >= limit);
  return value % maxExclusive;
}
```

`createDailyRandom(utcDate, sourceRevision)` hashes `stsdle:v1:<date>:<revision>` with `crypto.subtle.digest("SHA-256", ...)`, seeds sfc32 with four digest words, and returns a `RandomSource`:

```ts
export async function createDailyRandom(date: string, revision: string): Promise<RandomSource> {
  const seed = new TextEncoder().encode(["stsdle", "v1", date, revision].join(":"));
  const digest = await crypto.subtle.digest("SHA-256", seed);
  const words = new DataView(digest);
  let a = words.getUint32(0, false);
  let b = words.getUint32(4, false);
  let c = words.getUint32(8, false);
  let d = words.getUint32(12, false);
  return {
    nextUint32() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      const t = (a + b + d) >>> 0;
      d = (d + 1) >>> 0;
      a = (b ^ (b >>> 9)) >>> 0;
      b = (c + (c << 3)) >>> 0;
      c = ((c << 21) | (c >>> 11)) >>> 0;
      c = (c + t) >>> 0;
      return t;
    },
  };
}

export function createPracticeRandom(): RandomSource {
  return {
    nextUint32() {
      return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    },
  };
}
```

Add one test with a fixed date/revision and hard-code the first four generated integers after running the implementation once; that vector prevents accidental Daily-answer changes during later refactors.

`selectAnswer` calls `nextIndex` once for `baseGroups`, once for the chosen group's `cardIds`, then resolves the chosen card's pair group. It must never choose from the flat card list.

Return this serializable contract:

```ts
export interface SelectedAnswer {
  baseGroupKey: string;
  selectedCardId: string;
  pairKey: string;
  acceptedCardIds: string[];
}
```

- [ ] **Step 6: Write failing paired-comparison tests**

Cover all result states and display forms:

```ts
expect(compareFeature("rarity", samePair, answer).color).toBe("green");
expect(compareFeature("mana", baseOnlyMatch, answer)).toMatchObject({
  color: "yellow",
  hint: "down",
  displayValue: "2 → 1",
});
expect(compareFeature("mana", crossingCosts, answer)).toMatchObject({
  color: "red",
  hint: "both",
});
expect(compareFeature("mana", xAgainstNumber, answer).hint).toBe("dash");
```

- [ ] **Step 7: Implement comparison without special-casing keywords**

Expose:

```ts
export type TileColor = "green" | "yellow" | "red";
export type ManaHint = "none" | "up" | "down" | "dash" | "both" | "up-dash" | "down-dash";

export interface FeatureResult {
  feature: FeatureName;
  color: TileColor;
  displayValue: string;
  hint: ManaHint;
}

export function compareGuess(guess: CardIdentity, answer: CardIdentity): FeatureResult[];
```

Color is green for two matches, yellow for exactly one, and red for neither. Format changed guessed values as `Base → Upgraded`; format unchanged values once. Mana arrows point from guess toward answer. Merge two mismatching hints exactly as specified: equal hints collapse, opposite numeric hints become `both`, and numeric plus non-comparable becomes `up-dash` or `down-dash`.

- [ ] **Step 8: Run all shared tests and type checking**

Run:

```powershell
npm test -- tests/shared
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/shared tests/shared
git commit -m "feat: add paired card game rules"
```

### Task 4: Spire Codex client and atomic snapshot store

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/spire-codex/client.ts`
- Create: `src/server/sync/snapshot-store.ts`
- Create: `tests/server/spire-codex-client.test.ts`
- Create: `tests/server/snapshot-store.test.ts`

**Interfaces:**
- Consumes: `RawSpireCardsSchema`.
- Produces: `SpireCodexClient.fetchCards(): Promise<FetchedCards>`, `loadConfig(env)`, and `SnapshotStore`.

- [ ] **Step 1: Write failing API-client tests with an injected fetch**

Test one exact request to `/api/cards?lang=eng`, response-body hashing, `Last-Modified`, schema rejection, non-2xx rejection, timeout, and rate-limit context:

```ts
const client = new SpireCodexClient({
  baseUrl: "https://example.test",
  fetchImpl: async (url) => new Response(JSON.stringify(fixture), {
    headers: { "Last-Modified": "Tue, 11 Aug 2026 15:34:42 GMT" },
  }),
});

const result = await client.fetchCards();
expect(result.cards).toHaveLength(fixture.length);
expect(result.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
expect(result.lastModified).toBe("Tue, 11 Aug 2026 15:34:42 GMT");
```

- [ ] **Step 2: Run the client test and verify it fails**

Run: `npm test -- tests/server/spire-codex-client.test.ts`

Expected: FAIL because `SpireCodexClient` does not exist.

- [ ] **Step 3: Implement configuration and the API client**

`loadConfig` must parse:

```ts
export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  spireCodexBaseUrl: string;
  requestTimeoutMs: number;
  artworkConcurrency: number;
  skipSync: boolean;
}
```

Defaults are `127.0.0.1`, port `3000`, `./var`, `https://spire-codex.com`, 30 seconds, concurrency four, and `skipSync: false`. Only `STSDLE_SKIP_SYNC=1` enables fixture/offline startup. Reject concurrency above four.

Implement `fetchCards` by reading `response.text()` once, hashing that exact UTF-8 text with Node `createHash("sha256")`, then parsing JSON and Zod. Use `AbortSignal.timeout(requestTimeoutMs)`. Include URL, HTTP status, `retry-after`, and `x-ratelimit-remaining` in typed error context without logging the response body.

Return:

```ts
export interface FetchedCards {
  cards: RawSpireCard[];
  rawBody: string;
  sourceRevision: string;
  lastModified: string | null;
  fetchedAt: string;
}
```

- [ ] **Step 4: Write failing atomic-store tests**

Test a temporary data directory:

```ts
const store = new SnapshotStore(tempDir);
const staging = await store.createStaging("abc123");
await writeFile(join(staging.path, "manifest.json"), "{}");
await staging.activate();

expect(JSON.parse(await readFile(join(tempDir, "active.json"), "utf8")))
  .toEqual({ buildId: staging.buildId });
```

Also create an existing valid active pointer, abort a second staging build, and assert the pointer still references the first build.

- [ ] **Step 5: Implement staging and pointer activation**

`SnapshotStore.createStaging(sourceRevision)` creates:

```text
<dataDir>/snapshots/<revision-prefix>-<timestamp>.staging/
```

`activate()` renames the staging directory to remove `.staging`, writes `active.json.tmp`, fsyncs it, and renames it over `active.json`. It returns the activated directory. It never deletes the previous build during activation.

Expose `loadActive(): Promise<{ buildId: string; path: string } | null>` and reject pointers that escape `<dataDir>/snapshots`.

- [ ] **Step 6: Run server tests**

Run:

```powershell
npm test -- tests/server/spire-codex-client.test.ts tests/server/snapshot-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/server/config.ts src/server/spire-codex/client.ts src/server/sync/snapshot-store.ts tests/server/spire-codex-client.test.ts tests/server/snapshot-store.test.ts
git commit -m "feat: add Codex client and snapshot store"
```

### Task 5: Deterministic artwork sprite pipeline

**Files:**
- Create: `src/server/images/build-sprites.ts`
- Create: `tests/server/build-sprites.test.ts`

**Interfaces:**
- Consumes: sorted `CardIdentity[]`, an injected `fetch`, and output directory.
- Produces: `buildSprites(options): Promise<SpriteMap>` and `candidate.webp`/`guess.webp`.

- [ ] **Step 1: Write failing sprite tests using generated solid-color images**

Generate three in-memory WebP fixtures with Sharp. Mock `fetch` by URL and assert:

```ts
const map = await buildSprites({
  cards,
  outputDir,
  fetchImpl,
  concurrency: 2,
});

expect(map.cards.CARD_A?.candidate).toEqual({
  x: 0, y: 0, width: 64, height: 64,
});
expect(await sharp(join(outputDir, "candidate.webp")).metadata())
  .toMatchObject({ width: 128, height: 128 });
expect(await sharp(join(outputDir, "guess.webp")).metadata())
  .toMatchObject({ width: 320, height: 320 });
```

Assert each art URL is fetched once even though two atlases are produced, packing is stable after input shuffling, and concurrency never exceeds the configured value.

- [ ] **Step 2: Run the sprite test and verify it fails**

Run: `npm test -- tests/server/build-sprites.test.ts`

Expected: FAIL because `buildSprites` does not exist.

- [ ] **Step 3: Implement bounded downloads and deterministic packing**

Sort cards by stable ID. Use:

```ts
const columns = Math.ceil(Math.sqrt(cards.length));
const rows = Math.ceil(cards.length / columns);
```

Download with a four-worker queue, validate successful image responses and non-empty bytes, and reuse each downloaded buffer for both cell sizes.

For each atlas, resize with:

```ts
await sharp(source)
  .resize(cellSize, cellSize, { fit: "cover", position: "centre" })
  .webp({ quality: cellSize === 64 ? 76 : 82 })
  .toBuffer();
```

Composite cells onto a transparent atlas. Candidate uses 64-pixel cells and `displayScale: 0.5`; guess uses 160-pixel cells and `displayScale: 0.5`. Reject an atlas dimension above 8192 pixels.

- [ ] **Step 4: Validate failures are all-or-nothing**

Add tests for a missing URL, HTTP failure, invalid image bytes, duplicate card ID, and out-of-range concurrency. Assert neither final WebP exists after a rejected build.

Implement temporary filenames and rename both only after both encodes and the complete coordinate map succeed.

- [ ] **Step 5: Run tests and inspect image metadata**

Run:

```powershell
npm test -- tests/server/build-sprites.test.ts
npm run typecheck
```

Expected: PASS with deterministic dimensions and coordinates.

- [ ] **Step 6: Commit**

```powershell
git add src/server/images/build-sprites.ts tests/server/build-sprites.test.ts
git commit -m "feat: build card artwork sprites"
```

### Task 6: Vendor and wrap the existing JavaScript fallback renderer

**Files:**
- Create: `vendor/card-renderer/renderer.js`
- Create: `vendor/card-renderer/assets/**`
- Create: `vendor/card-renderer/fonts/kreon_bold.ttf`
- Create: `vendor/card-renderer/fonts/kreon_regular.ttf`
- Create: `src/server/images/renderer-adapter.ts`
- Create: `src/server/images/fallback-renderer.ts`
- Create: `tests/server/renderer-adapter.test.ts`
- Create: `tests/server/fallback-renderer.test.ts`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Consumes: `RawSpireCard`, normalized feature/upgrade information, raw portrait URL, and output path.
- Produces: `buildRendererConfig(raw, upgraded)` and `FallbackRenderer.render(raw, upgraded, destination)`.

- [ ] **Step 1: Copy only the approved renderer files and assets**

Run from the repository root:

```powershell
New-Item -ItemType Directory -Force vendor/card-renderer/assets
New-Item -ItemType Directory -Force vendor/card-renderer/fonts
Copy-Item "C:\Users\zhuyl\OneDrive\Desktop\sts2_stats\Release Version\scripts\render\renderer.js" "vendor/card-renderer/renderer.js"
Copy-Item "C:\Users\zhuyl\OneDrive\Desktop\sts2_stats\Release Version\card render assets\*" "vendor/card-renderer/assets" -Recurse
Copy-Item "C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\fonts\kreon_bold.ttf" "vendor/card-renderer/fonts/kreon_bold.ttf"
Copy-Item "C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\fonts\kreon_regular.ttf" "vendor/card-renderer/fonts/kreon_regular.ttf"
```

Do not copy `scripts/parsers`, `simplifier.js`, extracted card JSON, or any parser-derived source file.

- [ ] **Step 2: Make the vendored renderer's asset base injectable**

Change only the renderer asset helper:

```js
const A = (sub) => {
  const base = globalThis.STSDLE_CARD_ASSET_BASE || "cardassets:///";
  return base.replace(/\/$/, "") + "/" + sub;
};
```

Leave rendering geometry, color tables, and drawing code unchanged. Keep its CommonJS/window exports.

- [ ] **Step 3: Write failing adapter tests**

Assert that:

- Base Alchemize uses cost 1 and Exhaust.
- Upgraded Alchemize uses cost 0.
- Upgraded Afterimage prepends Innate even with no upgraded description.
- Upgraded Apparition removes Ethereal.
- Mad Science uses its canonical Attack variant and Event rarity.

Expected renderer config:

```ts
interface RendererConfig {
  card_name: string;
  description: string;
  card_type: string;
  character: string;
  rarity: string;
  cost: string;
  star_cost: string | number | null;
  upgraded: boolean;
  cost_green: false;
  portrait_url: string;
}
```

- [ ] **Step 4: Implement an original public-schema adapter**

Do not port dashboard parser/simplifier code. Build description lines from the hosted fields:

1. Start with `upgrade_description || description` when upgraded, otherwise `description`.
2. Compute the effective keyword set with the same normalizer helper.
3. Prepend Unplayable and Innate lines when present.
4. Append Ethereal, Retain, Sly, Exhaust, and Eternal lines when present.
5. Use API `type`, `color`, rarity, cost, star cost, and raw `image_url`.

Use the renderer's direct `renderCard` API, not its legacy dashboard `adapt(row)` function.

- [ ] **Step 5: Write a failing headless render test**

Render the Mad Science base and upgrade fixture to a temporary directory. Assert both outputs are valid 400 × 520 WebP images, differ in content hash, and the Chromium process closes even when a second render is forced to fail.

- [ ] **Step 6: Implement the Playwright wrapper**

`FallbackRenderer` must:

1. Launch one headless Chromium instance for a fallback batch.
2. Route `https://stsdle.local/assets/**` to files under `vendor/card-renderer/assets`.
3. Route `https://stsdle.local/fonts/**` to the two vendored fonts.
4. Fetch the portrait server-side and route it as `https://stsdle.local/portrait.webp`.
5. Set page content containing `@font-face`, a canvas host, `STSDLE_CARD_ASSET_BASE`, and the vendored renderer script.
6. Await `window.cardRender.renderer.preload()`.
7. Create the portrait `Image`, call `renderCard(config)`, and return its PNG bytes.
8. Resize to a 400 × 520 transparent canvas with Sharp using `fit: "contain"` so the renderer's 748 × 876 output is never distorted, then encode WebP.
9. Close page and browser in `finally`.

Only call this wrapper when `image_url_card` or the required `image_url_card_upg` is missing.

- [ ] **Step 7: Add exact third-party notices**

`THIRD_PARTY_NOTICES.md` must identify:

- Spire Codex hosted API, community-use terms, and requested attribution.
- Mega Crit ownership of Slay the Spire 2 data/art.
- The WanderZil card maker and local JavaScript port under MIT.
- The source path and names of the copied render assets/fonts.
- A statement that no Spire Codex parser source was copied.

- [ ] **Step 8: Run renderer tests**

Run:

```powershell
npm test -- tests/server/renderer-adapter.test.ts tests/server/fallback-renderer.test.ts
npm run typecheck
```

Expected: PASS and no lingering Chromium process.

- [ ] **Step 9: Commit**

```powershell
git add vendor/card-renderer src/server/images/renderer-adapter.ts src/server/images/fallback-renderer.ts tests/server/renderer-adapter.test.ts tests/server/fallback-renderer.test.ts THIRD_PARTY_NOTICES.md
git commit -m "feat: add fallback card renderer"
```

### Task 7: Snapshot builder, validation, and sync-before-listen server

**Files:**
- Create: `src/server/sync/build-snapshot.ts`
- Create: `src/server/sync/validate-snapshot.ts`
- Create: `src/server/app.ts`
- Create: `src/server/main.ts`
- Create: `tests/server/build-snapshot.test.ts`
- Create: `tests/server/validate-snapshot.test.ts`
- Create: `tests/server/app.test.ts`
- Create: `.env.example`

**Interfaces:**
- Consumes: `SpireCodexClient`, normalizer, group builder, sprite builder, fallback renderer, and `SnapshotStore`.
- Produces: `buildSnapshot(deps): Promise<ActivatedSnapshot>`, `validateSnapshot`, and `createApp`.

- [ ] **Step 1: Write a failing snapshot integration test**

Inject fixture cards, image responses, a fake fallback renderer, and a temporary store:

```ts
const activated = await buildSnapshot({
  client: fixtureClient,
  store,
  fetchImpl: fixtureImages.fetch,
  fallbackRenderer: fakeRenderer,
  now: () => new Date("2026-08-12T00:00:00Z"),
});

expect(activated.manifest.cardCount).toBe(fixture.length);
expect(activated.manifest.baseGroupCount).toBeGreaterThan(0);
expect(await pathExists(join(activated.path, "candidate.webp"))).toBe(true);
expect(await store.loadActive()).toMatchObject({ buildId: activated.buildId });
```

Assert the fake renderer is called for Mad Science base and upgrade only.

- [ ] **Step 2: Run the snapshot test and verify it fails**

Run: `npm test -- tests/server/build-snapshot.test.ts`

Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Implement snapshot file creation**

`buildSnapshot` must:

1. Fetch and normalize cards sorted by ID.
2. Reject duplicate IDs. Record duplicate display names so the client can show the class label while continuing to use stable IDs for identity.
3. Build base and pair groups.
4. Create a staging build.
5. Build both sprites into staging.
6. Render missing base/upgraded full-card fallbacks and replace missing reveal URLs with `/runtime/fallback/<id>[_upg].webp`.
7. Write `cards.json`, `base-groups.json`, `pair-groups.json`, and `sprite-map.json` using stable JSON ordering.
8. Hash every emitted JSON/image file except `manifest.json`, put those hashes in `manifest.files`, then write `manifest.json` last so there is no self-hash cycle.
9. Validate the complete staging directory.
10. Activate it and return its path/manifest.

Use one helper `writeStableJson(path, value)` that writes UTF-8 JSON plus a final newline.

Return:

```ts
export interface ActivatedSnapshot {
  buildId: string;
  path: string;
  manifest: SnapshotManifest;
  report: SnapshotAcceptanceReport;
}
```

- [ ] **Step 4: Write and implement strict snapshot validation**

Tests must corrupt one property at a time and expect a specific failure:

- Card count/upgrade count mismatch.
- Unknown or duplicated group card ID.
- Card missing from its expected base or pair group.
- Sprite rectangle outside atlas bounds.
- Missing sprite or JSON file.
- Missing both remote and fallback full-card URL.
- Unknown class/type/rarity/mana/keyword value.
- File hash mismatch.

`validateSnapshot(path)` returns an acceptance report containing card, upgrade, base-group, pair-group, missing-image, sprite-dimension, and encoded-size counts. It throws a list of card-specific issues when any invariant fails.

```ts
export interface SnapshotAcceptanceReport {
  cardCount: number;
  upgradeCount: number;
  baseGroupCount: number;
  pairGroupCount: number;
  baseGroupHistogram: Record<string, number>;
  pairGroupHistogram: Record<string, number>;
  missingRawArtCardIds: string[];
  fallbackCardIds: string[];
  candidateSprite: { width: number; height: number; bytes: number };
  guessSprite: { width: number; height: number; bytes: number };
}
```

- [ ] **Step 5: Write failing Fastify lifecycle tests**

Use Fastify injection to assert:

```ts
const app = await createApp({ clientRoot, snapshotRoot });
expect((await app.inject({ url: "/runtime/manifest.json" })).statusCode).toBe(200);
expect((await app.inject({ url: "/non-route" })).headers["content-type"])
  .toContain("text/html");
```

Also test that `main` does not call `listen` when sync rejects with no prior snapshot, and does use the last active snapshot when refresh fails.

- [ ] **Step 6: Implement sync-before-listen server startup**

`createApp` registers:

- `/runtime/` static files rooted at the activated snapshot directory.
- Vite's built client directory as ordinary static files.
- SPA fallback to `index.html`.
- `/health` returning active source revision and generated time.
- Fastify structured logging without card payloads.

`main.ts` performs:

```ts
const config = loadConfig(process.env);
const store = new SnapshotStore(config.dataDir);
let active: ActivatedSnapshot;
if (config.skipSync) {
  const prior = await store.loadActive();
  if (!prior) throw new Error("STSDLE_SKIP_SYNC requires a validated active snapshot");
  active = await loadActivatedSnapshot(prior.path);
} else try {
  active = await buildSnapshot(createProductionDependencies(config, store));
} catch (error) {
  const prior = await store.loadActive();
  if (!prior) throw error;
  active = await loadActivatedSnapshot(prior.path);
}
const app = await createApp({ config, snapshotRoot: active.path });
await app.listen({ host: config.host, port: config.port });
```

`loadActivatedSnapshot` reruns manifest/file-hash validation before a prior build can be served; an invalid prior snapshot is treated the same as no prior snapshot.

Create `.env.example`:

```dotenv
STSDLE_HOST=127.0.0.1
STSDLE_PORT=3000
STSDLE_DATA_DIR=./var
SPIRE_CODEX_BASE_URL=https://spire-codex.com
STSDLE_REQUEST_TIMEOUT_MS=30000
STSDLE_ARTWORK_CONCURRENCY=4
STSDLE_SKIP_SYNC=0
```

- [ ] **Step 7: Run server verification**

Run:

```powershell
npm test -- tests/server
npm run typecheck
npm run build:server
```

Expected: PASS. The test suite uses fixtures and makes no live API request.

- [ ] **Step 8: Commit**

```powershell
git add src/server tests/server .env.example
git commit -m "feat: synchronize and serve card snapshots"
```

### Task 8: React shell and Daily/Practice round state

**Files:**
- Create: `index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/api/load-snapshot.ts`
- Create: `src/shared/snapshot-schema.ts`
- Create: `src/client/game/game-reducer.ts`
- Create: `src/client/game/use-game.ts`
- Create: `src/client/game/preload-images.ts`
- Create: `src/client/styles/shell.css`
- Create: `tests/client/load-snapshot.test.ts`
- Create: `tests/client/game-reducer.test.ts`
- Create: `tests/client/use-game.test.tsx`

**Interfaces:**
- Consumes: active snapshot JSON, `selectAnswer`, `createDailyRandom`, `createPracticeRandom`, and `compareGuess`.
- Produces: `LoadedSnapshot`, `RoundState`, `gameReducer`, and `useGame(snapshot)`.

- [ ] **Step 1: Write failing snapshot-loader tests**

Mock five JSON requests and assert all cross-references are assembled:

```ts
const snapshot = await loadSnapshot(fetchImpl);
expect(snapshot.manifest.sourceRevision).toBe("revision");
expect(snapshot.cardsById.get("ALCHEMIZE")?.name).toBe("Alchemize");
expect(snapshot.pairGroupsByKey.get(pairKey)?.cardIds).toContain("ALCHEMIZE");
```

Reject a non-2xx response, a manifest/cards count mismatch, or a group referencing an unknown card.

- [ ] **Step 2: Implement the snapshot loader**

Fetch in parallel:

```text
/runtime/manifest.json
/runtime/cards.json
/runtime/base-groups.json
/runtime/pair-groups.json
/runtime/sprite-map.json
```

Parse with Zod schemas in `src/shared/snapshot-schema.ts` that mirror `SnapshotManifest`, `CardIdentity`, `BaseGroup`, `PairGroup`, and `SpriteMap`. Return arrays plus `cardsById` and `pairGroupsByKey` lookup maps. Include the failed URL in load errors.

```ts
export interface LoadedSnapshot {
  manifest: SnapshotManifest;
  cards: CardIdentity[];
  baseGroups: BaseGroup[];
  pairGroups: PairGroup[];
  spriteMap: SpriteMap;
  cardsById: Map<string, CardIdentity>;
  pairGroupsByKey: Map<string, PairGroup>;
}
```

- [ ] **Step 3: Write failing reducer and hook tests**

Define state transitions for loading, switching Daily/Practice, submitting a valid card, rejecting a duplicate, winning with a pair-equivalent card, and starting a new Practice round:

```ts
const next = gameReducer(round, { type: "submit", card: guess });
expect(next.guesses[0]?.results).toHaveLength(11);
expect(next.status).toBe("playing");

const won = gameReducer(round, { type: "submit", card: acceptedEquivalent });
expect(won.status).toBe("won");
```

Mock `2026-08-12T12:00:00Z`; two Daily hook mounts with the same revision must select the same answer. Practice's `nextRound` must consume fresh random draws.

- [ ] **Step 4: Implement round state and answer initialization**

Use these public state shapes:

```ts
export type PlayMode = "daily" | "practice";
export type RoundStatus = "playing" | "won";

export interface SubmittedGuess {
  cardId: string;
  results: FeatureResult[];
}

export interface RoundState {
  mode: PlayMode;
  answer: SelectedAnswer;
  guesses: SubmittedGuess[];
  status: RoundStatus;
  error: string | null;
}
```

`useGame` awaits Daily random creation using the UTC date and `manifest.sourceRevision`. Practice uses `createPracticeRandom`. Submission looks up the base card, computes results against the selected card, and wins when the guessed card's `pairKey` equals the answer pair.

- [ ] **Step 5: Preload accepted full-card images without displaying them**

`preloadAnswerImages(answer, cardsById)` creates `Image` objects for every accepted base URL and existing upgraded URL, calls `decode()` when available, and resolves after all settle. It never blocks input or treats a failed preload as a lost round.

- [ ] **Step 6: Build the React loading/error shell**

`App` loads the snapshot once, shows a retryable load error, and renders Daily/Practice tabs plus a brief paired-comparison explanation. The selected tab must use `aria-current` or tab roles. Do not implement search/grid markup in this task; expose focused component slots with typed props.

Use a conventional Vite entry:

```html
<div id="root"></div>
<script type="module" src="/src/client/main.tsx"></script>
```

```tsx
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Run client state tests and build**

Run:

```powershell
npm test -- tests/client/load-snapshot.test.ts tests/client/game-reducer.test.ts tests/client/use-game.test.tsx
npm run typecheck
npm run build:client
```

Expected: PASS and Vite emits `dist/client`.

- [ ] **Step 8: Commit**

```powershell
git add index.html src/client src/shared/snapshot-schema.ts tests/client vite.config.ts
git commit -m "feat: add Daily and Practice game state"
```

### Task 9: Prefix autocomplete and sprite-backed artwork

**Files:**
- Create: `src/client/components/SpriteArt.tsx`
- Create: `src/client/components/CardSearch.tsx`
- Create: `src/client/styles/search.css`
- Create: `tests/client/CardSearch.test.tsx`
- Create: `tests/client/SpriteArt.test.tsx`

**Interfaces:**
- Consumes: `CardIdentity[]`, `SpriteMap`, current guessed-card IDs, and `onSelect(cardId)`.
- Produces: accessible base-name autocomplete and reusable candidate/guess sprite rendering.

- [ ] **Step 1: Write failing autocomplete behavior tests**

Testing Library tests must prove:

- Empty input shows no menu.
- `a` matches names beginning with A, not names merely containing A.
- Matching is case-insensitive.
- Results are alphabetical.
- A guessed card is disabled/omitted.
- ArrowDown/ArrowUp changes active option.
- Enter and click select exactly one card.
- Escape closes the menu.
- Blur does not prevent a pointer selection.

Example:

```tsx
await user.type(screen.getByRole("combobox"), "ap");
expect(screen.getAllByRole("option").map((node) => node.textContent))
  .toEqual(["Apotheosis", "Apparition"]);
expect(screen.queryByText("Scrap")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run autocomplete tests and verify they fail**

Run: `npm test -- tests/client/CardSearch.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement pure prefix search and listbox semantics**

Normalize search with `trim().toLocaleLowerCase("en-US")`; use `startsWith`; sort with `localeCompare("en-US")`. Render a combobox with `aria-controls`, `aria-expanded`, `aria-activedescendant`, and listbox options. Cap menu height rather than truncating results.

Keep filtering pure and separately testable:

```ts
export function searchCards(cards: CardIdentity[], query: string, excluded: Set<string>): CardIdentity[] {
  const prefix = query.trim().toLocaleLowerCase("en-US");
  if (!prefix) return [];
  return cards
    .filter((card) => !excluded.has(card.id))
    .filter((card) => card.name.toLocaleLowerCase("en-US").startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || left.id.localeCompare(right.id));
}
```

If two cards have the same display name, show a subtle class label and use the stable card ID for option identity.

- [ ] **Step 4: Write failing sprite coordinate tests**

For a candidate rectangle at source `x=128,y=64,width=64,height=64` with display scale 0.5, assert:

```ts
expect(art).toHaveStyle({
  width: "32px",
  height: "32px",
  backgroundPosition: "-64px -32px",
});
```

Also test guess-art sizing at 80 pixels and text-only fallback for an absent map entry.

- [ ] **Step 5: Implement coordinate-based SpriteArt**

Calculate displayed atlas and position values by multiplying every source dimension/coordinate by `displayScale`. Use the atlas URL from `SpriteMap`, `background-repeat: no-repeat`, and an accessible label supplied by the caller. Do not emit one `<img>` request per card.

- [ ] **Step 6: Style and integrate the search**

Match LoLdle's centered interaction pattern without copying its assets:

- 32-pixel candidate art.
- Fixed-height scroll menu.
- 44-pixel minimum pointer targets.
- Strong keyboard focus.
- Search menu layered above the grid.
- Mobile width constrained to the viewport.

Wire `CardSearch` into `App` and dispatch valid selections to `useGame.submitGuess`.

- [ ] **Step 7: Run tests**

Run:

```powershell
npm test -- tests/client/CardSearch.test.tsx tests/client/SpriteArt.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/client/components/CardSearch.tsx src/client/components/SpriteArt.tsx src/client/styles/search.css tests/client/CardSearch.test.tsx tests/client/SpriteArt.test.tsx src/client/App.tsx
git commit -m "feat: add card autocomplete"
```

### Task 10: Eleven-column comparison grid and flip sequence

**Files:**
- Create: `src/client/components/FeatureTile.tsx`
- Create: `src/client/components/GuessGrid.tsx`
- Create: `src/client/styles/grid.css`
- Create: `tests/client/FeatureTile.test.tsx`
- Create: `tests/client/GuessGrid.test.tsx`

**Interfaces:**
- Consumes: `SubmittedGuess[]`, `CardIdentity` lookups, `FeatureResult[]`, and guess sprite metadata.
- Produces: accessible sticky-art result table with staggered feature reveals.

- [ ] **Step 1: Write failing tile tests**

Assert:

- Green/yellow/red classes and visible guessed value.
- `2 → 1` paired display.
- Red/yellow up/down arrows.
- Dash for X/non-comparable.
- Both arrows for crossing costs.
- No arrow on green.
- Reduced-motion mode skips the transform delay.

```tsx
render(<FeatureTile result={{
  feature: "mana",
  color: "yellow",
  displayValue: "2 → 1",
  hint: "down",
}} revealIndex={2} />);
expect(screen.getByText("↓")).toHaveClass("feature-tile__hint--yellow");
```

- [ ] **Step 2: Run tile tests and verify they fail**

Run: `npm test -- tests/client/FeatureTile.test.tsx`

Expected: FAIL because the tile does not exist.

- [ ] **Step 3: Implement one tile with semantic result text**

Set CSS variables `--reveal-index` and `--tile-color`; use a 3D front/back surface. The accessible label must include feature label, guessed base/upgraded value, result color, and mana direction. Map hints:

```ts
const HINT_TEXT: Record<ManaHint, string> = {
  none: "",
  up: "↑",
  down: "↓",
  dash: "–",
  both: "↑↓",
  "up-dash": "↑ –",
  "down-dash": "↓ –",
};
```

- [ ] **Step 4: Write failing grid tests**

Assert one sticky artwork/name cell and eleven feature headers in `FEATURE_ORDER`, exactly eleven tiles per guess, the first guess above later guesses, 80-pixel sprite art, and no Version column.

- [ ] **Step 5: Implement the scrollable result grid**

Use CSS Grid with:

```css
grid-template-columns: 96px repeat(11, minmax(88px, 1fr));
min-width: 1120px;
```

Place the grid inside an overflow-x container. Make the first column sticky with its own background/z-index. Feature headers remain in the same scroll container. Use a 110ms reveal stagger, starting only after artwork appears.

Under `@media (prefers-reduced-motion: reduce)`, remove transform transitions and delay. Use color-independent text/symbol labels so red/green distinction is not the only signal.

- [ ] **Step 6: Integrate the grid and prevent animation replay**

Newly submitted rows animate once. Restored Daily guesses render in their final state. Track `animateFromIndex` in client state rather than using timeouts that mutate persisted results.

- [ ] **Step 7: Run grid tests and build**

Run:

```powershell
npm test -- tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx
npm run typecheck
npm run build:client
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/client/components/FeatureTile.tsx src/client/components/GuessGrid.tsx src/client/styles/grid.css tests/client/FeatureTile.test.tsx tests/client/GuessGrid.test.tsx src/client/App.tsx
git commit -m "feat: reveal paired feature comparisons"
```

### Task 11: Answer stacks, persistence, UTC rollover, and sharing

**Files:**
- Create: `src/client/components/CardStack.tsx`
- Create: `src/client/components/AnswerReveal.tsx`
- Create: `src/client/components/SharePanel.tsx`
- Create: `src/client/game/storage.ts`
- Create: `src/shared/share.ts`
- Create: `src/client/styles/reveal.css`
- Create: `tests/client/CardStack.test.tsx`
- Create: `tests/client/AnswerReveal.test.tsx`
- Create: `tests/client/storage.test.ts`
- Create: `tests/shared/share.test.ts`

**Interfaces:**
- Consumes: accepted card IDs, reveal URLs, completed `RoundState`, snapshot revision, and UTC clock.
- Produces: swap interaction, versioned Daily persistence, UTC rollover, and `formatDailyShare`.

- [ ] **Step 1: Write failing card-stack tests**

For a card with an upgrade, assert the base card begins front/unmasked, the upgrade begins diagonally offset/gray, click and Enter swap them, and a second activation restores base. For a non-upgradable card, assert one image and no button semantics.

- [ ] **Step 2: Implement accessible base/upgraded swapping**

`CardStack` uses one button bounding both images when `hasUpgrade` is true. Track `front: "base" | "upgraded"`. Move both cards with transforms and transfer a pseudo-element gray mask; do not modify image opacity enough to make text unreadable.

Use:

```css
.card-stack { width: clamp(190px, 24vw, 280px); aspect-ratio: 400 / 520; }
.card-stack__back { transform: translate(18px, 18px) scale(.97); }
```

Respect reduced motion. Provide an aria-label such as “Show upgraded Alchemize” that changes after swapping.

- [ ] **Step 3: Write and implement accepted-answer reveal tests**

`AnswerReveal` must render every ID from `answer.acceptedCardIds`, sorted alphabetically by base name. Wide screens wrap a grid; narrow screens use horizontal scroll with snap points. A failed image keeps the answer name, displays a retry button, and does not remove other accepted answers.

- [ ] **Step 4: Write failing storage and rollover tests**

Use a fake Storage and clock:

```ts
const key = dailyStorageKey({
  sourceRevision: "abc",
  utcDate: "2026-08-12",
  ruleset: "v1",
});
expect(key).toBe("stsdle:daily:v1:abc:2026-08-12");
```

Test round-trip restoration, corrupt JSON isolation, snapshot/date separation, no animation replay, and `msUntilNextUtcDay` across month/year boundaries. Also test the global Daily streak rules: first completed UTC day starts at one, the immediately following UTC day increments, a missed day resets to one, and a second snapshot completed on the same UTC date does not increment twice.

- [ ] **Step 5: Implement versioned persistence**

Persist only serializable answer IDs, guesses/results, and status in the date/revision key. Re-resolve card objects from the active snapshot after load. Validate stored JSON before use; delete only the invalid key. Practice may persist the current unfinished round under a separate non-streak key.

Store streaks independently of snapshot revisions so a game patch does not reset them:

```ts
export interface DailyStats {
  lastCompletedUtcDate: string | null;
  currentStreak: number;
  maxStreak: number;
}

export const DAILY_STATS_KEY = "stsdle:stats:v1";
```

On a Daily win, compare the new UTC date to `lastCompletedUtcDate`: same date leaves stats unchanged; exactly one calendar day later increments; any other later date starts a new streak at one. Update `maxStreak` with the larger value. Practice never reads or writes this key.

`useGame` schedules one rollover timer for the next UTC midnight and rechecks the UTC date when the document becomes visible, covering suspended browser timers.

- [ ] **Step 6: Write failing share-format tests**

Expected shape:

```text
STS-dle 2026-08-12 4/∞
🟥🟩🟨↓🟥🟩🟩🟥🟩🟥🟩🟩
🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩
https://example.test/
```

Tests must assert no guessed/answer names, IDs, feature values, image URLs, or Practice share output.

- [ ] **Step 7: Implement sharing and panels**

`formatDailyShare({ utcDate, guesses, siteUrl })` emits eleven colored symbols per guess in `FEATURE_ORDER`. Append the mana hint immediately after the third symbol when non-empty. `SharePanel` uses `navigator.clipboard.writeText`, reports success/failure accessibly, appears only after a Daily win, and shows “Next random card” instead for Practice.

- [ ] **Step 8: Run persistence/reveal/share tests**

Run:

```powershell
npm test -- tests/client/CardStack.test.tsx tests/client/AnswerReveal.test.tsx tests/client/storage.test.ts tests/shared/share.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/client/components/CardStack.tsx src/client/components/AnswerReveal.tsx src/client/components/SharePanel.tsx src/client/game/storage.ts src/shared/share.ts src/client/styles/reveal.css tests/client tests/shared/share.test.ts src/client/App.tsx src/client/game/use-game.ts
git commit -m "feat: reveal and share Daily answers"
```

### Task 12: End-to-end acceptance, responsive polish, and operations documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/game.spec.ts`
- Create: `tests/e2e/fixtures/build-test-snapshot.ts`
- Create: `src/client/styles/global.css`
- Create: `README.md`
- Modify: `src/client/App.tsx`
- Modify: `src/server/main.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the completed server/client and fixture snapshot builder.
- Produces: full-browser acceptance coverage and production runbook.

- [ ] **Step 1: Create a deterministic end-to-end fixture command**

Add `npm run fixture:snapshot` that builds a complete temporary snapshot from `tests/fixtures/spire-cards.json` and generated artwork, without network access. Inject a deterministic test fallback that writes a solid 400 × 520 Sharp image for Mad Science instead of launching Chromium. Start the server with:

```powershell
$env:STSDLE_DATA_DIR = ".tmp/e2e-var"
$env:STSDLE_SKIP_SYNC = "1"
npm run fixture:snapshot
npm run dev:server
```

`STSDLE_SKIP_SYNC=1` is allowed only when an already validated active snapshot exists; otherwise startup fails.

Add these package scripts:

```json
{
  "scripts": {
    "fixture:snapshot": "tsx tests/e2e/fixtures/build-test-snapshot.ts",
    "start:e2e": "npm run build && npm run fixture:snapshot && node dist/server/main.js"
  }
}
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:3000/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      STSDLE_HOST: "127.0.0.1",
      STSDLE_PORT: "3000",
      STSDLE_DATA_DIR: ".tmp/e2e-var",
      STSDLE_SKIP_SYNC: "1"
    }
  }
});
```

- [ ] **Step 2: Write failing browser acceptance tests**

Cover one coherent Daily path:

1. Load the game and see the paired-rules explanation.
2. Type a prefix and verify alphabetical candidates/art sprites.
3. Submit an incorrect guess and wait for eleven revealed tiles.
4. Verify at least one yellow paired result and a mana arrow from the fixture.
5. Refresh and verify the guess is restored without replaying flips.
6. Submit a pair-equivalent accepted answer and win.
7. Verify all accepted answer stacks.
8. Swap an upgraded card forward with click and keyboard.
9. Copy a Daily summary and assert it contains no card name.
10. Switch to Practice, finish, request a new round, and confirm no share button.

Add a separate viewport matrix for 390 × 844, 768 × 1024, and 1440 × 900. Assert the page itself has no horizontal overflow while the guess-grid scroller does.

- [ ] **Step 3: Run E2E and verify it fails at the first missing integration**

Run: `npm run test:e2e`

Expected: FAIL with a specific missing selector or integration behavior, not fixture/network failure.

- [ ] **Step 4: Finish cohesive styling and accessibility**

Add a Slay the Spire-inspired but original dark parchment/ember palette using CSS gradients and system-safe effects. Do not copy LoLdle images or CSS. Verify:

- Minimum 4.5:1 text contrast for ordinary text.
- Visible focus rings.
- 44-pixel interactive targets.
- Labels on search, tabs, tiles, card stacks, share, and retry controls.
- No information conveyed by color alone.
- Reduced-motion paths for flips and stack swaps.
- Sticky artwork remains legible over scrolled tiles.

- [ ] **Step 5: Add startup acceptance logging**

After validation, log one structured event containing:

```ts
{
  sourceRevision,
  sourceLastModified,
  cardCount,
  upgradeCount,
  baseGroupCount,
  pairGroupCount,
  baseGroupHistogram,
  pairGroupHistogram,
  candidateSpriteBytes,
  guessSpriteBytes,
  fallbackCardCount,
}
```

Never log card response bodies or localStorage content.

- [ ] **Step 6: Write the operating guide**

`README.md` must include exact commands for:

- Node/npm prerequisites and `npm install`.
- Chromium installation.
- Development client/server.
- Fixture-only tests.
- Full `npm run check` and E2E.
- Production build and `npm start`.
- Writable `STSDLE_DATA_DIR`.
- Restart-on-patch synchronization behavior.
- Previous-snapshot fallback.
- CDN/full-card and local-sprite responsibilities.
- UTC Daily behavior and same-day source-revision changes.
- Spire Codex/Mega Crit/renderer attribution links.

- [ ] **Step 7: Run complete verification**

Run in this order:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: every command exits 0. Confirm the test server performs no live Spire Codex request.

- [ ] **Step 8: Perform one live startup acceptance run**

With an empty disposable data directory, run the production server once against Spire Codex. Verify logs report:

- 577 current stable cards or the new patch's authoritative count.
- No duplicate/missing guessable IDs.
- Every card has both sprite cells.
- All groups and file hashes validate.
- Only cards lacking CDN full images invoke the fallback renderer.
- The server begins listening only after activation.

Stop the server, restart with the same source data, and verify the Daily answer remains stable because the content revision is unchanged.

- [ ] **Step 9: Commit**

```powershell
git add playwright.config.ts tests/e2e src/client/styles/global.css src/client/App.tsx src/server/main.ts package.json package-lock.json README.md
git commit -m "test: verify complete STS-dle experience"
```

## Final implementation verification

After all twelve task commits:

1. Run `git status --short` and require a clean worktree.
2. Run `npm run check` and `npm run test:e2e` from a fresh process.
3. Inspect the startup acceptance report for the live snapshot.
4. Open Daily at desktop and phone widths and complete a round.
5. Confirm the share text contains no card identity.
6. Confirm all accepted answer stacks swap base/upgraded cards.
7. Confirm Practice can repeat indefinitely without changing Daily storage.
8. Confirm the active snapshot can fall back after a deliberately mocked refresh failure.
