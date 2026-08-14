import type { CardIdentity, FeatureName } from "../../shared/domain.js";
import { sameFeatureValue } from "../../shared/comparison.js";

export const ORB_KINDS = ["reveal", "filter", "negation"] as const;
export type OrbKind = (typeof ORB_KINDS)[number];

export type CandidateCategory = "neutral" | "green" | "red";

export interface CandidateVisibility {
  neutral: boolean;
  green: boolean;
  red: boolean;
}

export interface RevealOrbTarget {
  feature: FeatureName;
}

export interface ConstraintOrbTarget {
  guessIndex: number;
  cardId: string;
  feature: FeatureName;
}

export interface AssistanceState {
  reveal: RevealOrbTarget | null;
  filter: ConstraintOrbTarget | null;
  negation: ConstraintOrbTarget | null;
  visibility: CandidateVisibility;
}

export const DEFAULT_CANDIDATE_VISIBILITY: Readonly<CandidateVisibility> = Object.freeze({
  neutral: true,
  green: true,
  red: true,
});

export function createDefaultAssistance(): AssistanceState {
  return {
    reveal: null,
    filter: null,
    negation: null,
    visibility: { ...DEFAULT_CANDIDATE_VISIBILITY },
  };
}

export function featurePairMatches(left: CardIdentity, right: CardIdentity, feature: FeatureName): boolean {
  return sameFeatureValue(feature, left.base[feature], right.base[feature])
    && sameFeatureValue(feature, left.upgraded[feature], right.upgraded[feature]);
}

export function classifyCandidate(
  candidate: CardIdentity,
  assistance: AssistanceState,
  cardsById: ReadonlyMap<string, CardIdentity>,
): CandidateCategory {
  const negation = assistance.negation;
  const negated = negation ? cardsById.get(negation.cardId) : undefined;
  if (negated && negation && featurePairMatches(candidate, negated, negation.feature)) return "red";

  const filter = assistance.filter;
  const filtered = filter ? cardsById.get(filter.cardId) : undefined;
  if (filtered && filter && featurePairMatches(candidate, filtered, filter.feature)) return "green";

  return "neutral";
}

export function isCandidateCategoryVisible(category: CandidateCategory, visibility: CandidateVisibility): boolean {
  return visibility[category];
}

export function orbUsage(assistance: AssistanceState): Record<OrbKind, boolean> {
  return {
    reveal: assistance.reveal !== null,
    filter: assistance.filter !== null,
    negation: assistance.negation !== null,
  };
}
