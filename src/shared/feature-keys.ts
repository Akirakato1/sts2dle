import { FEATURE_ORDER, type CardIdentity, type FeatureVector } from "./domain.js";
import { cardIdentitySchema } from "./snapshot-schema.js";

export function baseKey(vector: FeatureVector): string {
  const canonical = cardIdentitySchema.shape.base.parse(vector);
  return FEATURE_ORDER.map((name) => JSON.stringify(canonical[name])).join("|");
}

export function pairKey(card: Pick<CardIdentity, "base" | "upgraded">): string {
  return `${baseKey(card.base)}||${baseKey(card.upgraded)}`;
}
