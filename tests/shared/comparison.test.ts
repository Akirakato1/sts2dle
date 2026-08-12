import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { compareFeature, compareGuess } from "../../src/shared/comparison.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false,
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
    expect(compareGuess(card("guess"), answer)).toHaveLength(10);
  });
});
