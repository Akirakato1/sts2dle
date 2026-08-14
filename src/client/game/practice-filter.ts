import {
  CARD_RARITIES,
  CARD_TYPES,
  type CardClass,
  type CardIdentity,
  type CardRarity,
  type CardType,
  type FeatureVector,
  type ManaValue,
} from "../../shared/domain.js";

const CARD_CLASSES: readonly CardClass[] = [
  "Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event",
];

export const CORE_FILTER_GROUPS = ["cardClass", "cardType", "mana", "rarity"] as const;
export const KEYWORD_FILTER_FEATURES = ["eternal", "ethereal", "exhaust", "innate", "retain", "sly"] as const;

export type PracticeFilterGroupName = (typeof CORE_FILTER_GROUPS)[number] | "keywords";
export type KeywordFilterFeature = (typeof KEYWORD_FILTER_FEATURES)[number];
export type PracticeFilterValue = CardClass | CardType | ManaValue | CardRarity | KeywordFilterFeature;

export interface FilterGroup<T> {
  disabled: boolean;
  selected: T[];
}

export interface PracticeFilterState {
  enabled: boolean;
  cardClass: FilterGroup<CardClass>;
  cardType: FilterGroup<CardType>;
  mana: FilterGroup<ManaValue>;
  rarity: FilterGroup<CardRarity>;
  keywords: FilterGroup<KeywordFilterFeature>;
}

export interface PracticeFilterOptions {
  cardClass: CardClass[];
  cardType: CardType[];
  mana: ManaValue[];
  rarity: CardRarity[];
  keywords: KeywordFilterFeature[];
}

export type CandidateFormMatch = "both" | "base-only" | "upgrade-only" | null;

export function createDefaultPracticeFilter(): PracticeFilterState {
  return {
    enabled: false,
    cardClass: { disabled: true, selected: [] },
    cardType: { disabled: true, selected: [] },
    mana: { disabled: true, selected: [] },
    rarity: { disabled: true, selected: [] },
    keywords: { disabled: true, selected: [] },
  };
}

export function collectPracticeFilterOptions(cards: readonly CardIdentity[]): PracticeFilterOptions {
  const cardClass = new Set<CardClass>();
  const cardType = new Set<CardType>();
  const mana = new Set<ManaValue>();
  const rarity = new Set<CardRarity>();
  const keywords = new Set<KeywordFilterFeature>();

  for (const card of cards) {
    for (const form of [card.base, card.upgraded]) {
      cardClass.add(form.cardClass);
      cardType.add(form.cardType);
      mana.add(form.mana);
      rarity.add(form.rarity);
      for (const keyword of KEYWORD_FILTER_FEATURES) if (form[keyword]) keywords.add(keyword);
    }
  }

  return {
    cardClass: CARD_CLASSES.filter((value) => cardClass.has(value)),
    cardType: CARD_TYPES.filter((value) => cardType.has(value)),
    mana: [...mana].sort(compareMana),
    rarity: CARD_RARITIES.filter((value) => rarity.has(value)),
    keywords: KEYWORD_FILTER_FEATURES.filter((value) => keywords.has(value)),
  };
}

function compareMana(left: ManaValue, right: ManaValue): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  if (left === right) return 0;
  return left === "X" ? -1 : 1;
}

export function classifyPracticeCandidate(card: CardIdentity, filter: PracticeFilterState): CandidateFormMatch {
  const base = formMatches(card.base, filter);
  const upgraded = formMatches(card.upgraded, filter);
  if (base && upgraded) return "both";
  if (base) return "base-only";
  if (upgraded) return "upgrade-only";
  return null;
}

export function updatePracticeFilterGroupDisabled(
  filter: PracticeFilterState,
  group: PracticeFilterGroupName,
  disabled: boolean,
): PracticeFilterState {
  if (filter[group].disabled === disabled) return filter;
  return { ...filter, [group]: { ...filter[group], disabled } } as PracticeFilterState;
}

export function updatePracticeFilterGroupValue(
  filter: PracticeFilterState,
  group: PracticeFilterGroupName,
  value: PracticeFilterValue,
  selected: boolean,
): PracticeFilterState {
  if (!isValueForGroup(group, value)) return filter;
  const current = filter[group].selected as PracticeFilterValue[];
  const includesValue = current.includes(value);
  if (includesValue === selected) return filter;
  const next = selected ? [...current, value] : current.filter((item) => item !== value);
  return { ...filter, [group]: { ...filter[group], selected: next } } as PracticeFilterState;
}

function isValueForGroup(group: PracticeFilterGroupName, value: PracticeFilterValue): boolean {
  switch (group) {
    case "cardClass": return CARD_CLASSES.includes(value as CardClass);
    case "cardType": return CARD_TYPES.includes(value as CardType);
    case "mana": return typeof value === "number" || value === "X" || value === "None";
    case "rarity": return CARD_RARITIES.includes(value as CardRarity);
    case "keywords": return KEYWORD_FILTER_FEATURES.includes(value as KeywordFilterFeature);
  }
}

function formMatches(vector: FeatureVector, filter: PracticeFilterState): boolean {
  return coreGroupMatches(vector.cardClass, filter.cardClass)
    && coreGroupMatches(vector.cardType, filter.cardType)
    && coreGroupMatches(vector.mana, filter.mana)
    && coreGroupMatches(vector.rarity, filter.rarity)
    && keywordGroupMatches(vector, filter.keywords);
}

function coreGroupMatches<T>(value: T, group: FilterGroup<T>): boolean {
  return group.disabled || group.selected.includes(value);
}

function keywordGroupMatches(vector: FeatureVector, group: FilterGroup<KeywordFilterFeature>): boolean {
  return group.disabled || group.selected.every((keyword) => vector[keyword]);
}
