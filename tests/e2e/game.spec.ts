import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";

import {
  type BaseGroup,
  type CardIdentity,
  type FeatureName,
  type PairGroup,
  type SnapshotManifest,
} from "../../src/shared/domain.js";
import { compareGuess, formatFeatureValue } from "../../src/shared/comparison.js";
import { createDailyRandom } from "../../src/shared/random.js";
import { selectAnswer, type SelectedAnswer } from "../../src/shared/selection.js";
import {
  installOfficialCodexBlock,
  type OfficialCodexNetworkGuard,
} from "./support/offline-network.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
const FIXED_UTC_DATE = FIXED_NOW.toISOString().slice(0, 10);
const APP_ROOT = `${process.env.STSDLE_E2E_ORIGIN ?? "http://127.0.0.1:3000"}/`;
const PRACTICE_ROUND_IDS = [
  "practice:00000000-0000-4000-8000-000000000001",
  "practice:00000000-0000-4000-8000-000000000002",
  "practice:00000000-0000-4000-8000-000000000003",
] as const;
const FEATURE_LABELS: Readonly<Record<FeatureName, string>> = {
  cardClass: "Class",
  cardType: "Type",
  mana: "Mana",
  rarity: "Rarity",
  eternal: "Eternal",
  ethereal: "Ethereal",
  exhaust: "Exhaust",
  innate: "Innate",
  retain: "Retain",
  sly: "Sly",
};

interface FixtureModel {
  cards: CardIdentity[];
  manifest: SnapshotManifest;
  dailyAnswer: SelectedAnswer;
  hardcoreAnswer: SelectedAnswer;
  practiceAnswer: SelectedAnswer;
  dailyEquivalent: CardIdentity;
  hardcoreEquivalent: CardIdentity;
  dailyWrongGuesses: CardIdentity[];
  hardcoreWrongGuesses: CardIdentity[];
  practiceWrongGuess: CardIdentity;
  orbFixture: {
    guess: CardIdentity;
    greenFeature: FeatureName;
    redFeature: FeatureName;
    dualCandidate: CardIdentity;
  };
  wrongGuesses: readonly [CardIdentity, CardIdentity];
}

interface AtlasReadiness {
  urls: { candidate: string; guess: string };
  responses: Map<string, Response>;
}

interface FullCardFailureGate {
  allow: boolean;
  url: string;
}

test("offline network guard aborts both official Codex origins", async ({ page }) => {
  const guard = await installOfficialCodexBlock(page);
  const probeUrls = [
    "https://spire-codex.com/__stsdle_e2e_probe__",
    "https://cdn.spire-codex.com/__stsdle_e2e_probe__",
  ];

  const rejected = await page.evaluate(async (urls) => Promise.all(urls.map(async (url) => {
    try {
      await fetch(url);
      return false;
    } catch {
      return true;
    }
  })), probeUrls);

  expect(rejected).toEqual([true, true]);
  expect(guard.attemptedRequests).toEqual(probeUrls);
  expect(guard.blockedRequests).toEqual(probeUrls);
});

async function loadFixtureModel(request: APIRequestContext): Promise<FixtureModel> {
  const [manifest, cards, baseGroups, pairGroups] = await Promise.all([
    request.get("/runtime/manifest.json").then((response) => response.json() as Promise<SnapshotManifest>),
    request.get("/runtime/cards.json").then((response) => response.json() as Promise<CardIdentity[]>),
    request.get("/runtime/base-groups.json").then((response) => response.json() as Promise<BaseGroup[]>),
    request.get("/runtime/pair-groups.json").then((response) => response.json() as Promise<PairGroup[]>),
  ]);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const pairGroupsByKey = new Map(pairGroups.map((group) => [group.key, group]));
  const groups = {
    baseGroups,
    pairGroups,
    pairGroupsByKey,
    baseGroupsByKey: new Map(baseGroups.map((group) => [group.key, group])),
  };
  const normalSource = await createDailyRandom(FIXED_UTC_DATE, manifest.sourceRevision, "daily");
  const hardcoreSource = await createDailyRandom(FIXED_UTC_DATE, manifest.sourceRevision, "hardcore-daily");
  const dailyAnswer = selectAnswer(groups, cardsById, normalSource);
  const hardcoreAnswer = selectAnswer(groups, cardsById, hardcoreSource);
  if (dailyAnswer.selectedCardId === hardcoreAnswer.selectedCardId) {
    throw new Error("Fixture namespaces must select distinct Daily answers");
  }
  const practiceAnswer = selectAnswer(groups, cardsById, { nextUint32: () => 0 });
  const answerCard = cardsById.get(dailyAnswer.selectedCardId);
  if (!answerCard) throw new Error("Normal Daily fixture answer was not retained");
  const dailyEquivalent = dailyAnswer.acceptedCardIds
    .map((id) => cardsById.get(id))
    .find((card): card is CardIdentity => card !== undefined
      && card.id !== dailyAnswer.selectedCardId
      && card.name !== answerCard.name);
  if (!dailyEquivalent) {
    throw new Error("Normal Daily fixture must retain an equivalent answer with a different name");
  }
  const hardcoreAnswerCard = cardsById.get(hardcoreAnswer.selectedCardId);
  if (!hardcoreAnswerCard) throw new Error("Hardcore Daily fixture answer was not retained");
  const hardcoreEquivalent = hardcoreAnswer.acceptedCardIds
    .map((id) => cardsById.get(id))
    .find((card): card is CardIdentity => card !== undefined
      && card.id !== hardcoreAnswer.selectedCardId
      && card.name !== hardcoreAnswerCard.name);
  if (!hardcoreEquivalent) {
    throw new Error("Hardcore Daily fixture must retain an equivalent answer with a different name");
  }
  const sortCards = (left: CardIdentity, right: CardIdentity) => (
    left.name.localeCompare(right.name, "en-US") || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
  const dailyWrongGuesses = cards
    .filter((card) => !dailyAnswer.acceptedCardIds.includes(card.id))
    .sort(sortCards);
  const hardcoreWrongGuesses = cards
    .filter((card) => !hardcoreAnswer.acceptedCardIds.includes(card.id))
    .sort(sortCards);
  if (dailyWrongGuesses.length < 8 || hardcoreWrongGuesses.length < 8) {
    throw new Error("Fixture must provide at least eight accepted wrong submissions per Daily mode");
  }
  const answerWordCount = answerCard.name.match(/[^ ]+/gu)?.length ?? 0;
  if (answerWordCount < 2) {
    throw new Error("Normal Daily fixture answer must have multiple words for initial hint coverage");
  }
  if (dailyWrongGuesses.length < 7 + answerWordCount) {
    throw new Error("Fixture must provide enough wrong guesses for deterministic post-initial hints");
  }
  let orbFixture: FixtureModel["orbFixture"] | undefined;
  for (const guess of dailyWrongGuesses) {
    const results = compareGuess(guess, answerCard);
    for (const green of results.filter((result) => result.color === "green")) {
      for (const red of results.filter((result) => result.color === "red")) {
        const dualCandidate = dailyWrongGuesses.find((candidate) => candidate.id !== guess.id
          && candidate.base[green.feature] === guess.base[green.feature]
          && candidate.upgraded[green.feature] === guess.upgraded[green.feature]
          && candidate.base[red.feature] === guess.base[red.feature]
          && candidate.upgraded[red.feature] === guess.upgraded[red.feature]);
        if (dualCandidate) {
          orbFixture = {
            guess,
            greenFeature: green.feature,
            redFeature: red.feature,
            dualCandidate,
          };
          break;
        }
      }
      if (orbFixture) break;
    }
    if (orbFixture) break;
  }
  if (!orbFixture) {
    throw new Error("Fixture must provide green and red targets with a candidate matching both constraints");
  }
  const practiceWrongGuess = cards.find((card) => !practiceAnswer.acceptedCardIds.includes(card.id));
  if (!practiceWrongGuess) throw new Error("Practice fixture must provide an accepted wrong submission");
  const risingGuess = cards.find((card) => card.id === "AFTERIMAGE");
  const fallingGuess = cards.find((card) => card.id === "APPARITION");
  if (!risingGuess || !fallingGuess) throw new Error("Directional E2E guesses were not retained");
  if (!compareGuess(risingGuess, answerCard).some((result) => result.displayValue === "false → true")) {
    throw new Error("Afterimage no longer demonstrates the false-to-true fixture direction");
  }
  if (!compareGuess(fallingGuess, answerCard).some((result) => result.displayValue === "true → false")) {
    throw new Error("Apparition no longer demonstrates the true-to-false fixture direction");
  }
  return {
    cards,
    manifest,
    dailyAnswer,
    hardcoreAnswer,
    practiceAnswer,
    dailyEquivalent,
    hardcoreEquivalent,
    dailyWrongGuesses,
    hardcoreWrongGuesses,
    practiceWrongGuess,
    orbFixture,
    wrongGuesses: [risingGuess, fallingGuess],
  };
}

async function chooseCard(page: Page, name: string): Promise<void> {
  const search = page.getByRole("combobox", { name: "Guess a card" });
  await search.fill(name);
  const optionNames = await page.getByRole("option").locator(".card-search__name").allTextContents();
  const optionIndex = optionNames.indexOf(name);
  expect(optionIndex, `${name} should be an exact keyboard-selectable candidate`).toBeGreaterThanOrEqual(0);
  await search.press("Home");
  for (let index = 0; index < optionIndex; index += 1) await search.press("ArrowDown");
  await expect(page.getByRole("option").nth(optionIndex)).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function guessRow(page: Page, card: CardIdentity): Locator {
  return page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: new RegExp(`^${escapeRegExp(card.name)} artwork and name$`) }),
  });
}

