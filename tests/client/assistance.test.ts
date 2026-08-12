import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import {
  ORB_KINDS,
  classifyCandidate,
  createDefaultAssistance,
  featurePairMatches,
  isCandidateCategoryVisible,
  orbUsage,
  type AssistanceState,
} from "../../src/client/game/assistance.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false,
};

function card(id: string, baseChanges: Partial<FeatureVector> = {}, upgradedChanges: Partial<FeatureVector> = {}): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
    base: { ...vector, ...baseChanges }, upgraded: { ...vector, ...upgradedChanges },
  };
}

describe("assistance candidate classification", () => {
  const filterSource = card("FILTER_SOURCE", { mana: 2 }, { mana: 3 });
  const negationSource = card("NEGATION_SOURCE", { rarity: "Rare" }, { rarity: "Uncommon" });
  const assistance: AssistanceState = {
    reveal: null,
    filter: { guessIndex: 0, cardId: "FILTER_SOURCE", feature: "mana" },
    negation: { guessIndex: 1, cardId: "NEGATION_SOURCE", feature: "rarity" },
    visibility: { neutral: true, green: true, red: true },
  };
  const cardsById = new Map([[filterSource.id, filterSource], [negationSource.id, negationSource]]);

  it.each([
    ["green", card("filter-match", { mana: 2 }, { mana: 3 })],
    ["red", card("negation-match", { rarity: "Rare" }, { rarity: "Uncommon" })],
    ["red", card("matches-both", { mana: 2, rarity: "Rare" }, { mana: 3, rarity: "Uncommon" })],
    ["neutral", card("neither", { mana: 4, rarity: "Basic" }, { mana: 5, rarity: "Common" })],
  ] as const)("classifies a %s candidate using paired feature values", (expected, candidate) => {
    expect(classifyCandidate(candidate, assistance, cardsById)).toBe(expected);
  });

  it("does not treat a base-only match as a paired match", () => {
    expect(featurePairMatches(card("base-only", { mana: 2 }, { mana: 9 }), filterSource, "mana")).toBe(false);
  });
});

describe("assistance presentation state", () => {
  it.each([
    [{ neutral: false, green: false, red: false }, false, false, false],
    [{ neutral: false, green: false, red: true }, false, false, true],
    [{ neutral: false, green: true, red: false }, false, true, false],
    [{ neutral: false, green: true, red: true }, false, true, true],
    [{ neutral: true, green: false, red: false }, true, false, false],
    [{ neutral: true, green: false, red: true }, true, false, true],
    [{ neutral: true, green: true, red: false }, true, true, false],
    [{ neutral: true, green: true, red: true }, true, true, true],
  ])("reads visibility flags independently", (visibility, neutral, green, red) => {
    expect(isCandidateCategoryVisible("neutral", visibility)).toBe(neutral);
    expect(isCandidateCategoryVisible("green", visibility)).toBe(green);
    expect(isCandidateCategoryVisible("red", visibility)).toBe(red);
  });

  it("creates independent default visibility objects", () => {
    const first = createDefaultAssistance();
    const second = createDefaultAssistance();
    first.visibility.green = false;
    expect(second.visibility.green).toBe(true);
  });

  it("reports orb usage in Reveal, Filter, Negation order without target details", () => {
    const assistance: AssistanceState = {
      reveal: { feature: "mana" },
      filter: null,
      negation: { guessIndex: 2, cardId: "source", feature: "rarity" },
      visibility: { neutral: true, green: true, red: true },
    };

    expect(ORB_KINDS).toEqual(["reveal", "filter", "negation"]);
    expect(orbUsage(assistance)).toEqual({ reveal: true, filter: false, negation: true });
  });
});
