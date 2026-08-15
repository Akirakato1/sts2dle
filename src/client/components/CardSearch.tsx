import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CardIdentity, SpriteMap } from "../../shared/domain.js";
import {
  classifyCandidate,
  isCandidateCategoryVisible,
  type AssistanceState,
  type CandidateCategory,
} from "../game/assistance.js";
import {
  classifyPracticeCandidate,
  type CandidateFormMatch,
  type PracticeFilterState,
} from "../game/practice-filter.js";
import { SpriteArt } from "./SpriteArt.js";

export interface ClassifiedCandidate {
  card: CardIdentity;
  category: CandidateCategory;
  formMatch: CandidateFormMatch;
}

export type CardSearchMode =
  | { readonly kind: "candidates" }
  | { readonly kind: "hardcore-name"; readonly submitExactName: (query: string) => boolean };

export interface CardSearchProps {
  cards: readonly CardIdentity[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  spriteMap: SpriteMap;
  guessedCardIds: ReadonlySet<string>;
  assistance: AssistanceState | null;
  practiceFilter?: PracticeFilterState | null;
  roundKey: string | number;
  disabled?: boolean;
  assistanceControlsDisabled?: boolean;
  assistanceSlot?: React.ReactNode;
  nameHintSlot?: React.ReactNode;
  searchMode?: CardSearchMode;
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
  practiceFilter: PracticeFilterState | null = null,
): ClassifiedCandidate[] {
  const prefix = query.trim().toLocaleLowerCase("en-US");
  const sortedCards = cards
    .filter((card) => !guessedCardIds.has(card.id))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || compareCodeUnits(left.id, right.id));

  if (practiceFilter?.enabled) {
    return sortedCards
      .flatMap((card) => {
        const formMatch = classifyPracticeCandidate(card, practiceFilter);
        return formMatch === null ? [] : [{ card, category: "neutral" as const, formMatch }];
      })
      .filter(({ card }) => !prefix || card.name.toLocaleLowerCase("en-US").startsWith(prefix));
  }

  return sortedCards
    .map((card) => ({
      card,
      category: assistance ? classifyCandidate(card, assistance, cardsById) : "neutral",
      formMatch: null,
    }))
    .filter(({ category }) => assistance === null || isCandidateCategoryVisible(category, assistance.visibility))
    .filter(({ card }) => !prefix || card.name.toLocaleLowerCase("en-US").startsWith(prefix));
}

