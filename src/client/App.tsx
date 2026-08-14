import React, { useEffect, useState } from "react";

import { loadSnapshot, type LoadedSnapshot } from "./api/load-snapshot.js";
import { CardSearch } from "./components/CardSearch.js";
import { GameGuide } from "./components/GameGuide.js";
import { GuessGrid } from "./components/GuessGrid.js";
import { FEATURE_LABELS, keywordAccessibleValue } from "./components/FeatureTile.js";
import { AnswerReveal } from "./components/AnswerReveal.js";
import { SharePanel } from "./components/SharePanel.js";
import { NameHint } from "./components/NameHint.js";
import { OrbInteractionProvider, useOrbInteraction, type OrbTargetDescriptor, type OrbUseResult } from "./components/OrbInteractionContext.js";
import { OrbTray } from "./components/OrbTray.js";
import { ORB_LABELS } from "./components/OrbVisual.js";
import { PracticeControls } from "./components/PracticeControls.js";
import { useGame } from "./game/use-game.js";
import { isPracticeSettingsEditable, type PlayMode, type RoundState } from "./game/game-reducer.js";
import { deriveNameHint } from "./game/name-hints.js";
import type { CandidateCategory, ConstraintOrbTarget, OrbKind, RevealOrbTarget } from "./game/assistance.js";
import { FEATURE_ORDER, type CardIdentity } from "../shared/domain.js";
import { formatFeatureValue } from "../shared/comparison.js";

function ignoreCandidateVisibility(): void {}

interface RoundGameProps {
  round: RoundState;
  roundKey: number;
  snapshot: LoadedSnapshot;
  utcDate: string;
  practiceHardcoreChoice: boolean;
  onSubmit(cardId: string): void;
  onConsumeReveal(target: RevealOrbTarget): void;
  onConsumeFilter(target: ConstraintOrbTarget): void;
  onConsumeNegation(target: ConstraintOrbTarget): void;
  onCandidateVisibility(category: CandidateCategory, visible: boolean): void;
  onPracticeHardcoreChange(hardcore: boolean): void;
  onForfeitPractice(): void;
  onNextRound(): void;
}

interface OrbConsumers {
  consumeReveal(target: RevealOrbTarget): void;
  consumeFilter(target: ConstraintOrbTarget): void;
  consumeNegation(target: ConstraintOrbTarget): void;
}

function rejected(announcement: string): OrbUseResult {
  return { accepted: false, announcement };
}

function accepted(announcement: string): OrbUseResult {
  return { accepted: true, announcement };
}

function validConstraintTarget(round: RoundState, target: Extract<OrbTargetDescriptor, { kind: "tile" }>, color: "green" | "red"): boolean {
  if (!target.revealed || target.color !== color || !Number.isInteger(target.guessIndex) || target.guessIndex < 0) return false;
  const guess = round.guesses[target.guessIndex];
  if (!guess || guess.cardId !== target.cardId) return false;
  return guess.results.some((result) => result.feature === target.feature && result.color === color);
}

function resolveOrbUse(
  round: RoundState,
  answerCard: CardIdentity,
  orb: OrbKind,
  target: OrbTargetDescriptor,
  consumers: OrbConsumers,
): OrbUseResult {
  if (round.status !== "playing" || round.assistance === null || round.assistance[orb] !== null) {
    return rejected(`${ORB_LABELS[orb]} Orb is no longer available.`);
  }

  switch (orb) {
    case "reveal":
      if (target.kind !== "header" || !FEATURE_ORDER.includes(target.feature)) {
        return rejected("Reveal Orb can only be used on a feature heading.");
      }
      consumers.consumeReveal({ feature: target.feature });
      {
        const answerValue = formatFeatureValue(
          answerCard.base[target.feature],
          answerCard.upgraded[target.feature],
        );
        const accessibleValue = target.feature === "cardClass"
          || target.feature === "cardType"
          || target.feature === "mana"
          || target.feature === "rarity"
          ? answerValue
          : keywordAccessibleValue(answerValue);
        return accepted(`Reveal Orb showed ${FEATURE_LABELS[target.feature]}: ${accessibleValue}.`);
      }
    case "filter":
      if (target.kind !== "tile" || !validConstraintTarget(round, target, "green")) {
        return rejected("Filter Orb requires a revealed green feature tile.");
      }
      consumers.consumeFilter({ guessIndex: target.guessIndex, cardId: target.cardId, feature: target.feature });
      return accepted(`Filter Orb now marks candidates matching ${FEATURE_LABELS[target.feature]}.`);
    case "negation":
      if (target.kind !== "tile" || !validConstraintTarget(round, target, "red")) {
        return rejected("Negation Orb requires a revealed red feature tile.");
      }
      consumers.consumeNegation({ guessIndex: target.guessIndex, cardId: target.cardId, feature: target.feature });
      return accepted(`Negation Orb now marks candidates excluded by ${FEATURE_LABELS[target.feature]}.`);
  }
}

