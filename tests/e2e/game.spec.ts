import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
  wrongGuess: CardIdentity;
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
  const wrongGuess = cards.find((card) => !answer.acceptedCardIds.includes(card.id)
    && compareGuess(card, answerCard).some((result) => result.color === "yellow")
    && compareGuess(card, answerCard).some((result) => result.feature === "mana" && result.hint !== "none"));
  if (!wrongGuess) throw new Error("Fixture does not contain a yellow-plus-mana wrong guess");
  return { cards, answer, wrongGuess };
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
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, "getRandomValues", {
      configurable: true,
      value: (values: Uint32Array) => {
        values.fill(0);
        return values;
      },
    });
  });
  return guard;
}

async function expectAccessibleTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "interactive control should have a layout box").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

test("Daily and Practice complete the full paired-card experience without leaking the answer", async ({ context, page, request }) => {
  const model = await loadFixtureModel(request);
  const retryCard = model.answer.acceptedCardIds
    .map((id) => model.cards.find((card) => card.id === id)!)
    .find((card) => card.baseCardUrl?.startsWith("https://cdn.test/"))!;
  const fullCardFailure = { allow: false, url: retryCard.baseCardUrl! };
  const codexGuard = await prepareOfflinePage(page, fullCardFailure);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3000" });

  await page.goto("/");
  const attribution = page.getByRole("contentinfo");
  await expect(attribution.getByRole("link", { name: "Spire Codex" })).toHaveAttribute(
    "href",
    "https://spire-codex.com/",
  );
  await expect(attribution).toContainText(/unofficial fan project/i);
  await expect(attribution).toContainText(/not affiliated with or endorsed by Mega Crit/i);
  await expect(page.getByText(/Each guess compares its base card and upgrade together/i)).toBeVisible();
  const dailyTab = page.getByRole("button", { name: "Daily" });
  await expectAccessibleTarget(dailyTab);
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

  await chooseCard(page, model.wrongGuess.name);
  const wrongRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(model.wrongGuess.name) }) });
  await expect(wrongRow.getByRole("cell")).toHaveCount(11);
  await expect(wrongRow.getByRole("cell", { name: /Result: yellow/ }).first()).toBeVisible();
  await expect(wrongRow.getByRole("cell", { name: /Mana: .*Direction: (up|down|dash|both)/ })).toBeVisible();
  await expect(search).toBeEnabled({ timeout: 5_000 });

  await page.reload();
  const restoredRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(model.wrongGuess.name) }) });
  await expect(restoredRow.getByRole("cell")).toHaveCount(11);
  await expect(restoredRow.locator(".feature-tile--immediate")).toHaveCount(11);
  await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeEnabled();

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
  const dailyStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key.startsWith("stsdle:daily:") || key === "stsdle:stats:v1")));

  await page.getByRole("button", { name: "Practice" }).click();
  const firstPair = (await request.get("/runtime/pair-groups.json").then((response) => response.json() as Promise<PairGroup[]>))[0]!;
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
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`keeps ${viewport.width}x${viewport.height} page contained while the guess grid owns overflow`, async ({ page }) => {
    const codexGuard = await prepareOfflinePage(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Guess a card" })).toBeVisible();
    const dimensions = await page.evaluate(() => {
      const root = document.documentElement;
      const scroller = document.querySelector<HTMLElement>(".guess-grid-scroll")!;
      return {
        pageClientWidth: root.clientWidth,
        pageScrollWidth: root.scrollWidth,
        scrollerClientWidth: scroller.clientWidth,
        scrollerScrollWidth: scroller.scrollWidth,
      };
    });
    expect(dimensions.pageScrollWidth).toBeLessThanOrEqual(dimensions.pageClientWidth);
    expect(dimensions.scrollerScrollWidth).toBeGreaterThan(dimensions.scrollerClientWidth);
    expect(codexGuard.attemptedRequests).toEqual([]);
    expect(codexGuard.blockedRequests).toEqual([]);
  });
}
