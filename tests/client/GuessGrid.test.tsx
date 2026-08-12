// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { GuessGrid, REVEAL_FALLBACK_SAFETY_MS } from "../../src/client/components/GuessGrid.js";
import { REVEAL_DURATION_MS, REVEAL_STAGGER_MS } from "../../src/client/components/FeatureTile.js";
import type { SubmittedGuess } from "../../src/client/game/game-reducer.js";
import type { FeatureResult } from "../../src/shared/comparison.js";
import { FEATURE_ORDER, type CardIdentity, type SpriteMap } from "../../src/shared/domain.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const features = {
  cardClass: "Ironclad", cardType: "Attack", mana: 2, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false,
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
const revealFallbackMs = FEATURE_ORDER.length * REVEAL_STAGGER_MS
  + REVEAL_DURATION_MS
  + REVEAL_FALLBACK_SAFETY_MS;

function dispatchTransitionEnd(target: Element, propertyName: string): void {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(target, event);
}

describe("GuessGrid", () => {
  test("renders a sticky artwork column followed by exactly the ten canonical feature columns", () => {
    render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} />);

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(11);
    expect(headers.slice(1).map((header) => header.getAttribute("data-feature"))).toEqual([
      "cardClass", "cardType", "mana", "rarity", "eternal", "ethereal",
      "exhaust", "innate", "retain", "sly",
    ]);
    expect(headers.slice(1).map((header) => header.getAttribute("data-feature"))).toEqual([...FEATURE_ORDER]);
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();

    const guessRow = screen.getAllByRole("row")[1]!;
    expect(within(guessRow).getAllByRole("rowheader")).toHaveLength(1);
    expect(within(guessRow).getAllByRole("cell")).toHaveLength(10);
  });

  test("keeps the earliest guess above later guesses and displays 160px source art at 80px", () => {
    render(<GuessGrid guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={2} />);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByRole("rowheader")).toHaveAccessibleName("First Guess artwork and name");
    expect(within(rows[2]!).getByRole("rowheader")).toHaveAccessibleName("Second Guess artwork and name");
    expect(screen.getByRole("img", { name: "First Guess guess artwork" })).toHaveStyle({ width: "80px", height: "80px" });
  });

  test("assigns sequential reveal indices and completes only after the final new tile flips", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);

    const tiles = screen.getAllByRole("cell");
    expect(tiles.map((tile) => tile.style.getPropertyValue("--reveal-index"))).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    dispatchTransitionEnd(container.querySelectorAll(".feature-tile__surface")[8]!, "transform");
    expect(onRevealComplete).not.toHaveBeenCalled();
    dispatchTransitionEnd(container.querySelectorAll(".feature-tile__surface")[9]!, "transform");
    expect(onRevealComplete).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("renders restored guesses in their final state without replaying animation", () => {
    render(<GuessGrid guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={guesses.length} />);
    expect(screen.getAllByRole("cell")).toHaveLength(20);
    expect(screen.getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);
  });

  test("completes a reused reduced-motion reveal key once per settled lifecycle under StrictMode", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const onRevealComplete = vi.fn();
    const { rerender } = render(<StrictMode><GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);

    expect(screen.getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);
    await act(async () => Promise.resolve());
    expect(onRevealComplete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<StrictMode><GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} onRevealComplete={onRevealComplete} /></StrictMode>);
    expect(onRevealComplete).toHaveBeenCalledOnce();
    rerender(<StrictMode><GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);
    expect(onRevealComplete).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("completes a reused normal reveal key once per settled lifecycle", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const view = render(<StrictMode><GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);
    const firstSurface = view.container.querySelectorAll(".feature-tile__surface")[9]!;
    dispatchTransitionEnd(firstSurface, "transform");
    dispatchTransitionEnd(firstSurface, "transform");
    expect(onRevealComplete).toHaveBeenCalledOnce();

    view.rerender(<StrictMode><GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} onRevealComplete={onRevealComplete} /></StrictMode>);
    expect(onRevealComplete).toHaveBeenCalledOnce();
    view.rerender(<StrictMode><GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);
    const secondSurface = view.container.querySelectorAll(".feature-tile__surface")[9]!;
    dispatchTransitionEnd(secondSurface, "transform");
    dispatchTransitionEnd(secondSurface, "transform");
    expect(onRevealComplete).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRevealComplete).toHaveBeenCalledTimes(2);
  });

  test("uses a fallback exactly once when the final transition event is missing", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);

    act(() => vi.advanceTimersByTime(revealFallbackMs - 1));
    expect(onRevealComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRevealComplete).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("ignores a bubbled transform transition from the final tile child", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    const finalSurface = container.querySelectorAll(".feature-tile__surface")[9]!;

    dispatchTransitionEnd(finalSurface.querySelector(".feature-tile__back")!, "transform");
    expect(onRevealComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(revealFallbackMs));
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("ignores a transition for the wrong property", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);

    dispatchTransitionEnd(container.querySelectorAll(".feature-tile__surface")[9]!, "opacity");
    expect(onRevealComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(revealFallbackMs));
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("accepts duplicate valid transition events only once", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    const finalSurface = container.querySelectorAll(".feature-tile__surface")[9]!;

    act(() => vi.advanceTimersByTime(20));
    dispatchTransitionEnd(finalSurface, "transform");
    dispatchTransitionEnd(finalSurface, "transform");
    expect(onRevealComplete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("cancels the fallback without completing after unmount", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const view = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRevealComplete).not.toHaveBeenCalled();
  });
});
