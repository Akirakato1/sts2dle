// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PracticeControls } from "../../src/client/components/PracticeControls.js";
import { createDefaultAssistance } from "../../src/client/game/assistance.js";
import type { RoundState } from "../../src/client/game/game-reducer.js";

afterEach(cleanup);

const playingRound: RoundState = {
  mode: "practice",
  hardcore: false,
  roundId: "practice:one",
  hintSeed: "one",
  answer: { baseGroupKey: "base", selectedCardId: "answer", pairKey: "pair", acceptedCardIds: ["answer"] },
  guesses: [],
  status: "playing",
  terminalGuessCount: null,
  error: null,
  assistance: createDefaultAssistance(),
};

describe("PracticeControls", () => {
  test("allows the Hardcore choice and forfeit only while an editable Practice round is interactive", () => {
    const onHardcoreChange = vi.fn();
    const onForfeit = vi.fn();
    render(<PracticeControls
      round={playingRound}
      selectedHardcore={false}
      settingsEditable
      disabled={false}
      onHardcoreChange={onHardcoreChange}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    const toggle = screen.getByRole("checkbox", { name: "Hardcore Practice" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(onHardcoreChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(onForfeit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "New Practice Round" })).not.toBeInTheDocument();
  });

  test("locks the setting after the first accepted guess or orb and blocks forfeit during reveal or drag", () => {
    const onForfeit = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, guesses: [{ cardId: "guess", results: [] }] }}
      selectedHardcore={false}
      settingsEditable={false}
      disabled
      onHardcoreChange={vi.fn()}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    expect(screen.getByRole("checkbox", { name: "Hardcore Practice" })).toBeDisabled();
    expect(screen.getByText(/locked after your first accepted guess or orb/i)).toBeVisible();
    const endGame = screen.getByRole("button", { name: "End game" });
    expect(endGame).toBeDisabled();
    fireEvent.click(endGame);
    expect(onForfeit).not.toHaveBeenCalled();
  });

  test("uses interaction disabling to block forfeit without replacing the settings-editable gate", () => {
    render(<PracticeControls
      round={playingRound}
      selectedHardcore={false}
      settingsEditable
      disabled
      onHardcoreChange={vi.fn()}
      onForfeit={vi.fn()}
      onNextRound={vi.fn()}
    />);

    expect(screen.getByRole("checkbox", { name: "Hardcore Practice" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "End game" })).toBeDisabled();
  });

  test("keeps the next-round Hardcore choice editable after a terminal result", () => {
    const onHardcoreChange = vi.fn();
    const onNextRound = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, status: "forfeited", terminalGuessCount: 0 }}
      selectedHardcore
      settingsEditable
      disabled={false}
      onHardcoreChange={onHardcoreChange}
      onForfeit={vi.fn()}
      onNextRound={onNextRound}
    />);

    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: "Hardcore Practice" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onHardcoreChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "New Practice Round" }));
    expect(onNextRound).toHaveBeenCalledOnce();
  });
});
