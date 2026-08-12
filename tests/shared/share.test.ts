import { describe, expect, test } from "vitest";

import { formatDailyShare } from "../../src/shared/share.js";
import type { FeatureResult, TileColor } from "../../src/shared/comparison.js";
import { FEATURE_ORDER } from "../../src/shared/domain.js";

function result(feature: (typeof FEATURE_ORDER)[number], color: TileColor): FeatureResult {
  return {
    feature,
    color,
    displayValue: feature === "mana" ? "SECRET_MANA_7" : `SECRET_${feature}`,
  };
}

describe("formatDailyShare", () => {
  test("emits ten color symbols in FEATURE_ORDER", () => {
    const firstColors: TileColor[] = [
      "red", "green", "yellow", "red", "green", "green", "red", "green", "red", "green",
    ];
    const guesses = [
      {
        cardId: "SECRET_GUESS_ID",
        results: [...FEATURE_ORDER].reverse().map((feature) => result(
          feature,
          firstColors[FEATURE_ORDER.indexOf(feature)]!,
        )),
      },
      { cardId: "SECRET_ANSWER_ID", results: FEATURE_ORDER.map((feature) => result(feature, "green")) },
    ];
    const options = {
      utcDate: "2026-08-12",
      guesses,
      siteUrl: "https://example.test/daily?answer=SECRET#today",
    };

    expect(formatDailyShare(options)).toBe([
      "STS-dle 2026-08-12 2/∞",
      "\u{1F7E5}\u{1F7E9}\u{1F7E8}\u{1F7E5}\u{1F7E9}\u{1F7E9}\u{1F7E5}\u{1F7E9}\u{1F7E5}\u{1F7E9}",
      "\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}",
      "https://example.test/",
    ].join("\n"));
    const row = formatDailyShare(options).split("\n")[1]!;
    expect(Array.from(row)).toHaveLength(10);
    expect(row).not.toMatch(/[\u2191\u2193\u2013]/u);
  });

  test("never includes card names, IDs, feature values, image URLs, or non-root URLs", () => {
    const secretValues = ["Alchemize", "ALCHEMIZE_ID", "SECRET_MANA_7", "https://cards.example/alchemize.png", "/daily"];
    const text = formatDailyShare({
      utcDate: "2026-08-12",
      guesses: [{
        cardId: "ALCHEMIZE_ID",
        results: FEATURE_ORDER.map((feature) => ({
          ...result(feature, "red"),
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

  test("keeps share symbol rows in chronological guess order", () => {
    const text = formatDailyShare({
      utcDate: "2026-08-12",
      guesses: [
        { cardId: "FIRST_GUESS", results: FEATURE_ORDER.map((feature) => result(feature, "red")) },
        { cardId: "SECOND_GUESS", results: FEATURE_ORDER.map((feature) => result(feature, "green")) },
      ],
      siteUrl: "https://example.test/",
    });

    expect(text.split("\n").slice(1, 3)).toEqual([
      "\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}",
      "\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}",
    ]);
  });

  test("rejects a malformed guess rather than leaking a partial result", () => {
    expect(() => formatDailyShare({
      utcDate: "2026-08-12",
      guesses: [{ cardId: "id", results: [result("mana", "red")] }],
      siteUrl: "https://example.test/",
    })).toThrow("exactly one result for every feature");
  });
});
