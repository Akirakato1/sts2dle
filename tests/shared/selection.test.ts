import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { buildGroups } from "../../src/shared/groups.js";
import { createDailyRandom, nextIndex, shuffleWithSource, type RandomSource } from "../../src/shared/random.js";
import { selectAnswer, selectDistinctAnswer } from "../../src/shared/selection.js";

const base: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  target: "Self", powers: [], keywords: [],
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
      .toEqual([1276318749, 161346104, 1761368639, 17782772]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses separate daily and hardcore-daily digest namespaces", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (_algorithm, data) => {
      const input = new TextDecoder().decode(data);
      const word = input.includes(":hardcore-daily:") ? 0x2222_2222 : 0x1111_1111;
      return Uint32Array.from([word, word, word, word]).buffer;
    });

    const daily = await createDailyRandom("2026-08-12", "abc123", "daily");
    const hardcore = await createDailyRandom("2026-08-12", "abc123", "hardcore-daily");

    expect(new TextDecoder().decode(digest.mock.calls[0]![1] as BufferSource)).toBe("stsdle:v2:daily:2026-08-12:abc123");
    expect(new TextDecoder().decode(digest.mock.calls[1]![1] as BufferSource)).toBe("stsdle:v2:hardcore-daily:2026-08-12:abc123");
    expect(daily.nextUint32()).not.toBe(hardcore.nextUint32());
  });

  it("gives Fisher-Yates the same unbiased rejection seam", () => {
    const values = [0xffff_ffff, 4, 0];
    const source: RandomSource = { nextUint32: () => values.shift() ?? 0 };

    expect(shuffleWithSource(["a", "b", "c"], source)).toEqual(["c", "a", "b"]);
    expect(values).toHaveLength(0);
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

  it("rerolls the complete base-group-then-card draw when the excluded card collides", () => {
    const cards = [card("A", { mana: 0 }), card("B", { mana: 2 })];
    const groups = buildGroups(cards);
    const cardsById = new Map(cards.map((entry) => [entry.id, entry]));
    const excludedId = groups.baseGroups[0]!.cardIds[0]!;
    const expectedId = groups.baseGroups[1]!.cardIds[0]!;
    const values = [0, 0, 1, 0];
    const source: RandomSource = { nextUint32: () => values.shift() ?? 0 };

    const result = selectDistinctAnswer(groups, cardsById, source, excludedId);

    expect(result.selectedCardId).toBe(expectedId);
  });

  it("fails with a fixed message when no distinct Daily answer exists", () => {
    const cards = [card("ONLY", { mana: 0 })];
    const groups = buildGroups(cards);
    const cardsById = new Map(cards.map((entry) => [entry.id, entry]));

    expect(() => selectDistinctAnswer(groups, cardsById, { nextUint32: () => 0 }, "ONLY"))
      .toThrow("Cannot select a distinct answer");
  });

  it("sanitizes corrupt-group failures without exposing a card identifier", () => {
    const cards = [card("A", { mana: 0 }), card("B", { mana: 2 })];
    const valid = buildGroups(cards);
    const groups = { ...valid, baseGroups: [{ key: "corrupt", cardIds: ["SECRET_CARD_ID"] }] };
    const cardsById = new Map(cards.map((entry) => [entry.id, entry]));

    let message = "";
    try {
      selectDistinctAnswer(groups, cardsById, { nextUint32: () => 0 }, "A");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Cannot select a distinct answer");
    expect(message).not.toContain("SECRET_CARD_ID");
  });

  it("bounds rejection when a pathological source repeats the excluded draw forever", () => {
    const cards = [card("A", { mana: 0 }), card("B", { mana: 2 })];
    const groups = buildGroups(cards);
    const cardsById = new Map(cards.map((entry) => [entry.id, entry]));
    let draws = 0;
    const source: RandomSource = { nextUint32: () => { draws += 1; return 0; } };

    expect(() => selectDistinctAnswer(groups, cardsById, source, groups.baseGroups[0]!.cardIds[0]!))
      .toThrow("Cannot select a distinct answer");
    expect(draws).toBe(2048);
  });
});