function cardOption(page: Page, card: CardIdentity): Locator {
  return page.getByRole("option", {
    name: new RegExp(`^${escapeRegExp(card.name)} artwork ${escapeRegExp(card.name)}`),
  });
}

async function submitGuessAndWait(page: Page, card: CardIdentity): Promise<void> {
  await chooseCard(page, card.name);
  await expect(guessRow(page, card)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled({ timeout: 5_000 });
}

async function submitWinningGuess(page: Page, card: CardIdentity): Promise<void> {
  await chooseCard(page, card.name);
  await expect(guessRow(page, card)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeDisabled();
}

async function openEmptySearch(page: Page): Promise<Locator> {
  const search = page.getByRole("combobox", { name: "Guess a card" });
  await search.fill("");
  await search.focus();
  await expect(search).toHaveAttribute("aria-expanded", "true");
  return search;
}

async function clickTrueHelpBackdrop(page: Page): Promise<void> {
  const hitTest = await page.locator(".game-guide__backdrop").evaluate((backdrop) => {
    const backdropRect = backdrop.getBoundingClientRect();
    const dialogRect = backdrop.querySelector(".game-guide__dialog")!.getBoundingClientRect();
    const client = {
      x: backdropRect.left + 4,
      y: backdropRect.top + 4,
    };
    const pagePoint = { x: client.x + window.scrollX, y: client.y + window.scrollY };
    return {
      client,
      page: pagePoint,
      scroll: { x: window.scrollX, y: window.scrollY },
      targetIsBackdrop: document.elementFromPoint(client.x, client.y) === backdrop,
      outsideDialog: client.x < dialogRect.left
        || client.x > dialogRect.right
        || client.y < dialogRect.top
        || client.y > dialogRect.bottom,
      backdropRect: {
        left: backdropRect.left,
        top: backdropRect.top,
        right: backdropRect.right,
        bottom: backdropRect.bottom,
      },
    };
  });
  expect(hitTest.client.x).toBeGreaterThanOrEqual(hitTest.backdropRect.left);
  expect(hitTest.client.x).toBeLessThanOrEqual(hitTest.backdropRect.right);
  expect(hitTest.client.y).toBeGreaterThanOrEqual(hitTest.backdropRect.top);
  expect(hitTest.client.y).toBeLessThanOrEqual(hitTest.backdropRect.bottom);
  expect(hitTest.page.x - hitTest.client.x).toBe(hitTest.scroll.x);
  expect(hitTest.page.y - hitTest.client.y).toBe(hitTest.scroll.y);
  expect(hitTest.targetIsBackdrop).toBe(true);
  expect(hitTest.outsideDialog).toBe(true);
  await page.mouse.click(hitTest.client.x, hitTest.client.y);
}

async function dragOrbTo(page: Page, orb: "Reveal" | "Filter" | "Negation", target: Locator): Promise<void> {
  const source = page.getByRole("button", { name: `${orb} Orb, available` });
  await target.scrollIntoViewIfNeeded();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  expect(sourceBox, `${orb} Orb should have a real drag box`).not.toBeNull();
  expect(targetBox, `${orb} target should have a real drag box`).not.toBeNull();
  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const targetX = targetBox!.x + targetBox!.width / 2;
  const targetY = targetBox!.y + targetBox!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 2 });
  await expect(page.locator(`.orb-drag-avatar--${orb.toLowerCase()}`)).toBeVisible();
  await page.mouse.move(targetX, targetY, { steps: 5 });
  await page.mouse.up();
}

async function expectPoof(page: Page, orb: "reveal" | "filter" | "negation"): Promise<Locator> {
  const poof = page.locator(`.orb-poof--${orb}`);
  await expect(poof).toHaveCount(1, { timeout: 500 });
  return poof;
}

async function expectAnimatedPoof(page: Page, orb: "reveal" | "filter" | "negation"): Promise<Locator> {
  const poof = await expectPoof(page, orb);
  await expect.poll(async () => poof.evaluate((element) => {
    const effects = [...element.querySelectorAll<HTMLElement>(".orb-poof__burst, .orb-poof__particle")];
    const positiveDuration = (value: string) => value.split(",").some((duration) => {
      const parsed = Number.parseFloat(duration);
      return parsed > 0;
    });
    return {
      hasAnimatedEffect: effects.some((effect) => {
        const style = getComputedStyle(effect);
        return style.animationName !== "none" && positiveDuration(style.animationDuration);
      }),
      hasRunningAnimation: element.getAnimations({ subtree: true })
        .some((animation) => animation.playState === "running"),
      hasVisibleEffect: effects.some((effect) => {
        const style = getComputedStyle(effect);
        const rect = effect.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
          && rect.width > 0 && rect.height > 0;
      }),
    };
  }), { intervals: [0, 10, 20], timeout: 350 }).toEqual({
    hasAnimatedEffect: true,
    hasRunningAnimation: true,
    hasVisibleEffect: true,
  });
  return poof;
}

function hintRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) {
    state ^= byte;
    state = Math.imul(state, 0x01000193);
  }
  state >>>= 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function expectedHintLabel(name: string, wrongGuessCount: number, hintSeed: string): string {
  const words = [...name.matchAll(/[^ ]+/gu)].map((match) => Array.from(match[0]));
  const revealed = new Set<string>();
  const initialRevealCount = Math.min(words.length, Math.max(0, wrongGuessCount - 6));
  const remaining: Array<{ wordIndex: number; characterIndex: number }> = [];
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    if (wordIndex < initialRevealCount) revealed.add(`${wordIndex}:0`);
    for (let characterIndex = 1; characterIndex < words[wordIndex]!.length; characterIndex += 1) {
      remaining.push({ wordIndex, characterIndex });
    }
  }
  const random = hintRandom(`${hintSeed}\u0000${name}`);
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = random() % (index + 1);
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex]!, remaining[index]!];
  }
  const randomRevealCount = Math.max(0, wrongGuessCount - (6 + words.length));
  for (const position of remaining.slice(0, randomRevealCount)) {
    revealed.add(`${position.wordIndex}:${position.characterIndex}`);
  }
  const accessible = words.map((characters, wordIndex) => characters
    .map((character, characterIndex) => revealed.has(`${wordIndex}:${characterIndex}`) ? character : "blank")
    .join(" "));
  return `Card name hint: ${accessible.join("; ")}`;
}

