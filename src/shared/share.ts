import type { FeatureResult, TileColor } from "./comparison.js";
import { FEATURE_ORDER, type FeatureName } from "./domain.js";

const COLOR_SYMBOLS: Record<TileColor, string> = {
  green: "\u{1F7E9}",
  yellow: "\u{1F7E8}",
  red: "\u{1F7E5}",
};

export interface ShareGuess {
  cardId: string;
  results: readonly FeatureResult[];
}

export interface FormatDailyShareOptions {
  utcDate: string;
  guesses: readonly ShareGuess[];
  siteUrl: string;
}

function formatGuess(guess: ShareGuess): string {
  const byFeature = new Map<FeatureName, FeatureResult>();
  for (const result of guess.results) byFeature.set(result.feature, result);
  if (guess.results.length !== FEATURE_ORDER.length
    || byFeature.size !== FEATURE_ORDER.length
    || FEATURE_ORDER.some((feature) => !byFeature.has(feature))) {
    throw new Error("A share guess must contain exactly one result for every feature.");
  }

  return FEATURE_ORDER.map((feature) => COLOR_SYMBOLS[byFeature.get(feature)!.color]).join("");
}

export function formatDailyShare({ utcDate, guesses, siteUrl }: FormatDailyShareOptions): string {
  const universalSiteUrl = new URL("/", siteUrl).toString();
  return [
    `STS-dle ${utcDate} ${guesses.length}/∞`,
    ...guesses.map(formatGuess),
    universalSiteUrl,
  ].join("\n");
}
