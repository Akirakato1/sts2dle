// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { GuessGrid, REVEAL_FALLBACK_SAFETY_MS } from "../../src/client/components/GuessGrid.js";
import { REVEAL_DURATION_MS, REVEAL_STAGGER_MS } from "../../src/client/components/FeatureTile.js";
import { OrbInteractionProvider, type OrbTargetDescriptor } from "../../src/client/components/OrbInteractionContext.js";
import { OrbTray } from "../../src/client/components/OrbTray.js";
import { createDefaultAssistance, type AssistanceState } from "../../src/client/game/assistance.js";
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
  { id: "third", name: "Third Guess", hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: features, upgraded: features },
];

const selectedAnswer: CardIdentity = {
  ...cards[0]!,
  id: "answer",
  name: "Selected Answer",
  base: { ...features, mana: 2, eternal: false },
  upgraded: { ...features, mana: 1, eternal: true },
};

const results: FeatureResult[] = [
  { feature: "cardClass", color: "red", displayValue: "Ironclad" },
  { feature: "cardType", color: "green", displayValue: "Attack" },
  { feature: "mana", color: "yellow", displayValue: "2 \u2192 1" },
  { feature: "rarity", color: "red", displayValue: "Common" },
  { feature: "eternal", color: "green", displayValue: "false" },
  { feature: "ethereal", color: "green", displayValue: "false" },
  { feature: "exhaust", color: "red", displayValue: "false" },
  { feature: "innate", color: "green", displayValue: "false" },
  { feature: "retain", color: "green", displayValue: "false" },
  { feature: "sly", color: "green", displayValue: "false" },
];

const guesses: SubmittedGuess[] = [
  { cardId: "first", results },
  { cardId: "second", results: results.map((result) => ({ ...result, displayValue: result.feature === "cardClass" ? "Silent" : result.displayValue })) },
  { cardId: "third", results: results.map((result) => ({ ...result, displayValue: result.feature === "cardClass" ? "Defect" : result.displayValue })) },
];

const spriteMap: SpriteMap = {
  candidate: { url: "/candidate.webp", width: 128, height: 64, displayScale: 0.5 },
  guess: { url: "/guess.webp", width: 320, height: 160, displayScale: 0.45 },
  cards: {
    first: { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } },
    second: { candidate: { x: 64, y: 0, width: 64, height: 64 }, guess: { x: 160, y: 0, width: 160, height: 160 } },
    third: { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } },
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

interface GridHarnessProps extends Omit<React.ComponentProps<typeof GuessGrid>, "assistance" | "selectedAnswer"> {
  assistance?: AssistanceState | null;
  selectedAnswer?: CardIdentity;
  onUse?: (orb: "reveal" | "filter" | "negation", target: OrbTargetDescriptor) => { accepted: boolean; announcement: string };
}

function GridHarness({
  assistance = createDefaultAssistance(),
  selectedAnswer = cards[0]!,
  onUse = () => ({ accepted: true, announcement: "Orb consumed." }),
  ...gridProps
}: GridHarnessProps) {
  return <OrbInteractionProvider
    assistance={assistance}
    disabled={false}
    onUse={onUse}
    roundKey={gridProps.roundKey}
  >
    {assistance && <OrbTray assistance={assistance} disabled={false} />}
    <GuessGrid {...gridProps} assistance={assistance} selectedAnswer={selectedAnswer} />
  </OrbInteractionProvider>;
}

