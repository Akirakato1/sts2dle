import type { CardIdentity } from "./domain.js";
import type { CardGroups } from "./groups.js";
import { pairKey } from "./feature-keys.js";
import { nextIndex, type RandomSource } from "./random.js";

export interface SelectedAnswer {
  baseGroupKey: string;
  selectedCardId: string;
  pairKey: string;
  acceptedCardIds: string[];
}

export function selectAnswer(
  groups: CardGroups,
  cardsById: ReadonlyMap<string, CardIdentity>,
  source: RandomSource,
): SelectedAnswer {
  const baseGroup = groups.baseGroups[nextIndex(source, groups.baseGroups.length)];
  if (!baseGroup) throw new RangeError("Cannot select from empty base groups");
  const selectedCardId = baseGroup.cardIds[nextIndex(source, baseGroup.cardIds.length)];
  if (!selectedCardId) throw new RangeError("Cannot select from an empty base group");
  const selectedCard = cardsById.get(selectedCardId);
  if (!selectedCard) throw new Error(`Missing selected card: ${selectedCardId}`);
  const selectedPairKey = pairKey(selectedCard);
  const pairGroup = groups.pairGroupsByKey.get(selectedPairKey);
  if (!pairGroup) throw new Error(`Missing pair group: ${selectedPairKey}`);
  return { baseGroupKey: baseGroup.key, selectedCardId, pairKey: selectedPairKey, acceptedCardIds: pairGroup.cardIds };
}
