import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import {
  classifyCandidate,
  isCandidateCategoryVisible,
  type AssistanceState,
  type CandidateCategory,
} from "../game/assistance.js";
import { SpriteArt } from "./SpriteArt.js";

export interface ClassifiedCandidate {
  card: CardIdentity;
  category: CandidateCategory;
}

export interface CardSearchProps {
  cards: readonly CardIdentity[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  spriteMap: SpriteMap;
  guessedCardIds: ReadonlySet<string>;
  assistance: AssistanceState | null;
  roundKey: string | number;
  disabled?: boolean;
  assistanceSlot?: React.ReactNode;
  nameHintSlot?: React.ReactNode;
  onVisibilityChange(category: CandidateCategory, visible: boolean): void;
  onSelect(cardId: string): void;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function searchCards(
  cards: readonly CardIdentity[],
  query: string,
  guessedCardIds: ReadonlySet<string>,
  assistance: AssistanceState | null,
  cardsById: ReadonlyMap<string, CardIdentity>,
): ClassifiedCandidate[] {
  const prefix = query.trim().toLocaleLowerCase("en-US");
  return cards
    .filter((card) => !guessedCardIds.has(card.id))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || compareCodeUnits(left.id, right.id))
    .map((card) => ({ card, category: assistance ? classifyCandidate(card, assistance, cardsById) : "neutral" }))
    .filter(({ category }) => assistance === null || isCandidateCategoryVisible(category, assistance.visibility))
    .filter(({ card }) => !prefix || card.name.toLocaleLowerCase("en-US").startsWith(prefix));
}

export function CardSearch({
  cards,
  cardsById,
  spriteMap,
  guessedCardIds,
  assistance = null,
  roundKey,
  disabled = false,
  assistanceSlot,
  nameHintSlot,
  onVisibilityChange,
  onSelect,
}: CardSearchProps) {
  const listboxId = useId();
  const pointerSelecting = useRef(false);
  const visibilityPointerDown = useRef(false);
  const optionRefs = useRef(new Map<string, HTMLLIElement>());
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const results = useMemo(
    () => searchCards(cards, query, guessedCardIds, assistance, cardsById),
    [assistance, cards, cardsById, guessedCardIds, query],
  );
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [cards]);
  const menuOpen = !disabled && isOpen;
  const activeIndex = activeCardId === null ? -1 : results.findIndex(({ card }) => card.id === activeCardId);
  const activeCandidate = activeIndex < 0 ? undefined : results[activeIndex];
  const hasResults = menuOpen && results.length > 0;
  const canNavigate = menuOpen && activeCandidate !== undefined;
  const optionId = (cardId: string) => `${listboxId}-option-${encodeURIComponent(cardId)}`;

  useEffect(() => {
    if (!disabled) return;
    pointerSelecting.current = false;
    visibilityPointerDown.current = false;
    setQuery("");
    setActiveCardId(null);
    setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    pointerSelecting.current = false;
    visibilityPointerDown.current = false;
    setQuery("");
    setActiveCardId(null);
    setIsOpen(false);
  }, [roundKey]);

