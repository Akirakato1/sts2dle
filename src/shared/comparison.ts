import { FEATURE_ORDER, type CardIdentity, type FeatureName } from "./domain.js";

export type TileColor = "green" | "yellow" | "red";

export interface FeatureResult {
  feature: FeatureName;
  color: TileColor;
  displayValue: string;
}

function displayValue(base: unknown, upgraded: unknown): string {
  return base === upgraded ? String(base) : `${String(base)} \u2192 ${String(upgraded)}`;
}

export function compareFeature(feature: FeatureName, guess: CardIdentity, answer: CardIdentity): FeatureResult {
  const baseMatches = guess.base[feature] === answer.base[feature];
  const upgradedMatches = guess.upgraded[feature] === answer.upgraded[feature];
  const color: TileColor = baseMatches && upgradedMatches ? "green" : baseMatches || upgradedMatches ? "yellow" : "red";
  return {
    feature,
    color,
    displayValue: displayValue(guess.base[feature], guess.upgraded[feature]),
  };
}

export function compareGuess(guess: CardIdentity, answer: CardIdentity): FeatureResult[] {
  return FEATURE_ORDER.map((feature) => compareFeature(feature, guess, answer));
}
