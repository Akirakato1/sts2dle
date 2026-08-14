import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import {
  compareFeature,
  compareGuess,
  formatFeatureValue,
  sameFeatureValue,
  setsOverlap,
} from "../../src/shared/comparison.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  target: "Self", powers: [], keywords: [],
};
function card(id: string, baseChanges: Partial<FeatureVector> = {}, upgradeChanges: Partial<FeatureVector> = {}): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
    base: { ...vector, ...baseChanges }, upgraded: { ...vector, ...upgradeChanges },
  };
}

describe("paired feature comparison", () => {
  const answer = card("answer", { mana: 2 }, { mana: 0 });

  it("marks matching paired features green", () => {
    expect(compareFeature("rarity", card("same"), answer).color).toBe("green");
  });

  it("returns a three-property result for a base-only mana match", () => {
    const baseOnlyMatch = card("base", { mana: 2 }, { mana: 1 });
    expect(compareFeature("mana", baseOnlyMatch, answer)).toEqual({
      feature: "mana", color: "yellow", displayValue: "2 \u2192 1",
    });
    expect(Object.hasOwn(compareFeature("mana", baseOnlyMatch, answer), "hint")).toBe(false);
  });

  it("marks a mana comparison red when neither base nor upgraded value matches", () => {
    const noMatches = card("no-matches", { mana: 1 }, { mana: 3 });
    expect(compareFeature("mana", noMatches, answer).color).toBe("red");
  });

  it("returns one ordered result for every feature", () => {
    expect(compareGuess(card("guess"), answer)).toHaveLength(7);
  });

  it("formats equal paired values once and changed values with an arrow", () => {
    expect(formatFeatureValue("Basic", "Basic")).toBe("Basic");
    expect(formatFeatureValue("Self", "None")).toBe("Self → None");
  });

  it("compares corresponding set-valued forms by exactness or overlap", () => {
    const answer = card("answer", { powers: ["Strength"] }, { powers: ["Weak"] });

    expect(compareFeature("powers", card("exact", { powers: ["Strength"] }, { powers: ["Weak"] }), answer).color).toBe("green");
    expect(compareFeature("powers", card("partial", { powers: ["Strength"] }, { powers: ["Strength"] }), answer).color).toBe("yellow");
    expect(compareFeature("powers", card("disjoint", { powers: ["Poison"] }, { powers: [] }), answer).color).toBe("red");
  });

  it("treats an empty matching form as exact and formats feature arrays canonically", () => {
    const emptyBaseAnswer = card("empty-answer", { keywords: [] }, { keywords: [] });

    expect(compareFeature("keywords", card("partial", { keywords: [] }, { keywords: ["Innate"] }), emptyBaseAnswer).color).toBe("yellow");
    expect(formatFeatureValue([], [])).toBe("None");
    expect(formatFeatureValue(["Strength", "Weak"], ["Strength", "Weak"])).toBe("Strength, Weak");
    expect(formatFeatureValue(["Ethereal", "Exhaust"], ["Exhaust"])).toBe("Ethereal, Exhaust → Exhaust");
  });

  it("compares set feature values by contents rather than array identity", () => {
    expect(sameFeatureValue("powers", ["Strength"], ["Strength"])).toBe(true);
    expect(sameFeatureValue("powers", ["Strength"], ["Weak"])).toBe(false);
    expect(setsOverlap(["Strength"], ["Strength", "Weak"])).toBe(true);
    expect(setsOverlap([], [])).toBe(false);
  });
});
