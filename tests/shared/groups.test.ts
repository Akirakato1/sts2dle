import { describe, expect, it, vi } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { baseKey, pairKey } from "../../src/shared/feature-keys.js";
import { buildGroups } from "../../src/shared/groups.js";

const base: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  target: "Self", powers: ["Strength", "Weak"], keywords: ["Ethereal", "Exhaust"],
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
      keywords: ["Ethereal", "Exhaust"] as const, powers: ["Strength", "Weak"], target: "Self" as const,
      rarity: "Common" as const, mana: 1, cardType: "Attack" as const, cardClass: "Ironclad" as const,
    };

    expect(baseKey(base)).toBe(baseKey(reordered));
  });

  it("uses equal canonical array contents in grouping keys and rejects noncanonical arrays", () => {
    const separatelyAllocated: FeatureVector = {
      ...base,
      powers: ["Strength", "Weak"],
      keywords: ["Ethereal", "Exhaust"],
    };
    const noncanonical: FeatureVector = { ...base, powers: ["Weak", "Strength"] };

    expect(baseKey(base)).toBe(baseKey(separatelyAllocated));
    expect(pairKey(card("first"))).toBe(pairKey(card("second", { upgraded: { ...separatelyAllocated } })));
    expect(() => buildGroups([card("invalid", { base: noncanonical })])).toThrow();
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

  it("orders groups identically across input permutations even when locale collation ties keys", () => {
    const low = card("LOW", { base: { ...base, mana: 0 } });
    const high = card("HIGH", { base: { ...base, mana: 1 } });
    const expectedKeys = [baseKey(low.base), baseKey(high.base)].sort();
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockReturnValue(0);

    try {
      expect(buildGroups([low, high]).baseGroups.map((group) => group.key)).toEqual(expectedKeys);
      expect(buildGroups([high, low]).baseGroups.map((group) => group.key)).toEqual(expectedKeys);
    } finally {
      localeCompare.mockRestore();
    }
  });
});
