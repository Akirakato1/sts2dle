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
  const toggleDisabled = !settingsEditable;

  return <section className="practice-controls" aria-label="Practice controls">
    <label className="practice-controls__hardcore">
      <input
        type="checkbox"
        checked={selectedHardcore}
        disabled={toggleDisabled}
        onChange={(event) => onHardcoreChange(event.currentTarget.checked)}
      />
      <span>Hardcore Practice</span>
    </label>
    {terminal
      ? <button type="button" disabled={disabled} onClick={onNextRound}>New Practice Round</button>
      : <button type="button" disabled={disabled} onClick={onForfeit}>End game</button>}
    {!terminal && !settingsEditable && <p className="practice-controls__lock-help">
      Hardcore is locked after your first accepted guess or orb.
    </p>}
  </section>;
}