async function storedRound(page: Page, key: string): Promise<{
  practiceHardcoreChoice: boolean | null;
  round: {
    roundId: string;
    hardcore: boolean;
    answer: SelectedAnswer;
    guesses: Array<{ cardId: string }>;
    assistance: null | {
      reveal: null | { feature: FeatureName };
      filter: null | { cardId: string; feature: FeatureName; guessIndex: number };
      negation: null | { cardId: string; feature: FeatureName; guessIndex: number };
      visibility: { neutral: boolean; green: boolean; red: boolean };
    };
  };
}> {
  return page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) throw new Error(`Missing persisted round: ${storageKey}`);
    return JSON.parse(raw);
  }, key);
}

function expectNoCardSecrets(
  shareText: string,
  model: FixtureModel,
  additionalSecrets: readonly string[] = [],
): void {
  const normalizedShare = shareText.toLocaleLowerCase("en-US");
  const answerSecrets = [model.dailyAnswer, model.hardcoreAnswer, model.practiceAnswer]
    .flatMap((answer) => [answer.selectedCardId, answer.pairKey, answer.baseGroupKey]);
  const secrets = [
    ...model.cards.flatMap((card) => [card.name, card.id]),
    ...answerSecrets,
    ...additionalSecrets,
    "Answer:",
    "Card name hint:",
    "blank",
  ];
  for (const secret of new Set(secrets.filter((value) => value.length > 0))) {
    expect(normalizedShare, `share must not contain secret ${JSON.stringify(secret)}`)
      .not.toContain(secret.toLocaleLowerCase("en-US"));
  }
}

function expectedShareRow(guess: CardIdentity, answer: CardIdentity): string {
  const symbols = { green: "🟩", yellow: "🟨", red: "🟥" } as const;
  return compareGuess(guess, answer).map((result) => symbols[result.color]).join("");
}

async function prepareOfflinePage(
  page: Page,
  fullCardFailure?: FullCardFailureGate,
): Promise<OfficialCodexNetworkGuard> {
  const guard = await installOfficialCodexBlock(page);
  await page.route("https://cdn.test/**", (route) => {
    if (fullCardFailure && !fullCardFailure.allow && route.request().url() === fullCardFailure.url) {
      return route.fulfill({ status: 503, body: "fixture retry" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG });
  });
  await page.addInitScript((fixedNow) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(value?: string | number | Date) {
        super(value === undefined ? fixedNow : value);
      }
      static override now(): number { return fixedNow; }
    }
    Object.defineProperty(window, "Date", { configurable: true, value: FixedDate });
    Object.defineProperty(window.crypto, "getRandomValues", {
      configurable: true,
      value: (values: Uint32Array) => {
        values.fill(0);
        return values;
      },
    });
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        const counterKey = "stsdle:e2e:practice-uuid-counter";
        const previous = Number.parseInt(sessionStorage.getItem(counterKey) ?? "0", 10);
        const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
        sessionStorage.setItem(counterKey, String(next));
        return `00000000-0000-4000-8000-${next.toString(16).padStart(12, "0")}`;
      },
    });
  }, FIXED_NOW.valueOf());
  return guard;
}

async function expectAccessibleTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "interactive control should have a layout box").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

function watchAtlasResponses(page: Page): AtlasReadiness {
  const appOrigin = process.env.STSDLE_E2E_ORIGIN ?? "http://127.0.0.1:3000";
  const urls = {
    candidate: new URL("/runtime/candidate.webp", appOrigin).href,
    guess: new URL("/runtime/guess.webp", appOrigin).href,
  };
  const responses = new Map<string, Response>();
  page.on("response", (response) => {
    if (Object.values(urls).includes(response.url())) {
      responses.set(response.url(), response);
    }
  });
  return { urls, responses };
}

async function expectAtlasesReady(page: Page, readiness: AtlasReadiness): Promise<void> {
  for (const url of Object.values(readiness.urls)) {
    const response = readiness.responses.get(url);
    expect(response, `${url} should finish before gameplay`).toBeDefined();
    expect(await response!.finished(), `${url} should finish without a transfer error`).toBeNull();
    expect(response!.ok()).toBe(true);
    await expect.poll(() => page.evaluate((exactUrl) => performance.getEntriesByName(exactUrl, "resource")
      .map((entry) => ({
        name: entry.name,
        responseEnd: (entry as PerformanceResourceTiming).responseEnd,
      })), url)).toHaveLength(1);
    const [timing] = await page.evaluate((exactUrl) => performance.getEntriesByName(exactUrl, "resource")
      .map((entry) => ({
        name: entry.name,
        responseEnd: (entry as PerformanceResourceTiming).responseEnd,
      })), url);
    expect(timing?.name).toBe(url);
    expect(timing?.responseEnd).toBeGreaterThan(0);
  }
}

