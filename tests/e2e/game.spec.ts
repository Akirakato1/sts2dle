import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";

import {
  CARD_TARGETS,
  FEATURE_ORDER,
  type BaseGroup,
  type CardIdentity,
  type FeatureName,
  type PairGroup,
  type SnapshotManifest,
} from "../../src/shared/domain.js";
import { compareGuess, formatFeatureValue, sameFeatureValue } from "../../src/shared/comparison.js";
import { createDailyRandom } from "../../src/shared/random.js";
import { selectAnswer, type SelectedAnswer } from "../../src/shared/selection.js";
import { collectCardFilterOptions } from "../../src/client/game/card-filter.js";
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
const PRACTICE_ROUND_IDS = [
  "practice:00000000-0000-4000-8000-000000000001",
  "practice:00000000-0000-4000-8000-000000000002",
  "practice:00000000-0000-4000-8000-000000000003",
] as const;
const SEARCH_FILTER_STORAGE_KEY = "stsdle:search:filters:v1";
const SEARCH_FILTER_HELP_DISMISSED_KEY = "stsdle:search-filter-help-dismissed:v1";
const FEATURE_LABELS: Readonly<Record<FeatureName, string>> = {
  cardClass: "Class",
  cardType: "Type",
  mana: "Mana",
  rarity: "Rarity",
  target: "Target",
  powers: "Powers",
  keywords: "Keywords",
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
  practiceOrbFixture: {
    guess: CardIdentity;
    greenFeature: FeatureName;
    greenCandidate: CardIdentity;
  };
  orbFixture: {
    guess: CardIdentity;
    greenFeature: FeatureName;
    redFeature: FeatureName;
    dualCandidate: CardIdentity;
  };
  wrongGuesses: readonly [CardIdentity, CardIdentity];
}