interface RoundGameBoardProps extends Omit<RoundGameProps, "onConsumeReveal" | "onConsumeFilter" | "onConsumeNegation"> {
  animateFromIndex: number;
  isRevealing: boolean;
  onRevealComplete(): void;
}

function RoundGameBoard({
  round,
  roundKey,
  snapshot,
  utcDate,
  practiceHardcoreChoice,
  onSubmit,
  onCandidateVisibility,
  onPracticeHardcoreChange,
  onForfeitPractice,
  onNextRound,
  animateFromIndex,
  isRevealing,
  onRevealComplete,
}: RoundGameBoardProps) {
  const { draggingOrb } = useOrbInteraction();
  const interactionDisabled = isRevealing || round.status !== "playing";
  const showResult = round.status !== "playing" && !isRevealing;
  const answerCard = snapshot.cardsById.get(round.answer.selectedCardId);
  if (!answerCard) return <p role="alert">The selected answer is missing from the card snapshot.</p>;
  const wrongGuessCount = round.guesses.filter((guess) => !round.answer.acceptedCardIds.includes(guess.cardId)).length;
  const nameHint = !round.hardcore
    ? deriveNameHint(answerCard.name, wrongGuessCount, round.hintSeed)
    : null;

  return <main className="game-board" aria-label="Card guessing game">
    {round.mode === "practice" && <PracticeControls
      round={round}
      selectedHardcore={practiceHardcoreChoice}
      settingsEditable={round.status !== "playing" || isPracticeSettingsEditable(round)}
      disabled={isRevealing || draggingOrb !== null}
      onHardcoreChange={onPracticeHardcoreChange}
      onForfeit={onForfeitPractice}
      onNextRound={onNextRound}
    />}
    <CardSearch
      cards={snapshot.cards}
      cardsById={snapshot.cardsById}
      spriteMap={snapshot.spriteMap}
      guessedCardIds={new Set(round.guesses.map((guess) => guess.cardId))}
      assistance={round.assistance ?? null}
      roundKey={roundKey}
      disabled={interactionDisabled}
      assistanceSlot={round.assistance && <OrbTray assistance={round.assistance} disabled={interactionDisabled} />}
      nameHintSlot={<NameHint hint={nameHint} cardName={answerCard.name} />}
      onVisibilityChange={onCandidateVisibility}
      onSelect={onSubmit}
    />
    <GuessGrid
      guesses={round.guesses}
      cardsById={snapshot.cardsById}
      selectedAnswer={answerCard}
      assistance={round.assistance ?? null}
      spriteMap={snapshot.spriteMap}
      roundKey={roundKey}
      animateFromIndex={animateFromIndex}
      onRevealComplete={onRevealComplete}
    />
    {showResult && <AnswerReveal answer={round.answer} cardsById={snapshot.cardsById} />}
    {showResult && <SharePanel
      round={round}
      utcDate={utcDate}
      siteUrl={typeof window === "undefined" ? "https://stsdle.invalid/" : new URL("/", window.location.href).toString()}
      onNextRound={onNextRound}
    />}
    {round.error && <p role="alert">{round.error}</p>}
  </main>;
}