async function expectKeywordIconOrder(
  cell: Locator,
  expectedIcons: readonly ["x" | "check", "x" | "check"],
): Promise<void> {
  const icons = cell.locator("svg");
  expect(await icons.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-icon"))))
    .toEqual(expectedIcons);
  expect(await icons.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-hidden"))))
    .toEqual(["true", "true"]);
  await expect(cell.getByRole("img")).toHaveCount(0);
}

test("Normal Daily preloads atlases and persists orb targets, classifications, visibility, and usage-only sharing", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  const atlasReadiness = watchAtlasResponses(page);
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Guess a card" });
  await expect(search).toBeVisible();
  await expectAtlasesReady(page, atlasReadiness);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });

  await openEmptySearch(page);
  const initialNames = await page.getByRole("option").locator(".card-search__name").allTextContents();
  expect(initialNames).toHaveLength(model.cards.length);
  expect(initialNames).toEqual([...initialNames].sort((left, right) => left.localeCompare(right, "en-US")));
  await search.press("Escape");

  const revealFeature: FeatureName = "mana";
  const selectedAnswerCard = model.cards.find((card) => card.id === model.dailyAnswer.selectedCardId)!;
  const revealHeader = page.locator(`.guess-grid__header[data-feature="${revealFeature}"]`);
  await dragOrbTo(page, "Reveal", revealHeader);
  await expectAnimatedPoof(page, "reveal");
  await expect(page.getByRole("status")).toContainText(
    `Reveal Orb showed ${FEATURE_LABELS[revealFeature]}: ${formatFeatureValue(
      selectedAnswerCard.base[revealFeature],
      selectedAnswerCard.upgraded[revealFeature],
    )}.`,
  );
  await expect(revealHeader.getByRole("note", { name: /^Answer:/ })).toBeVisible();
  await expect(page.getByLabel("Reveal Orb, used")).toBeVisible();

  const { guess, greenFeature, redFeature, dualCandidate } = model.orbFixture;
  await submitGuessAndWait(page, guess);
  const row = guessRow(page, guess);

  await dragOrbTo(page, "Filter", row.getByRole("cell", { name: new RegExp(`^${FEATURE_LABELS[redFeature]}:.*Result: red`) }));
  await expect(page.getByRole("status")).toContainText(
    `${FEATURE_LABELS[redFeature]} red result tile is an invalid target for the Filter Orb. Orb returned.`,
  );
  await expect(page.getByRole("button", { name: "Filter Orb, available" })).toBeVisible();

  const filterButton = page.getByRole("button", { name: "Filter Orb, available" });
  await filterButton.click();
  await expect(filterButton).toHaveAttribute("aria-pressed", "true");
  const greenTarget = row.getByRole("button", {
    name: `${FEATURE_LABELS[greenFeature]} green result tile. Use Filter Orb.`,
  });
  await greenTarget.focus();
  await greenTarget.press("Enter");
  await expectAnimatedPoof(page, "filter");
  await expect(page.getByRole("status")).toContainText(`Filter Orb now marks candidates matching ${FEATURE_LABELS[greenFeature]}.`);
  await expect(row.getByRole("img", { name: "Filter Orb used here" })).toBeVisible();
  await expect(page.getByLabel("Filter Orb, used")).toBeVisible();

  const negationButton = page.getByRole("button", { name: "Negation Orb, available" });
  await negationButton.click();
  await expect(negationButton).toHaveAttribute("aria-pressed", "true");
  const redTarget = row.getByRole("button", {
    name: `${FEATURE_LABELS[redFeature]} red result tile. Use Negation Orb.`,
  });
  await redTarget.click();
  await expectAnimatedPoof(page, "negation");
  await expect(page.getByRole("status")).toContainText(`Negation Orb now marks candidates excluded by ${FEATURE_LABELS[redFeature]}.`);
  await expect(row.getByRole("img", { name: "Negation Orb used here" })).toBeVisible();
  await expect(page.getByLabel("Negation Orb, used")).toBeVisible();

  const answerCard = model.cards.find((card) => card.id === model.dailyAnswer.selectedCardId)!;
  await openEmptySearch(page);
  await expect(cardOption(page, answerCard)).toHaveClass(/card-search__option--green/);
  await expect(cardOption(page, answerCard)).toContainText("matches Filter Orb");
  await expect(cardOption(page, dualCandidate)).toHaveClass(/card-search__option--red/);
  await expect(cardOption(page, dualCandidate)).toContainText("excluded by Negation Orb");

  const neutralToggle = page.getByRole("checkbox", { name: "Neutral" });
  const greenToggle = page.getByRole("checkbox", { name: "Green" });
  const redToggle = page.getByRole("checkbox", { name: "Red" });
  for (const toggle of [neutralToggle, greenToggle, redToggle]) await expect(toggle).toBeChecked();
  await neutralToggle.uncheck();
  await expect(page.locator(".card-search__option--neutral")).toHaveCount(0);
  await neutralToggle.check();
  await greenToggle.uncheck();
  await expect(cardOption(page, answerCard)).toHaveCount(0);
  await greenToggle.check();
  await redToggle.uncheck();
  await expect(cardOption(page, dualCandidate)).toHaveCount(0);
  await redToggle.check();
  await submitGuessAndWait(page, dualCandidate);
  await expect(guessRow(page, dualCandidate)).toBeVisible();
  await expect(search).toBeEnabled();
  await redToggle.uncheck();
  await neutralToggle.uncheck();

  await expect.poll(async () => (await storedRound(page, "stsdle:round:daily:v1")).round.assistance?.visibility)
    .toEqual({ neutral: false, green: true, red: false });
  const beforeReload = await storedRound(page, "stsdle:round:daily:v1");
  expect(beforeReload.round.guesses.map(({ cardId }) => cardId)).toEqual([guess.id, dualCandidate.id]);
  expect(beforeReload.round.assistance).toMatchObject({
    reveal: { feature: revealFeature },
    filter: { guessIndex: 0, cardId: guess.id, feature: greenFeature },
    negation: { guessIndex: 0, cardId: guess.id, feature: redFeature },
  });

  await page.reload();
  await expect(search).toBeEnabled();
  await expect(page.getByLabel("Reveal Orb, used")).toBeVisible();
  await expect(page.getByLabel("Filter Orb, used")).toBeVisible();
  await expect(page.getByLabel("Negation Orb, used")).toBeVisible();
  await expect(revealHeader.getByRole("note", { name: /^Answer:/ })).toBeVisible();
  await expect(guessRow(page, guess).getByRole("img", { name: "Filter Orb used here" })).toBeVisible();
  await expect(guessRow(page, guess).getByRole("img", { name: "Negation Orb used here" })).toBeVisible();
  await expect(guessRow(page, dualCandidate)).toBeVisible();
  await expect(neutralToggle).not.toBeChecked();
  await expect(greenToggle).toBeChecked();
  await expect(redToggle).not.toBeChecked();
  expect(await storedRound(page, "stsdle:round:daily:v1")).toEqual(beforeReload);

  await submitWinningGuess(page, model.dailyEquivalent);
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible();
  await page.getByRole("button", { name: "Copy Daily result" }).click();
  await expect(page.getByRole("region", { name: "Daily result" }).getByRole("status"))
    .toContainText("Daily result copied");
  const shareText = await page.evaluate(() => navigator.clipboard.readText());
  const shareLines = shareText.split(/\r?\n/);
  const submittedCards = [guess, dualCandidate, model.dailyEquivalent];
  const expectedLines = [
    `STS-dle ${FIXED_UTC_DATE} ${submittedCards.length}/\u221e`,
    ...submittedCards.map((card) => expectedShareRow(card, answerCard)),
    "Orbs: \u26ab \u26ab \u26ab",
    APP_ROOT,
  ];
  expect(shareLines).toEqual(expectedLines);
  expectNoCardSecrets(shareText, model, [
    revealFeature,
    greenFeature,
    redFeature,
    FEATURE_LABELS[revealFeature],
    FEATURE_LABELS[greenFeature],
    FEATURE_LABELS[redFeature],
  ]);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("pointer-selects a search option above multiple guess rows on a narrow viewport", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  await prepareOfflinePage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  for (const card of model.dailyWrongGuesses.slice(0, 4)) await submitGuessAndWait(page, card);
  const pointerGuess = model.dailyWrongGuesses[4]!;
  await page.getByRole("combobox", { name: "Guess a card" }).fill(pointerGuess.name);

  await cardOption(page, pointerGuess).click();

  await expect(guessRow(page, pointerGuess)).toBeVisible();
});