interface AtlasReadiness {
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
  let orbFixture: FixtureModel["orbFixture"] | undefined;
  for (const guess of dailyWrongGuesses) {
    const results = compareGuess(guess, answerCard);
    for (const green of results.filter((result) => result.color === "green")) {
      for (const red of results.filter((result) => result.color === "red")) {
        const dualCandidate = dailyWrongGuesses.find((candidate) => candidate.id !== guess.id
          && sameFeatureValue(green.feature, candidate.base[green.feature], guess.base[green.feature])
          && sameFeatureValue(green.feature, candidate.upgraded[green.feature], guess.upgraded[green.feature])
          && sameFeatureValue(red.feature, candidate.base[red.feature], guess.base[red.feature])
          && sameFeatureValue(red.feature, candidate.upgraded[red.feature], guess.upgraded[red.feature]));
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
  const practiceAnswerCard = cardsById.get(practiceAnswer.selectedCardId);
  if (!practiceAnswerCard) throw new Error("Practice fixture answer was not retained");
  let practiceOrbFixture: FixtureModel["practiceOrbFixture"] | undefined;
  const practiceOrbGuesses = ["DAZED", "FALLING_STAR"]
    .map((id) => cardsById.get(id))
    .filter((card): card is CardIdentity => card !== undefined && !practiceAnswer.acceptedCardIds.includes(card.id));
  for (const guess of practiceOrbGuesses) {
    for (const green of compareGuess(guess, practiceAnswerCard).filter((result) => result.color === "green")) {
      const greenCandidate = cards.find((candidate) => candidate.id !== guess.id
        && !practiceAnswer.acceptedCardIds.includes(candidate.id)
        && sameFeatureValue(green.feature, candidate.base[green.feature], guess.base[green.feature])
        && sameFeatureValue(green.feature, candidate.upgraded[green.feature], guess.upgraded[green.feature]));
      if (greenCandidate) {
        practiceOrbFixture = { guess, greenFeature: green.feature, greenCandidate };
        break;
      }
    }
    if (practiceOrbFixture) break;
  }
  if (!practiceOrbFixture) throw new Error("Practice fixture must provide a real Filter Orb candidate");
  const risingGuess = cards.find((card) => card.id === "AFTERIMAGE");
  const fallingGuess = cards.find((card) => card.id === "APPARITION");
  if (!risingGuess || !fallingGuess) throw new Error("Directional E2E guesses were not retained");
  if (!compareGuess(risingGuess, answerCard).some((result) => (
    result.feature === "keywords" && result.displayValue === "None → Innate"
  ))) {
    throw new Error("Afterimage no longer demonstrates a gained keyword set");
  }
  if (!compareGuess(fallingGuess, answerCard).some((result) => (
    result.feature === "keywords" && result.displayValue === "Ethereal, Exhaust → Exhaust"
  ))) {
    throw new Error("Apparition no longer demonstrates a lost keyword set");
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
    practiceOrbFixture,
    orbFixture,
    wrongGuesses: [risingGuess, fallingGuess],
  };
}

async function chooseCard(page: Page, cardOrName: CardIdentity | string): Promise<void> {
  const name = typeof cardOrName === "string" ? cardOrName : cardOrName.name;
  const cardClass = typeof cardOrName === "string" || !cardOrName.duplicateName
    ? null
    : cardOrName.base.cardClass;
  const search = page.getByRole("combobox", { name: "Guess a card" });
  await search.fill(name);
  const optionIndex = await page.getByRole("option").evaluateAll((options, expected) => options.findIndex((option) => (
    option.querySelector<HTMLElement>(".card-search__name")?.textContent === expected.name
      && (expected.cardClass === null
        || option.querySelector<HTMLElement>(".card-search__class")?.textContent === expected.cardClass)
  )), { name, cardClass });
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
  }).filter({ hasText: card.base.cardClass });
}

function cardOption(page: Page, card: CardIdentity): Locator {
  const discriminator = card.duplicateName ? ` ${escapeRegExp(card.base.cardClass)}` : "";
  return page.getByRole("option", {
    name: new RegExp(`^${escapeRegExp(card.name)} artwork ${escapeRegExp(card.name)}${discriminator}`),
  });
}

async function submitGuessAndWait(page: Page, card: CardIdentity): Promise<void> {
  await chooseCard(page, card);
  await expect(guessRow(page, card)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled({ timeout: 5_000 });
}

async function submitWinningGuess(page: Page, card: CardIdentity): Promise<void> {
  await chooseCard(page, card);
  await expect(guessRow(page, card)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeDisabled();
}

function hardcoreSearch(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Guess a card" });
}

async function enterHardcoreName(page: Page, query: string): Promise<void> {
  const search = hardcoreSearch(page);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill(query);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.press("Enter");
}

async function submitHardcoreGuessAndWait(page: Page, card: CardIdentity, query = card.name): Promise<void> {
  const rowCount = await page.getByRole("rowheader").count();
  await enterHardcoreName(page, query);
  await expect(guessRow(page, card)).toBeVisible();
  await expect(page.getByRole("rowheader")).toHaveCount(rowCount + 1);
  await expect(hardcoreSearch(page)).toBeEnabled({ timeout: 5_000 });
}

async function submitHardcoreWinningGuess(page: Page, card: CardIdentity, query = card.name): Promise<void> {
  await enterHardcoreName(page, query);
  await expect(guessRow(page, card)).toBeVisible();
  await expect(hardcoreSearch(page)).toBeDisabled();
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
  practiceRandomValues: readonly number[] = [],
): Promise<OfficialCodexNetworkGuard> {
  const guard = await installOfficialCodexBlock(page);
  await page.route("https://cdn.test/**", (route) => {
    if (fullCardFailure && !fullCardFailure.allow && route.request().url() === fullCardFailure.url) {
      return route.fulfill({ status: 503, body: "fixture retry" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG });
  });
  await page.addInitScript(({ fixedNow, practiceRandomValues }) => {
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
        const counterKey = "stsdle:e2e:practice-random-counter";
        const index = Number.parseInt(sessionStorage.getItem(counterKey) ?? "0", 10);
        values.fill(practiceRandomValues[index] ?? 0);
        sessionStorage.setItem(counterKey, String(index + 1));
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
  }, { fixedNow: FIXED_NOW.valueOf(), practiceRandomValues });
  return guard;
}

function searchResult(page: Page, card: CardIdentity, badge?: "Base only" | "Upgrade only"): Locator {
  const cardLabel = card.duplicateName ? `${card.name} (${card.base.cardClass})` : card.name;
  return page.getByRole("button", {
    name: `Preview ${cardLabel}${badge ? ` — ${badge}` : ""}`,
    exact: true,
  });
}

async function searchResultNames(page: Page): Promise<string[]> {
  return page.locator(".search-card-list__result").evaluateAll((results) => results.map((result) => (
    result.querySelector<HTMLElement>(".search-card-list__name")?.textContent?.trim() ?? ""
  )));
}

function searchCardLabel(card: CardIdentity): string {
  return card.duplicateName ? `${card.name} (${card.base.cardClass})` : card.name;
}

function requestCounts(requests: readonly string[], urls: readonly string[]): number[] {
  return urls.map((url) => requests.filter((requestUrl) => requestUrl === url).length);
}

async function performAfterResponses(page: Page, urls: readonly string[], action: () => Promise<void>): Promise<void> {
  const responses = urls.map((url) => page.waitForResponse((response) => response.url() === url));
  await action();
  await Promise.all(responses);
}

async function dismissSearchFilterHelpOnLoad(page: Page): Promise<void> {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), SEARCH_FILTER_HELP_DISMISSED_KEY);
}

async function openSearchWorkspace(page: Page): Promise<Locator> {
  const tab = page.getByRole("button", { name: "Search", exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-current", "page");
  const workspace = page.getByRole("region", { name: "Card search workspace" });
  await expect(workspace).toBeVisible();
  return workspace;
}

function watchConsoleIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      issues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  return issues;
}

async function prepareOfflinePageForPracticeAnswer(
  page: Page,
  request: APIRequestContext,
  cardId: string,
): Promise<OfficialCodexNetworkGuard> {
  const baseGroups = await request.get("/runtime/base-groups.json")
    .then((response) => response.json() as Promise<BaseGroup[]>);
  const groupIndex = baseGroups.findIndex((group) => group.cardIds.includes(cardId));
  expect(groupIndex, `Practice fixture must retain ${cardId}`).toBeGreaterThanOrEqual(0);
  const cardIndex = baseGroups[groupIndex]!.cardIds.indexOf(cardId);
  expect(cardIndex, `Practice base group must retain ${cardId}`).toBeGreaterThanOrEqual(0);
  return prepareOfflinePage(page, undefined, [groupIndex, cardIndex]);
}

async function expectAccessibleTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "interactive control should have a layout box").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

const appRoot = (page: Page) => new URL("/", page.url()).href;

function watchAtlasResponses(page: Page): AtlasReadiness {
  const responses = new Map<string, Response>();
  page.on("response", (response) => {
    if (["/runtime/candidate.webp", "/runtime/guess.webp"].includes(new URL(response.url()).pathname)) {
      responses.set(response.url(), response);
    }
  });
  return { responses };
}

async function expectAtlasesReady(page: Page, readiness: AtlasReadiness): Promise<void> {
  const urls = {
    candidate: new URL("/runtime/candidate.webp", page.url()).href,
    guess: new URL("/runtime/guess.webp", page.url()).href,
  };
  for (const url of Object.values(urls)) {
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

test("offline fixture drives seven set-aware columns, comparisons, reveal, and pair-exact orbs", async ({ page, request }) => {
  const cards = await request.get("/runtime/cards.json")
    .then((response) => response.json() as Promise<CardIdentity[]>);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const fixtureIds = [
    "SET_SENTINEL", "SET_SENTINEL_PAIR", "EXACT_SET_SENTINEL",
    "OVERLAP_SENTINEL", "DISJOINT_SENTINEL", "DISJOINT_SENTINEL_PAIR", "LONG_SET",
    "FILTER_FORM_SENTINEL", "NEGATION_SOURCE_SENTINEL", "NEGATION_SOURCE_SENTINEL_PAIR",
    "NEGATION_FORM_SENTINEL",
  ];

  const observedTargets = new Set(cards.flatMap((card) => [card.base.target, card.upgraded.target]));
  expect.soft(CARD_TARGETS.filter((target) => observedTargets.has(target))).toEqual(CARD_TARGETS);
  expect.soft(cards.some((card) => card.base.powers.length === 0)).toBe(true);
  expect.soft(cards.some((card) => card.base.powers.length === 1 && card.base.powers[0] === "Unique Buff")).toBe(true);
  expect.soft(cards.some((card) => card.base.powers.length === 1 && card.base.powers[0] !== "Unique Buff")).toBe(true);
  expect.soft(cards.some((card) => card.base.powers.length === 2)).toBe(true);
  expect.soft(cardsById.get("ALCHEMIZE")?.base.keywords).toEqual(["Exhaust"]);
  expect.soft(cardsById.get("ALCHEMIZE")?.upgraded.keywords).toEqual(["Exhaust"]);
  expect.soft(cardsById.get("AFTERIMAGE")?.base.keywords).toEqual([]);
  expect.soft(cardsById.get("AFTERIMAGE")?.upgraded.keywords).toEqual(["Innate"]);
  expect.soft(cardsById.get("APPARITION")?.base.keywords).toEqual(["Ethereal", "Exhaust"]);
  expect.soft(cardsById.get("APPARITION")?.upgraded.keywords).toEqual(["Exhaust"]);
  expect.soft(cardsById.get("DAZED")?.base.keywords).toContain("Unplayable");
  expect.soft(fixtureIds.every((id) => cardsById.has(id))).toBe(true);
  if (!fixtureIds.every((id) => cardsById.has(id))) return;

  const answer = cardsById.get("SET_SENTINEL")!;
  const exact = cardsById.get("EXACT_SET_SENTINEL")!;
  const overlap = cardsById.get("OVERLAP_SENTINEL")!;
  const disjoint = cardsById.get("DISJOINT_SENTINEL")!;
  const filterFormSentinel = cardsById.get("FILTER_FORM_SENTINEL")!;
  const negationSource = cardsById.get("NEGATION_SOURCE_SENTINEL")!;
  const negationSourcePair = cardsById.get("NEGATION_SOURCE_SENTINEL_PAIR")!;
  const negationFormSentinel = cardsById.get("NEGATION_FORM_SENTINEL")!;
  const targetExact = cardsById.get("LONG_SET")!;
  const guard = await prepareOfflinePageForPracticeAnswer(page, request, answer.id);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Practice" }).click();

  await expect(page.getByRole("columnheader")).toHaveText([
    "Card", "Class", "Type", "Mana", "Rarity", "Target", "Powers", "Keywords",
  ]);
  await expect(page.getByRole("table", { name: "Card feature comparisons" })).toHaveAttribute("aria-colcount", "8");
  expect(FEATURE_ORDER).toHaveLength(7);

  for (const card of [exact, overlap, disjoint, targetExact, negationSource]) await submitGuessAndWait(page, card);
  for (const [card, color] of [[exact, "green"], [overlap, "yellow"], [disjoint, "red"]] as const) {
    const row = guessRow(page, card);
    await expect(row.getByRole("cell", { name: new RegExp(`^Powers: .*Result: ${color}\\.$`) })).toBeVisible();
    await expect(row.getByRole("cell", { name: new RegExp(`^Keywords: .*Result: ${color}\\.$`) })).toBeVisible();
  }
  await expect(guessRow(page, exact).getByRole("cell", {
    name: "Keywords: Ethereal, Exhaust → Exhaust. Result: green.",
  })).toBeVisible();
  await expect(guessRow(page, targetExact).getByRole("cell", {
    name: "Target: All Allies. Result: green.",
  })).toBeVisible();
  await expect(guessRow(page, disjoint).getByRole("cell", {
    name: "Target: Random Enemy. Result: red.",
  })).toBeVisible();

  const keywordsHeader = page.locator('.guess-grid__header[data-feature="keywords"]');
  await page.getByRole("button", { name: "Reveal Orb, available" }).click();
  await keywordsHeader.getByRole("button", { name: "Keywords feature heading. Use Reveal Orb." }).click();
  await expect(keywordsHeader.getByRole("note", {
    name: "Answer: Ethereal, Exhaust → Exhaust",
  })).toBeVisible();

  const exactKeywords = guessRow(page, exact).getByRole("cell", { name: /^Keywords: .*Result: green\.$/ });
  await page.getByRole("button", { name: "Filter Orb, available" }).click();
  await exactKeywords.getByRole("button", { name: "Keywords green result tile. Use Filter Orb." }).click();
  const negationKeywords = guessRow(page, negationSource).getByRole("cell", { name: /^Keywords: .*Result: red\.$/ });
  await page.getByRole("button", { name: "Negation Orb, available" }).click();
  await negationKeywords.getByRole("button", { name: "Keywords red result tile. Use Negation Orb." }).click();
  await openEmptySearch(page);
  await expect(cardOption(page, answer)).toContainText("matches Filter Orb");
  await expect(cardOption(page, negationSourcePair)).toContainText("excluded by Negation Orb");
  await expect.soft(cardOption(page, filterFormSentinel)).toHaveClass(/card-search__option--neutral/);
  await expect.soft(cardOption(page, filterFormSentinel)).toContainText("unhighlighted candidate");
  await expect.soft(cardOption(page, negationFormSentinel)).toHaveClass(/card-search__option--neutral/);
  await expect.soft(cardOption(page, negationFormSentinel)).toContainText("unhighlighted candidate");
  expect(guard.attemptedRequests).toEqual([]);
  expect(guard.blockedRequests).toEqual([]);
});

test("Normal Daily preloads atlases and persists orb targets, classifications, visibility, and usage-only sharing", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  const consoleIssues = watchConsoleIssues(page);
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
      revealFeature,
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
    appRoot(page),
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
  expect(consoleIssues).toEqual([]);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("pointer-selects a search option above multiple guess rows on a narrow viewport", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  for (const card of model.dailyWrongGuesses.slice(0, 4)) await submitGuessAndWait(page, card);
  const pointerGuess = model.dailyWrongGuesses[4]!;
  await page.getByRole("combobox", { name: "Guess a card" }).fill(pointerGuess.name);

  await cardOption(page, pointerGuess).click();

  await expect(guessRow(page, pointerGuess)).toBeVisible();
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Practice reveals exact deterministic name masks at 5, 6, 7, later initials, and a post-initial position", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const answer = model.cards.find((card) => card.id === "SET_SENTINEL")!;
  const equivalent = model.cards.find((card) => card.id === "SET_SENTINEL_PAIR")!;
  const wrongGuesses = model.cards
    .filter((card) => card.id !== answer.id && card.id !== equivalent.id)
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  const codexGuard = await prepareOfflinePageForPracticeAnswer(page, request, answer.id);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  const hintSeed = "00000000-0000-4000-8000-000000000001";

  for (const card of wrongGuesses.slice(0, 5)) await submitGuessAndWait(page, card);
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
  await submitGuessAndWait(page, wrongGuesses[5]!);
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 6, hintSeed));
  expect(await hint.getAttribute("aria-label")).toBe(fiveMask);

  await submitGuessAndWait(page, wrongGuesses[6]!);
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 7, hintSeed));
  await submitGuessAndWait(page, wrongGuesses[7]!);
  await expect(hint).toHaveAttribute("aria-label", expectedHintLabel(answer.name, 8, hintSeed));

  const postInitialWrongCount = 7 + wordLengths.length;
  for (let index = 8; index < postInitialWrongCount; index += 1) {
    await submitGuessAndWait(page, wrongGuesses[index]!);
  }
  const postInitialMask = expectedHintLabel(answer.name, postInitialWrongCount, hintSeed);
  await expect(hint).toHaveAttribute("aria-label", postInitialMask);
  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page.locator(".name-hint")).toHaveAttribute("aria-label", postInitialMask);

