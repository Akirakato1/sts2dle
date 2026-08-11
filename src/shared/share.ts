import type { FeatureResult, ManaHint, TileColor } from "./comparison.js";
import { FEATURE_ORDER, type FeatureName } from "./domain.js";

const COLOR_SYMBOLS: Record<TileColor, string> = {
  green: "🟩",
  yellow: "🟨",
  red: "🟥",
};

const HINT_SYMBOLS: Record<ManaHint, string> = {
  none: "",
  up: "↑",
  down: "↓",
  dash: "–",
  both: "↑↓",
  "up-dash": "↑ –",
  "down-dash": "↓ –",
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

  return FEATURE_ORDER.map((feature) => {
    const result = byFeature.get(feature)!;
    const hint = feature === "mana" && result.color !== "green" ? HINT_SYMBOLS[result.hint] : "";
    return `${COLOR_SYMBOLS[result.color]}${hint}`;
  }).join("");
}

export function formatDailyShare({ utcDate, guesses, siteUrl }: FormatDailyShareOptions): string {
  const universalSiteUrl = new URL("/", siteUrl).toString();
  return [
    `STS-dle ${utcDate} ${guesses.length}/∞`,
    ...guesses.map(formatGuess),
    universalSiteUrl,
  ].join("\n");
}
