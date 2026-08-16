import React from "react";

import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import type { CardFormMatch } from "../game/card-filter.js";
import { formatSearchCardName } from "../game/search-card-label.js";
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
      const cardName = formatSearchCardName(card);
      return <li key={card.id}>
        <button
          type="button"
          className="search-card-list__result"
          aria-label={`Preview ${cardName}${label ? ` — ${label}` : ""}`}
          onPointerEnter={() => onWarmPreview(card)}
          onFocus={() => onWarmPreview(card)}
          onClick={() => onPreview(card)}
        >
          <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="candidate" label={`${cardName} artwork`} />
          <span className="search-card-list__identity">
            <span className="search-card-list__name">{card.name}</span>
            {card.duplicateName && <span className="search-card-list__class">({card.base.cardClass})</span>}
          </span>
          {label && <span className="search-card-list__badge">{label}</span>}
        </button>
      </li>;
    })}
  </ul>;
}
