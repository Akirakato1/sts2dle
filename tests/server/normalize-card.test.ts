import fixture from "../fixtures/spire-cards.json";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";
import { assertAllowedImageUrl } from "../../src/server/images/url-policy.js";
import { RawSpireCardsSchema } from "../../src/server/spire-codex/schema.js";
import { normalizeCard } from "../../src/server/sync/normalize-card.js";
import { baseKey, pairKey } from "../../src/shared/feature-keys.js";

const cards = RawSpireCardsSchema.parse(fixture);
const BASE_URL = "https://spire.test";

function card(id: string) {
  const result = cards.find((entry) => entry.id === id);
  if (!result) throw new Error(`Fixture card not found: ${id}`);
  return result;
}

describe("normalizeCard", () => {
  it("applies keyword-only upgrades without an upgraded description", () => {
    expect(normalizeCard(card("AFTERIMAGE"), BASE_URL).upgraded.innate).toBe(true);
  });

  it("uses the official canonical CDN URL for hosted Spire Codex card artwork", () => {
    expect(normalizeCard(card("ALCHEMIZE"), "https://spire-codex.com").artUrl)
      .toBe("https://cdn.spire-codex.com/cards/alchemize.webp");
  });

  it("allows canonical official artwork with the default production configuration", () => {
    const config = loadConfig({});
    const normalized = normalizeCard(card("ALCHEMIZE"), config.spireCodexBaseUrl);

    expect(() => assertAllowedImageUrl(
      normalized.artUrl,
      config.artworkAllowedOrigins,
      "Artwork",
    )).not.toThrow();
  });

  it("removes base keywords when an upgrade requests it", () => {
    expect(normalizeCard(card("APPARITION"), BASE_URL).upgraded.ethereal).toBe(false);
  });

  it("uses a numeric upgrade cost as the effective mana", () => {
    expect(normalizeCard(card("ALCHEMIZE"), BASE_URL).upgraded.mana).toBe(0);
  });

  it("maps cost -1 without the X-cost flag to None", () => {
    const raw = structuredClone(card("DAZED"));
    raw.cost = -1;
    raw.is_x_cost = null;

    expect(normalizeCard(raw, BASE_URL).base.mana).toBe("None");
  });

  it("maps status cards to the neutral class", () => {
    expect(normalizeCard(card("DAZED"), BASE_URL).base.cardClass).toBe("Neutral");
  });

  it("preserves the event class and missing full-card URLs", () => {
    const normalized = normalizeCard(card("MAD_SCIENCE"), BASE_URL);
    expect(normalized.base.cardClass).toBe("Event");
    expect(normalized.baseCardUrl).toBeNull();
    expect(normalized.upgradedCardUrl).toBeNull();
  });

  it("uses the X-cost flag even when the numeric cost is zero", () => {
    const raw = structuredClone(card("MALAISE"));
    raw.cost = 0;
    raw.is_x_cost = true;

    expect(normalizeCard(raw, BASE_URL).base.mana).toBe("X");
  });

  it("does not include unplayable in the normalized feature vector", () => {
    expect(Object.hasOwn(normalizeCard(card("DAZED"), BASE_URL).base, "unplayable")).toBe(false);
  });

  it("uses the same generated keys when raw Unplayable is removed", () => {
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
  });

  it("reuses base features for cards without an upgrade", () => {
    const normalized = normalizeCard(card("DAZED"), BASE_URL);
    expect(normalized.upgraded).toEqual(normalized.base);
  });
});
