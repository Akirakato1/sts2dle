import type { FeatureResult, TileColor } from "./comparison.js";
import { FEATURE_ORDER, type FeatureName } from "./domain.js";

type ShareOrbKind = "reveal" | "filter" | "negation";

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
  hardcore: boolean;
  orbUsage?: Readonly<Record<ShareOrbKind, boolean>>;
}

const ORB_SYMBOLS: Readonly<Record<ShareOrbKind, string>> = {
  reveal: "\u{1F7E3}",
  filter: "\u{1F7E2}",
  negation: "\u{1F534}",
};
const CONSUMED_ORB_SYMBOL = "\u26AB";

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

export function formatDailyShare({ utcDate, guesses, siteUrl, hardcore, orbUsage }: FormatDailyShareOptions): string {
  if (!hardcore && (!orbUsage
    || typeof orbUsage.reveal !== "boolean"
    || typeof orbUsage.filter !== "boolean"
    || typeof orbUsage.negation !== "boolean")) {
    throw new Error("Normal Daily share requires orb usage.");
  }
  const universalSiteUrl = new URL("/", siteUrl).toString();
  return [
    `STS-dle${hardcore ? " Hardcore" : ""} ${utcDate} ${guesses.length}/∞`,
    ...guesses.map(formatGuess),
    ...(!hardcore && orbUsage ? [`Orbs: ${(["reveal", "filter", "negation"] as const)
      .map((kind) => orbUsage[kind] ? CONSUMED_ORB_SYMBOL : ORB_SYMBOLS[kind])
      .join(" ")}`] : []),
    universalSiteUrl,
  ].join("\n");
}
