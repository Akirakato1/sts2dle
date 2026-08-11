import { FEATURE_ORDER, type CardIdentity, type FeatureName, type ManaValue } from "./domain.js";

export type TileColor = "green" | "yellow" | "red";
export type ManaHint = "none" | "up" | "down" | "dash" | "both" | "up-dash" | "down-dash";

export interface FeatureResult {
  feature: FeatureName;
  color: TileColor;
  displayValue: string;
  hint: ManaHint;
}

function displayValue(base: unknown, upgraded: unknown): string {
  return base === upgraded ? String(base) : `${String(base)} → ${String(upgraded)}`;
}

type SingleManaHint = "none" | "up" | "down" | "dash";

function manaHint(guess: ManaValue, answer: ManaValue): SingleManaHint {
  if (guess === answer) return "none";
  if (typeof guess !== "number" || typeof answer !== "number") return "dash";
  return guess < answer ? "up" : "down";
}

function mergeHints(first: SingleManaHint, second: SingleManaHint): ManaHint {
  if (first === "none") return second;
  if (second === "none" || first === second) return first;
  if ((first === "up" && second === "down") || (first === "down" && second === "up")) return "both";
  if (first === "dash") return second === "up" ? "up-dash" : "down-dash";
  return first === "up" ? "up-dash" : "down-dash";
}

export function compareFeature(feature: FeatureName, guess: CardIdentity, answer: CardIdentity): FeatureResult {
  const baseMatches = guess.base[feature] === answer.base[feature];
  const upgradedMatches = guess.upgraded[feature] === answer.upgraded[feature];
  const color: TileColor = baseMatches && upgradedMatches ? "green" : baseMatches || upgradedMatches ? "yellow" : "red";
  return {
    feature,
    color,
    displayValue: displayValue(guess.base[feature], guess.upgraded[feature]),
    hint: feature === "mana"
      ? mergeHints(manaHint(guess.base.mana, answer.base.mana), manaHint(guess.upgraded.mana, answer.upgraded.mana))
      : "none",
  };
}

export function compareGuess(guess: CardIdentity, answer: CardIdentity): FeatureResult[] {
  return FEATURE_ORDER.map((feature) => compareFeature(feature, guess, answer));
}