export function CardSearch({
  cards,
  cardsById,
  spriteMap,
  guessedCardIds,
  assistance = null,
  practiceFilter = null,
  roundKey,
  disabled = false,
  assistanceControlsDisabled = false,
  assistanceSlot,
  nameHintSlot,
  searchMode = { kind: "candidates" },
  onVisibilityChange,
  onSelect,
}: CardSearchProps) {
  const hardcoreNameMode = searchMode.kind === "hardcore-name";
  const listboxId = useId();
  const pointerSelecting = useRef(false);
  const visibilityPointerDown = useRef(false);
  const optionRefs = useRef(new Map<string, HTMLLIElement>());
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [invalidAttempt, setInvalidAttempt] = useState(0);
  const visibilityControlsDisabled = disabled || assistanceControlsDisabled;
  const results = useMemo(
    () => hardcoreNameMode ? [] : searchCards(cards, query, guessedCardIds, assistance, cardsById, practiceFilter),
    [assistance, cards, cardsById, guessedCardIds, hardcoreNameMode, practiceFilter, query],
  );
  const duplicateNames = useMemo(() => {
    if (hardcoreNameMode) return new Set<string>();
    const counts = new Map<string, number>();
    for (const card of cards) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [cards, hardcoreNameMode]);
  const menuOpen = !hardcoreNameMode && !disabled && isOpen;
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
    setInvalidAttempt(0);
  }, [disabled]);

  useEffect(() => {
    pointerSelecting.current = false;
    visibilityPointerDown.current = false;
    setQuery("");
    setActiveCardId(null);
    setIsOpen(false);
    setInvalidAttempt(0);
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

  function submitHardcoreName() {
    if (disabled || searchMode.kind !== "hardcore-name") return;
    if (searchMode.submitExactName(query)) {
      setQuery("");
      setActiveCardId(null);
      setIsOpen(false);
      setInvalidAttempt(0);
    } else {
      setInvalidAttempt((current) => current + 1);
    }
  }

  return <section className="card-search" aria-label="Card search">
    {assistance !== null && <fieldset
      className={`candidate-visibility${visibilityControlsDisabled ? " candidate-visibility--disabled" : ""}`}
      aria-label="Candidate visibility"
      disabled={visibilityControlsDisabled}
    >
      {(["neutral", "green", "red"] as const).map((category) => <label
        key={category}
        className="candidate-visibility__label"
        onPointerDown={() => { if (!visibilityControlsDisabled) visibilityPointerDown.current = true; }}
        onMouseDown={() => { if (!visibilityControlsDisabled) visibilityPointerDown.current = true; }}
        onPointerUp={() => { visibilityPointerDown.current = false; }}
        onPointerCancel={() => { visibilityPointerDown.current = false; }}
        onMouseUp={() => { visibilityPointerDown.current = false; }}
      >
        <input
          type="checkbox"
          checked={assistance.visibility[category]}
          disabled={visibilityControlsDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onChange={(event) => {
            if (!visibilityControlsDisabled) onVisibilityChange(category, event.currentTarget.checked);
          }}
        />
        <span>{category[0]!.toUpperCase() + category.slice(1)}</span>
      </label>)}
    </fieldset>}
    {assistance !== null && (assistanceControlsDisabled && assistanceSlot
      ? <div
        className="card-search__assistance-slot--disabled"
        aria-hidden="true"
        inert
      >{assistanceSlot}</div>
      : assistanceSlot)}
    {assistance !== null && nameHintSlot}
    <label className="card-search__label" htmlFor={`${listboxId}-input`}>Guess a card</label>
    <input
      id={`${listboxId}-input`}
      className={`card-search__input${hardcoreNameMode && invalidAttempt > 0 ? ` card-search__input--invalid-${invalidAttempt % 2 === 1 ? "a" : "b"}` : ""}`}
      type="search"
      autoComplete="off"
      role={hardcoreNameMode ? undefined : "combobox"}
      aria-autocomplete={hardcoreNameMode ? undefined : "list"}
      aria-controls={hardcoreNameMode ? undefined : listboxId}
      aria-expanded={hardcoreNameMode ? undefined : menuOpen}
      aria-activedescendant={hardcoreNameMode || !canNavigate ? undefined : optionId(activeCandidate.card.id)}
      data-invalid-attempt={hardcoreNameMode ? invalidAttempt : undefined}
      value={query}
      disabled={disabled}
      onChange={(event) => {
        if (disabled) return;
        const nextQuery = event.currentTarget.value;
        setQuery(nextQuery);
        setActiveCardId(null);
        if (!hardcoreNameMode) setIsOpen(true);
      }}
      onFocus={() => { if (!disabled && !hardcoreNameMode) setIsOpen(true); }}
      onBlur={() => {
        if (hardcoreNameMode) return;
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
        if (hardcoreNameMode) {
          if (event.key === "Enter") {
            event.preventDefault();
            submitHardcoreName();
          }
        } else if (event.key === "ArrowDown") {
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
    {hardcoreNameMode && invalidAttempt > 0 && <p key={invalidAttempt} className="card-search__sr-only" role="status">No matching unguessed card name.</p>}
    {!hardcoreNameMode && menuOpen && (results.length > 0 ? <ul id={listboxId} className="card-search__options" role="listbox">
      {results.map((candidate) => {
        const { card, category, formMatch } = candidate;
        return <li
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
        onClick={() => choose(candidate)}
      >
        <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="candidate" label={`${card.name} artwork`} />
        <span className="card-search__name">{card.name}</span>
        {(card.duplicateName || duplicateNames.has(card.name)) && <span className="card-search__class">{card.base.cardClass}</span>}
        {formMatch === "base-only" && <span className="card-search__form-badge">Base only</span>}
        {formMatch === "upgrade-only" && <span className="card-search__form-badge">Upgrade only</span>}
        <span className="card-search__sr-only">{category === "neutral"
          ? "unhighlighted candidate"
          : category === "green"
            ? "matches Filter Orb"
            : "excluded by Negation Orb"}</span>
      </li>;
      })}
    </ul> : <p className="card-search__empty" role="status">No visible candidates</p>)}
  </section>;
}
