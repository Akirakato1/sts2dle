import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { buildGroups } from "../../src/shared/groups.js";
import { createDailyRandom, nextIndex, type RandomSource } from "../../src/shared/random.js";
import { selectAnswer } from "../../src/shared/selection.js";

const base: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false, unplayable: false,
};
function card(id: string, changes: Partial<FeatureVector>): CardIdentity {
  const identity = { ...base, ...changes };
  return { id, name: id, hasUpgrade: false, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: identity, upgraded: identity };
}

describe("nextIndex", () => {
  it("rejects modulo-bias tail values before choosing an index", () => {
    const values = [0xffff_ffff, 4];
    const source: RandomSource = { nextUint32: () => values.shift() ?? 0 };

    expect(nextIndex(source, 3)).toBe(1);
  });
});

describe("createDailyRandom", () => {
  it("keeps the seeded Daily sequence stable", async () => {
    const source = await createDailyRandom("2026-08-12", "abc123");

    expect([source.nextUint32(), source.nextUint32(), source.nextUint32(), source.nextUint32()])
      .toEqual([2712364787, 3757452310, 246433847, 3091294913]);
  });
});

describe("selectAnswer", () => {
  it("selects a base group first and then a card within it", () => {
    const cards = [card("B", { mana: 0 }), card("A", { mana: 0 }), card("C", { mana: 2 })];
    const groups = buildGroups(cards);
    const cardsById = new Map(cards.map((entry) => [entry.id, entry]));
    const scriptedValues = [1, 0];
    const scripted: RandomSource = { nextUint32: () => scriptedValues.shift() ?? 0 };

    const result = selectAnswer(groups, cardsById, scripted);

    expect(result.baseGroupKey).toBe(groups.baseGroups[1]?.key);
    expect(result.selectedCardId).toBe(groups.baseGroups[1]?.cardIds[0]);
    expect(result.acceptedCardIds).toEqual(groups.pairGroupsByKey.get(result.pairKey)?.cardIds);
  });
});
