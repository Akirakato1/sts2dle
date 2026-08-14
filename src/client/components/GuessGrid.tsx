import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SubmittedGuess } from "../game/game-reducer.js";
import type { AssistanceState, ConstraintOrbTarget } from "../game/assistance.js";
import { formatFeatureValue } from "../../shared/comparison.js";
import { FEATURE_ORDER, type CardIdentity, type FeatureName, type SpriteMap } from "../../shared/domain.js";
import { FEATURE_LABELS, FeatureTile, REVEAL_DURATION_MS, REVEAL_STAGGER_MS } from "./FeatureTile.js";
import { useOrbInteraction } from "./OrbInteractionContext.js";
import { SpriteArt } from "./SpriteArt.js";

export interface GuessGridProps {
  guesses: readonly SubmittedGuess[];
  cardsById: ReadonlyMap<string, CardIdentity>;
  selectedAnswer: CardIdentity;
  assistance: AssistanceState | null;
  spriteMap: SpriteMap;
  roundKey: string | number;
  animateFromIndex: number;
  onRevealComplete?: () => void;
}

function FeatureHeader({ feature, selectedAnswer, revealed }: {
  feature: FeatureName;
  selectedAnswer: CardIdentity;
  revealed: boolean;
}) {
  const binding = useOrbInteraction().bindTarget(
    { kind: "header", feature },
    ["reveal"],
    `${FEATURE_LABELS[feature]} feature heading`,
  );
  const displayValue = formatFeatureValue(selectedAnswer.base[feature], selectedAnswer.upgraded[feature]);

  return <div className="guess-grid__header" role="columnheader" data-feature={feature}>
    <span className="guess-grid__header-label">{FEATURE_LABELS[feature]}</span>
    {revealed && <span className="guess-grid__reveal-bubble" role="note" aria-label={`Answer: ${displayValue}`}>
      {displayValue}
    </span>}
    {binding.active && <button
      {...binding.targetProps}
      type="button"
      className={`guess-grid__header-target orb-target--active${binding.valid ? " orb-target--valid" : ""}`}
    />}
  </div>;
}

function sameConstraintTarget(
  target: ConstraintOrbTarget | null,
  guessIndex: number,
  cardId: string,
  feature: FeatureName,
): boolean {
  return target !== null
    && target.guessIndex === guessIndex
    && target.cardId === cardId
    && target.feature === feature;
}

export const REVEAL_FALLBACK_SAFETY_MS = 70;
const REVEAL_FALLBACK_MS = FEATURE_ORDER.length * REVEAL_STAGGER_MS
  + REVEAL_DURATION_MS
  + REVEAL_FALLBACK_SAFETY_MS;

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

export function GuessGrid({
  guesses,
  cardsById,
  selectedAnswer,
  assistance,
  spriteMap,
  roundKey,
  animateFromIndex,
  onRevealComplete,
}: GuessGridProps) {
  const reducedMotion = usePrefersReducedMotion();
  const activeControllerRef = useRef<RevealController | null>(null);
  const completedRevealKeyRef = useRef<string | null>(null);
  const onRevealCompleteRef = useRef(onRevealComplete);
  onRevealCompleteRef.current = onRevealComplete;
  const renderedGuesses = useMemo(() => guesses
    .map((guess, chronologicalIndex) => ({ guess, chronologicalIndex }))
    .reverse(), [guesses]);
  const hasPendingReveal = animateFromIndex < guesses.length;
  const activeRevealKey = `${String(roundKey)}:${animateFromIndex}:${guesses.length}:${guesses.at(-1)?.cardId ?? ""}`;
  const renderedController = useMemo<RevealController | null>(() => hasPendingReveal
    ? { key: activeRevealKey, completed: false, timeoutId: null }
    : null, [activeRevealKey, hasPendingReveal]);

  const completeReveal = useCallback((controller: RevealController) => {
    if (activeControllerRef.current !== controller
      || completedRevealKeyRef.current === controller.key
      || controller.completed) return;
    controller.completed = true;
    completedRevealKeyRef.current = controller.key;
    if (controller.timeoutId !== null) {
      clearTimeout(controller.timeoutId);
      controller.timeoutId = null;
    }
    onRevealCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (!renderedController) {
      activeControllerRef.current = null;
      completedRevealKeyRef.current = null;
      return;
    }
    const controller = renderedController;
    activeControllerRef.current = controller;
    if (completedRevealKeyRef.current === controller.key) controller.completed = true;
    else if (reducedMotion) completeReveal(controller);
    else controller.timeoutId = setTimeout(() => completeReveal(controller), REVEAL_FALLBACK_MS);
    return () => {
      if (controller.timeoutId !== null) clearTimeout(controller.timeoutId);
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
    };
  }, [completeReveal, reducedMotion, renderedController]);

  const handleFinalTransition = useCallback((controller: RevealController, event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    completeReveal(controller);
  }, [completeReveal]);

  return <section className="guess-grid-scroll" aria-label="Guess results">
    <div className="guess-grid" role="table" aria-label="Card feature comparisons" aria-colcount={FEATURE_ORDER.length + 1}>
      <div className="guess-grid__row guess-grid__header-row" role="row">
        <div className="guess-grid__header guess-grid__art-header" role="columnheader">Card</div>
        {FEATURE_ORDER.map((feature) => <FeatureHeader
          feature={feature}
          key={feature}
          revealed={assistance?.reveal?.feature === feature}
          selectedAnswer={selectedAnswer}
        />)}
      </div>
      {renderedGuesses.map(({ guess, chronologicalIndex }) => {
        const card = cardsById.get(guess.cardId);
        if (!card) return null;
        const animate = !reducedMotion && chronologicalIndex >= animateFromIndex;
        const isNewestChronologicalGuess = chronologicalIndex === guesses.length - 1;
        return <div className="guess-grid__row" role="row" key={`${String(roundKey)}:${guess.cardId}:${chronologicalIndex}`}>
          <div className="guess-grid__art" role="rowheader" aria-label={`${card.name} artwork and name`}>
            <SpriteArt cardId={card.id} spriteMap={spriteMap} kind="guess" label={`${card.name} guess artwork`} />
            <span className="guess-grid__card-name">{card.name}</span>
          </div>
          {guess.results.map((result, featureIndex) => <FeatureTile
            key={`${animate ? activeRevealKey : `settled:${chronologicalIndex}`}:${result.feature}`}
            result={result}
            cardId={guess.cardId}
            chronologicalGuessIndex={chronologicalIndex}
            revealIndex={featureIndex}
            animate={animate}
            {...(sameConstraintTarget(assistance?.negation ?? null, chronologicalIndex, guess.cardId, result.feature)
              ? { orbBadge: "negation" as const }
              : sameConstraintTarget(assistance?.filter ?? null, chronologicalIndex, guess.cardId, result.feature)
                ? { orbBadge: "filter" as const }
                : {})}
            {...(animate && isNewestChronologicalGuess && featureIndex === FEATURE_ORDER.length - 1 && onRevealComplete && renderedController
              ? { onRevealEnd: (event: React.TransitionEvent<HTMLDivElement>) => handleFinalTransition(renderedController, event) }
              : {})}
          />)}
        </div>;
      })}
    </div>
  </section>;
}