  expect(equivalent.name).not.toBe(answer.name);
  await submitWinningGuess(page, equivalent);
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible();
  for (const acceptedId of [answer.id, equivalent.id]) {
    const accepted = model.cards.find((card) => card.id === acceptedId)!;
    await expect(page.getByRole("heading", { name: accepted.name, level: 3, exact: true })).toBeVisible();
  }
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Hardcore Daily keeps a separate answer, progress domain, and secret-free share without assistance", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  const consoleIssues = watchConsoleIssues(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await submitGuessAndWait(page, model.dailyWrongGuesses[0]!);
  const dailyStorageBefore = await page.evaluate(() => localStorage.getItem("stsdle:round:daily:v1"));
  expect(dailyStorageBefore).not.toBeNull();

  await page.getByRole("button", { name: "Hardcore Daily" }).click();
  await expect(page.getByRole("button", { name: "Hardcore Daily" })).toHaveAttribute("aria-current", "page");
  await expect(hardcoreSearch(page)).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toHaveCount(0);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(0);
  expect(model.hardcoreAnswer.selectedCardId).not.toBe(model.dailyAnswer.selectedCardId);
  await expect(page.getByRole("region", { name: "Orb inventory" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Candidate visibility" })).toHaveCount(0);
  await expect(page.locator(".name-hint")).toHaveCount(0);

  for (const card of model.hardcoreWrongGuesses.slice(0, 8)) {
    await submitHardcoreGuessAndWait(page, card);
  }
  await expect(page.locator(".name-hint")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Orb inventory" })).toHaveCount(0);
  const hardcoreStored = await storedRound(page, "stsdle:round:hardcore-daily:v1");
  expect(hardcoreStored.round.answer.selectedCardId).toBe(model.hardcoreAnswer.selectedCardId);
  expect(hardcoreStored.round.guesses).toHaveLength(8);
  expect(hardcoreStored.round.assistance).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:daily:v1"))).toBe(dailyStorageBefore);

  await submitHardcoreWinningGuess(page, model.hardcoreEquivalent);
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
    appRoot(page),
  ];
  expect(shareLines).toEqual(expectedLines);
  expectNoCardSecrets(shareText, model);

  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await expect(page.getByRole("button", { name: "Daily", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(guessRow(page, model.dailyWrongGuesses[0]!)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:daily:v1"))).toBe(dailyStorageBefore);
  expect(consoleIssues).toEqual([]);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Hardcore Practice persists assistance-free memory play and normal Practice locks after a guess or orb", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  const consoleIssues = watchConsoleIssues(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Practice" }).click();

  const hardcore = page.getByRole("checkbox", { name: "Hardcore Practice" });
  await expect(hardcore).toBeEnabled();
  await expect(hardcore).not.toBeChecked();
  await hardcore.check();
  await expect(hardcore).toBeChecked();
  await expect(hardcoreSearch(page)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toHaveCount(0);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Candidate visibility" })).toHaveCount(0);
  await expect(page.locator(".orb-tray, .name-hint, .card-search__options")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Filter Mode" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Practice filters" })).toHaveCount(0);
  expect((await storedRound(page, "stsdle:round:practice:v1")).round)
    .toMatchObject({ hardcore: true, assistance: null });

  const remembered = model.cards.find((card) => !model.practiceAnswer.acceptedCardIds.includes(card.id))!;
  const normalizedEntry = `  ${remembered.name.toLocaleUpperCase("en-US").replaceAll(" ", "---")}!!!  `;
  await submitHardcoreGuessAndWait(page, remembered, normalizedEntry);
  await expect(hardcore).toBeDisabled();

  await page.reload();
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(hardcore).toBeChecked();
  await expect(hardcore).toBeDisabled();
  await expect(guessRow(page, remembered)).toBeVisible();
  await page.getByRole("button", { name: "End game" }).click();
  await page.getByRole("button", { name: "New Practice Round" }).click();
  await expect(hardcore).toBeChecked();
  await expect(hardcore).toBeEnabled();
  expect((await storedRound(page, "stsdle:round:practice:v1")).round).toMatchObject({
    roundId: PRACTICE_ROUND_IDS[1],
    hardcore: true,
    assistance: null,
  });

  await hardcore.uncheck();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Candidate visibility" })).toBeVisible();
  await expect(page.locator(".orb-tray")).toBeVisible();
  await expect(page.getByRole("region", { name: "Practice filters" })).toHaveCount(0);
  await openEmptySearch(page);
  await expect(page.getByRole("option")).toHaveCount(model.cards.length);
  await submitGuessAndWait(page, model.practiceOrbFixture.guess);
  await expect(hardcore).toBeDisabled();

  await page.getByRole("button", { name: "End game" }).click();
  await page.getByRole("button", { name: "New Practice Round" }).click();
  await expect(hardcore).not.toBeChecked();
  await expect(hardcore).toBeEnabled();
  const reveal = page.getByRole("button", { name: "Reveal Orb, available" });
  await reveal.click();
  await page.locator('.guess-grid__header[data-feature="mana"]')
    .getByRole("button", { name: "Mana feature heading. Use Reveal Orb." }).click();
  await expect(hardcore).toBeDisabled();
  expect((await storedRound(page, "stsdle:round:practice:v1")).round.assistance?.reveal).toEqual({ feature: "mana" });
  expect(consoleIssues).toEqual([]);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Search preserves the game round, rejects unknown storage, and applies every filter composition per form", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  const consoleIssues = watchConsoleIssues(page);
  await dismissSearchFilterHelpOnLoad(page);
  await page.addInitScript(({ key, value }) => {
    const seededKey = "stsdle:e2e:invalid-search-filter-seeded";
    if (sessionStorage.getItem(seededKey) === null) {
      localStorage.setItem(key, value);
      sessionStorage.setItem(seededKey, "1");
    }
  }, {
    key: SEARCH_FILTER_STORAGE_KEY,
    value: JSON.stringify({
      version: 1,
      filter: {
        cardClass: { disabled: false, selected: ["Unknown"] },
        cardType: { disabled: true, selected: [] },
        mana: { disabled: true, selected: [] },
        rarity: { disabled: true, selected: [] },
        target: { disabled: true, selected: [] },
        powers: { disabled: true, selected: [] },
        keywords: { disabled: true, selected: [] },
      },
    }),
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Practice" }).click();
  const distinctiveGuess = model.practiceOrbFixture.guess;
  await submitGuessAndWait(page, distinctiveGuess);
  await expect(guessRow(page, distinctiveGuess)).toBeVisible();
  await expect(page.getByRole("button", { name: "End game" })).toBeVisible();
  const practiceBefore = await page.evaluate(() => localStorage.getItem("stsdle:round:practice:v1"));
  const practiceEnvelopeBefore = await storedRound(page, "stsdle:round:practice:v1");
  expect(practiceEnvelopeBefore.round).toMatchObject({
    roundId: PRACTICE_ROUND_IDS[0],
    status: "playing",
    guesses: [{ cardId: distinctiveGuess.id }],
  });

  const expectedAllResultNames = [...model.cards]
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || left.id.localeCompare(right.id, "en-US"))
    .map((card) => card.name);

  await openSearchWorkspace(page);
  expect(await searchResultNames(page)).toEqual(expectedAllResultNames);
  expect(await page.evaluate((key) => localStorage.getItem(key), SEARCH_FILTER_STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:practice:v1"))).toBe(practiceBefore);
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(guessRow(page, distinctiveGuess)).toBeVisible();
  await expect(page.getByRole("button", { name: "End game" })).toBeVisible();
  expect(await storedRound(page, "stsdle:round:practice:v1")).toEqual(practiceEnvelopeBefore);
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:practice:v1"))).toBe(practiceBefore);
  await openSearchWorkspace(page);

  const filterPanel = page.getByRole("region", { name: "Search filters" });
  const classGroup = filterPanel.getByRole("group", { name: "Class" });
  await classGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await expect(page.getByRole("list", { name: "Search results" }).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "No cards match these filters." }))
    .toHaveText("No cards match these filters.");
  await classGroup.getByRole("checkbox", { name: "Silent" }).check();
  await classGroup.getByRole("checkbox", { name: "Event" }).check();
  expect(await searchResultNames(page)).toEqual([
    "Afterimage", "Afterimage Pair", "Apparition", "Apparition Pair",
    "Filter Form Sentinel", "Filter Form Sentinel Pair",
    "Mad Science", "Mad Science Pair", "Malaise", "Malaise Pair",
  ]);
  await classGroup.getByRole("checkbox", { name: "Disable" }).check();

  const exactSet = model.cards.find((card) => card.id === "EXACT_SET_SENTINEL")!;
  const exactSetPair = model.cards.find((card) => card.id === "EXACT_SET_SENTINEL_PAIR")!;
  const overlapSet = model.cards.find((card) => card.id === "OVERLAP_SENTINEL")!;
  const powersGroup = filterPanel.getByRole("group", { name: "Powers" });
  await powersGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await powersGroup.getByRole("checkbox", { name: "Strength" }).check();
  await powersGroup.getByRole("checkbox", { name: "Weak" }).check();
  await expect(searchResult(page, exactSet)).toBeVisible();
  await expect(searchResult(page, overlapSet)).toHaveCount(0);

  await classGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await classGroup.getByRole("checkbox", { name: "Silent" }).uncheck();
  await classGroup.getByRole("checkbox", { name: "Event" }).uncheck();
  await classGroup.getByRole("checkbox", { name: "Ironclad" }).check();
  expect(await searchResultNames(page)).toEqual([exactSet.name, exactSetPair.name]);
  await powersGroup.getByRole("checkbox", { name: "Disable" }).check();

  await classGroup.getByRole("checkbox", { name: "Ironclad" }).uncheck();
  await classGroup.getByRole("checkbox", { name: "Silent" }).check();
  await classGroup.getByRole("checkbox", { name: "Event" }).check();
  const keywordsGroup = filterPanel.getByRole("group", { name: "Keywords" });
  await keywordsGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await keywordsGroup.getByRole("checkbox", { name: "Exhaust" }).check();
  await keywordsGroup.getByRole("checkbox", { name: "Ethereal" }).check();
  expect(await searchResultNames(page)).toEqual([
    "Apparition", "Apparition Pair", "Filter Form Sentinel", "Filter Form Sentinel Pair",
  ]);
  await classGroup.getByRole("checkbox", { name: "Disable" }).check();
  await keywordsGroup.getByRole("checkbox", { name: "Disable" }).check();

  await powersGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await powersGroup.getByRole("checkbox", { name: "None" }).check();
  await expect(powersGroup.getByRole("checkbox", { name: "Strength" })).not.toBeChecked();
  await expect(powersGroup.getByRole("checkbox", { name: "Weak" })).not.toBeChecked();
  await expect(searchResult(page, model.cards.find((card) => card.id === "ALCHEMIZE")!)).toBeVisible();
  await expect(searchResult(page, exactSet)).toHaveCount(0);
  await powersGroup.getByRole("checkbox", { name: "Disable" }).check();

  const manaGroup = filterPanel.getByRole("group", { name: "Mana" });
  const alchemize = model.cards.find((card) => card.id === "ALCHEMIZE")!;
  const oppositeForms = model.cards.find((card) => card.id === "SEARCH_FORM_SENTINEL")!;
  await manaGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await manaGroup.getByRole("checkbox", { name: "1" }).check();
  await expect(searchResult(page, alchemize, "Base only")).toBeVisible();
  await manaGroup.getByRole("checkbox", { name: "1" }).uncheck();
  await manaGroup.getByRole("checkbox", { name: "0" }).check();
  await expect(searchResult(page, alchemize, "Upgrade only")).toBeVisible();
  await expect(searchResult(page, oppositeForms, "Upgrade only")).toBeVisible();
  await keywordsGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  await keywordsGroup.getByRole("checkbox", { name: "Ethereal" }).check();
  await expect(searchResult(page, oppositeForms)).toHaveCount(0);

  const groups = await filterPanel.getByRole("group").all();
  for (const group of groups) {
    const disable = group.getByRole("checkbox", { name: "Disable" });
    if (await disable.isChecked()) await disable.uncheck();
    for (const choice of await group.getByRole("checkbox").all().then((choices) => choices.slice(1))) {
      if (await choice.isChecked()) await choice.uncheck();
    }
    await disable.check();
  }
  await classGroup.getByRole("checkbox", { name: "Disable" }).uncheck();
  const canonicalClassValues = ["Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event"] as const;
  expect(collectCardFilterOptions(model.cards).cardClass).toEqual(canonicalClassValues);
  for (const value of canonicalClassValues) {
    await classGroup.getByRole("checkbox", { name: value }).check();
  }
  const query = page.getByRole("searchbox", { name: "Search cards" });
  await query.fill("a");
  const resultList = page.getByRole("list", { name: "Search results" });
  await resultList.evaluate((list) => { list.scrollTop = list.scrollHeight; });
  expect(await resultList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  const opener = searchResult(page, model.cards.find((card) => card.name === "Malaise Pair")!);
  await opener.click();
  await expect(page.getByRole("dialog", { name: "Preview Malaise Pair" })).toBeVisible();
  const persisted = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SEARCH_FILTER_STORAGE_KEY);
  expect(persisted).toStrictEqual({
    version: 1,
    filter: {
      cardClass: { disabled: false, selected: canonicalClassValues },
      cardType: { disabled: true, selected: [] },
      mana: { disabled: true, selected: [] },
      rarity: { disabled: true, selected: [] },
      target: { disabled: true, selected: [] },
      powers: { disabled: true, selected: [] },
      keywords: { disabled: true, selected: [] },
    },
  });

  await page.reload();
  await expect(page.getByRole("dialog", { name: /Preview/ })).toHaveCount(0);
  await openSearchWorkspace(page);
  await expect(page.getByRole("dialog", { name: /Preview/ })).toHaveCount(0);
  await expect(query).toHaveValue("");
  await expect(classGroup.getByRole("checkbox", { name: "Disable" })).not.toBeChecked();
  for (const value of canonicalClassValues) {
    await expect(classGroup.getByRole("checkbox", { name: value })).toBeChecked();
  }
  expect(await resultList.evaluate((list) => list.scrollTop)).toBe(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SEARCH_FILTER_STORAGE_KEY))
    .toStrictEqual(persisted);
  expect(await page.evaluate(() => localStorage.getItem("stsdle:round:practice:v1"))).toBe(practiceBefore);
  expect(consoleIssues).toEqual([]);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Search disambiguates validated duplicate names by class throughout result and preview labels", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const ironclad = model.cards.find((card) => card.id === "OVERLAP_SENTINEL")!;
  const regent = model.cards.find((card) => card.id === "DISJOINT_SENTINEL")!;
  const unique = model.cards.find((card) => card.id === "ALCHEMIZE")!;
  expect([ironclad.name, regent.name]).toEqual(["Twin Signal", "Twin Signal"]);
  expect([ironclad.duplicateName, regent.duplicateName]).toEqual([true, true]);
  expect([ironclad.base.cardClass, regent.base.cardClass]).toEqual(["Ironclad", "Regent"]);
  expect(unique.duplicateName).toBeUndefined();

  const codexGuard = await prepareOfflinePage(page);
  await dismissSearchFilterHelpOnLoad(page);
  await page.goto("/");
  await openSearchWorkspace(page);

  for (const card of [ironclad, regent]) {
    const label = searchCardLabel(card);
    const result = searchResult(page, card);
    await expect(result.locator(".search-card-list__name")).toHaveText(card.name);
    await expect(result.locator(".search-card-list__class")).toHaveText(`(${card.base.cardClass})`);
    await result.click();
    const dialog = page.getByRole("dialog", { name: `Preview ${label}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: `${label} — Base card face` })).toBeVisible();
    await expect(dialog.getByRole("region", { name: `${label} — Upgraded card face` })).toBeVisible();
    await expect(dialog.getByRole("img", { name: `${label} — Base card artwork` })).toBeVisible();
    await expect(dialog.getByRole("img", { name: `${label} — Upgraded card artwork` })).toBeVisible();
    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(result).toBeFocused();
  }

  const uniqueResult = searchResult(page, unique);
  await expect(uniqueResult).toHaveAccessibleName(`Preview ${unique.name}`);
  await expect(uniqueResult.locator(".search-card-list__class")).toHaveCount(0);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Search preview traps real wheel scrolling and restores prior root styles", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const card = model.cards.find((candidate) => candidate.id === "ALCHEMIZE")!;
  await prepareOfflinePage(page);
  await dismissSearchFilterHelpOnLoad(page);
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto("/");
  await openSearchWorkspace(page);

  const priorStyles = await page.evaluate(() => ({
    html: document.documentElement.getAttribute("style"),
    body: document.body.getAttribute("style"),
  }));
  const expectedStyles = {
    html: "color: rgb(1, 2, 3); overflow: auto;",
    body: "min-height: 300vh; background-color: rgb(4, 5, 6); overflow: visible;",
  };

  try {
    await page.evaluate(({ html, body }) => {
      document.documentElement.setAttribute("style", html);
      document.body.setAttribute("style", body);
      window.scrollTo(0, 500);
    }, expectedStyles);
    await searchResult(page, card).click();
    const dialog = page.getByRole("dialog", { name: `Preview ${searchCardLabel(card)}` });
    const backdrop = page.locator(".card-preview-modal__backdrop");
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    }))).toEqual({ html: "hidden", body: "hidden" });
    expect(await backdrop.evaluate((element) => getComputedStyle(element).overscrollBehavior)).toBe("contain");
    expect(await dialog.evaluate((element) => getComputedStyle(element).overscrollBehavior)).toBe("contain");

    const backgroundY = await page.evaluate(() => window.scrollY);
    const backdropPoint = await backdrop.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 3, y: rect.top + 3 };
    });
    await page.mouse.move(backdropPoint.x, backdropPoint.y);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(backgroundY);

    await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    await page.mouse.move(dialogBox!.x + dialogBox!.width / 2, dialogBox!.y + dialogBox!.height / 2);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(backgroundY);

    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => ({
      html: document.documentElement.getAttribute("style"),
      body: document.body.getAttribute("style"),
    }))).toEqual(expectedStyles);
  } finally {
    await page.evaluate(({ html, body }) => {
      if (html === null) document.documentElement.removeAttribute("style");
      else document.documentElement.setAttribute("style", html);
      if (body === null) document.body.removeAttribute("style");
      else document.body.setAttribute("style", body);
    }, priorStyles);
  }
});

test("Search preview uses only snapshot URLs with pointer, keyboard, retry, close, focus, and single-face layouts", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const upgraded = model.cards.find((card) => card.id === "ALCHEMIZE")!;
  const noUpgrade = model.cards.find((card) => card.id === "DAZED")!;
  expect(upgraded.baseCardUrl).not.toBeNull();
  expect(upgraded.upgradedCardUrl).not.toBeNull();
  expect(noUpgrade).toMatchObject({ hasUpgrade: false, upgradedCardUrl: null });
  const failureGate: FullCardFailureGate = { allow: false, url: upgraded.upgradedCardUrl! };
  const codexGuard = await prepareOfflinePage(page, failureGate);
  const consoleIssues = watchConsoleIssues(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await dismissSearchFilterHelpOnLoad(page);
  await page.goto("/");
  await openSearchWorkspace(page);

  const pointerOpener = searchResult(page, upgraded);
  const upgradedUrls = [upgraded.baseCardUrl!, upgraded.upgradedCardUrl!];
  const singleUrl = noUpgrade.baseCardUrl!;
  const selectedPreviewUrls = [...upgradedUrls, singleUrl];
  expect(requests.filter((url) => selectedPreviewUrls.includes(url))).toEqual([]);
  await performAfterResponses(page, upgradedUrls, () => pointerOpener.hover());
  expect(requestCounts(requests, upgradedUrls)).toEqual([1, 1]);
  await performAfterResponses(page, [upgraded.upgradedCardUrl!], () => pointerOpener.focus());
  expect(requestCounts(requests, upgradedUrls)).toEqual([1, 2]);
  await performAfterResponses(page, [upgraded.upgradedCardUrl!], () => pointerOpener.click());
  expect(requestCounts(requests, upgradedUrls)).toEqual([1, 3]);
  const upgradedLabel = searchCardLabel(upgraded);
  const upgradedDialog = page.getByRole("dialog", { name: `Preview ${upgradedLabel}` });
  await expect(upgradedDialog).toBeVisible();
  await expect(upgradedDialog.getByRole("region", { name: `${upgradedLabel} — Base card face` })).toBeVisible();
  await expect(upgradedDialog.getByRole("region", { name: `${upgradedLabel} — Upgraded card face` })).toBeVisible();
  await expect(upgradedDialog.getByRole("status", { name: "Upgraded image failed to load" })).toBeVisible();
  await expect(page.locator(".app-shell__content")).toHaveAttribute("inert", "");
  expect(await page.getByRole("button", { name: "Search", exact: true }).evaluate((tab) => {
    tab.focus();
    return document.activeElement === tab;
  })).toBe(false);
  const faces = await upgradedDialog.locator("[data-card-preview-face]").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }));
  expect(faces).toHaveLength(2);
  expect(Math.abs(faces[0]!.top - faces[1]!.top)).toBeLessThanOrEqual(1);
  expect(faces[1]!.left).toBeGreaterThan(faces[0]!.left);
  failureGate.allow = true;
  const retry = upgradedDialog.getByRole("button", { name: "Retry Upgraded image" });
  await retry.focus();
  await performAfterResponses(page, [upgraded.upgradedCardUrl!], () => (
    retry.press("Enter")
  ));
  await expect(upgradedDialog.getByRole("button", { name: "Close preview" })).toBeFocused();
  await expect(upgradedDialog.getByRole("img", { name: `${upgradedLabel} — Upgraded card artwork` })).toBeVisible();
  expect(requestCounts(requests, upgradedUrls)).toEqual([1, 4]);
  expect(consoleIssues.length).toBeGreaterThan(0);
  expect(consoleIssues.every((issue) => issue === "error: Failed to load resource: the server responded with a status of 503 (Service Unavailable)"))
    .toBe(true);
  consoleIssues.length = 0;
  expect(requests.filter((url) => /\/(?:api\/cards?|runtime\/(?:render|card-data)|render-card)(?:\/|$)/i.test(new URL(url).pathname))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(upgradedDialog).toBeHidden();
  await expect(pointerOpener).toBeFocused();

  const keyboardOpener = searchResult(page, noUpgrade);
  expect(requestCounts(requests, [singleUrl])).toEqual([0]);
  await performAfterResponses(page, [singleUrl], () => keyboardOpener.focus());
  expect(requestCounts(requests, [singleUrl])).toEqual([1]);
  await keyboardOpener.press("Enter");
  expect(requestCounts(requests, [singleUrl])).toEqual([1]);
  const noUpgradeLabel = searchCardLabel(noUpgrade);
  const singleDialog = page.getByRole("dialog", { name: `Preview ${noUpgradeLabel}` });
  await expect(singleDialog).toBeVisible();
  await expect(singleDialog.getByRole("region", { name: `${noUpgradeLabel} — Base card face` })).toBeVisible();
  await expect(singleDialog.getByRole("region", { name: `${noUpgradeLabel} — Upgraded card face` })).toHaveCount(0);
  await expect(singleDialog.locator(".card-preview-modal__faces--single")).toBeVisible();
  await singleDialog.getByRole("button", { name: "Close preview" }).click();
  await expect(singleDialog).toBeHidden();
  await expect(keyboardOpener).toBeFocused();

  await pointerOpener.click();
  await expect(upgradedDialog).toBeVisible();
  const backdrop = page.locator(".card-preview-modal__backdrop");
  const hit = await backdrop.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const dialogRect = element.querySelector(".card-preview-modal")!.getBoundingClientRect();
    const point = { x: rect.left + 4, y: rect.top + 4 };
    return { point, trueBackdrop: document.elementFromPoint(point.x, point.y) === element, outside: point.x < dialogRect.left || point.y < dialogRect.top };
  });
  expect(hit).toMatchObject({ trueBackdrop: true, outside: true });
  await page.mouse.click(hit.point.x, hit.point.y);
  await expect(upgradedDialog).toBeHidden();
  await expect(pointerOpener).toBeFocused();
  expect(consoleIssues).toEqual([]);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Hardcore memory entry rejects invalid and already-guessed names but accepts complete normalized names", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("button", { name: "Hardcore Daily" }).click();

  const search = hardcoreSearch(page);
  const invalidCard = model.hardcoreWrongGuesses.find((card) => card.name.includes(" "))
    ?? model.hardcoreWrongGuesses[0]!;
  const characters = Array.from(invalidCard.name);
  const words = invalidCard.name.split(/\s+/u);
  const invalidQueries = [
    "",
    characters.slice(0, -1).join(""),
    words.length > 1 ? [...words].reverse().join(" ") : [...characters].reverse().join(""),
    `${characters.slice(0, -1).join("")}x`,
  ];

  for (const [index, query] of invalidQueries.entries()) {
    const rowCount = await page.getByRole("rowheader").count();
    await enterHardcoreName(page, query);
    await expect(search).toHaveValue(query);
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute("data-invalid-attempt", String(index + 1));
    await expect(search).toHaveClass(new RegExp(`card-search__input--invalid-${index % 2 === 0 ? "a" : "b"}`));
    await expect(page.getByRole("rowheader")).toHaveCount(rowCount);
    await expect(page.locator(".card-search").getByRole("status"))
      .toHaveText("No matching unguessed card name.");
    const animation = await search.evaluate((element) => {
      const style = getComputedStyle(element);
      const effect = element.getAnimations()[0]?.effect;
      const keyframes = effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
      return {
        name: style.animationName,
        duration: style.animationDuration,
        borderColors: keyframes.flatMap((frame) => [
          frame.borderTopColor,
          frame.borderRightColor,
          frame.borderBottomColor,
          frame.borderLeftColor,
        ]).filter(Boolean),
        backgroundColors: keyframes.map((frame) => frame.backgroundColor).filter(Boolean),
        transforms: keyframes.map((frame) => frame.transform).filter(Boolean),
      };
    });
    expect(animation.name).toBe(`card-search-invalid-${index % 2 === 0 ? "a" : "b"}`);
    expect(animation.duration).toBe("0.24s");
    expect(animation.borderColors).toContain("rgb(216, 107, 100)");
    expect(animation.backgroundColors).toContain("rgb(59, 25, 24)");
    expect(animation.transforms.some((transform) => transform !== "none" && transform !== "translateX(0px)"))
      .toBe(true);
  }

  const unchangedQuery = invalidQueries.at(-1)!;
  const retryStatus = page.locator(".card-search").getByRole("status");
  const previousStatusNode = await retryStatus.elementHandle();
  const retryRowCount = await page.getByRole("rowheader").count();
  await search.press("Enter");
  await expect(search).toHaveValue(unchangedQuery);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("data-invalid-attempt", "5");
  await expect(search).toHaveClass(/card-search__input--invalid-a/);
  await expect(page.getByRole("rowheader")).toHaveCount(retryRowCount);
  await expect(retryStatus).toHaveText("No matching unguessed card name.");
  expect(await previousStatusNode!.evaluate((element) => element.isConnected)).toBe(false);
  const retryAnimation = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    const animation = element.getAnimations()[0];
    return {
      name: style.animationName,
      duration: style.animationDuration,
      running: animation?.playState === "running",
    };
  });
  expect(retryAnimation).toEqual({
    name: "card-search-invalid-a",
    duration: "0.24s",
    running: true,
  });

  const validCard = model.hardcoreWrongGuesses.find((card) => card.id !== invalidCard.id)!;
  const normalizedVariant = Array.from(validCard.name.toLocaleUpperCase("en-US")).join(" . ");
  const initialRowCount = await page.getByRole("rowheader").count();
  await submitHardcoreGuessAndWait(page, validCard, normalizedVariant);
  await expect(page.getByRole("rowheader")).toHaveCount(initialRowCount + 1);
  await expect(page.getByRole("rowheader").first())
    .toHaveAttribute("aria-label", `${validCard.name} artwork and name`);
  await expect(search).toHaveValue("");

  await enterHardcoreName(page, normalizedVariant);
  await expect(search).toHaveValue(normalizedVariant);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("data-invalid-attempt", "1");
  await expect(page.getByRole("rowheader")).toHaveCount(initialRowCount + 1);
  await expect(page.locator(".card-search").getByRole("status"))
    .toHaveText("No matching unguessed card name.");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(0);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

test("Hardcore reduced motion keeps red invalid feedback and status without transform shake", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Hardcore Daily" }).click();

  const search = hardcoreSearch(page);
  const card = model.hardcoreWrongGuesses[0]!;
  const misspelled = `${Array.from(card.name).slice(0, -1).join("")}x`;
  await enterHardcoreName(page, misspelled);
  await expect(search).toHaveValue(misspelled);
  await expect(search).toBeFocused();
  await expect(page.locator(".card-search").getByRole("status"))
    .toHaveText("No matching unguessed card name.");
  const animation = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      name: style.animationName,
      duration: style.animationDuration,
      computedTransform: style.transform,
    };
  });
  expect(animation.name).toBe("card-search-invalid-reduced-a");
  expect(animation.duration).toBe("0.24s");
  expect(animation.computedTransform).toBe("none");
  await expect.poll(() => search.evaluate((element) => {
    const style = getComputedStyle(element);
    const running = element.getAnimations()[0];
    const effect = running?.effect;
    const keyframes = effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
    const channels = (value: string) => (value.match(/[\d.]+/gu) ?? []).map(Number);
    const border = channels(style.borderTopColor);
    const background = channels(style.backgroundColor);
    return {
      name: style.animationName,
      duration: style.animationDuration,
      running: running?.playState === "running",
      redVisible: border[0]! > 119 && background[0]! > 17 && background[2]! > 17,
      borderColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      transform: style.transform,
      transforms: keyframes.map((frame) => frame.transform).filter(Boolean),
    };
  }), { intervals: [0, 10, 20, 30], timeout: 180 }).toMatchObject({
    name: "card-search-invalid-reduced-a",
    duration: "0.24s",
    running: true,
    redVisible: true,
    transform: "none",
    transforms: [],
  });
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
    `Reveal Orb showed Mana: ${formatFeatureValue("mana", answerCard.base.mana, answerCard.upgraded.mana)}.`,
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

test("guess decoration cannot be selected or alter the grid while the orb target still works", async ({ page, request }) => {
  const model = await loadFixtureModel(request);
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const { guess, greenFeature } = model.orbFixture;
  await submitGuessAndWait(page, guess);
  const row = guessRow(page, guess);
  const cardName = row.locator(".guess-grid__card-name");
  const featureValue = row.locator(".feature-tile__value").last();
  const before = await row.evaluate((element) => ({
    text: element.textContent,
    className: element.className,
    tileBackgrounds: [...element.querySelectorAll<HTMLElement>(".feature-tile__back")]
      .map((tile) => getComputedStyle(tile).backgroundColor),
  }));
  const [cardNameBox, featureValueBox] = await Promise.all([cardName.boundingBox(), featureValue.boundingBox()]);
  expect(cardNameBox).not.toBeNull();
  expect(featureValueBox).not.toBeNull();

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(cardNameBox!.x + 3, cardNameBox!.y + cardNameBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    featureValueBox!.x + featureValueBox!.width - 3,
    featureValueBox!.y + featureValueBox!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect(cardName).toHaveCSS("user-select", "none");
  await expect(featureValue).toHaveCSS("user-select", "none");
  expect(await row.evaluate((element) => ({
    text: element.textContent,
    className: element.className,
    tileBackgrounds: [...element.querySelectorAll<HTMLElement>(".feature-tile__back")]
      .map((tile) => getComputedStyle(tile).backgroundColor),
  }))).toEqual(before);

  const target = row.getByRole("cell", {
    name: new RegExp(`^${FEATURE_LABELS[greenFeature]}:.*Result: green`),
  });
  await dragOrbTo(page, "Filter", target);
  await expect(page.locator(".orb-announcement"))
    .toHaveText(`Filter Orb now marks candidates matching ${FEATURE_LABELS[greenFeature]}.`);
  await expect(page.getByLabel("Filter Orb, used")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Filter Orb, available" })).toHaveCount(0);
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
  await expect(page.getByText("Both corresponding forms match exactly", { exact: true })).toHaveCount(0);
  await helpTrigger.click();
  const help = page.getByRole("dialog", { name: "How to play" });
  await expect(help).toBeVisible();
  for (const heading of ["Basics", "Result colors", "Set features", "Orbs and filtering", "Name hints", "Modes"]) {
    await expect(help.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(help.getByText("Both corresponding forms match exactly", { exact: true })).toBeVisible();
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
  await expect(wrongRow.getByRole("cell")).toHaveCount(7);
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
  await expect(wrongRow.getByRole("cell", {
    name: /^Keywords: None → Innate\. Result: (?:green|yellow|red)\.$/,
  })).toBeVisible();
  await expect(wrongRow.locator(".sprite-art--guess")).toHaveCSS("background-image", /guess\.webp/);
  await expect(search).toBeEnabled({ timeout: 5_000 });

  await page.reload();
  const restoredRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(firstWrongGuess.name) }) });
  await expect(restoredRow.getByRole("cell")).toHaveCount(7);
  await expect(restoredRow.locator(".feature-tile--immediate")).toHaveCount(7);
  await expect(restoredRow).not.toContainText(/Direction:/);
  await expect(restoredRow.locator(".feature-tile__result-mark, .feature-tile__hint")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();

  await chooseCard(page, secondWrongGuess.name);
  const secondWrongRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(secondWrongGuess.name) }) });
  await expect(secondWrongRow.getByRole("cell", {
    name: /^Keywords: Ethereal, Exhaust → Exhaust\. Result: (?:green|yellow|red)\.$/,
  })).toBeVisible();
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
  for (const row of shareRows) expect([...row]).toHaveLength(7);
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
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test(`measured overflow cues at ${viewport.width}x${viewport.height} move one column and never obstruct the page`, async ({ page }) => {
    const codexGuard = await prepareOfflinePage(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(viewport);
    await page.goto("/");

    const scroller = page.locator(".guess-grid-scroll");
    const hint = page.getByText("Swipe or scroll for more columns", { exact: false });
    const right = page.getByRole("button", { name: "Scroll guesses right" });
    const left = page.getByRole("button", { name: "Scroll guesses left" });
    await expect(scroller).toBeVisible();
    await expect(hint).toBeVisible();
    await expect(right).toBeVisible();
    await expect(left).toHaveCount(0);
    await expect(page.locator(".guess-grid-overflow__fade--right")).toHaveCount(1);
    await expect(page.locator(".guess-grid-overflow__fade--left")).toHaveCount(0);
    await expectAccessibleTarget(right);

    const initial = await scroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      maxScrollLeft: element.scrollWidth - element.clientWidth,
      pageClientWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    }));
    expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth + 1);
    expect(initial.scrollLeft).toBe(0);
    expect(initial.pageScrollWidth).toBeLessThanOrEqual(initial.pageClientWidth);

    await page.getByRole("button", { name: "Reveal Orb, available" }).click();
    const headerTarget = page.locator('.guess-grid__header[data-feature="cardClass"]')
      .getByRole("button", { name: "Class feature heading. Use Reveal Orb." });
    await expect(headerTarget).toBeVisible();
    const unobstructed = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => (
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      );
      const control = rect(".guess-grid-overflow__control--right");
      const target = rect('.guess-grid__header[data-feature="cardClass"] .guess-grid__header-target');
      const orbTray = rect(".orb-tray");
      const centerX = (target.left + target.right) / 2;
      const centerY = (target.top + target.bottom) / 2;
      const targetElement = document.querySelector<HTMLElement>(
        '.guess-grid__header[data-feature="cardClass"] .guess-grid__header-target',
      )!;
      const hit = document.elementFromPoint(centerX, centerY);
      return {
        controlOverlapsTarget: overlaps(control, target),
        controlOverlapsOrbTray: overlaps(control, orbTray),
        targetHeight: target.height,
        hitIsTarget: hit === targetElement || targetElement.contains(hit),
      };
    });
    expect(unobstructed.controlOverlapsTarget).toBe(false);
    expect(unobstructed.controlOverlapsOrbTray).toBe(false);
    expect(unobstructed.targetHeight).toBeGreaterThanOrEqual(44);
    expect(unobstructed.hitIsTarget).toBe(true);

    const manualScrollLeft = Math.min(12, initial.maxScrollLeft);
    await scroller.evaluate((element, nextScrollLeft) => {
      element.scrollLeft = nextScrollLeft;
      element.dispatchEvent(new Event("scroll"));
    }, manualScrollLeft);
    await expect(hint).toHaveCount(0);
    await expect(left).toBeVisible();
    await scroller.evaluate((element) => {
      element.scrollLeft = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect(hint).toHaveCount(0);
    await expect(left).toHaveCount(0);
    await expect(right).toBeVisible();

    const expectedOneColumn = Math.min(88, initial.maxScrollLeft);
    await right.click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft))
      .toBe(expectedOneColumn);
    await expect(left).toBeVisible();
    await expect(hint).toHaveCount(0);

    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => scroller.evaluate((element) => (
      element.scrollWidth - element.clientWidth - element.scrollLeft
    ))).toBe(0);
    await expect(left).toBeVisible();
    await expect(right).toHaveCount(0);
    await expect(page.locator(".guess-grid-overflow__fade--left")).toHaveCount(1);
    await expect(page.locator(".guess-grid-overflow__fade--right")).toHaveCount(0);
    const finalPageSize = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(finalPageSize.scrollWidth).toBeLessThanOrEqual(finalPageSize.clientWidth);
    expect(codexGuard.attemptedRequests).toEqual([]);
    expect(codexGuard.blockedRequests).toEqual([]);
  });
}

test("wide measured grid omits overflow hint, fades, and controls when every column fits", async ({ page }) => {
  const codexGuard = await prepareOfflinePage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const scroller = page.locator(".guess-grid-scroll");
  await expect(scroller).toBeVisible();
  await expect(page.getByText("Swipe or scroll for more columns", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scroll guesses left" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scroll guesses right" })).toHaveCount(0);
  await expect(page.locator(".guess-grid-overflow__fade")).toHaveCount(0);
  const geometry = await scroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.pageClientWidth);

  await page.getByRole("button", { name: "Reveal Orb, available" }).click();
  const headerTarget = page.locator('.guess-grid__header[data-feature="cardClass"]')
    .getByRole("button", { name: "Class feature heading. Use Reveal Orb." });
  await expect(headerTarget).toBeVisible();
  expect(await headerTarget.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.height >= 44 && (hit === element || element.contains(hit));
  })).toBe(true);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844, scrollerOverflows: true },
  { width: 768, height: 1024, scrollerOverflows: true },
  { width: 1440, height: 900, scrollerOverflows: false },
]) {
  test(`keeps ${viewport.width}x${viewport.height} game, Search, and preview contained with accessible targets`, async ({ page, request }) => {
    const model = await loadFixtureModel(request);
    const codexGuard = await prepareOfflinePage(page);
    const consoleIssues = watchConsoleIssues(page);
    await dismissSearchFilterHelpOnLoad(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Practice" }).click();
    await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
    const practiceWrongGuesses = model.cards
      .filter((card) => !model.practiceAnswer.acceptedCardIds.includes(card.id) && card.id !== "LONG_SET")
      .sort((left, right) => left.name.localeCompare(right.name, "en-US") || left.id.localeCompare(right.id, "en-US"));
    for (const card of practiceWrongGuesses.slice(0, 5)) await submitGuessAndWait(page, card);
    const longSet = model.cards.find((card) => card.id === "LONG_SET")!;
    expect(model.practiceAnswer.acceptedCardIds).not.toContain(longSet.id);
    await submitGuessAndWait(page, longSet);
    const longSetRow = guessRow(page, longSet);
    await expect(longSetRow.locator(".feature-tile__value--cardClass")).toHaveText("Necrobinder");
    await expect(longSetRow.locator(".feature-tile__value--powers"))
      .toHaveText("Afterimage, Strength, Vulnerable, Weak");
    await expect(longSetRow.locator(".feature-tile__value--keywords"))
      .toHaveText("Ethereal, Exhaust, Retain, Unplayable");
    const longSetGeometry = await longSetRow.evaluate((row) => {
      const measure = (selector: string) => {
        const value = row.querySelector<HTMLElement>(selector)!;
        const valueRect = value.getBoundingClientRect();
        const faceRect = value.closest<HTMLElement>(".feature-tile__face")!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(value);
        return {
          value: { left: valueRect.left, top: valueRect.top, right: valueRect.right, bottom: valueRect.bottom },
          face: { left: faceRect.left, top: faceRect.top, right: faceRect.right, bottom: faceRect.bottom },
          height: valueRect.height,
          lineCount: range.getClientRects().length,
          whiteSpace: getComputedStyle(value).whiteSpace,
        };
      };
      return {
        cardClass: measure(".feature-tile__value--cardClass"),
        powers: measure(".feature-tile__value--powers"),
        keywords: measure(".feature-tile__value--keywords"),
      };
    });
    expect(longSetGeometry.cardClass.whiteSpace).toBe("nowrap");
    expect(longSetGeometry.cardClass.lineCount).toBe(1);
    for (const feature of [longSetGeometry.powers, longSetGeometry.keywords]) {
      expect(feature.value.left).toBeGreaterThanOrEqual(feature.face.left);
      expect(feature.value.top).toBeGreaterThanOrEqual(feature.face.top);
      expect(feature.value.right).toBeLessThanOrEqual(feature.face.right);
      expect(feature.value.bottom).toBeLessThanOrEqual(feature.face.bottom);
    }
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
    await expect(helpTrigger).toHaveText("");
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
    const triggerVisualGeometry = await helpTrigger.evaluate((element) => {
      const art = element.querySelector<HTMLElement>(".game-guide__trigger-art")!;
      const frame = element.getBoundingClientRect();
      const artwork = art.getBoundingClientRect();
      const artStyle = getComputedStyle(art);
      return {
        frame: {
          width: frame.width,
          height: frame.height,
          x: frame.x + frame.width / 2,
          y: frame.y + frame.height / 2,
        },
        artwork: {
          x: artwork.x + artwork.width / 2,
          y: artwork.y + artwork.height / 2,
        },
        radius: getComputedStyle(element).borderRadius,
        backgroundImage: artStyle.backgroundImage,
        maskImage: artStyle.maskImage || artStyle.getPropertyValue("-webkit-mask-image"),
      };
    });
    expect(triggerVisualGeometry.frame.width).toBe(48);
    expect(triggerVisualGeometry.frame.height).toBe(48);
    expect(triggerVisualGeometry.radius).toBe("50%");
    expect(triggerVisualGeometry.backgroundImage).toContain("/assets/map_unknown-");
    expect(triggerVisualGeometry.backgroundImage).toContain(".png");
    expect(triggerVisualGeometry.maskImage).toBe("none");
    expect(Math.abs(triggerVisualGeometry.frame.x - triggerVisualGeometry.artwork.x)).toBeLessThanOrEqual(.5);
    expect(Math.abs(triggerVisualGeometry.frame.y - triggerVisualGeometry.artwork.y)).toBeLessThanOrEqual(.5);

    await helpTrigger.click();
    const help = page.getByRole("dialog", { name: "How to play" });
    await expect(help).toBeVisible();
    const setSectionGeometry = await help.getByRole("heading", { name: "Set features" }).locator("..").evaluate((section) => {
      const sectionRect = section.getBoundingClientRect();
      const rowRect = section.querySelector("li")!.getBoundingClientRect();
      return {
        section: { left: sectionRect.left, right: sectionRect.right },
        row: { left: rowRect.left, right: rowRect.right },
      };
    });
    expect(setSectionGeometry.row.left).toBeGreaterThanOrEqual(setSectionGeometry.section.left);
    expect(setSectionGeometry.row.right).toBeLessThanOrEqual(setSectionGeometry.section.right);
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

    const workspace = await openSearchWorkspace(page);
    const filterPanel = page.getByRole("region", { name: "Search filters" });
    const resultList = page.getByRole("list", { name: "Search results" });
    await expect(resultList.getByRole("button")).toHaveCount(model.cards.length);
    await expectAccessibleTarget(filterPanel.getByRole("button", { name: "Filter help" }));
    await expectAccessibleTarget(page.getByRole("searchbox", { name: "Search cards" }));
    await expectAccessibleTarget(resultList.getByRole("button").first());
    for (const group of await filterPanel.getByRole("group").all()) {
      await expectAccessibleTarget(group.locator(".search-filter__choice--disable"));
      await expectAccessibleTarget(group.locator(".search-filter__choice:not(.search-filter__choice--disable)").first());
    }
    const searchGeometry = await page.evaluate(() => {
      const root = document.documentElement;
      const shell = document.querySelector<HTMLElement>(".app-shell")!;
      const list = document.querySelector<HTMLElement>(".search-card-list")!;
      const shellRect = shell.getBoundingClientRect();
      const contained = [".game-panel", ".search-workspace", ".search-filter", ".search-card-list"]
        .map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
        });
      return {
        pageClientWidth: root.clientWidth,
        pageScrollWidth: root.scrollWidth,
        shell: { left: shellRect.left, right: shellRect.right },
        contained,
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        listOverflowY: getComputedStyle(list).overflowY,
        listScrollTopBefore: list.scrollTop,
      };
    });
    expect(searchGeometry.pageScrollWidth).toBe(searchGeometry.pageClientWidth);
    for (const element of searchGeometry.contained) {
      expect(element.left, `${element.selector} left containment`).toBeGreaterThanOrEqual(searchGeometry.shell.left - 1);
      expect(element.right, `${element.selector} right containment`).toBeLessThanOrEqual(searchGeometry.shell.right + 1);
      expect(element.scrollWidth, `${element.selector} horizontal overflow`).toBeLessThanOrEqual(element.clientWidth + 1);
    }
    expect(searchGeometry.listScrollHeight).toBeGreaterThan(searchGeometry.listClientHeight);
    expect(searchGeometry.listOverflowY).toBe("auto");
    const listScrollOwnership = await resultList.evaluate((list) => {
      const beforeDocument = { x: window.scrollX, y: window.scrollY };
      list.scrollTop = Math.min(160, list.scrollHeight - list.clientHeight);
      list.dispatchEvent(new Event("scroll"));
      return {
        beforeDocument,
        afterDocument: { x: window.scrollX, y: window.scrollY },
        listScrollTop: list.scrollTop,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(listScrollOwnership.listScrollTop).toBeGreaterThan(searchGeometry.listScrollTopBefore);
    expect(listScrollOwnership.afterDocument).toEqual(listScrollOwnership.beforeDocument);
    expect(listScrollOwnership.pageScrollWidth).toBe(listScrollOwnership.pageClientWidth);

    const previewCard = model.cards.find((card) => card.id === "ALCHEMIZE")!;
    const previewOpener = searchResult(page, previewCard);
    await previewOpener.click();
    const preview = page.getByRole("dialog", { name: `Preview ${previewCard.name}` });
    await expect(preview).toBeVisible();
    await expectAccessibleTarget(preview.getByRole("button", { name: "Close preview" }));
    await expect(workspace).toHaveAttribute("inert", "");
    await expect(page.locator(".app-shell__content")).toHaveAttribute("inert", "");
    const previewGeometry = await preview.evaluate((dialog) => {
      const root = document.documentElement;
      const rect = dialog.getBoundingClientRect();
      const faces = [...dialog.querySelectorAll<HTMLElement>("[data-card-preview-face]")].map((face) => {
        const faceRect = face.getBoundingClientRect();
        return { left: faceRect.left, right: faceRect.right, width: faceRect.width, height: faceRect.height };
      });
      const searchTab = document.querySelector<HTMLButtonElement>(".mode-tabs button:last-child")!;
      searchTab.focus();
      const beforeDocument = { x: window.scrollX, y: window.scrollY };
      dialog.scrollTop = Math.min(160, dialog.scrollHeight - dialog.clientHeight);
      dialog.dispatchEvent(new Event("scroll"));
      return {
        dialog: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        clientHeight: dialog.clientHeight,
        scrollHeight: dialog.scrollHeight,
        scrollTop: dialog.scrollTop,
        overflowY: getComputedStyle(dialog).overflowY,
        viewport: { width: root.clientWidth, height: window.innerHeight },
        pageScrollWidth: root.scrollWidth,
        beforeDocument,
        afterDocument: { x: window.scrollX, y: window.scrollY },
        faces,
        searchTabFocusBlocked: document.activeElement !== searchTab,
      };
    });
    expect(previewGeometry.dialog.left).toBeGreaterThanOrEqual(0);
    expect(previewGeometry.dialog.top).toBeGreaterThanOrEqual(0);
    expect(previewGeometry.dialog.right).toBeLessThanOrEqual(previewGeometry.viewport.width);
    expect(previewGeometry.dialog.bottom).toBeLessThanOrEqual(previewGeometry.viewport.height);
    expect(previewGeometry.overflowY).toBe("auto");
    expect(previewGeometry.scrollHeight).toBeGreaterThanOrEqual(previewGeometry.clientHeight);
    expect(previewGeometry.pageScrollWidth).toBe(previewGeometry.viewport.width);
    expect(previewGeometry.afterDocument).toEqual(previewGeometry.beforeDocument);
    expect(previewGeometry.searchTabFocusBlocked).toBe(true);
    expect(previewGeometry.faces).toHaveLength(2);
    for (const face of previewGeometry.faces) {
      expect(face.left).toBeGreaterThanOrEqual(previewGeometry.dialog.left);
      expect(face.right).toBeLessThanOrEqual(previewGeometry.dialog.right);
      expect(Math.abs(face.height / face.width - 1.3)).toBeLessThanOrEqual(.01);
    }
    if (viewport.width < 1000) {
      expect(previewGeometry.scrollHeight).toBeGreaterThan(previewGeometry.clientHeight);
      expect(previewGeometry.scrollTop).toBeGreaterThan(0);
    } else {
      expect(previewGeometry.scrollHeight).toBe(previewGeometry.clientHeight);
      expect(previewGeometry.scrollTop).toBe(0);
    }
    await preview.getByRole("button", { name: "Close preview" }).click();
    await expect(previewOpener).toBeFocused();
    expect(consoleIssues).toEqual([]);
    expect(codexGuard.attemptedRequests).toEqual([]);
    expect(codexGuard.blockedRequests).toEqual([]);
  });
}
