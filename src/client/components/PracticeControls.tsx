import React from "react";

import type { RoundState } from "../game/game-reducer.js";

export interface PracticeControlsProps {
  round: RoundState;
  selectedHardcore: boolean;
  settingsEditable: boolean;
  disabled: boolean;
  onHardcoreChange(hardcore: boolean): void;
  onForfeit(): void;
  onNextRound(): void;
}

export function PracticeControls({
  round,
  selectedHardcore,
  settingsEditable,
  disabled,
  onHardcoreChange,
  onForfeit,
  onNextRound,
}: PracticeControlsProps) {
  const terminal = round.status !== "playing";

  return <section className="practice-controls" aria-label="Practice controls">
    <label className="practice-controls__filter">
      <input
        type="checkbox"
        checked={selectedHardcore}
        disabled={disabled || terminal || !settingsEditable}
        onChange={(event) => {
          if (!disabled && !terminal && settingsEditable) onHardcoreChange(event.currentTarget.checked);
        }}
      />
      <span>Hardcore Practice</span>
    </label>
    {terminal
      ? <button type="button" disabled={disabled} onClick={onNextRound}>New Practice Round</button>
      : <button type="button" disabled={disabled} onClick={onForfeit}>End game</button>}
  </section>;
}
