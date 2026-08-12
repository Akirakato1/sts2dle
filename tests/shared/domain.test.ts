import { describe, expect, it } from "vitest";
import {
  CARD_RARITIES,
  CARD_TYPES,
  FEATURE_ORDER,
  type ManaValue,
} from "../../src/shared/domain.js";

describe("FEATURE_ORDER", () => {
  it("keeps the approved ten-column order", () => {
    expect(FEATURE_ORDER).toEqual([
      "cardClass", "cardType", "mana", "rarity",
      "eternal", "ethereal", "exhaust", "innate",
      "retain", "sly",
    ]);
  });
});

describe("Spire Codex feature domains", () => {
  it("preserves every canonical card type and rarity", () => {
    expect(CARD_TYPES).toEqual(["Attack", "Skill", "Power", "Quest", "Status", "Curse"]);
    expect(CARD_RARITIES).toEqual([
      "Ancient", "Basic", "Common", "Curse", "Event",
      "Quest", "Rare", "Status", "Token", "Uncommon",
    ]);
  });
});

describe("ManaValue", () => {
  it("accepts None for unavailable mana", () => {
    const mana: ManaValue = "None";

    expect(mana).toBe("None");
  });
});
