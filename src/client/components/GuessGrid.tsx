import React, { useEffect, useRef, useState } from "react";

import type { SubmittedGuess } from "../game/game-reducer.js";
import { FEATURE_ORDER, type CardIdentity, type SpriteMap } from "../../shared/domain.js";
import { FEATURE_LABELS, FeatureTile } from "./FeatureTile.js";
import { SpriteArt } from "./SpriteArt.js";

export interface GuessGridProps {
  guesses: readonly SubmittedGuess[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  spriteMap: SpriteMap;
  animateFromIndex: number;
  onRevealComplete?: () => void;
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

export function GuessGrid({ guesses, cardsById, spriteMap, animateFromIndex, onRevealComplete }: GuessGridProps) {
  const reducedMotion = usePrefersReducedMotion();
  const completedImmediateReveal = useRef<string | null>(null);
  const hasPendingReveal = animateFromIndex < guesses.length;
  const immediateRevealKey = `${animateFromIndex}:${guesses.length}`;

  useEffect(() => {
    if (!reducedMotion || !hasPendingReveal) {
      completedImmediateReveal.current = null;
      return;
    }
    if (completedImmediateReveal.current === immediateRevealKey) return;
    completedImmediateReveal.current = immediateRevealKey;
    onRevealComplete?.();
  }, [hasPendingReveal, immediateRevealKey, onRevealComplete, reducedMotion]);

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
        return <div className="guess-grid__row" role="row" key={`${guess.cardId}:${rowIndex}`}>
          <div className="guess-grid__art" role="rowheader" aria-label={`${card.name} artwork and name`}>
            <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="guess" label={`${card.name} guess artwork`} />
            <span className="guess-grid__card-name">{card.name}</span>
          </div>
          {guess.results.map((result, featureIndex) => <FeatureTile
            key={result.feature}
            result={result}
            revealIndex={featureIndex}
            animate={animate}
            {...(animate && rowIndex === guesses.length - 1 && featureIndex === FEATURE_ORDER.length - 1 && onRevealComplete
              ? { onRevealEnd: onRevealComplete }
              : {})}
          />)}
        </div>;
      })}
    </div>
  </section>;
}
