import { describe, expect, it } from "vitest";
import { FEATURE_ORDER, type ManaValue } from "../../src/shared/domain.js";

describe("FEATURE_ORDER", () => {
  it("keeps the approved eleven-column order", () => {
    expect(FEATURE_ORDER).toEqual([
      "cardClass", "cardType", "mana", "rarity",
      "eternal", "ethereal", "exhaust", "innate",
      "retain", "sly", "unplayable",
    ]);
  });
});

describe("ManaValue", () => {
  it("accepts the canonical en dash for unavailable mana", () => {
    const mana: ManaValue = "–";

    expect(mana).toBe("–");
  });
});
