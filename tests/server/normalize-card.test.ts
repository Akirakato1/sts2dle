import fixture from "../fixtures/spire-cards.json";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";
import { assertAllowedImageUrl } from "../../src/server/images/url-policy.js";
import { RawSpireCardsSchema } from "../../src/server/spire-codex/schema.js";
import { analyzeSourceFeatures, normalizeCard } from "../../src/server/sync/normalize-card.js";
import { baseKey, pairKey } from "../../src/shared/feature-keys.js";

const cards = RawSpireCardsSchema.parse(fixture);
const BASE_URL = "https://spire.test";

function card(id: string) {
  const result = cards.find((entry) => entry.id === id);
  if (!result) throw new Error(`Fixture card not found: ${id}`);
  return result;
}

function rawCard(overrides: Record<string, unknown>) {
  return RawSpireCardsSchema.parse([{ ...card("FALLING_STAR"), ...overrides }])[0]!;
}

const featureAnalysis = analyzeSourceFeatures(cards);
function normalize(raw: ReturnType<typeof card>) {
  return normalizeCard(raw, BASE_URL, featureAnalysis.powerCardCounts);
}

describe("normalizeCard", () => {
  it("uses Codex canonical keys for Falling Star instead of localized display fields", () => {
    const fallingStar = rawCard({
      id: "FALLING_STAR",
      name: "Falling Star",
      color: "regent",
      type: "Localized Attack",
      type_key: "Attack",
      rarity: null,
      rarity_key: "Basic",
    });

    expect(normalize(fallingStar).base).toMatchObject({
      cardClass: "Regent",
      cardType: "Attack",
      rarity: "Basic",
    });
  });

  it.each([
    ["Attack", "Attack"], ["Skill", "Skill"], ["Power", "Power"],
    ["Quest", "Quest"], ["Status", "Status"], ["Curse", "Curse"],
  ] as const)("uses type_key %s as the feature card type", (typeKey, expected) => {
    expect(normalize(rawCard({ type: "Localized", type_key: typeKey })).base.cardType)
      .toBe(expected);
  });

  it.each([
    ["Ancient", "Ancient"], ["Basic", "Basic"], ["Common", "Common"], ["Curse", "Curse"],
    ["Event", "Event"], ["Quest", "Quest"], ["Rare", "Rare"], ["Status", "Status"],
    ["Token", "Token"], ["Uncommon", "Uncommon"],
  ] as const)("uses rarity_key %s as the feature rarity", (rarityKey, expected) => {
    expect(normalize(rawCard({ rarity: null, rarity_key: rarityKey })).base.rarity)
      .toBe(expected);
  });
  it("applies keyword-only upgrades without an upgraded description", () => {
    expect(normalize(card("AFTERIMAGE")).upgraded.keywords).toContain("Innate");
  });

  it("uses the official canonical CDN URL for hosted Spire Codex card artwork", () => {
    expect(normalizeCard(card("ALCHEMIZE"), "https://spire-codex.com", featureAnalysis.powerCardCounts).artUrl)
      .toBe("https://cdn.spire-codex.com/cards/alchemize.webp");
  });

  it("allows canonical official artwork with the default production configuration", () => {
    const config = loadConfig({});
    const normalized = normalizeCard(card("ALCHEMIZE"), config.spireCodexBaseUrl, featureAnalysis.powerCardCounts);

    expect(() => assertAllowedImageUrl(
      normalized.artUrl,
      config.artworkAllowedOrigins,
      "Artwork",
    )).not.toThrow();
  });

  it("removes base keywords when an upgrade requests it", () => {
    expect(normalize(card("APPARITION")).upgraded.keywords).not.toContain("Ethereal");
  });

  it("uses a numeric upgrade cost as the effective mana", () => {
    expect(normalize(card("ALCHEMIZE")).upgraded.mana).toBe(0);
  });

  it("maps cost -1 without the X-cost flag to None", () => {
    const raw = structuredClone(card("DAZED"));
    raw.cost = -1;
    raw.is_x_cost = null;

    expect(normalize(raw).base.mana).toBe("None");
  });

  it("maps status cards to the neutral class", () => {
    expect(normalize(card("DAZED")).base.cardClass).toBe("Neutral");
  });

  it("preserves the event class and missing full-card URLs", () => {
    const normalized = normalize(card("MAD_SCIENCE"));
    expect(normalized.base.cardClass).toBe("Event");
    expect(normalized.baseCardUrl).toBeNull();
    expect(normalized.upgradedCardUrl).toBeNull();
  });

  it("uses the X-cost flag even when the numeric cost is zero", () => {
    const raw = structuredClone(card("MALAISE"));
    raw.cost = 0;
    raw.is_x_cost = true;

    expect(normalize(raw).base.mana).toBe("X");
  });

  it("includes Unplayable in canonical keyword arrays", () => {
    expect(normalize(card("DAZED")).base.keywords).toContain("Unplayable");
  });

  it("uses different generated keys when raw Unplayable is removed", () => {
    const rawWithKeyword = structuredClone(card("DAZED"));
    const rawWithoutKeyword = structuredClone(rawWithKeyword);
    rawWithoutKeyword.id = "DAZED_PLAYABLE_FIXTURE";
    rawWithoutKeyword.name = "Dazed Playable Fixture";
    rawWithoutKeyword.keywords_key = rawWithoutKeyword.keywords_key?.filter(
      (keyword) => keyword.toLowerCase() !== "unplayable",
    ) ?? [];
    const first = normalize(rawWithKeyword);
    const second = normalize(rawWithoutKeyword);

    expect(baseKey(first.base)).not.toBe(baseKey(second.base));
    expect(pairKey(first)).not.toBe(pairKey(second));
  });

  it("reuses base features for cards without an upgrade", () => {
    const normalized = normalize(card("DAZED"));
    expect(normalized.upgraded).toEqual(normalized.base);
  });

  it("requires strict raw target and power-entry data", () => {
    expect(() => RawSpireCardsSchema.parse([{ ...card("ALCHEMIZE"), target: "Hand" }])).toThrow();
    expect(() => RawSpireCardsSchema.parse([{
      ...card("ALCHEMIZE"), powers_applied: [{ power: "Weak" }],
    }])).toThrow();
  });

  it("counts each power key once per source card", () => {
    const analysis = analyzeSourceFeatures([
      card("ABRASIVE"), card("COMET"), card("RESONANCE"), card("DUPLICATE_STRENGTH"),
    ]);
    expect(analysis.powerCardCounts.get("strength")).toBe(2);
    expect(analysis.powerCardCounts.get("afterimage")).toBe(1);
  });

  it("keeps distinct singleton power keys separate when their display names match", () => {
    const first = structuredClone(card("RESONANCE"));
    first.id = "GUARD_A";
    first.powers_applied = [{ power: "Guard", power_key: "guard_a", amount: 1 }];
    const second = structuredClone(first);
    second.id = "GUARD_B";
    second.powers_applied = [{ power: "Guard", power_key: "guard_b", amount: 1 }];

    const analysis = analyzeSourceFeatures([first, second]);
    expect(analysis.powerCardCounts.get("guard_a")).toBe(1);
    expect(analysis.powerCardCounts.get("guard_b")).toBe(1);
    expect(normalizeCard(first, BASE_URL, analysis.powerCardCounts).base.powers).toEqual(["Unique Buff"]);
    expect(normalizeCard(second, BASE_URL, analysis.powerCardCounts).base.powers).toEqual(["Unique Buff"]);
  });

  it("returns immutable source-frequency data and rejects conflicting power displays", () => {
    const analysis = analyzeSourceFeatures([card("RESONANCE")]);
    expect((analysis.powerCardCounts as unknown as { set?: unknown }).set).toBeUndefined();

    const conflicting = structuredClone(card("RESONANCE"));
    conflicting.id = "CONFLICTING_STRENGTH";
    conflicting.powers_applied = [{ power: "Might", power_key: "strength", amount: 1 }];
    expect(() => analyzeSourceFeatures([card("RESONANCE"), conflicting])).toThrow(/conflicting power display names/i);
  });

  it("normalizes canonical target, power, and keyword arrays", () => {
    const analysis = analyzeSourceFeatures([
      card("ABRASIVE"), card("COMET"), card("RESONANCE"), card("DUPLICATE_STRENGTH"),
    ]);
    const counts = analysis.powerCardCounts;
    expect(normalizeCard(card("AFTERIMAGE"), BASE_URL, counts).base.powers).toEqual(["Unique Buff"]);
    expect(normalizeCard(card("COMET"), BASE_URL, counts).base.powers).toEqual(["Vulnerable", "Weak"]);
    expect(normalizeCard(card("DAZED"), BASE_URL, counts).base.keywords).toContain("Unplayable");
    expect(normalizeCard(card("APPARITION"), BASE_URL, counts).upgraded.keywords).not.toContain("Ethereal");
    expect(normalizeCard(card("RESONANCE"), BASE_URL, counts).base.target).toBe("AllEnemies");
  });
});
