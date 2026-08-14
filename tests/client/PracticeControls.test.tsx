// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PracticeControls } from "../../src/client/components/PracticeControls.js";
import { createDefaultAssistance } from "../../src/client/game/assistance.js";
import type { RoundState } from "../../src/client/game/game-reducer.js";
import { createDefaultPracticeFilter } from "../../src/client/game/practice-filter.js";

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
  practiceFilter: createDefaultPracticeFilter(),
};

describe("PracticeControls", () => {
  test("offers End game while a Practice round is playing", () => {
    const onForfeit = vi.fn();
    render(<PracticeControls
      round={playingRound}
      disabled={false}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    expect(screen.queryByRole("checkbox", { name: "Hardcore Practice" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(onForfeit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "New Practice Round" })).not.toBeInTheDocument();
  });

  test("blocks forfeit during reveal or drag", () => {
    const onForfeit = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, guesses: [{ cardId: "guess", results: [] }] }}
      disabled
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    const endGame = screen.getByRole("button", { name: "End game" });
    expect(endGame).toBeDisabled();
    fireEvent.click(endGame);
    expect(onForfeit).not.toHaveBeenCalled();
  });

  test("offers New Practice Round after a terminal result", () => {
    const onNextRound = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, status: "forfeited", terminalGuessCount: 0 }}
      disabled={false}
      onForfeit={vi.fn()}
      onNextRound={onNextRound}
    />);

    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New Practice Round" }));
    expect(onNextRound).toHaveBeenCalledOnce();
  });
});
