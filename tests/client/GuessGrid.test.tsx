// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { GuessGrid } from "../../src/client/components/GuessGrid.js";
import type { SubmittedGuess } from "../../src/client/game/game-reducer.js";
import type { FeatureResult } from "../../src/shared/comparison.js";
import { FEATURE_ORDER, type CardIdentity, type SpriteMap } from "../../src/shared/domain.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const features = {
  cardClass: "Ironclad", cardType: "Attack", mana: 2, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false, unplayable: false,
} as const;

const cards: CardIdentity[] = [
  { id: "first", name: "First Guess", hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: features, upgraded: features },
  { id: "second", name: "Second Guess", hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: features, upgraded: features },
];

const results: FeatureResult[] = [
  { feature: "cardClass", color: "red", displayValue: "Ironclad", hint: "none" },
  { feature: "cardType", color: "green", displayValue: "Attack", hint: "none" },
  { feature: "mana", color: "yellow", displayValue: "2 \u2192 1", hint: "down" },
  { feature: "rarity", color: "red", displayValue: "Common", hint: "none" },
  { feature: "eternal", color: "green", displayValue: "false", hint: "none" },
  { feature: "ethereal", color: "green", displayValue: "false", hint: "none" },
  { feature: "exhaust", color: "red", displayValue: "false", hint: "none" },
  { feature: "innate", color: "green", displayValue: "false", hint: "none" },
  { feature: "retain", color: "green", displayValue: "false", hint: "none" },
  { feature: "sly", color: "green", displayValue: "false", hint: "none" },
  { feature: "unplayable", color: "green", displayValue: "false", hint: "none" },
];

const guesses: SubmittedGuess[] = [
  { cardId: "first", results },
  { cardId: "second", results: results.map((result) => ({ ...result, displayValue: result.feature === "cardClass" ? "Silent" : result.displayValue })) },
];

const spriteMap: SpriteMap = {
  candidate: { url: "/candidate.webp", width: 128, height: 64, displayScale: 0.5 },
  guess: { url: "/guess.webp", width: 320, height: 160, displayScale: 0.5 },
  cards: {
    first: { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } },
    second: { candidate: { x: 64, y: 0, width: 64, height: 64 }, guess: { x: 160, y: 0, width: 160, height: 160 } },
  },
};

const cardsById = new Map(cards.map((card) => [card.id, card]));

describe("GuessGrid", () => {
  test("renders a sticky artwork column followed by exactly the eleven canonical feature columns", () => {
    render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} animateFromIndex={1} />);

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(12);
    expect(headers.slice(1).map((header) => header.getAttribute("data-feature"))).toEqual([
      "cardClass", "cardType", "mana", "rarity", "eternal", "ethereal",
      "exhaust", "innate", "retain", "sly", "unplayable",
    ]);
    expect(headers.slice(1).map((header) => header.getAttribute("data-feature"))).toEqual([...FEATURE_ORDER]);
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();

    const guessRow = screen.getAllByRole("row")[1]!;
    expect(within(guessRow).getAllByRole("rowheader")).toHaveLength(1);
    expect(within(guessRow).getAllByRole("cell")).toHaveLength(11);
  });

  test("keeps the earliest guess above later guesses and displays 160px source art at 80px", () => {
    render(<GuessGrid guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} animateFromIndex={2} />);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByRole("rowheader")).toHaveAccessibleName("First Guess artwork and name");
    expect(within(rows[2]!).getByRole("rowheader")).toHaveAccessibleName("Second Guess artwork and name");
    expect(screen.getByRole("img", { name: "First Guess guess artwork" })).toHaveStyle({ width: "80px", height: "80px" });
  });

  test("assigns sequential reveal indices and completes only after the final new tile flips", () => {
    const onRevealComplete = vi.fn();
    const { container } = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} animateFromIndex={0} onRevealComplete={onRevealComplete} />);

    const tiles = screen.getAllByRole("cell");
    expect(tiles.map((tile) => tile.style.getPropertyValue("--reveal-index"))).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    fireEvent.transitionEnd(container.querySelectorAll(".feature-tile__surface")[9]!);
    expect(onRevealComplete).not.toHaveBeenCalled();
    fireEvent.transitionEnd(container.querySelectorAll(".feature-tile__surface")[10]!);
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("renders restored guesses in their final state without replaying animation", () => {
    render(<GuessGrid guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} animateFromIndex={guesses.length} />);
    expect(screen.getAllByRole("cell")).toHaveLength(22);
    expect(screen.getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);
  });

  test("reveals immediately and completes without a transition when reduced motion is preferred", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const onRevealComplete = vi.fn();
    render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} animateFromIndex={0} onRevealComplete={onRevealComplete} />);

    expect(screen.getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);
    await waitFor(() => expect(onRevealComplete).toHaveBeenCalledOnce());
  });
});