function RoundGame({
  round,
  roundKey,
  snapshot,
  utcDate,
  practiceHardcoreChoice,
  onSubmit,
  onConsumeReveal,
  onConsumeFilter,
  onConsumeNegation,
  onCandidateVisibility,
  onPracticeHardcoreChange,
  onForfeitPractice,
  onNextRound,
}: RoundGameProps) {
  const [animateFromIndex, setAnimateFromIndex] = useState(round.guesses.length);
  const isRevealing = animateFromIndex < round.guesses.length;
  const consumers: OrbConsumers = {
    consumeReveal: onConsumeReveal,
    consumeFilter: onConsumeFilter,
    consumeNegation: onConsumeNegation,
  };
  const assistance = round.assistance ?? null;
  const interactionDisabled = isRevealing || round.status !== "playing";
  const answerCard = snapshot.cardsById.get(round.answer.selectedCardId);

  return <OrbInteractionProvider
    key={round.roundId}
    roundKey={round.roundId}
    assistance={assistance}
    disabled={interactionDisabled}
    onUse={(orb, target) => answerCard
      ? resolveOrbUse(round, answerCard, orb, target, consumers)
      : rejected("Reveal Orb is unavailable for this round.")}
  >
    <RoundGameBoard
      round={round}
      roundKey={roundKey}
      snapshot={snapshot}
      utcDate={utcDate}
      practiceHardcoreChoice={practiceHardcoreChoice}
      onSubmit={onSubmit}
      onCandidateVisibility={onCandidateVisibility}
      onPracticeHardcoreChange={onPracticeHardcoreChange}
      onForfeitPractice={onForfeitPractice}
      onNextRound={onNextRound}
      animateFromIndex={animateFromIndex}
      isRevealing={isRevealing}
      onRevealComplete={() => setAnimateFromIndex(round.guesses.length)}
    />
  </OrbInteractionProvider>;
}

function GameShell({ snapshot }: { snapshot: LoadedSnapshot }) {
  const game = useGame(snapshot);
  const activeMode = game.activeMode ?? game.round?.mode ?? "daily";
  const modeLabels: Readonly<Record<PlayMode, string>> = {
    daily: "Daily",
    "hardcore-daily": "Hardcore Daily",
    practice: "Practice",
  };
  return <section className="game-panel" aria-label="Card guessing controls">
    <nav className="mode-tabs" aria-label="Round mode">
      {(["daily", "hardcore-daily", "practice"] as const).map((mode) => <button key={mode} type="button" aria-current={activeMode === mode ? "page" : undefined} className={activeMode === mode ? "active" : ""} onClick={() => void game.setMode(mode)}>{modeLabels[mode]}</button>)}
    </nav>
    {game.error ? <section className="load-error mode-error" role="alert">
      <p>Unable to prepare this game mode.</p>
      <button type="button" onClick={() => game.retryActiveMode()}>Retry</button>
    </section> : game.status === "loading" || !game.round ? <p role="status">Preparing today&apos;s card…</p> : <RoundGame
      key={game.roundToken}
      round={game.round}
      roundKey={game.roundToken}
      snapshot={snapshot}
      utcDate={game.dailyUtcDate}
      practiceHardcoreChoice={game.practiceHardcoreChoice ?? game.round.hardcore}
      onSubmit={game.submit}
      onConsumeReveal={game.consumeReveal}
      onConsumeFilter={game.consumeFilter}
      onConsumeNegation={game.consumeNegation}
      onCandidateVisibility={game.setCandidateVisibility ?? ignoreCandidateVisibility}
      onPracticeHardcoreChange={game.setPracticeHardcoreChoice ?? ignoreCandidateVisibility}
      onForfeitPractice={game.forfeitPractice ?? ignoreCandidateVisibility}
      onNextRound={game.nextPracticeRound ?? game.nextRound}
    />}
  </section>;
}

export function App() {
  const [snapshot, setSnapshot] = useState<LoadedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setError(null);
    void loadSnapshot(fetch, controller.signal).then((loaded) => { if (!controller.signal.aborted) setSnapshot(loaded); }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to load game data.");
    });
    return () => { controller.abort(); };
  }, [attempt]);
  return <div className="app-shell">
    <div className="ember-glow" aria-hidden="true" />
    <header className="hero"><GameGuide /><p className="eyebrow">Slay the Spire 2</p><h1>STSDLE</h1><p className="subtitle">Prototype</p></header>
    {error ? <section className="load-error" role="alert"><p>We couldn&apos;t load the current card set.</p><small>{error}</small><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></section> : snapshot ? <GameShell snapshot={snapshot} /> : <p role="status">Loading card data…</p>}
    <footer className="site-footer">
      <p>Card data and artwork references provided by <a href="https://spire-codex.com/">Spire Codex</a>.</p>
      <p>STS-dle is an unofficial fan project and is not affiliated with or endorsed by Mega Crit.</p>
    </footer>
  </div>;
}
