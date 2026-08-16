import React from "react";

import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import type { CardFormMatch } from "../game/card-filter.js";
import { SpriteArt } from "./SpriteArt.js";

export interface SearchCardResult {
  card: CardIdentity;
  formMatch: Exclude<CardFormMatch, null>;
}

export interface SearchCardListProps {
  results: readonly SearchCardResult[];
  spriteMap: SpriteMap;
  onPreview(card: CardIdentity): void;
  onWarmPreview(card: CardIdentity): void;
}

function badge(formMatch: SearchCardResult["formMatch"]): string | null {
  if (formMatch === "base-only") return "Base only";
  if (formMatch === "upgrade-only") return "Upgrade only";
  return null;
}

export function SearchCardList({ results, spriteMap, onPreview, onWarmPreview }: SearchCardListProps): React.JSX.Element {
  return <ul className="search-card-list" aria-label="Search results">
    {results.map(({ card, formMatch }) => {
      const label = badge(formMatch);
      return <li key={card.id}>
        <button
          type="button"
          className="search-card-list__result"
          aria-label={`Preview ${card.name}${label ? ` — ${label}` : ""}`}
          onPointerEnter={() => onWarmPreview(card)}
          onFocus={() => onWarmPreview(card)}
          onClick={() => onPreview(card)}
        >
          <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="candidate" label={`${card.name} artwork`} />
          <span>{card.name}</span>
          {label && <span className="search-card-list__badge">{label}</span>}
        </button>
      </li>;
    })}
  </ul>;
}
