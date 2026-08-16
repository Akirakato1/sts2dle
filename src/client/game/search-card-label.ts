import type { CardIdentity } from "../../shared/domain.js";

export function formatSearchCardName(card: CardIdentity): string {
  return card.duplicateName ? `${card.name} (${card.base.cardClass})` : card.name;
}
