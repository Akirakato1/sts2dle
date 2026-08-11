import { FEATURE_ORDER, type CardIdentity, type FeatureVector } from "./domain.js";

export function baseKey(vector: FeatureVector): string {
  return FEATURE_ORDER.map((name) => JSON.stringify(vector[name])).join("|");
}

export function pairKey(card: Pick<CardIdentity, "base" | "upgraded">): string {
  return `${baseKey(card.base)}||${baseKey(card.upgraded)}`;
}
