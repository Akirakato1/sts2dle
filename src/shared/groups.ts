import type { BaseGroup, CardIdentity, PairGroup } from "./domain.js";
import { baseKey, pairKey } from "./feature-keys.js";

export interface CardGroups {
  baseGroups: BaseGroup[];
  pairGroups: PairGroup[];
  baseGroupsByKey: Map<string, BaseGroup>;
  pairGroupsByKey: Map<string, PairGroup>;
}

function sortedGroups(groups: Map<string, string[]>): BaseGroup[] {
  return [...groups]
    .map(([key, cardIds]) => ({ key, cardIds: [...cardIds].sort() }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function buildGroups(cards: CardIdentity[]): CardGroups {
  const baseIdsByKey = new Map<string, string[]>();
  const pairIdsByKey = new Map<string, string[]>();
  for (const card of cards) {
    const base = baseKey(card.base);
    const pair = pairKey(card);
    baseIdsByKey.set(base, [...(baseIdsByKey.get(base) ?? []), card.id]);
    pairIdsByKey.set(pair, [...(pairIdsByKey.get(pair) ?? []), card.id]);
  }
  const baseGroups = sortedGroups(baseIdsByKey);
  const pairGroups = sortedGroups(pairIdsByKey);
  return {
    baseGroups,
    pairGroups,
    baseGroupsByKey: new Map(baseGroups.map((group) => [group.key, group])),
    pairGroupsByKey: new Map(pairGroups.map((group) => [group.key, group])),
  };
}
