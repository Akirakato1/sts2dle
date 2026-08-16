import React, { useMemo, useRef, useState } from "react";

import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import {
  classifyCardCandidate,
  collectCardFilterOptions,
  createDefaultCardFilter,
  updateCardFilterGroupDisabled,
  updateCardFilterGroupValue,
  type CardFilterState,
} from "../game/card-filter.js";
import { loadSearchPreferences, saveSearchPreferences, type SearchPreferences } from "../game/search-storage.js";
import { preloadCardPreview } from "../game/preload-card-preview.js";
import { CardPreviewModal } from "./CardPreviewModal.js";
import { SearchCardList, type SearchCardResult } from "./SearchCardList.js";
import { SearchFilterPanel } from "./SearchFilterPanel.js";

export type { SearchCardResult } from "./SearchCardList.js";

export interface SearchWorkspaceProps {
  cards: readonly CardIdentity[];
  spriteMap: SpriteMap;
  storage?: Storage | null;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim();
}

export function deriveSearchResults(cards: readonly CardIdentity[], filter: CardFilterState, query: string): SearchCardResult[] {
  const normalizedQuery = normalize(query);
  return cards
    .map((card) => ({ card, formMatch: classifyCardCandidate(card, filter) }))
    .filter((result): result is SearchCardResult => result.formMatch !== null)
    .filter(({ card }) => !normalizedQuery || normalize(card.name).includes(normalizedQuery))
    .sort((left, right) => left.card.name.localeCompare(right.card.name, "en-US") || left.card.id.localeCompare(right.card.id, "en-US"));
}

export function SearchWorkspace({ cards, spriteMap, storage }: SearchWorkspaceProps): React.JSX.Element {
  const options = useMemo(() => collectCardFilterOptions(cards), [cards]);
  const [preferences, setPreferences] = useState(() => loadSearchPreferences(storage, options));
  const { filter, collapsed } = preferences;
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardIdentity | null>(null);
  const previewOpenerRef = useRef<HTMLElement | null>(null);
  const results = useMemo(() => deriveSearchResults(cards, filter, query), [cards, filter, query]);

  function update(next: SearchPreferences): void {
    setPreferences(next);
    saveSearchPreferences(storage, next);
  }

  return <>
    <section
      className="search-workspace"
      aria-label="Card search workspace"
      inert={selectedCard ? true : undefined}
      onClickCapture={(event) => {
        const opener = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".search-card-list__result") : null;
        if (opener) previewOpenerRef.current = opener;
      }}
    >
      <label className="search-workspace__query">
        Search cards
        <input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
      <SearchFilterPanel
        state={filter}
        options={options}
        collapsed={collapsed}
        onCollapsedChange={(nextCollapsed) => update({ filter, collapsed: nextCollapsed })}
        onReset={() => update({ filter: createDefaultCardFilter(), collapsed })}
        onGroupDisabledChange={(group, disabled) => update({ filter: updateCardFilterGroupDisabled(filter, group, disabled), collapsed })}
        onValueChange={(group, value, selected) => update({ filter: updateCardFilterGroupValue(filter, group, value, selected), collapsed })}
      />
      <SearchCardList
        results={results}
        spriteMap={spriteMap}
        onPreview={(card) => {
          previewOpenerRef.current?.focus();
          setSelectedCard(card);
        }}
        onWarmPreview={(card) => { void preloadCardPreview(card); }}
      />
      {results.length === 0 && <p role="status">No cards match these filters.</p>}
    </section>
    {selectedCard && <CardPreviewModal card={selectedCard} onClose={() => {
      setSelectedCard(null);
      queueMicrotask(() => previewOpenerRef.current?.focus());
    }} />}
  </>;
}
