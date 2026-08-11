import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { baseKey, pairKey } from "../../src/shared/feature-keys.js";
import { buildGroups } from "../../src/shared/groups.js";

const base: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false, unplayable: false,
};

function card(id: string, overrides: Partial<CardIdentity> = {}): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
    base, upgraded: { ...base }, ...overrides,
  };
}

describe("feature keys and groups", () => {
  it("serializes feature vectors in canonical order rather than object property order", () => {
    const reordered = {
      unplayable: false, sly: false, retain: false, innate: false, exhaust: false,
      ethereal: false, eternal: false, rarity: "Common" as const, mana: 1,
      cardType: "Attack" as const, cardClass: "Ironclad" as const,
    };

    expect(baseKey(base)).toBe(baseKey(reordered));
  });

  it("groups equal bases together but keeps different upgrades in separate pairs", () => {
    const cardA = card("A");
    const cardB = card("B");
    const differentUpgrade = card("C", { upgraded: { ...base, mana: 0 } });
    const groups = buildGroups([cardB, differentUpgrade, cardA]);

    expect(baseKey(cardA.base)).toBe(baseKey(cardB.base));
    expect(pairKey(cardA)).not.toBe(pairKey(differentUpgrade));
    expect(groups.baseGroups[0]?.cardIds).toEqual([cardA.id, cardB.id, differentUpgrade.id].sort());
    expect(groups.pairGroupsByKey.get(pairKey(cardA))?.cardIds).toEqual(["A", "B"]);
  });
});
