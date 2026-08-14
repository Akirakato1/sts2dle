import React from "react";

import type { RoundState } from "../game/game-reducer.js";

export interface PracticeControlsProps {
  round: RoundState;
  filterEnabled: boolean;
  disabled: boolean;
  onFilterEnabledChange(enabled: boolean): void;
  onForfeit(): void;
  onNextRound(): void;
}

export function PracticeControls({
  round,
  filterEnabled,
  disabled,
  onFilterEnabledChange,
  onForfeit,
  onNextRound,
}: PracticeControlsProps) {
  const terminal = round.status !== "playing";

  return <section className="practice-controls" aria-label="Practice controls">
    <label className="practice-controls__filter">
      <input
        type="checkbox"
        checked={filterEnabled}
        disabled={disabled || terminal}
        onChange={(event) => {
          if (!disabled && !terminal) onFilterEnabledChange(event.currentTarget.checked);
        }}
      />
      <span>Filter Mode</span>
    </label>
    {terminal
      ? <button type="button" disabled={disabled} onClick={onNextRound}>New Practice Round</button>
      : <button type="button" disabled={disabled} onClick={onForfeit}>End game</button>}
  </section>;
}
