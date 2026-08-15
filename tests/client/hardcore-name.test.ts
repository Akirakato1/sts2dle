import { describe, expect, test } from "vitest";

import {
  normalizeHardcoreCardName,
  resolveHardcoreCardName,
  type HardcoreNameResolutionInput,
} from "../../src/client/game/hardcore-name.js";
import type { CardIdentity } from "../../src/shared/domain.js";

function card(id: string, name = id): CardIdentity {
  return {
    id,
    name,
    hasUpgrade: true,
    artUrl: "https://art.example/card.png",
    baseCardUrl: null,
    upgradedCardUrl: null,
    base: {
      cardClass: "Silent",
      cardType: "Skill",
      mana: 1,
      rarity: "Common",
      target: "Self",
      powers: [],
      keywords: [],
    },
    upgraded: {
      cardClass: "Silent",
      cardType: "Skill",
      mana: 0,
      rarity: "Common",
      target: "Self",
      powers: [],
      keywords: [],
    },
  };
}

const strikeCards = [
  card("STRIKE_ZETA", "Strike"),
  card("STRIKE_ALPHA", "Strike"),
  card("STRIKE_GAMMA", "Strike"),
  card("STRIKE_DELTA", "Strike"),
  card("STRIKE_BETA", "Strike"),
];

const defendCards = [
  card("DEFEND_ZETA", "Defend"),
  card("DEFEND_ALPHA", "Defend"),
  card("DEFEND_GAMMA", "Defend"),
  card("DEFEND_DELTA", "Defend"),
  card("DEFEND_BETA", "Defend"),
];

const cards = [card("AFTERIMAGE", "After Image"), ...strikeCards, ...defendCards];

function input(overrides: Partial<HardcoreNameResolutionInput> = {}): HardcoreNameResolutionInput {
  return {
    cards,
    guessedCardIds: new Set<string>(),
    acceptedCardIds: new Set<string>(),
    query: "",
    ...overrides,
  };
}

describe("normalizeHardcoreCardName", () => {
  test.each([
    ["  F.T.L.  ", "ftl"],
    ["Snake-Bite", "snakebite"],
    ["AFTER IMAGE", "afterimage"],
    ["Re\u0301sonance", "r\u00e9sonance"],
  ])("normalizes %j to %j", (value, expected) => {
    expect(normalizeHardcoreCardName(value)).toBe(expected);
  });
});

describe("resolveHardcoreCardName", () => {
  test("requires an unguessed complete normalized name in its original word order", () => {
    expect(resolveHardcoreCardName({ ...input(), query: "after" })).toBeNull();
    expect(resolveHardcoreCardName({ ...input(), query: "image after" })).toBeNull();
    expect(resolveHardcoreCardName({ ...input(), query: "afterimaje" })).toBeNull();
    expect(resolveHardcoreCardName({ ...input(), query: "after image" })).toBe("AFTERIMAGE");
    expect(resolveHardcoreCardName({ ...input(), query: "   " })).toBeNull();
  });

  test("rejects every card represented by an earlier shared-name guess", () => {
    expect(resolveHardcoreCardName(input({
      guessedCardIds: new Set(["STRIKE_GAMMA"]),
      query: "strike",
    }))).toBeNull();
  });

  test("selects an accepted shared-name identity ahead of stable ordering", () => {
    expect(resolveHardcoreCardName(input({
      acceptedCardIds: new Set(["STRIKE_ZETA"]),
      query: "strike",
    }))).toBe("STRIKE_ZETA");
  });

  test("uses the first stable shared-name representative when none is accepted", () => {
    expect(resolveHardcoreCardName(input({ query: "strike" }))).toBe("STRIKE_ALPHA");
    expect(resolveHardcoreCardName(input({ query: "defend" }))).toBe("DEFEND_ALPHA");
  });
});
