import type { CardIdentity } from "../../shared/domain.js";

export function normalizeHardcoreCardName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

export interface HardcoreNameResolutionInput {
  readonly cards: readonly CardIdentity[];
  readonly guessedCardIds: ReadonlySet<string>;
  readonly acceptedCardIds: ReadonlySet<string>;
  readonly query: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function resolveHardcoreCardName({
  cards,
  guessedCardIds,
  acceptedCardIds,
  query,
}: HardcoreNameResolutionInput): string | null {
  const normalizedQuery = normalizeHardcoreCardName(query);
  if (!normalizedQuery) return null;

  const guessedNames = new Set(
    cards
      .filter((card) => guessedCardIds.has(card.id))
      .map((card) => normalizeHardcoreCardName(card.name)),
  );
  if (guessedNames.has(normalizedQuery)) return null;

  const matches = cards
    .filter((card) => !guessedCardIds.has(card.id) && normalizeHardcoreCardName(card.name) === normalizedQuery)
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || compareCodeUnits(left.id, right.id));

  return matches.find((card) => acceptedCardIds.has(card.id))?.id ?? matches[0]?.id ?? null;
}
