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
  test("offers Hardcore Practice and End game while a Practice round is untouched", () => {
    const onForfeit = vi.fn();
    const onHardcoreChange = vi.fn();
    render(<PracticeControls
      round={playingRound}
      selectedHardcore={false}
      settingsEditable
      disabled={false}
      onHardcoreChange={onHardcoreChange}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    const hardcorePractice = screen.getByRole("checkbox", { name: "Hardcore Practice" });
    expect(hardcorePractice).not.toBeChecked();
    fireEvent.click(hardcorePractice);
    expect(onHardcoreChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(onForfeit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "New Practice Round" })).not.toBeInTheDocument();
    expect(screen.queryByText("Filter Mode")).not.toBeInTheDocument();
  });

  test("reflects selected Hardcore Practice", () => {
    render(<PracticeControls
      round={{ ...playingRound, hardcore: true, assistance: null }}
      selectedHardcore
      settingsEditable
      disabled={false}
      onHardcoreChange={vi.fn()}
      onForfeit={vi.fn()}
      onNextRound={vi.fn()}
    />);

    expect(screen.getByRole("checkbox", { name: "Hardcore Practice" })).toBeChecked();
  });

  test.each([
    { label: "a guess", round: { ...playingRound, guesses: [{ cardId: "guess", results: [] }] } },
    { label: "an orb", round: { ...playingRound, assistance: { ...createDefaultAssistance(), reveal: { feature: "mana" as const } } } },
    { label: "a terminal result", round: { ...playingRound, status: "forfeited" as const, terminalGuessCount: 0 } },
  ])("locks Hardcore Practice after $label", ({ round }) => {
    const onForfeit = vi.fn();
    const onHardcoreChange = vi.fn();
    render(<PracticeControls
      round={round}
      selectedHardcore={false}
      settingsEditable={false}
      disabled={false}
      onHardcoreChange={onHardcoreChange}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    const hardcorePractice = screen.getByRole("checkbox", { name: "Hardcore Practice" });
    expect(hardcorePractice).toBeDisabled();
    fireEvent.click(hardcorePractice);
    expect(onHardcoreChange).not.toHaveBeenCalled();
  });

  test("offers a locked Hardcore Practice choice and New Practice Round after a terminal result", () => {
    const onNextRound = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, status: "forfeited", terminalGuessCount: 0 }}
      selectedHardcore
      settingsEditable={false}
      disabled={false}
      onHardcoreChange={vi.fn()}
      onForfeit={vi.fn()}
      onNextRound={onNextRound}
    />);

    expect(screen.getByRole("checkbox", { name: "Hardcore Practice" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Hardcore Practice" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New Practice Round" }));
    expect(onNextRound).toHaveBeenCalledOnce();
  });
});
