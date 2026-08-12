import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";

import type { CardIdentity, PairGroup, SnapshotManifest } from "../../src/shared/domain.js";
import { compareGuess } from "../../src/shared/comparison.js";
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

interface FixtureModel {
  cards: CardIdentity[];
  answer: SelectedAnswer;
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
    request.get("/runtime/base-groups.json").then((response) => response.json()),
    request.get("/runtime/pair-groups.json").then((response) => response.json() as Promise<PairGroup[]>),
  ]);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const pairGroupsByKey = new Map(pairGroups.map((group) => [group.key, group]));
  const source = await createDailyRandom(FIXED_UTC_DATE, manifest.sourceRevision);
  const answer = selectAnswer({ baseGroups, pairGroups, pairGroupsByKey, baseGroupsByKey: new Map(baseGroups.map((group: { key: string }) => [group.key, group])) }, cardsById, source);
  const answerCard = cardsById.get(answer.selectedCardId)!;
  const risingGuess = cards.find((card) => card.id === "AFTERIMAGE");
  const fallingGuess = cards.find((card) => card.id === "APPARITION");
  if (!risingGuess || !fallingGuess) throw new Error("Directional E2E guesses were not retained");
  if (!compareGuess(risingGuess, answerCard).some((result) => result.displayValue === "false → true")) {
    throw new Error("Afterimage no longer demonstrates the false-to-true fixture direction");
  }
  if (!compareGuess(fallingGuess, answerCard).some((result) => result.displayValue === "true → false")) {
    throw new Error("Apparition no longer demonstrates the true-to-false fixture direction");
  }
  return { cards, answer, wrongGuesses: [risingGuess, fallingGuess] };
}

