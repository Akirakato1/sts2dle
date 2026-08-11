import { describe, expect, test } from "vitest";

import { formatDailyShare } from "../../src/shared/share.js";
import type { FeatureResult, ManaHint, TileColor } from "../../src/shared/comparison.js";
import { FEATURE_ORDER } from "../../src/shared/domain.js";

function result(feature: (typeof FEATURE_ORDER)[number], color: TileColor, hint: ManaHint = "none"): FeatureResult {
  return {
    feature,
    color,
    hint,
    displayValue: feature === "mana" ? "SECRET_MANA_7" : `SECRET_${feature}`,
  };
}

describe("formatDailyShare", () => {
  test("emits eleven symbols in FEATURE_ORDER with the mana hint after the third symbol", () => {
    const firstColors: TileColor[] = [
      "red", "green", "yellow", "red", "green", "green", "red", "green", "red", "green", "green",
    ];
    const guesses = [
      {
        cardId: "SECRET_GUESS_ID",
        results: [...FEATURE_ORDER].reverse().map((feature) => result(
          feature,
          firstColors[FEATURE_ORDER.indexOf(feature)]!,
          feature === "mana" ? "down" : "none",
        )),
      },
      { cardId: "SECRET_ANSWER_ID", results: FEATURE_ORDER.map((feature) => result(feature, "green")) },
    ];

    expect(formatDailyShare({
      utcDate: "2026-08-12",
      guesses,
      siteUrl: "https://example.test/daily?answer=SECRET#today",
    })).toBe([
      "STS-dle 2026-08-12 2/∞",
      "🟥🟩🟨↓🟥🟩🟩🟥🟩🟥🟩🟩",
      "🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩",
      "https://example.test/",
    ].join("\n"));
  });

  test.each([
    ["none", ""],
    ["up", "↑"],
    ["down", "↓"],
    ["dash", "–"],
    ["both", "↑↓"],
    ["up-dash", "↑ –"],
    ["down-dash", "↓ –"],
  ] as const)("formats the %s mana hint compactly", (hint, symbol) => {
    const guesses = [{
      cardId: "card-id",
      results: FEATURE_ORDER.map((feature) => result(feature, "red", feature === "mana" ? hint : "none")),
    }];
    const line = formatDailyShare({ utcDate: "2026-08-12", guesses, siteUrl: "https://example.test/" }).split("\n")[1];
    expect(line).toBe(`🟥🟥🟥${symbol}🟥🟥🟥🟥🟥🟥🟥🟥`);
  });

  test("never includes card names, IDs, feature values, image URLs, or non-root URLs", () => {
    const secretValues = ["Alchemize", "ALCHEMIZE_ID", "SECRET_MANA_7", "https://cards.example/alchemize.png", "/daily"];
    const text = formatDailyShare({
      utcDate: "2026-08-12",
      guesses: [{
        cardId: "ALCHEMIZE_ID",
        results: FEATURE_ORDER.map((feature) => ({
          ...result(feature, "red", feature === "mana" ? "up" : "none"),
          displayValue: feature === "cardClass"
            ? "Alchemize https://cards.example/alchemize.png"
            : `SECRET_${feature}`,
        })),
      }],
      siteUrl: "https://example.test/daily",
    });

    for (const secret of secretValues) expect(text).not.toContain(secret);
    expect(text).toContain("https://example.test/");
  });

  test("rejects a malformed guess rather than leaking a partial result", () => {
    expect(() => formatDailyShare({
      utcDate: "2026-08-12",
      guesses: [{ cardId: "id", results: [result("mana", "red", "up")] }],
      siteUrl: "https://example.test/",
    })).toThrow("exactly one result for every feature");
  });
});
