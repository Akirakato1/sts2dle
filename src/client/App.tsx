import React, { useEffect, useState } from "react";

import { loadSnapshot, type LoadedSnapshot } from "./api/load-snapshot.js";
import { CardSearch } from "./components/CardSearch.js";
import { GameGuide } from "./components/GameGuide.js";
import { GuessGrid } from "./components/GuessGrid.js";
import { AnswerReveal } from "./components/AnswerReveal.js";
import { SharePanel } from "./components/SharePanel.js";
import { NameHint } from "./components/NameHint.js";
import { PracticeControls } from "./components/PracticeControls.js";
import { useGame } from "./game/use-game.js";
import { isPracticeSettingsEditable, type PlayMode, type RoundState } from "./game/game-reducer.js";
import { deriveNameHint } from "./game/name-hints.js";
import type { CandidateCategory } from "./game/assistance.js";

function ignoreCandidateVisibility(): void {}

interface RoundGameProps {
  round: RoundState;
  roundKey: number;
  snapshot: LoadedSnapshot;
  utcDate: string;
  practiceHardcoreChoice: boolean;
  onSubmit(cardId: string): void;
  onCandidateVisibility(category: CandidateCategory, visible: boolean): void;
  onPracticeHardcoreChange(hardcore: boolean): void;
  onForfeitPractice(): void;
  onNextRound(): void;
}

function RoundGame({
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
}: RoundGameProps) {
  const [animateFromIndex, setAnimateFromIndex] = useState(round.guesses.length);
  const isRevealing = animateFromIndex < round.guesses.length;
  const showResult = round.status !== "playing" && !isRevealing;
  const answerCard = snapshot.cardsById.get(round.answer.selectedCardId);
  const wrongGuessCount = round.guesses.filter((guess) => !round.answer.acceptedCardIds.includes(guess.cardId)).length;
  const nameHint = !round.hardcore && answerCard
    ? deriveNameHint(answerCard.name, wrongGuessCount, round.hintSeed)
    : null;
  return <main className="game-board" aria-label="Card guessing game">
    {round.mode === "practice" && <PracticeControls
      round={round}
      selectedHardcore={practiceHardcoreChoice}
      settingsEditable={round.status !== "playing" || isPracticeSettingsEditable(round)}
      disabled={isRevealing}
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
      disabled={isRevealing || round.status !== "playing"}
      nameHintSlot={<NameHint hint={nameHint} cardName={answerCard?.name ?? ""} />}
      onVisibilityChange={onCandidateVisibility}
      onSelect={onSubmit}
    />
    <GuessGrid
      guesses={round.guesses}
      cardsById={snapshot.cardsById}
      spriteMap={snapshot.spriteMap}
      roundKey={roundKey}
      animateFromIndex={animateFromIndex}
      onRevealComplete={() => setAnimateFromIndex(round.guesses.length)}
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

function GameShell({ snapshot }: { snapshot: LoadedSnapshot }) {
  const game = useGame(snapshot);
  if (game.error) return <p role="alert">Unable to start the round: {game.error}</p>;
  if (game.status === "loading" || !game.round) return <p role="status">Preparing today&apos;s card…</p>;
  const { round } = game;
  const modeLabels: Readonly<Record<PlayMode, string>> = {
    daily: "Daily",
    "hardcore-daily": "Hardcore Daily",
    practice: "Practice",
  };
  return <section className="game-panel" aria-label="Card guessing controls">
    <nav className="mode-tabs" aria-label="Round mode">
      {(["daily", "hardcore-daily", "practice"] as const).map((mode) => <button key={mode} type="button" aria-current={round.mode === mode ? "page" : undefined} className={round.mode === mode ? "active" : ""} onClick={() => void game.setMode(mode)}>{modeLabels[mode]}</button>)}
    </nav>
    <GameGuide />
    <RoundGame
      key={game.roundToken}
      round={round}
      roundKey={game.roundToken}
      snapshot={snapshot}
      utcDate={game.dailyUtcDate}
      practiceHardcoreChoice={game.practiceHardcoreChoice ?? round.hardcore}
      onSubmit={game.submit}
      onCandidateVisibility={game.setCandidateVisibility ?? ignoreCandidateVisibility}
      onPracticeHardcoreChange={game.setPracticeHardcoreChoice ?? ignoreCandidateVisibility}
      onForfeitPractice={game.forfeitPractice ?? ignoreCandidateVisibility}
      onNextRound={game.nextPracticeRound ?? game.nextRound}
    />
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
    <header className="hero"><p className="eyebrow">Slay the Spire 2</p><h1>STSDLE</h1><p className="subtitle">A daily card deduction.</p></header>
    {error ? <section className="load-error" role="alert"><p>We couldn&apos;t load the current card set.</p><small>{error}</small><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></section> : snapshot ? <GameShell snapshot={snapshot} /> : <p role="status">Loading card data…</p>}
    <footer className="site-footer">
      <p>Card data and artwork references provided by <a href="https://spire-codex.com/">Spire Codex</a>.</p>
      <p>STS-dle is an unofficial fan project and is not affiliated with or endorsed by Mega Crit.</p>
    </footer>
  </div>;
}
