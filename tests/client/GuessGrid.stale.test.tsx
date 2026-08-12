// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { FeatureResult } from "../../src/shared/comparison.js";

interface CapturedTileProps {
  result: FeatureResult;
  onRevealEnd?: (event: React.TransitionEvent<HTMLDivElement>) => void;
}

const capturedTiles = vi.hoisted(() => [] as CapturedTileProps[]);

vi.mock("../../src/client/components/FeatureTile.js", async (importOriginal) => {
  const ReactModule = await import("react");
  const actual = await importOriginal<typeof import("../../src/client/components/FeatureTile.js")>();
  return {
    ...actual,
    FeatureTile: (props: CapturedTileProps) => {
      capturedTiles.push(props);
      return ReactModule.createElement("div", { role: "cell" });
    },
  };
});

import { GuessGrid } from "../../src/client/components/GuessGrid.js";
import type { SubmittedGuess } from "../../src/client/game/game-reducer.js";
import { FEATURE_ORDER, type CardIdentity, type FeatureVector, type SpriteMap } from "../../src/shared/domain.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false,
};
const cards: CardIdentity[] = ["first", "second"].map((id) => ({
  id, name: id, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
  base: vector, upgraded: vector,
}));
const cardsById = new Map(cards.map((card) => [card.id, card]));
const spriteMap: SpriteMap = {
  candidate: { url: "/candidate.webp", width: 1, height: 1, displayScale: 1 },
  guess: { url: "/guess.webp", width: 1, height: 1, displayScale: 1 },
  cards: {},
};
const results: FeatureResult[] = FEATURE_ORDER.map((feature) => ({
  feature, color: "red", displayValue: "wrong", hint: "none",
}));
const guesses: SubmittedGuess[] = cards.map((card) => ({ cardId: card.id, results }));

beforeEach(() => {
  capturedTiles.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GuessGrid stale reveal handler", () => {
  test("rejects retained handler and timeout callbacks from a settled identical-key lifecycle", () => {
    const timeoutCallbacks: Array<() => void> = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler) => {
      if (typeof handler !== "function") throw new TypeError("Expected a function timeout handler");
      timeoutCallbacks.push(() => handler());
      return timeoutCallbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    const onRevealComplete = vi.fn();
    const view = render(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    const staleHandler = capturedTiles.findLast((props) => props.onRevealEnd)?.onRevealEnd;
    expect(staleHandler).toBeTypeOf("function");
    const staleTimeout = timeoutCallbacks.at(-1);
    expect(staleTimeout).toBeTypeOf("function");
    const surface = document.createElement("div");
    const event = { target: surface, currentTarget: surface, propertyName: "transform" } as unknown as React.TransitionEvent<HTMLDivElement>;

    act(() => staleHandler?.(event));
    expect(onRevealComplete).toHaveBeenCalledOnce();

    capturedTiles.length = 0;
    view.rerender(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={1} onRevealComplete={onRevealComplete} />);
    view.rerender(<GuessGrid guesses={[guesses[0]!]} cardsById={cardsById} spriteMap={spriteMap} roundKey="round-1" animateFromIndex={0} onRevealComplete={onRevealComplete} />);
    const currentHandler = capturedTiles.findLast((props) => props.onRevealEnd)?.onRevealEnd;
    expect(currentHandler).toBeTypeOf("function");
    const currentTimeout = timeoutCallbacks.at(-1);
    expect(currentTimeout).toBeTypeOf("function");

    act(() => staleHandler?.(event));
    expect(onRevealComplete).toHaveBeenCalledOnce();
    act(() => staleTimeout?.());
    expect(onRevealComplete).toHaveBeenCalledOnce();
    act(() => currentHandler?.(event));
    expect(onRevealComplete).toHaveBeenCalledTimes(2);
    act(() => currentTimeout?.());
    expect(onRevealComplete).toHaveBeenCalledTimes(2);
  });
});
