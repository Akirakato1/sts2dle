import React, { useCallback, useEffect, useRef, useState } from "react";

import type { SubmittedGuess } from "../game/game-reducer.js";
import { FEATURE_ORDER, type CardIdentity, type SpriteMap } from "../../shared/domain.js";
import { FEATURE_LABELS, FeatureTile } from "./FeatureTile.js";
import { SpriteArt } from "./SpriteArt.js";

export interface GuessGridProps {
  guesses: readonly SubmittedGuess[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  spriteMap: SpriteMap;
  roundKey: string | number;
  animateFromIndex: number;
  onRevealComplete?: () => void;
}

const REVEAL_STAGGER_MS = 110;
const REVEAL_DURATION_MS = 420;
const REVEAL_FALLBACK_PADDING_MS = 70;
const REVEAL_FALLBACK_MS = FEATURE_ORDER.length * REVEAL_STAGGER_MS
  + REVEAL_DURATION_MS
  + REVEAL_FALLBACK_PADDING_MS;

interface RevealController {
  key: string;
  completed: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

export function GuessGrid({ guesses, cardsById, spriteMap, roundKey, animateFromIndex, onRevealComplete }: GuessGridProps) {
  const reducedMotion = usePrefersReducedMotion();
  const controllerRef = useRef<RevealController | null>(null);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;
  const hasPendingReveal = animateFromIndex < guesses.length;
  const activeRevealKey = `${String(roundKey)}:${animateFromIndex}:${guesses.length}:${guesses.at(-1)?.cardId ?? ""}`;

  const completeReveal = useCallback((revealKey: string) => {
    const controller = controllerRef.current;
    if (!controller || controller.key !== revealKey || controller.completed) return;
    controller.completed = true;
    if (controller.timeoutId !== null) {
      clearTimeout(controller.timeoutId);
      controller.timeoutId = null;
    }
    onRevealCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (!hasPendingReveal) {
      controllerRef.current = null;
      return;
    }
    const controller: RevealController = { key: activeRevealKey, completed: false, timeoutId: null };
    controllerRef.current = controller;
    if (reducedMotion) completeReveal(activeRevealKey);
    else controller.timeoutId = setTimeout(() => completeReveal(activeRevealKey), REVEAL_FALLBACK_MS);
    return () => {
      if (controller.timeoutId !== null) clearTimeout(controller.timeoutId);
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [activeRevealKey, completeReveal, hasPendingReveal, reducedMotion]);

  const handleFinalTransition = useCallback((revealKey: string, event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    completeReveal(revealKey);
  }, [completeReveal]);

  return <section className="guess-grid-scroll" aria-label="Guess results">
    <div className="guess-grid" role="table" aria-label="Card feature comparisons" aria-colcount={12}>
      <div className="guess-grid__row guess-grid__header-row" role="row">
        <div className="guess-grid__header guess-grid__art-header" role="columnheader">Card</div>
        {FEATURE_ORDER.map((feature) => <div
          className="guess-grid__header"
          role="columnheader"
          data-feature={feature}
          key={feature}
        >{FEATURE_LABELS[feature]}</div>)}
      </div>
      {guesses.map((guess, rowIndex) => {
        const card = cardsById.get(guess.cardId);
        if (!card) return null;
        const animate = !reducedMotion && rowIndex >= animateFromIndex;
        return <div className="guess-grid__row" role="row" key={`${String(roundKey)}:${guess.cardId}:${rowIndex}`}>
          <div className="guess-grid__art" role="rowheader" aria-label={`${card.name} artwork and name`}>
            <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="guess" label={`${card.name} guess artwork`} />
            <span className="guess-grid__card-name">{card.name}</span>
          </div>
          {guess.results.map((result, featureIndex) => <FeatureTile
            key={`${animate ? activeRevealKey : `settled:${rowIndex}`}:${result.feature}`}
            result={result}
            revealIndex={featureIndex}
            animate={animate}
            {...(animate && rowIndex === guesses.length - 1 && featureIndex === FEATURE_ORDER.length - 1 && onRevealComplete
              ? { onRevealEnd: (event: React.TransitionEvent<HTMLDivElement>) => handleFinalTransition(activeRevealKey, event) }
              : {})}
          />)}
        </div>;
      })}
    </div>
  </section>;
}
