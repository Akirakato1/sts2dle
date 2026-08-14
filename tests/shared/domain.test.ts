import { describe, expect, it } from "vitest";
import {
  CARD_KEYWORDS,
  CARD_RARITIES,
  CARD_TARGETS,
  CARD_TYPES,
  FEATURE_ORDER,
  type ManaValue,
} from "../../src/shared/domain.js";

describe("FEATURE_ORDER", () => {
  it("keeps the approved seven-column order", () => {
    expect(FEATURE_ORDER).toEqual([
      "cardClass", "cardType", "mana", "rarity",
      "target", "powers", "keywords",
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
    expect(CARD_TARGETS).toEqual([
      "Self", "AnyEnemy", "AllEnemies", "RandomEnemy",
      "AnyAlly", "AllAllies", "None",
    ]);
    expect(CARD_KEYWORDS).toEqual([
      "Eternal", "Ethereal", "Exhaust", "Innate", "Retain", "Sly", "Unplayable",
    ]);
  });
});

describe("ManaValue", () => {
  it("accepts None for unavailable mana", () => {
    const mana: ManaValue = "None";

    expect(mana).toBe("None");
  });
});
