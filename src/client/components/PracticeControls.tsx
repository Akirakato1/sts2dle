import React from "react";

import type { RoundState } from "../game/game-reducer.js";

export interface PracticeControlsProps {
  round: RoundState;
  disabled: boolean;
  onForfeit(): void;
  onNextRound(): void;
}

export function PracticeControls({
  round,
  disabled,
  onForfeit,
  onNextRound,
}: PracticeControlsProps) {
  const terminal = round.status !== "playing";

  return <section className="practice-controls" aria-label="Practice controls">
    {terminal
      ? <button type="button" disabled={disabled} onClick={onNextRound}>New Practice Round</button>
      : <button type="button" disabled={disabled} onClick={onForfeit}>End game</button>}
  </section>;
}
