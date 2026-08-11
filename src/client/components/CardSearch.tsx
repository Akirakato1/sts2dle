import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import { SpriteArt } from "./SpriteArt.js";

export interface CardSearchProps {
  cards: readonly CardIdentity[];
  spriteMap: SpriteMap;
  guessedCardIds: ReadonlySet<string>;
  disabled?: boolean;
  onSelect(cardId: string): void;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function searchCards(
  cards: readonly CardIdentity[],
  query: string,
  excluded: ReadonlySet<string>,
): CardIdentity[] {
  const prefix = query.trim().toLocaleLowerCase("en-US");
  if (!prefix) return [];
  return cards
    .filter((card) => !excluded.has(card.id))
    .filter((card) => card.name.toLocaleLowerCase("en-US").startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || compareCodeUnits(left.id, right.id));
}

export function CardSearch({ cards, spriteMap, guessedCardIds, disabled = false, onSelect }: CardSearchProps) {
  const listboxId = useId();
  const pointerSelecting = useRef(false);
  const optionRefs = useRef(new Map<string, HTMLLIElement>());
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scrollRequest, setScrollRequest] = useState(0);
  const results = useMemo(() => searchCards(cards, query, guessedCardIds), [cards, guessedCardIds, query]);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [cards]);
  const menuOpen = !disabled && isOpen && results.length > 0;
  const optionId = (cardId: string) => `${listboxId}-option-${encodeURIComponent(cardId)}`;

  useEffect(() => {
    if (!disabled) return;
    pointerSelecting.current = false;
    setQuery("");
    setActiveIndex(-1);
    setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!menuOpen || activeIndex < 0 || scrollRequest === 0) return;
    const card = results[activeIndex];
    if (!card) return;
    const option = optionRefs.current.get(card.id);
    if (typeof option?.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, menuOpen, results, scrollRequest]);

  function choose(card: CardIdentity) {
    if (disabled) return;
    pointerSelecting.current = false;
    onSelect(card.id);
    setQuery("");
    setActiveIndex(-1);
    setIsOpen(false);
  }

  function moveActive(direction: 1 | -1) {
    if (disabled || results.length === 0) return;
    setIsOpen(true);
    setScrollRequest((current) => current + 1);
    setActiveIndex((current) => {
      if (current < 0) return direction === 1 ? 0 : results.length - 1;
      return (current + direction + results.length) % results.length;
    });
  }

  return <section className="card-search" aria-label="Card search">
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
      aria-activedescendant={menuOpen && activeIndex >= 0 ? optionId(results[activeIndex]!.id) : undefined}
      value={query}
      disabled={disabled}
      onChange={(event) => {
        if (disabled) return;
        const nextQuery = event.currentTarget.value;
        setQuery(nextQuery);
        setActiveIndex(-1);
        setIsOpen(nextQuery.trim().length > 0);
      }}
      onFocus={() => { if (!disabled && results.length > 0) setIsOpen(true); }}
      onBlur={() => {
        if (pointerSelecting.current) {
          pointerSelecting.current = false;
          return;
        }
        setIsOpen(false);
        setActiveIndex(-1);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveActive(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveActive(-1);
        } else if (event.key === "Home" && menuOpen) {
          event.preventDefault();
          setActiveIndex(0);
          setScrollRequest((current) => current + 1);
        } else if (event.key === "End" && menuOpen) {
          event.preventDefault();
          setActiveIndex(results.length - 1);
          setScrollRequest((current) => current + 1);
        } else if (event.key === "Enter" && menuOpen && activeIndex >= 0) {
          event.preventDefault();
          choose(results[activeIndex]!);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setIsOpen(false);
          setActiveIndex(-1);
        }
      }}
    />
    {menuOpen && <ul id={listboxId} className="card-search__options" role="listbox">
      {results.map((card, index) => <li
        id={optionId(card.id)}
        key={card.id}
        ref={(element) => {
          if (element) optionRefs.current.set(card.id, element);
          else optionRefs.current.delete(card.id);
        }}
        className="card-search__option"
        role="option"
        aria-selected={index === activeIndex}
        onPointerDown={() => { pointerSelecting.current = true; }}
        onMouseDown={(event) => { event.preventDefault(); pointerSelecting.current = true; }}
        onPointerUp={() => { pointerSelecting.current = false; }}
        onPointerCancel={() => { pointerSelecting.current = false; }}
        onMouseUp={() => { pointerSelecting.current = false; }}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(card)}
      >
        <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="candidate" label={`${card.name} artwork`} />
        <span className="card-search__name">{card.name}</span>
        {(card.duplicateName || duplicateNames.has(card.name)) && <span className="card-search__class">{card.base.cardClass}</span>}
      </li>)}
    </ul>}
  </section>;
}