async function chooseCard(page: Page, name: string): Promise<void> {
  const search = page.getByRole("combobox", { name: "Guess a card" });
  await search.fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} artwork ${name}`) }).click();
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

test("Daily and Practice complete the full paired-card experience without leaking the answer", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const retryCard = model.answer.acceptedCardIds
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
  for (const meaning of [
    "Both base and upgraded features match",
    "Exactly one version matches",
    "Neither version matches",
  ]) await expect(page.getByText(meaning, { exact: true })).toBeVisible();
  const rules = page.getByText("How to play", { exact: true }).locator("..");
  await expect(rules).not.toHaveAttribute("open");
  await page.getByText("How to play", { exact: true }).click();
  await expect(rules).toHaveAttribute("open");
  await expect(rules).toContainText("Guess a base card name. Each guess compares the guessed base to the answer base and the guessed upgraded card to the answer upgraded card: base-to-base and upgraded-to-upgraded.");
  await expect(rules).toContainText("An X means keyword absent; a checkmark means keyword present.");
  await expect(rules).toContainText("Cards with identical complete paired feature sets are accepted as equivalent answers.");
  await expect(rules).toContainText("Daily uses the UTC date, restores your progress, and produces a share result after a win.");
  await expect(rules).toContainText("Practice provides unlimited random rounds and no share result.");
  const dailyTab = page.getByRole("button", { name: "Daily" });
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
  await chooseCard(page, firstWrongGuess.name);
  const wrongRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(firstWrongGuess.name) }) });
  await expect(wrongRow.getByRole("cell")).toHaveCount(10);
  const guessArtworkBox = await wrongRow.getByRole("img", {
    name: `${firstWrongGuess.name} guess artwork`,
  }).boundingBox();
  expect(guessArtworkBox).toMatchObject({ width: 72, height: 72 });
  await expect(wrongRow.getByRole("cell", { name: /Result: yellow/ }).first()).toBeVisible();
  await expect(wrongRow.getByRole("cell", { name: /Mana: .*Result: (red|yellow)\./ })).toBeVisible();
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

  const equivalentId = model.answer.acceptedCardIds.find((id) => id !== model.answer.selectedCardId)!;
  const equivalent = model.cards.find((card) => card.id === equivalentId)!;
  await chooseCard(page, equivalent.name);
  await expect(page.getByRole("heading", { name: "Accepted answers" })).toBeVisible({ timeout: 5_000 });
  for (const acceptedId of model.answer.acceptedCardIds) {
    const accepted = model.cards.find((card) => card.id === acceptedId)!;
    await expect(page.getByRole("heading", { name: accepted.name, level: 3, exact: true })).toBeVisible();
  }
  const revealImages = page.locator(".answer-reveal .card-stack__image");
  await expect(revealImages).toHaveCount(model.answer.acceptedCardIds.length * 2 - 1);
  const retryImage = page.getByRole("button", { name: `Retry ${retryCard.name} base image` });
  await expect(retryImage).toBeVisible();
  await expectAccessibleTarget(retryImage);
  fullCardFailure.allow = true;
  await retryImage.click();
  await expect(retryImage).toBeHidden();
  await expect(revealImages).toHaveCount(model.answer.acceptedCardIds.length * 2);
  await expect.poll(() => revealImages.evaluateAll((images) => images.every((image) => {
    const element = image as HTMLImageElement;
    return element.complete && element.naturalWidth > 0;
  }))).toBe(true);

  const acceptedCards = model.answer.acceptedCardIds.map((id) => model.cards.find((card) => card.id === id)!);
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
  await expect(page.getByRole("status")).toContainText("Daily result copied");
  const shareText = await page.evaluate(() => navigator.clipboard.readText());
  expect(shareText).toContain("STS-dle");
  expect(shareText).toContain(FIXED_UTC_DATE);
  for (const card of model.cards) expect(shareText).not.toContain(card.name);
  const shareRows = shareText.split(/\r?\n/).filter((line) => /^[🟩🟨🟥]+$/u.test(line));
  expect(shareRows).toEqual([
    "🟩🟥🟥🟩🟩🟩🟥🟨🟩🟩",
    "🟥🟩🟥🟥🟩🟨🟩🟩🟩🟩",
    "🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩",
  ]);
  for (const row of shareRows) expect([...row]).toHaveLength(10);
  const dailyStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key.startsWith("stsdle:daily:") || key === "stsdle:stats:v1")));

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
  await rawUnplayableOption.click();
  await expect(page.getByRole("rowheader", { name: rawUnplayable.name })).toBeVisible();
  await expect(search).toBeEnabled({ timeout: 5_000 });
  const practiceCard = model.cards.find((card) => card.id === firstPair.cardIds[1])!;
  await chooseCard(page, practiceCard.name);
  await expect(page.getByRole("button", { name: "Next random card" })).toBeVisible({ timeout: 5_000 });
  await expectAccessibleTarget(page.getByRole("button", { name: "Next random card" }));
  await expect(page.getByRole("button", { name: /copy/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Next random card" }).click();
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /copy/i })).toHaveCount(0);
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key.startsWith("stsdle:daily:") || key === "stsdle:stats:v1")))).toEqual(dailyStorage);
  expect(codexGuard.attemptedRequests).toEqual([]);
  expect(codexGuard.blockedRequests).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844, scrollerOverflows: true },
  { width: 768, height: 1024, scrollerOverflows: true },
  { width: 1440, height: 900, scrollerOverflows: false },
]) {
  test(`keeps ${viewport.width}x${viewport.height} page contained while the guess grid owns overflow`, async ({ page }) => {
    const codexGuard = await prepareOfflinePage(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
    const scroller = page.locator(".guess-grid-scroll");
    await expect(scroller).toBeVisible();
    const dimensions = await scroller.evaluate((element) => {
      const root = document.documentElement;
      return {
        pageClientWidth: root.clientWidth,
        pageScrollWidth: root.scrollWidth,
        scrollerClientWidth: element.clientWidth,
        scrollerScrollWidth: element.scrollWidth,
      };
    });
    expect(dimensions.pageScrollWidth).toBeLessThanOrEqual(dimensions.pageClientWidth);
    expect(dimensions.scrollerClientWidth).toBeGreaterThan(0);
    expect(dimensions.scrollerScrollWidth).toBeGreaterThan(0);
    if (viewport.scrollerOverflows) {
      expect(dimensions.scrollerScrollWidth).toBeGreaterThan(dimensions.scrollerClientWidth);
    } else {
      expect(dimensions.scrollerScrollWidth).toBeLessThanOrEqual(dimensions.scrollerClientWidth);
    }
    expect(codexGuard.attemptedRequests).toEqual([]);
    expect(codexGuard.blockedRequests).toEqual([]);
  });
}
