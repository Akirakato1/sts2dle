import fixture from "../fixtures/spire-cards.json";
import { describe, expect, it } from "vitest";
import { RawSpireCardsSchema } from "../../src/server/spire-codex/schema.js";
import { normalizeCard } from "../../src/server/sync/normalize-card.js";

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

  it("removes base keywords when an upgrade requests it", () => {
    expect(normalizeCard(card("APPARITION"), BASE_URL).upgraded.ethereal).toBe(false);
  });

  it("uses a numeric upgrade cost as the effective mana", () => {
    expect(normalizeCard(card("ALCHEMIZE"), BASE_URL).upgraded.mana).toBe(0);
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

  it("normalizes X-cost cards", () => {
    expect(normalizeCard(card("MALAISE"), BASE_URL).base.mana).toBe("X");
  });

  it("reuses base features for cards without an upgrade", () => {
    const normalized = normalizeCard(card("DAZED"), BASE_URL);
    expect(normalized.upgraded).toEqual(normalized.base);
  });
});
