import {
  CARD_KEYWORDS,
  CARD_RARITIES,
  CARD_TARGETS,
  CARD_TYPES,
  UNIQUE_POWER,
  type CardClass,
  type CardIdentity,
  type CardKeyword,
  type CardRarity,
  type CardTarget,
  type CardType,
  type FeatureVector,
  type ManaValue,
} from "../../shared/domain.js";

const CARD_CLASSES: readonly CardClass[] = [
  "Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event",
];

export const CORE_FILTER_GROUPS = ["cardClass", "cardType", "mana", "rarity", "target"] as const;
export const POWER_FILTER_NONE = "power:none" as const;
export const KEYWORD_FILTER_NONE = "keyword:none" as const;
export const KEYWORD_FILTER_VALUES = [...CARD_KEYWORDS, KEYWORD_FILTER_NONE] as const;

export type PracticeFilterGroupName = (typeof CORE_FILTER_GROUPS)[number] | "powers" | "keywords";
export type PowerFilterValue = string;
export type KeywordFilterValue = CardKeyword | typeof KEYWORD_FILTER_NONE;
export type PracticeFilterValue = CardClass | CardType | ManaValue | CardRarity | CardTarget | PowerFilterValue | KeywordFilterValue;

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
  target: FilterGroup<CardTarget>;
  powers: FilterGroup<PowerFilterValue>;
  keywords: FilterGroup<KeywordFilterValue>;
}

export interface PracticeFilterOptions {
  cardClass: CardClass[];
  cardType: CardType[];
  mana: ManaValue[];
  rarity: CardRarity[];
  target: CardTarget[];
  powers: PowerFilterValue[];
  keywords: KeywordFilterValue[];
}

export type CandidateFormMatch = "both" | "base-only" | "upgrade-only" | null;

export function createDefaultPracticeFilter(): PracticeFilterState {
  return {
    enabled: false,
    cardClass: { disabled: true, selected: [] },
    cardType: { disabled: true, selected: [] },
    mana: { disabled: true, selected: [] },
    rarity: { disabled: true, selected: [] },
    target: { disabled: true, selected: [] },
    powers: { disabled: true, selected: [] },
    keywords: { disabled: true, selected: [] },
  };
}

export function collectPracticeFilterOptions(cards: readonly CardIdentity[]): PracticeFilterOptions {
  const cardClass = new Set<CardClass>();
  const cardType = new Set<CardType>();
  const mana = new Set<ManaValue>();
  const rarity = new Set<CardRarity>();
  const target = new Set<CardTarget>();
  const powers = new Set<string>();
  const keywords = new Set<CardKeyword>();

  for (const card of cards) {
    for (const form of [card.base, card.upgraded]) {
      cardClass.add(form.cardClass);
      cardType.add(form.cardType);
      mana.add(form.mana);
      rarity.add(form.rarity);
      target.add(form.target);
      for (const power of form.powers) powers.add(power);
      for (const keyword of form.keywords) keywords.add(keyword);
    }
  }

  return {
    cardClass: CARD_CLASSES.filter((value) => cardClass.has(value)),
    cardType: CARD_TYPES.filter((value) => cardType.has(value)),
    mana: [...mana].sort(compareMana),
    rarity: CARD_RARITIES.filter((value) => rarity.has(value)),
    target: CARD_TARGETS.filter((value) => target.has(value)),
    powers: [...powers].filter((value) => value !== UNIQUE_POWER)
      .sort((left, right) => left.localeCompare(right, "en-US"))
      .concat(powers.has(UNIQUE_POWER) ? [UNIQUE_POWER] : [], POWER_FILTER_NONE),
    keywords: [...CARD_KEYWORDS.filter((value) => keywords.has(value)), KEYWORD_FILTER_NONE],
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
  if ((group === "powers" || group === "keywords") && selected) {
    const none = group === "powers" ? POWER_FILTER_NONE : KEYWORD_FILTER_NONE;
    const next = value === none
      ? [none]
      : [...current.filter((item) => item !== none && item !== value), value];
    if (next.length === current.length && next.every((item, index) => item === current[index])) return filter;
    return { ...filter, [group]: { ...filter[group], selected: next } } as PracticeFilterState;
  }
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
    case "target": return CARD_TARGETS.includes(value as CardTarget);
    case "powers": return typeof value === "string"
      && !CARD_CLASSES.includes(value as CardClass)
      && !CARD_TYPES.includes(value as CardType)
      && !CARD_RARITIES.includes(value as CardRarity)
      && !CARD_TARGETS.includes(value as CardTarget)
      && !CARD_KEYWORDS.includes(value as CardKeyword)
      && value !== KEYWORD_FILTER_NONE;
    case "keywords": return KEYWORD_FILTER_VALUES.includes(value as KeywordFilterValue);
  }
}

function formMatches(vector: FeatureVector, filter: PracticeFilterState): boolean {
  return scalarGroupMatches(vector.cardClass, filter.cardClass)
    && scalarGroupMatches(vector.cardType, filter.cardType)
    && scalarGroupMatches(vector.mana, filter.mana)
    && scalarGroupMatches(vector.rarity, filter.rarity)
    && scalarGroupMatches(vector.target, filter.target)
    && setGroupMatches(vector.powers, filter.powers, POWER_FILTER_NONE)
    && setGroupMatches(vector.keywords, filter.keywords, KEYWORD_FILTER_NONE);
}

function scalarGroupMatches<T>(value: T, group: FilterGroup<T>): boolean {
  return group.disabled || group.selected.includes(value);
}

function setGroupMatches(values: readonly string[], group: FilterGroup<string>, none: string): boolean {
  if (group.disabled) return true;
  if (group.selected.includes(none)) return group.selected.length === 1 && values.length === 0;
  return group.selected.length > 0 && group.selected.every((value) => values.includes(value));
}
