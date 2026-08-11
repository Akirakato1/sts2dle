import React, { useEffect, useState } from "react";

import { loadSnapshot, type LoadedSnapshot } from "./api/load-snapshot.js";
import { CardSearch } from "./components/CardSearch.js";
import { GuessGrid } from "./components/GuessGrid.js";
import { AnswerReveal } from "./components/AnswerReveal.js";
import { SharePanel } from "./components/SharePanel.js";
import { useGame } from "./game/use-game.js";
import type { RoundState } from "./game/game-reducer.js";

interface RoundGameProps {
  round: RoundState;
  roundKey: number;
  snapshot: LoadedSnapshot;
  utcDate: string;
  onSubmit(cardId: string): void;
  onNextRound(): void;
}

function RoundGame({ round, roundKey, snapshot, utcDate, onSubmit, onNextRound }: RoundGameProps) {
  const [animateFromIndex, setAnimateFromIndex] = useState(round.guesses.length);
  const isRevealing = animateFromIndex < round.guesses.length;
  const showResult = round.status === "won" && !isRevealing;
  return <main className="game-board" aria-label="Card guessing game">
    <CardSearch
      cards={snapshot.cards}
      spriteMap={snapshot.spriteMap}
      guessedCardIds={new Set(round.guesses.map((guess) => guess.cardId))}
      disabled={isRevealing || round.status === "won"}
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
  if (!game.round) return <p role="status">Preparing today&apos;s card…</p>;
  const { round } = game;
  return <section className="game-panel" aria-labelledby="paired-rules">
    <nav className="mode-tabs" aria-label="Round mode">
      {(["daily", "practice"] as const).map((mode) => <button key={mode} type="button" aria-current={round.mode === mode ? "page" : undefined} className={round.mode === mode ? "active" : ""} onClick={() => void game.setMode(mode)}>{mode === "daily" ? "Daily" : "Practice"}</button>)}
    </nav>
    <p className="round-note" id="paired-rules"><span aria-hidden="true">&#9670;</span> Each guess compares its base card and upgrade together. Match every trait to find today&apos;s card.</p>
    <RoundGame key={game.roundToken} round={round} roundKey={game.roundToken} snapshot={snapshot} utcDate={game.dailyUtcDate} onSubmit={game.submit} onNextRound={game.nextRound} />
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
