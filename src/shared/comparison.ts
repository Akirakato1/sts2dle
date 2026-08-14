import { FEATURE_ORDER, type CardIdentity, type FeatureName, type FeatureVector } from "./domain.js";

export type TileColor = "green" | "yellow" | "red";

export interface FeatureResult {
  feature: FeatureName;
  color: TileColor;
  displayValue: string;
}

type FeatureValue = FeatureVector[FeatureName];

function isSetFeature(feature: FeatureName): feature is "powers" | "keywords" {
  return feature === "powers" || feature === "keywords";
}

function setsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function setsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}

export function sameFeatureValue(feature: FeatureName, left: FeatureValue, right: FeatureValue): boolean {
  if (isSetFeature(feature)) return setsEqual(left as readonly string[], right as readonly string[]);
  return left === right;
}

function formatSingleFeatureValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
  return String(value);
}

export function formatFeatureValue(base: unknown, upgraded: unknown): string {
  const baseDisplay = formatSingleFeatureValue(base);
  const upgradedDisplay = formatSingleFeatureValue(upgraded);
  return baseDisplay === upgradedDisplay ? baseDisplay : `${baseDisplay} \u2192 ${upgradedDisplay}`;
}

export function compareFeature(feature: FeatureName, guess: CardIdentity, answer: CardIdentity): FeatureResult {
  const baseExact = sameFeatureValue(feature, guess.base[feature], answer.base[feature]);
  const upgradeExact = sameFeatureValue(feature, guess.upgraded[feature], answer.upgraded[feature]);
  const baseOverlap = isSetFeature(feature) && setsOverlap(
    guess.base[feature] as readonly string[],
    answer.base[feature] as readonly string[],
  );
  const upgradeOverlap = isSetFeature(feature) && setsOverlap(
    guess.upgraded[feature] as readonly string[],
    answer.upgraded[feature] as readonly string[],
  );
  const green = baseExact && upgradeExact;
  const yellow = !green && (baseExact || upgradeExact || baseOverlap || upgradeOverlap);
  const color: TileColor = green ? "green" : yellow ? "yellow" : "red";
  return {
    feature,
    color,
    displayValue: formatFeatureValue(guess.base[feature], guess.upgraded[feature]),
  };
}

export function compareGuess(guess: CardIdentity, answer: CardIdentity): FeatureResult[] {
  return FEATURE_ORDER.map((feature) => compareFeature(feature, guess, answer));
}
