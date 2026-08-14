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
  test("offers Filter Mode and End game while a Practice round is playing", () => {
    const onForfeit = vi.fn();
    const onFilterEnabledChange = vi.fn();
    render(<PracticeControls
      round={playingRound}
      filterEnabled={false}
      disabled={false}
      onFilterEnabledChange={onFilterEnabledChange}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    const filterMode = screen.getByRole("checkbox", { name: "Filter Mode" });
    expect(filterMode).not.toBeChecked();
    fireEvent.click(filterMode);
    expect(onFilterEnabledChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(onForfeit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "New Practice Round" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Hardcore Practice|locks when/i)).not.toBeInTheDocument();
  });

  test("reflects enabled Filter Mode", () => {
    render(<PracticeControls
      round={playingRound}
      filterEnabled
      disabled={false}
      onFilterEnabledChange={vi.fn()}
      onForfeit={vi.fn()}
      onNextRound={vi.fn()}
    />);

    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).toBeChecked();
  });

  test("blocks filter changes and forfeit during reveal or drag", () => {
    const onForfeit = vi.fn();
    const onFilterEnabledChange = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, guesses: [{ cardId: "guess", results: [] }] }}
      filterEnabled={false}
      disabled
      onFilterEnabledChange={onFilterEnabledChange}
      onForfeit={onForfeit}
      onNextRound={vi.fn()}
    />);

    const endGame = screen.getByRole("button", { name: "End game" });
    const filterMode = screen.getByRole("checkbox", { name: "Filter Mode" });
    expect(endGame).toBeDisabled();
    expect(filterMode).toBeDisabled();
    fireEvent.click(filterMode);
    fireEvent.click(endGame);
    expect(onFilterEnabledChange).not.toHaveBeenCalled();
    expect(onForfeit).not.toHaveBeenCalled();
  });

  test("offers a disabled Filter Mode and New Practice Round after a terminal result", () => {
    const onNextRound = vi.fn();
    render(<PracticeControls
      round={{ ...playingRound, status: "forfeited", terminalGuessCount: 0 }}
      filterEnabled
      disabled={false}
      onFilterEnabledChange={vi.fn()}
      onForfeit={vi.fn()}
      onNextRound={onNextRound}
    />);

    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New Practice Round" }));
    expect(onNextRound).toHaveBeenCalledOnce();
  });
});
