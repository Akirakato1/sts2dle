import { describe, expect, it } from "vitest";
import { FEATURE_ORDER, type ManaValue } from "../../src/shared/domain.js";

describe("FEATURE_ORDER", () => {
  it("keeps the approved ten-column order", () => {
    expect(FEATURE_ORDER).toEqual([
      "cardClass", "cardType", "mana", "rarity",
      "eternal", "ethereal", "exhaust", "innate",
      "retain", "sly",
    ]);
  });
});

describe("ManaValue", () => {
  it("accepts None for unavailable mana", () => {
    const mana: ManaValue = "None";

    expect(mana).toBe("None");
  });
});