  useEffect(() => {
    if (!menuOpen || activeCandidate === undefined || scrollRequest === 0) return;
    const option = optionRefs.current.get(activeCandidate.card.id);
    if (typeof option?.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [activeCandidate, menuOpen, scrollRequest]);

  useEffect(() => {
    setActiveCardId((current) => current !== null && !results.some(({ card }) => card.id === current) ? null : current);
  }, [results]);

  function choose(candidate: ClassifiedCandidate) {
    if (disabled) return;
    pointerSelecting.current = false;
    visibilityPointerDown.current = false;
    onSelect(candidate.card.id);
    setQuery("");
    setActiveCardId(null);
    setIsOpen(false);
  }

  function moveActive(direction: 1 | -1) {
    if (disabled || results.length === 0) return;
    setIsOpen(true);
    setScrollRequest((current) => current + 1);
    setActiveCardId((current) => {
      const currentIndex = current === null ? -1 : results.findIndex(({ card }) => card.id === current);
      const nextIndex = currentIndex < 0
        ? (direction === 1 ? 0 : results.length - 1)
        : (currentIndex + direction + results.length) % results.length;
      return results[nextIndex]!.card.id;
    });
  }

  return <section className="card-search" aria-label="Card search">
    {assistance !== null && nameHintSlot}
    <label className="card-search__label" htmlFor={`${listboxId}-input`}>Guess a card</label>
    <input
      id={`${listboxId}-input`}
      className="card-search__input"
      type="search"
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-controls={listboxId}
      aria-expanded={menuOpen}
      aria-activedescendant={canNavigate ? optionId(activeCandidate.card.id) : undefined}
      value={query}
      disabled={disabled}
      onChange={(event) => {
        if (disabled) return;
        const nextQuery = event.currentTarget.value;
        setQuery(nextQuery);
        setActiveCardId(null);
        setIsOpen(true);
      }}
      onFocus={() => { if (!disabled) setIsOpen(true); }}
      onBlur={() => {
        if (pointerSelecting.current || visibilityPointerDown.current) {
          pointerSelecting.current = false;
          visibilityPointerDown.current = false;
          return;
        }
        setIsOpen(false);
        setActiveCardId(null);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveActive(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveActive(-1);
        } else if (event.key === "Home" && hasResults) {
          event.preventDefault();
          setActiveCardId(results[0]!.card.id);
          setScrollRequest((current) => current + 1);
        } else if (event.key === "End" && hasResults) {
          event.preventDefault();
          setActiveCardId(results.at(-1)!.card.id);
          setScrollRequest((current) => current + 1);
        } else if (event.key === "Enter" && activeCandidate !== undefined) {
          event.preventDefault();
          choose(activeCandidate);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setIsOpen(false);
          setActiveCardId(null);
        }
      }}
    />
    {assistance !== null && assistanceSlot}
    {assistance !== null && <fieldset className="candidate-visibility" aria-label="Candidate visibility">
      {(["neutral", "green", "red"] as const).map((category) => <label
        key={category}
        className="candidate-visibility__label"
        onPointerDown={() => { visibilityPointerDown.current = true; }}
        onMouseDown={() => { visibilityPointerDown.current = true; }}
        onPointerUp={() => { visibilityPointerDown.current = false; }}
        onPointerCancel={() => { visibilityPointerDown.current = false; }}
        onMouseUp={() => { visibilityPointerDown.current = false; }}
      >
        <input
          type="checkbox"
          checked={assistance.visibility[category]}
          onMouseDown={(event) => event.preventDefault()}
          onChange={(event) => onVisibilityChange(category, event.currentTarget.checked)}
        />
        <span>{category[0]!.toUpperCase() + category.slice(1)}</span>
      </label>)}
    </fieldset>}
    {menuOpen && (results.length > 0 ? <ul id={listboxId} className="card-search__options" role="listbox">
      {results.map(({ card, category }) => <li
        id={optionId(card.id)}
        key={card.id}
        ref={(element) => {
          if (element) optionRefs.current.set(card.id, element);
          else optionRefs.current.delete(card.id);
        }}
        className={`card-search__option card-search__option--${category}`}
        role="option"
        aria-selected={card.id === activeCardId}
        onPointerDown={() => { pointerSelecting.current = true; }}
        onMouseDown={(event) => { event.preventDefault(); pointerSelecting.current = true; }}
        onPointerUp={() => { pointerSelecting.current = false; }}
        onPointerCancel={() => { pointerSelecting.current = false; }}
        onMouseUp={() => { pointerSelecting.current = false; }}
        onMouseEnter={() => setActiveCardId(card.id)}
        onClick={() => choose({ card, category })}
      >
        <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="candidate" label={`${card.name} artwork`} />
        <span className="card-search__name">{card.name}</span>
        {(card.duplicateName || duplicateNames.has(card.name)) && <span className="card-search__class">{card.base.cardClass}</span>}
        <span className="card-search__sr-only">{category === "neutral"
          ? "unhighlighted candidate"
          : category === "green"
            ? "matches Filter Orb"
            : "excluded by Negation Orb"}</span>
      </li>)}
    </ul> : <p className="card-search__empty" role="status">No visible candidates</p>)}
  </section>;
}