test("Normal Daily reveals exact deterministic name masks at 5, 6, 7, later initials, and a post-initial position", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  const answer = model.cards.find((card) => card.id === model.dailyAnswer.selectedCardId)!;
  const hintSeed = `daily:${FIXED_UTC_DATE}:${model.manifest.sourceRevision}`;

  for (const card of model.dailyWrongGuesses.slice(0, 5)) await submitGuessAndWait(page, card);
  const hint = page.locator(".name-hint");
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 5, hintSeed));
  const wordLengths = [...answer.name.matchAll(/[^ ]+/gu)].map((match) => Array.from(match[0]).length);
  const lineMetrics = await hint.locator(".name-hint__word").evaluateAll((words) => words.map((word) => {
    const line = word.querySelector<HTMLElement>(".name-hint__line");
    return {
      characterCount: word.querySelectorAll(".name-hint__character").length,
      lineCount: word.querySelectorAll(".name-hint__line").length,
      lineWidth: line?.getBoundingClientRect().width ?? 0,
      wordWidth: word.getBoundingClientRect().width,
      borderWidth: line ? getComputedStyle(line).borderBottomWidth : "0px",
    };
  }));
  expect(lineMetrics).toHaveLength(wordLengths.length);
  lineMetrics.forEach((metric, index) => {
    expect(metric.characterCount).toBe(wordLengths[index]);
    expect(metric.lineCount).toBe(1);
    expect(metric.lineWidth).toBeGreaterThan(0);
    expect(Math.abs(metric.lineWidth - metric.wordWidth)).toBeLessThanOrEqual(1);
    expect(metric.borderWidth).toBe("2px");
  });

  const fiveMask = await hint.getAttribute("aria-label");
  await submitGuessAndWait(page, model.dailyWrongGuesses[5]!);
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 6, hintSeed));
  expect(await hint.getAttribute("aria-label")).toBe(fiveMask);

  await submitGuessAndWait(page, model.dailyWrongGuesses[6]!);
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 7, hintSeed));
  await submitGuessAndWait(page, model.dailyWrongGuesses[7]!);
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 8, hintSeed));

  const postInitialWrongCount = 7 + wordLengths.length;
  for (let index = 8; index < postInitialWrongCount; index += 1) {
    await submitGuessAndWait(page, model.dailyWrongGuesses[index]!);
  }
  const postInitialMask = expectedHintLabel(answer.name, postInitialWrongCount, hintSeed);
  await expect(hint).toHaveAttribute("aria-label", postInitialMask);
  await page.reload();
  await expect(page.locator(".name-hint")).toHaveAttribute("aria-label", postInitialMask);

  expect(model.dailyEquivalent.name).not.toBe(answer.name);
  await submitWinningGuess(page, model.dailyEquivalent);
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible();
  for (const acceptedId of model.dailyAnswer.acceptedCardIds) {
    const accepted = model.cards.find((card) => card.id === acceptedId)!;
    await expect(page.getByRole("heading", { name: accepted.name, level: 3, exact: true })).toBeVisible();
  }
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Hardcore Daily keeps a separate answer, progress domain, and secret-free share without assistance", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await submitGuessAndWait(page, model.dailyWrongGuesses[0]!);
  const dailyStorageBefore = await page.evaluate(() => localStorage.getItem("stsdle:round:daily:v1"));
  expect(dailyStorageBefore).not.toBeNull();

  await page.getByRole("button", { name: "Hardcore Daily" }).click();
  await expect(page.getByRole("button", { name: "Hardcore Daily" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();
  expect(model.hardcoreAnswer.selectedCardId).not.toBe(model.dailyAnswer.selectedCardId);
  await expect(page.getByRole("region", { name: "Orb inventory" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Candidate visibility" })).toHaveCount(0);
  await expect(page.locator(".name-hint")).toHaveCount(0);

  for (const card of model.hardcoreWrongGuesses.slice(0, 8)) {
    await submitGuessAndWait(page, card);
  }
  await expect(page.locator(".name-hint")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Orb inventory" })).toHaveCount(0);
  const hardcoreStored = await storedRound(page, "stsdle:round:hardcore-daily:v1");
  expect(hardcoreStored.round.answer.selectedCardId).toBe(model.hardcoreAnswer.selectedCardId);
  expect(hardcoreStored.round.guesses).toHaveLength(8);
  expect(hardcoreStored.round.assistance).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:daily:v1"))).toBe(dailyStorageBefore);

  await submitWinningGuess(page, model.hardcoreEquivalent);
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible();
  await page.getByRole("button", { name: "Copy Hardcore Daily result" }).click();
  await expect(page.getByRole("region", { name: "Hardcore Daily result" }).getByRole("status"))
    .toContainText("Hardcore Daily result copied");
  const shareText = await page.evaluate(() => navigator.clipboard.readText());
  const answerCard = model.cards.find((card) => card.id === model.hardcoreAnswer.selectedCardId)!;
  const submittedCards = [...model.hardcoreWrongGuesses.slice(0, 8), model.hardcoreEquivalent];
  const shareLines = shareText.split(/\r?\n/);
  const expectedLines = [
    `STS-dle Hardcore ${FIXED_UTC_DATE} ${submittedCards.length}/\u221e`,
    ...submittedCards.map((card) => expectedShareRow(card, answerCard)),
    APP_ROOT,
  ];
  expect(shareLines).toEqual(expectedLines);
  expectNoCardSecrets(shareText, model);

  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await expect(page.getByRole("button", { name: "Daily", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(guessRow(page, model.dailyWrongGuesses[0]!)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:daily:v1"))).toBe(dailyStorageBefore);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Practice locks its setting after a guess or orb, restores the round, and replaces it only on request", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("button", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  expect((await storedRound(page, "stsdle:round:practice:v1")).round.roundId).toBe(PRACTICE_ROUND_IDS[0]);
  const hardcoreToggle = page.getByRole("checkbox", { name: "Hardcore Practice" });
  await expect(hardcoreToggle).toBeEnabled();
  await expect(hardcoreToggle).not.toBeChecked();
  await hardcoreToggle.check();
  await expect(page.getByRole("region", { name: "Orb inventory" })).toHaveCount(0);

  await submitGuessAndWait(page, model.practiceWrongGuess);
  await expect(hardcoreToggle).toBeDisabled();
  await expect(page.getByText("Hardcore is locked after your first accepted guess or orb.")).toBeVisible();
  await page.getByRole("button", { name: "End game" }).click();
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible();
  for (const acceptedId of model.practiceAnswer.acceptedCardIds) {
    const accepted = model.cards.find((card) => card.id === acceptedId)!;
    await expect(page.getByRole("heading", { name: accepted.name, level: 3, exact: true })).toBeVisible();
  }

  await expect(hardcoreToggle).toBeEnabled();
  await hardcoreToggle.uncheck();
  const terminalPractice = await storedRound(page, "stsdle:round:practice:v1");
  expect(terminalPractice.round.hardcore).toBe(true);
  expect(terminalPractice.practiceHardcoreChoice).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(hardcoreToggle).toBeEnabled();
  await expect(hardcoreToggle).not.toBeChecked();
  expect((await storedRound(page, "stsdle:round:practice:v1")).round.roundId)
    .toBe(terminalPractice.round.roundId);
  await page.getByRole("button", { name: "New Practice Round" }).click();
  await expect(hardcoreToggle).not.toBeChecked();
  await expect(page.getByRole("region", { name: "Orb inventory" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();
  expect((await storedRound(page, "stsdle:round:practice:v1")).round.roundId).toBe(PRACTICE_ROUND_IDS[1]);

  const revealButton = page.getByRole("button", { name: "Reveal Orb, available" });
  await revealButton.click();
  await expect(revealButton).toHaveAttribute("aria-pressed", "true");
  const revealHeader = page.locator('.guess-grid__header[data-feature="rarity"]');
  await revealHeader.getByRole("button", { name: "Rarity feature heading. Use Reveal Orb." }).click();
  await expect(page.getByLabel("Reveal Orb, used")).toBeVisible();
  await expect(revealHeader.getByRole("note", { name: /^Answer:/ })).toBeVisible();
  await expect(hardcoreToggle).toBeDisabled();
  const persistedRound = await storedRound(page, "stsdle:round:practice:v1");
  expect(persistedRound.round.roundId).toBe(PRACTICE_ROUND_IDS[1]);

  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("button", { name: "Practice" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Reveal Orb, used")).toBeVisible();
  await expect(revealHeader.getByRole("note", { name: /^Answer:/ })).toBeVisible();
  await expect(hardcoreToggle).toBeDisabled();
  expect((await storedRound(page, "stsdle:round:practice:v1")).round.roundId)
    .toBe(PRACTICE_ROUND_IDS[1]);

  await page.getByRole("button", { name: "End game" }).click();
  await page.getByRole("button", { name: "New Practice Round" }).click();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();
  await expect(page.getByRole("rowheader")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reveal Orb, available" })).toBeVisible();
  const replacementRoundId = (await storedRound(page, "stsdle:round:practice:v1")).round.roundId;
  expect(replacementRoundId).toBe(PRACTICE_ROUND_IDS[2]);
  expect(replacementRoundId).not.toBe(persistedRound.round.roundId);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("keyboard orb use exposes pressed, status, classification, bubble, and badge semantics without reduced-motion animation", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  expect(await page.locator(".orb-tray").evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === "running").length)).toBe(0);

  const { guess, greenFeature, redFeature, dualCandidate } = model.orbFixture;
  await submitGuessAndWait(page, guess);
  const row = guessRow(page, guess);
  const filterButton = page.getByRole("button", { name: "Filter Orb, available" });
  await filterButton.focus();
  await filterButton.press("Space");
  await expect(filterButton).toHaveAttribute("aria-pressed", "true");
  const filterTarget = row.getByRole("button", {
    name: `${FEATURE_LABELS[greenFeature]} green result tile. Use Filter Orb.`,
  });
  await filterTarget.focus();
  await filterTarget.press("Space");
  const reducedPoof = await expectPoof(page, "filter");
  await expect(reducedPoof).toHaveCSS("opacity", "0");
  expect(await reducedPoof.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === "running").length)).toBe(0);
  await expect(page.locator(".orb-announcement")).toHaveText(
    `Filter Orb now marks candidates matching ${FEATURE_LABELS[greenFeature]}.`,
  );
  await expect(row.getByRole("img", { name: "Filter Orb used here" })).toBeVisible();

  const negationButton = page.getByRole("button", { name: "Negation Orb, available" });
  await negationButton.focus();
  await negationButton.press("Enter");
  await expect(negationButton).toHaveAttribute("aria-pressed", "true");
  const negationTarget = row.getByRole("button", {
    name: `${FEATURE_LABELS[redFeature]} red result tile. Use Negation Orb.`,
  });
  await negationTarget.focus();
  await negationTarget.press("Enter");
  await expect(page.locator(".orb-announcement")).toHaveText(
    `Negation Orb now marks candidates excluded by ${FEATURE_LABELS[redFeature]}.`,
  );
  await expect(row.getByRole("img", { name: "Negation Orb used here" })).toBeVisible();

  const revealButton = page.getByRole("button", { name: "Reveal Orb, available" });
  await revealButton.focus();
  await revealButton.press("Space");
  await expect(revealButton).toHaveAttribute("aria-pressed", "true");
  const revealHeader = page.locator('.guess-grid__header[data-feature="mana"]');
  const revealTarget = revealHeader.getByRole("button", { name: "Mana feature heading. Use Reveal Orb." });
  await revealTarget.focus();
  await revealTarget.press("Enter");
  const answerCard = model.cards.find((card) => card.id === model.dailyAnswer.selectedCardId)!;
  await expect(page.locator(".orb-announcement")).toHaveText(
    `Reveal Orb showed Mana: ${formatFeatureValue(answerCard.base.mana, answerCard.upgraded.mana)}.`,
  );
  await expect(revealHeader.getByRole("note", { name: /^Answer:/ })).toBeVisible();

  await openEmptySearch(page);
  await expect(cardOption(page, answerCard)).toHaveAccessibleName(/matches Filter Orb$/);
  await expect(cardOption(page, dualCandidate)).toHaveAccessibleName(/excluded by Negation Orb$/);
  await expect(cardOption(page, dualCandidate)).toHaveClass(/card-search__option--red/);
  expect(await page.locator(".orb-tray").evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === "running").length)).toBe(0);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Daily and Practice complete the full paired-card experience without leaking the answer", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const retryCard = model.dailyAnswer.acceptedCardIds
    .map((id) => model.cards.find((card) => card.id === id)!)
    .find((card) => card.baseCardUrl?.startsWith("https://cdn.test/"))!;
  const fullCardFailure = { allow: false, url: retryCard.baseCardUrl! };
  const codexGuard = await prepareOfflinePage(page, fullCardFailure);
  const atlasReadiness = watchAtlasResponses(page);

  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  await expectAtlasesReady(page, atlasReadiness);
  await context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: new URL(page.url()).origin },
  );
  const attribution = page.getByRole("contentinfo");
  await expect(attribution.getByRole("link", { name: "Spire Codex" })).toHaveAttribute(
    "href",
    "https://spire-codex.com/",
  );
  await expect(attribution).toContainText(/unofficial fan project/i);
  await expect(attribution).toContainText(/not affiliated with or endorsed by Mega Crit/i);
  const helpTrigger = page.getByRole("button", { name: "How to play" });
  await expect(page.getByText("Both base and upgraded features match", { exact: true })).toHaveCount(0);
  await helpTrigger.click();
  const help = page.getByRole("dialog", { name: "How to play" });
  await expect(help).toBeVisible();
  for (const heading of ["Basics", "Result colors", "Keyword icons", "Orbs and filtering", "Name hints", "Modes"]) {
    await expect(help.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(help.getByText("Both base and upgraded features match", { exact: true })).toBeVisible();
  const closeHelp = help.getByRole("button", { name: "Close help" });
  await expect(closeHelp).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeHelp).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closeHelp).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(helpTrigger).toBeFocused();

  await helpTrigger.click();
  await closeHelp.click();
  await expect(help).toBeHidden();
  await expect(helpTrigger).toBeFocused();

  await helpTrigger.click();
  await clickTrueHelpBackdrop(page);
  await expect(help).toBeHidden();
  await expect(helpTrigger).toBeFocused();
  const dailyTab = page.getByRole("button", { name: "Daily", exact: true });
  await expectAccessibleTarget(dailyTab);
  await page.keyboard.press("Tab");
  await dailyTab.focus();
  const focusRing = await dailyTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusRing.style).not.toBe("none");
  expect(focusRing.width).toBeGreaterThanOrEqual(2);

  const search = page.getByRole("combobox", { name: "Guess a card" });
  await expectAccessibleTarget(search);
  await search.fill("A");
  const candidateNames = await page.getByRole("option").locator(".card-search__name").allTextContents();
  expect(candidateNames).toEqual([...candidateNames].sort((left, right) => left.localeCompare(right, "en-US")));
  await expect(page.getByRole("option").getByRole("img")).toHaveCount(candidateNames.length);
  await search.fill("");

  await search.fill("A");
  const firstCandidate = page.getByRole("option").first();
  const candidateSprite = firstCandidate.locator(".sprite-art--candidate");
  await expect(candidateSprite).toHaveCSS("background-image", /candidate\.webp/);
  await search.fill("");

  const [firstWrongGuess, secondWrongGuess] = model.wrongGuesses;
  const dailyAnswerCard = model.cards.find((card) => card.id === model.dailyAnswer.selectedCardId)!;
  await chooseCard(page, firstWrongGuess.name);
  const wrongRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(firstWrongGuess.name) }) });
  await expect(wrongRow.getByRole("cell")).toHaveCount(10);
  const guessArtworkBox = await wrongRow.getByRole("img", {
    name: `${firstWrongGuess.name} guess artwork`,
  }).boundingBox();
  expect(guessArtworkBox).toMatchObject({ width: 72, height: 72 });
  for (const result of compareGuess(firstWrongGuess, dailyAnswerCard)) {
    await expect(wrongRow.getByRole("cell", {
      name: new RegExp(`^${FEATURE_LABELS[result.feature]}: .*Result: ${result.color}\\.$`),
    })).toBeVisible();
  }
  await expect(wrongRow).not.toContainText(/Direction:/);
  await expect(wrongRow.locator(".feature-tile__result-mark, .feature-tile__hint")).toHaveCount(0);
  const risingCell = wrongRow.getByRole("cell", { name: /absent to present/ });
  await expectKeywordIconOrder(risingCell, ["x", "check"]);
  await expect(wrongRow.locator(".sprite-art--guess")).toHaveCSS("background-image", /guess\.webp/);
  await expect(search).toBeEnabled({ timeout: 5_000 });

  await page.reload();
  const restoredRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(firstWrongGuess.name) }) });
  await expect(restoredRow.getByRole("cell")).toHaveCount(10);
  await expect(restoredRow.locator(".feature-tile--immediate")).toHaveCount(10);
  await expect(restoredRow).not.toContainText(/Direction:/);
  await expect(restoredRow.locator(".feature-tile__result-mark, .feature-tile__hint")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();

  await chooseCard(page, secondWrongGuess.name);
  const secondWrongRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(secondWrongGuess.name) }) });
  const fallingCell = secondWrongRow.getByRole("cell", { name: /present to absent/ });
  await expectKeywordIconOrder(fallingCell, ["check", "x"]);
  await expect(search).toBeEnabled({ timeout: 5_000 });
  const visibleRowHeaders = await page.getByRole("rowheader").allTextContents();
  expect(visibleRowHeaders).toEqual([
    secondWrongGuess.name,
    firstWrongGuess.name,
  ]);

  const equivalentId = model.dailyAnswer.acceptedCardIds.find((id) => id !== model.dailyAnswer.selectedCardId)!;
  const equivalent = model.cards.find((card) => card.id === equivalentId)!;
  await chooseCard(page, equivalent.name);
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible({ timeout: 5_000 });
  for (const acceptedId of model.dailyAnswer.acceptedCardIds) {
    const accepted = model.cards.find((card) => card.id === acceptedId)!;
    await expect(page.getByRole("heading", { name: accepted.name, level: 3, exact: true })).toBeVisible();
  }
  const revealImages = page.locator(".answer-reveal .card-stack__image");
  await expect(revealImages).toHaveCount(model.dailyAnswer.acceptedCardIds.length * 2 - 1);
  const retryImage = page.getByRole("button", { name: `Retry ${retryCard.name} base image` });
  await expect(retryImage).toBeVisible();
  await expectAccessibleTarget(retryImage);
  fullCardFailure.allow = true;
  await retryImage.click();
  await expect(retryImage).toBeHidden();
  await expect(revealImages).toHaveCount(model.dailyAnswer.acceptedCardIds.length * 2);
  await expect.poll(() => revealImages.evaluateAll((images) => images.every((image) => {
    const element = image as HTMLImageElement;
    return element.complete && element.naturalWidth > 0;
  }))).toBe(true);

  const acceptedCards = model.dailyAnswer.acceptedCardIds.map((id) => model.cards.find((card) => card.id === id)!);
  const firstStack = page.getByRole("button", { name: `Show upgraded ${acceptedCards[0]!.name}`, exact: true });
  await firstStack.click();
  await expect(page.getByRole("button", { name: `Show base ${acceptedCards[0]!.name}`, exact: true })).toBeVisible();
  const secondStack = page.getByRole("button", { name: `Show upgraded ${acceptedCards[1]!.name}`, exact: true });
  await secondStack.focus();
  await secondStack.press("Space");
  await expect(page.getByRole("button", { name: `Show base ${acceptedCards[1]!.name}`, exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDurations = await Promise.all([
    page.locator(".feature-tile__surface").first().evaluate((element) => getComputedStyle(element).transitionDuration),
    page.locator(".card-stack__card").first().evaluate((element) => getComputedStyle(element).transitionDuration),
  ]);
  expect(reducedDurations).toEqual(["0s", "0s"]);

  await page.getByRole("button", { name: "Copy Daily result" }).click();
  await expect(page.getByRole("region", { name: "Daily result" }).getByRole("status"))
    .toContainText("Daily result copied");
  const shareText = await page.evaluate(() => navigator.clipboard.readText());
  expect(shareText).toContain("STS-dle");
  expect(shareText).toContain(FIXED_UTC_DATE);
  for (const card of model.cards) expect(shareText).not.toContain(card.name);
  const shareRows = shareText.split(/\r?\n/).filter((line) => /^[🟩🟨🟥]+$/u.test(line));
  expect(shareRows).toEqual([
    expectedShareRow(firstWrongGuess, dailyAnswerCard),
    expectedShareRow(secondWrongGuess, dailyAnswerCard),
    expectedShareRow(equivalent, dailyAnswerCard),
  ]);
  for (const row of shareRows) expect([...row]).toHaveLength(10);
  const dailyStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key === "stsdle:round:daily:v1" || key === "stsdle:stats:v1")));

  await page.getByRole("button", { name: "Practice" }).click();
  await chooseCard(page, "Falling Star");
  const fallingStarRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /Falling Star/ }) });
  await expect(fallingStarRow.getByRole("cell", { name: /^Rarity: Basic\. Result:/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled({ timeout: 5_000 });
  const firstPair = (await request.get("/runtime/pair-groups.json").then((response) => response.json() as Promise<PairGroup[]>))[0]!;
  const rawUnplayable = model.cards.find((card) => card.id === "DAZED")!;
  expect(firstPair.cardIds).not.toContain(rawUnplayable.id);
  await search.fill(rawUnplayable.name);
  const rawUnplayableOption = page.getByRole("option", {
    name: new RegExp(`^${rawUnplayable.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} artwork ${rawUnplayable.name}`),
  });
  await expect(rawUnplayableOption).toBeVisible();
  await chooseCard(page, rawUnplayable.name);
  await expect(page.getByRole("rowheader", { name: rawUnplayable.name })).toBeVisible();
  await expect(search).toBeEnabled({ timeout: 5_000 });
  const practiceCard = model.cards.find((card) => card.id === firstPair.cardIds[1])!;
  await chooseCard(page, practiceCard.name);
  await expect(page.getByRole("button", { name: "New Practice Round" })).toBeVisible({ timeout: 5_000 });
  await expectAccessibleTarget(page.getByRole("button", { name: "New Practice Round" }));
  await expect(page.getByRole("button", { name: /copy/i })).toHaveCount(0);
  await page.getByRole("button", { name: "New Practice Round" }).click();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /copy/i })).toHaveCount(0);
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key === "stsdle:round:daily:v1" || key === "stsdle:stats:v1")))).toEqual(dailyStorage);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844, scrollerOverflows: true },
  { width: 768, height: 1024, scrollerOverflows: true },
  { width: 1440, height: 900, scrollerOverflows: false },
]) {
  test(`keeps ${viewport.width}x${viewport.height} shell, tray, controls, hint, and candidates contained while the guess grid owns overflow`, async ({ page, request }) => {
    const model = await loadFixtureModel(request);
    const codexGuard = await prepareOfflinePage(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
    for (const card of model.dailyWrongGuesses.slice(0, 5)) await submitGuessAndWait(page, card);
    await expect(page.locator(".name-hint")).toBeVisible();
    const gridGeometry = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".guess-grid")!;
      const header = document.querySelector<HTMLElement>(".guess-grid__header")!;
      const gridStyle = getComputedStyle(grid);
      return {
        paddingTop: Number.parseFloat(gridStyle.paddingTop),
        paddingLeft: Number.parseFloat(gridStyle.paddingLeft),
        headerHeight: header.getBoundingClientRect().height,
      };
    });
    expect(Math.abs(gridGeometry.paddingTop - gridGeometry.paddingLeft)).toBeLessThanOrEqual(.5);
    expect(gridGeometry.headerHeight).toBeGreaterThanOrEqual(44);
    const centered = await page.evaluate(() => {
      const centerX = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return rect.left + rect.width / 2;
      };
      const visibility = document.querySelector(".candidate-visibility")!;
      const labels = [...visibility.querySelectorAll(".candidate-visibility__label")];
      const left = Math.min(...labels.map((label) => label.getBoundingClientRect().left));
      const right = Math.max(...labels.map((label) => label.getBoundingClientRect().right));
      const hint = document.querySelector(".name-hint")!;
      const words = [...hint.querySelectorAll(".name-hint__word")];
      const wordLeft = Math.min(...words.map((word) => word.getBoundingClientRect().left));
      const wordRight = Math.max(...words.map((word) => word.getBoundingClientRect().right));
      return {
        search: centerX(".card-search"),
        hint: centerX(".name-hint"),
        words: (wordLeft + wordRight) / 2,
        visibility: centerX(".candidate-visibility"),
        labels: (left + right) / 2,
      };
    });
    expect(Math.abs(centered.search - centered.words)).toBeLessThanOrEqual(1);
    expect(Math.abs(centered.hint - centered.words)).toBeLessThanOrEqual(1);
    expect(Math.abs(centered.visibility - centered.labels)).toBeLessThanOrEqual(2);
    const orbCenters = await page.locator(".orb-tray__well").evaluateAll((wells) => wells.map((well) => {
      const center = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        well: center(well),
        button: center(well.querySelector(":scope > .orb-button")!),
        art: center(well.querySelector(":scope > .orb-button > .orb-visual")!),
      };
    }));
    for (const orb of orbCenters) {
      expect(Math.abs(orb.well.x - orb.button.x)).toBeLessThanOrEqual(.5);
      expect(Math.abs(orb.well.y - orb.button.y)).toBeLessThanOrEqual(.5);
      expect(Math.abs(orb.well.x - orb.art.x)).toBeLessThanOrEqual(.5);
      expect(Math.abs(orb.well.y - orb.art.y)).toBeLessThanOrEqual(.5);
    }
    const helpTrigger = page.locator(".game-guide__trigger");
    await expect(helpTrigger).toHaveAttribute("aria-label", "How to play");
    await expect(helpTrigger).toHaveAccessibleName("How to play");
    const documentSizeBeforeHelp = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    const triggerGeometry = await helpTrigger.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const shellRect = document.querySelector(".app-shell")!.getBoundingClientRect();
      const heroRect = document.querySelector(".hero")!.getBoundingClientRect();
      return {
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        shell: { left: shellRect.left, right: shellRect.right, width: shellRect.width },
        heroTop: heroRect.top,
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      };
    });
    expect(triggerGeometry.rect.width).toBeGreaterThanOrEqual(44);
    expect(triggerGeometry.rect.height).toBeGreaterThanOrEqual(44);
    expect(triggerGeometry.rect.left).toBeGreaterThanOrEqual(0);
    expect(triggerGeometry.rect.top).toBeGreaterThanOrEqual(0);
    expect(triggerGeometry.rect.right).toBeLessThanOrEqual(triggerGeometry.viewport.width);
    expect(triggerGeometry.rect.bottom).toBeLessThanOrEqual(triggerGeometry.viewport.height);
    expect(triggerGeometry.rect.left + triggerGeometry.rect.width / 2)
      .toBeGreaterThan(triggerGeometry.shell.left + triggerGeometry.shell.width / 2);
    expect(Math.abs(triggerGeometry.shell.right - triggerGeometry.rect.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(triggerGeometry.heroTop - triggerGeometry.rect.top)).toBeLessThanOrEqual(1);

    await helpTrigger.click();
    const help = page.getByRole("dialog", { name: "How to play" });
    await expect(help).toBeVisible();
    const modalGeometry = await help.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const root = document.documentElement;
      return {
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
        pageClientWidth: root.clientWidth,
        pageScrollWidth: root.scrollWidth,
        pageScrollHeight: root.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });
    expect(modalGeometry.rect.left).toBeGreaterThanOrEqual(0);
    expect(modalGeometry.rect.top).toBeGreaterThanOrEqual(0);
    expect(modalGeometry.rect.right).toBeLessThanOrEqual(modalGeometry.pageClientWidth);
    expect(modalGeometry.rect.bottom).toBeLessThanOrEqual(modalGeometry.viewportHeight);
    expect(modalGeometry.scrollHeight).toBeGreaterThanOrEqual(modalGeometry.clientHeight);
    expect(modalGeometry.overflowY).toBe("auto");
    if (viewport.width === 390) {
      expect(modalGeometry.scrollHeight).toBeGreaterThan(modalGeometry.clientHeight);
    }
    expect(modalGeometry.pageScrollWidth).toBeLessThanOrEqual(modalGeometry.pageClientWidth);
    expect(modalGeometry.pageScrollWidth).toBe(documentSizeBeforeHelp.width);
    expect(modalGeometry.pageScrollHeight).toBe(documentSizeBeforeHelp.height);
    await help.getByRole("button", { name: "Close help" }).click();
    await expect(help).toBeHidden();
    const revealHeader = page.locator('.guess-grid__header[data-feature="mana"]');
    await page.getByRole("button", { name: "Reveal Orb, available" }).click();
    const revealTarget = revealHeader.getByRole("button", { name: "Mana feature heading. Use Reveal Orb." });
    const headerTargetHeight = await revealTarget.evaluate((element) => element.getBoundingClientRect().height);
    const headerBeforeReveal = await revealHeader.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    await revealTarget.click();
    const revealBubble = revealHeader.getByRole("note", { name: /^Answer:/ });
    await expect(revealBubble).toBeVisible();
    const headerAfterReveal = await revealHeader.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const bubbleRect = element.querySelector<HTMLElement>(".guess-grid__reveal-bubble")!.getBoundingClientRect();
      return {
        top: rect.top,
        height: rect.height,
        centerDeltaX: bubbleRect.left + bubbleRect.width / 2 - (rect.left + rect.width / 2),
        centerDeltaY: bubbleRect.top + bubbleRect.height / 2 - (rect.top + rect.height / 2),
      };
    });
    expect(Math.abs(headerAfterReveal.top - headerBeforeReveal.top)).toBeLessThanOrEqual(.5);
    expect(Math.abs(headerAfterReveal.height - headerBeforeReveal.height)).toBeLessThanOrEqual(.5);
    expect(Math.abs(headerAfterReveal.centerDeltaX)).toBeLessThanOrEqual(.5);
    expect(Math.abs(headerAfterReveal.centerDeltaY)).toBeLessThanOrEqual(.5);
    await openEmptySearch(page);
    await expect(page.locator(".card-search__options")).toBeVisible();
    const scroller = page.locator(".guess-grid-scroll");
    await expect(scroller).toBeVisible();
    const dimensions = await page.evaluate(() => {
      const root = document.documentElement;
      const shell = document.querySelector<HTMLElement>(".app-shell")!;
      const gridScroller = document.querySelector<HTMLElement>(".guess-grid-scroll")!;
      const candidateList = document.querySelector<HTMLElement>(".card-search__options")!;
      const shellRect = shell.getBoundingClientRect();
      const contained = [".game-panel", ".card-search", ".orb-tray", ".candidate-visibility", ".name-hint", ".card-search__options"]
        .map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return {
            selector,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            left: rect.left,
            right: rect.right,
          };
        });
      return {
        pageClientWidth: root.clientWidth,
        pageScrollWidth: root.scrollWidth,
        shellLeft: shellRect.left,
        shellRight: shellRect.right,
        scrollerClientWidth: gridScroller.clientWidth,
        scrollerScrollWidth: gridScroller.scrollWidth,
        contained,
        candidateClientHeight: candidateList.clientHeight,
        candidateScrollHeight: candidateList.scrollHeight,
        candidateOverflowY: getComputedStyle(candidateList).overflowY,
      };
    });
    expect(dimensions.pageScrollWidth).toBeLessThanOrEqual(dimensions.pageClientWidth);
    expect(dimensions.scrollerClientWidth).toBeGreaterThan(0);
    expect(dimensions.scrollerScrollWidth).toBeGreaterThan(0);
    for (const element of dimensions.contained) {
      expect(element.left, `${element.selector} should stay inside the shell`).toBeGreaterThanOrEqual(dimensions.shellLeft - 1);
      expect(element.right, `${element.selector} should stay inside the shell`).toBeLessThanOrEqual(dimensions.shellRight + 1);
      expect(element.scrollWidth, `${element.selector} should not own horizontal overflow`).toBeLessThanOrEqual(element.clientWidth + 1);
    }
    expect(dimensions.candidateClientHeight).toBeLessThanOrEqual(308);
    expect(dimensions.candidateScrollHeight).toBeGreaterThan(dimensions.candidateClientHeight);
    expect(dimensions.candidateOverflowY).toBe("auto");
    expect(headerTargetHeight).toBeGreaterThanOrEqual(44);
    if (viewport.scrollerOverflows) {
      expect(dimensions.scrollerScrollWidth).toBeGreaterThan(dimensions.scrollerClientWidth);
    } else {
      expect(dimensions.scrollerScrollWidth).toBeLessThanOrEqual(dimensions.scrollerClientWidth);
    }
    expect(codexGuard.attemptedRequests).toEqual([]);
    expect(codexGuard.blockedRequests).toEqual([]);
  });
}
