import React, { useEffect, useState } from "react";

import { loadSnapshot, type LoadedSnapshot } from "./api/load-snapshot.js";
import { CardSearch } from "./components/CardSearch.js";
import { GuessGrid } from "./components/GuessGrid.js";
import { useGame } from "./game/use-game.js";
import type { RoundState } from "./game/game-reducer.js";

interface RoundGameProps {
  round: RoundState;
  snapshot: LoadedSnapshot;
  onSubmit(cardId: string): void;
  onNextRound(): void;
}

function RoundGame({ round, snapshot, onSubmit, onNextRound }: RoundGameProps) {
  const [animateFromIndex, setAnimateFromIndex] = useState(round.guesses.length);
  const isRevealing = animateFromIndex < round.guesses.length;
  return <main>
    <CardSearch
      cards={snapshot.cards}
      spriteMap={snapshot.spriteMap}
      guessedCardIds={new Set(round.guesses.map((guess) => guess.cardId))}
      disabled={isRevealing}
      onSelect={onSubmit}
    />
    <GuessGrid
      guesses={round.guesses}
      cardsById={snapshot.cardsById}
      spriteMap={snapshot.spriteMap}
      animateFromIndex={animateFromIndex}
      onRevealComplete={() => setAnimateFromIndex(round.guesses.length)}
    />
    {round.mode === "practice" && <button type="button" className="new-round" onClick={onNextRound}>New practice round</button>}
    {round.error && <p role="alert">{round.error}</p>}
  </main>;
}

function GameShell({ snapshot }: { snapshot: LoadedSnapshot }) {
  const game = useGame(snapshot);
  if (game.error) return <p role="alert">Unable to start the round: {game.error}</p>;
  if (!game.round) return <p role="status">Preparing today&apos;s card…</p>;
  const { round } = game;
  return <>
    <nav className="mode-tabs" aria-label="Round mode">
      {(["daily", "practice"] as const).map((mode) => <button key={mode} type="button" aria-current={round.mode === mode ? "page" : undefined} className={round.mode === mode ? "active" : ""} onClick={() => void game.setMode(mode)}>{mode === "daily" ? "Daily" : "Practice"}</button>)}
    </nav>
    <p className="round-note">Each guess compares its base card and upgrade together. Match every trait to find today&apos;s card.</p>
    <RoundGame key={game.roundToken} round={round} snapshot={snapshot} onSubmit={game.submit} onNextRound={game.nextRound} />
  </>;
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
    <header><p className="eyebrow">Slay the Spire 2</p><h1>STSDLE</h1><p className="subtitle">A daily card deduction.</p></header>
    {error ? <section className="load-error" role="alert"><p>We couldn&apos;t load the current card set.</p><small>{error}</small><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></section> : snapshot ? <GameShell snapshot={snapshot} /> : <p role="status">Loading card data…</p>}
  </div>;
}