describe("GuessGrid", () => {
  test.each(FEATURE_ORDER)("makes only the %s heading dispatchable after selecting Reveal", (feature) => {
    const onUse = vi.fn(() => ({ accepted: true, announcement: "Feature revealed." }));
    render(<GridHarness
      guesses={[]}
      cardsById={cardsById}
      spriteMap={spriteMap}
      roundKey={`round-${feature}`}
      animateFromIndex={0}
      selectedAnswer={selectedAnswer}
      onUse={onUse}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Reveal Orb, available" }));
    const cardHeader = screen.getByRole("columnheader", { name: "Card" });
    expect(within(cardHeader).queryByRole("button")).not.toBeInTheDocument();
    const featureHeader = document.querySelector<HTMLElement>(`[role="columnheader"][data-feature="${feature}"]`)!;
    fireEvent.click(within(featureHeader).getByRole("button", { name: /Use Reveal Orb/ }));

    expect(onUse).toHaveBeenCalledOnce();
    expect(onUse).toHaveBeenCalledWith("reveal", { kind: "header", feature });
  });

  test("persists one formatted Reveal bubble and uses directional keyword state icons", () => {
    const assistance = { ...createDefaultAssistance(), reveal: { feature: "eternal" as const } };
    const view = render(<GridHarness
      guesses={[]}
      cardsById={cardsById}
      spriteMap={spriteMap}
      roundKey="round-bubble"
      animateFromIndex={0}
      selectedAnswer={selectedAnswer}
      assistance={assistance}
    />);

    const eternalHeader = document.querySelector<HTMLElement>('[role="columnheader"][data-feature="eternal"]')!;
    const bubble = within(eternalHeader).getByRole("note", { name: "Answer: absent to present" });
    expect(view.container.querySelectorAll(".guess-grid__reveal-bubble")).toHaveLength(1);
    expect([...bubble.querySelectorAll("svg")].map((icon) => icon.dataset.icon)).toEqual(["x", "check"]);

    view.rerender(<GridHarness
      guesses={[]}
      cardsById={cardsById}
      spriteMap={spriteMap}
      roundKey="round-bubble"
      animateFromIndex={0}
      selectedAnswer={selectedAnswer}
      assistance={{ ...createDefaultAssistance(), reveal: { feature: "mana" } }}
    />);
    expect(screen.getByLabelText("Answer: 2 \u2192 1")).toHaveTextContent("2 \u2192 1");
    expect(view.container.querySelectorAll(".guess-grid__reveal-bubble")).toHaveLength(1);
  });

  test("badges only the exact chronological card and feature targets in newest-first rows", () => {
    const assistance: AssistanceState = {
      ...createDefaultAssistance(),
      filter: { guessIndex: 0, cardId: "first", feature: "cardType" },
      negation: { guessIndex: 1, cardId: "second", feature: "cardClass" },
    };
    render(<GridHarness
      guesses={guesses}
      cardsById={cardsById}
      spriteMap={spriteMap}
      roundKey="round-badges"
      animateFromIndex={guesses.length}
      assistance={assistance}
    />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).queryByLabelText(/Orb used here/)).not.toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText("Negation Orb used here")).toBeInTheDocument();
    expect(within(rows[1]!).queryByLabelText("Filter Orb used here")).not.toBeInTheDocument();
    expect(within(rows[2]!).getByLabelText("Filter Orb used here")).toBeInTheDocument();
    expect(within(rows[2]!).queryByLabelText("Negation Orb used here")).not.toBeInTheDocument();
  });

  test("renders a sticky artwork column followed by exactly the ten canonical feature columns", () => {
    render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-colcount", "11");
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(11);
    expect(headers.slice(1).map((header) => header.getAttribute("data-feature"))).toEqual([
      "cardClass", "cardType", "mana", "rarity", "eternal", "ethereal",
      "exhaust", "innate", "retain", "sly",
    ]);
    expect(headers.slice(1).map((header) => header.getAttribute("data-feature"))).toEqual([...FEATURE_ORDER]);
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Unplayable" })).not.toBeInTheDocument();

    const guessRow = screen.getAllByRole("row")[1]!;
    expect(within(guessRow).getAllByRole("rowheader")).toHaveLength(1);
    expect(within(guessRow).getAllByRole("cell")).toHaveLength(10);
  });

  test("renders newest guesses immediately below the header while preserving source art sizing", () => {
    render(<GridHarness guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={2} />);

    expect(screen.getAllByRole("rowheader").map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "Third Guess artwork and name",
      "Second Guess artwork and name",
      "First Guess artwork and name",
    ]);
    expect(screen.getByRole("img", { name: "First Guess guess artwork" })).toHaveStyle({ width: "72px", height: "72px" });
  });

  test("animates only the newest submitted row and completes its reveal from the first body row", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GridHarness guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={2} onRevealComplete={onRevealComplete} />);

    expect(screen.getAllByRole("rowheader").map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "Third Guess artwork and name",
      "Second Guess artwork and name",
      "First Guess artwork and name",
    ]);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getAllByRole("cell").every((tile) => !tile.classList.contains("feature-tile--immediate"))).toBe(true);
    expect(within(rows[2]!).getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);
    expect(within(rows[3]!).getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);

    const surfaces = container.querySelectorAll(".feature-tile__surface");
    dispatchTransitionEnd(surfaces[19]!, "transform");
    expect(onRevealComplete).not.toHaveBeenCalled();
    dispatchTransitionEnd(surfaces[9]!, "transform");
    dispatchTransitionEnd(surfaces[9]!, "transform");
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("assigns sequential reveal indices and completes only after the final new tile flips", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);

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
    render(<GridHarness guesses={guesses} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={guesses.length} />);
    expect(screen.getAllByRole("rowheader").map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "Third Guess artwork and name",
      "Second Guess artwork and name",
      "First Guess artwork and name",
    ]);
    expect(screen.getAllByRole("cell")).toHaveLength(30);
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
    const { rerender } = render(<StrictMode><GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);

    expect(screen.getAllByRole("cell").every((tile) => tile.classList.contains("feature-tile--immediate"))).toBe(true);
    await act(async () => Promise.resolve());
    expect(onRevealComplete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<StrictMode><GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} onRevealComplete={onRevealComplete} /></StrictMode>);
    expect(onRevealComplete).toHaveBeenCalledOnce();
    rerender(<StrictMode><GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);
    expect(onRevealComplete).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("completes a reused normal reveal key once per settled lifecycle", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const view = render(<StrictMode><GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);
    const firstSurface = view.container.querySelectorAll(".feature-tile__surface")[9]!;
    dispatchTransitionEnd(firstSurface, "transform");
    dispatchTransitionEnd(firstSurface, "transform");
    expect(onRevealComplete).toHaveBeenCalledOnce();

    view.rerender(<StrictMode><GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} onRevealComplete={onRevealComplete} /></StrictMode>);
    expect(onRevealComplete).toHaveBeenCalledOnce();
    view.rerender(<StrictMode><GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} /></StrictMode>);
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
    render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);

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
    const { container } = render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    const finalSurface = container.querySelectorAll(".feature-tile__surface")[9]!;

    dispatchTransitionEnd(finalSurface.querySelector(".feature-tile__back")!, "transform");
    expect(onRevealComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(revealFallbackMs));
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("ignores a transition for the wrong property", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);

    dispatchTransitionEnd(container.querySelectorAll(".feature-tile__surface")[9]!, "opacity");
    expect(onRevealComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(revealFallbackMs));
    expect(onRevealComplete).toHaveBeenCalledOnce();
  });

  test("accepts duplicate valid transition events only once", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const { container } = render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
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
    const view = render(<GridHarness guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRevealComplete).not.toHaveBeenCalled();
  });
});
