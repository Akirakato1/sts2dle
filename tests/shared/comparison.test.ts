import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { compareFeature, compareGuess } from "../../src/shared/comparison.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false, unplayable: false,
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

  it("marks a base-only match yellow and points toward the answer", () => {
    const baseOnlyMatch = card("base", { mana: 2 }, { mana: 1 });
    expect(compareFeature("mana", baseOnlyMatch, answer)).toMatchObject({
      color: "yellow", hint: "down", displayValue: "2 → 1",
    });
  });

  it("combines opposite mana directions for crossing costs", () => {
    const crossingCosts = card("crossing", { mana: 1 }, { mana: 2 });
    expect(compareFeature("mana", crossingCosts, answer)).toMatchObject({ color: "red", hint: "both" });
  });

  it("collapses matching upward directions", () => {
    expect(compareFeature("mana", card("up", { mana: 1 }, { mana: -1 }), answer).hint).toBe("up");
  });

  it("collapses matching downward directions", () => {
    expect(compareFeature("mana", card("down", { mana: 3 }, { mana: 2 }), answer).hint).toBe("down");
  });

  it("merges an upward direction with non-comparable mana", () => {
    expect(compareFeature("mana", card("up-dash", { mana: 1 }, { mana: "X" }), answer).hint).toBe("up-dash");
  });

  it("merges a downward direction with non-comparable mana", () => {
    expect(compareFeature("mana", card("down-dash", { mana: 3 }, { mana: "X" }), answer).hint).toBe("down-dash");
  });

  it("uses a dash for non-comparable mana values", () => {
    expect(compareFeature("mana", card("x", { mana: "X" }, { mana: "X" }), answer).hint).toBe("dash");
  });

  it("returns one ordered result for every feature", () => {
    expect(compareGuess(card("guess"), answer)).toHaveLength(11);
  });
});
