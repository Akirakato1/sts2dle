// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const loads = vi.hoisted(() => vi.fn());
const games = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/api/load-snapshot.js", () => ({ loadSnapshot: loads }));
vi.mock("../../src/client/game/use-game.js", () => ({ useGame: games }));
import { App } from "../../src/client/App.js";

const card = (id: string, name: string) => ({
  id, name, hasUpgrade: true, artUrl: `${id}.png`, baseCardUrl: null, upgradedCardUrl: null,
  base: { cardClass: "Neutral", cardType: "Skill", mana: 1, rarity: "Common", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false, unplayable: false },
  upgraded: { cardClass: "Neutral", cardType: "Skill", mana: 1, rarity: "Common", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false, unplayable: false },
});
const appCards = [card("apotheosis", "Apotheosis"), card("apparition", "Apparition")];
const appSprite = { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } };
const searchSnapshot = {
  cards: appCards,
  cardsById: new Map(appCards.map((item) => [item.id, item])),
  spriteMap: {
    candidate: { url: "/candidate.webp", width: 128, height: 64, displayScale: 0.5 },
    guess: { url: "/guess.webp", width: 320, height: 160, displayScale: 0.5 },
    cards: { apotheosis: appSprite, apparition: appSprite },
  },
};
const appFeatureNames = ["cardClass", "cardType", "mana", "rarity", "eternal", "ethereal", "exhaust", "innate", "retain", "sly", "unplayable"] as const;
const makeResult = (feature: (typeof appFeatureNames)[number]) => ({
  feature,
  color: "red" as const,
  displayValue: String(appCards[1]!.base[feature]),
  hint: "none" as const,
});
const submittedGuess = { cardId: "apparition", results: appFeatureNames.map(makeResult) };

function dispatchTransformEnd(target: Element): void {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "transform" });
  fireEvent(target, event);
}

beforeEach(() => {
  loads.mockReset();
  games.mockReset();
  games.mockReturnValue({ round: null, roundToken: 0, error: null, submit: vi.fn(), setMode: vi.fn(), nextRound: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App snapshot cleanup", () => {
  test("StrictMode aborts all pending loads without showing an error and remounts successfully", async () => {
    const calls: AbortSignal[] = [];
    loads.mockImplementation((_fetch: typeof fetch, signal: AbortSignal) => new Promise((_resolve, reject) => {
      calls.push(signal); signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")), { once: true });
    }));
    const first = render(<StrictMode><App /></StrictMode>);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(calls[0]?.aborted).toBe(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    first.unmount();
    expect(calls.every((signal) => signal.aborted)).toBe(true);
    loads.mockResolvedValueOnce({});
    render(<App />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preparing today"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("wires base-card candidates to game submission and excludes prior guesses", async () => {
    const submit = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      round: {
        mode: "daily",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [{ cardId: "apparition", results: [] }],
        status: "playing",
        error: null,
      },
      roundToken: 1,
      error: null,
      submit,
      setMode: vi.fn(),
      nextRound: vi.fn(),
    });

    render(<App />);
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Apotheosis"]);
    fireEvent.click(screen.getByRole("option"));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith("apotheosis");
  });

  test("clears search state on a mode switch and on a new Practice round", async () => {
    const makeRound = (mode: "daily" | "practice", selectedCardId: string) => ({
      mode,
      answer: { baseGroupKey: "base", selectedCardId, pairKey: "pair", acceptedCardIds: [selectedCardId] },
      guesses: [],
      status: "playing",
      error: null,
    });
    const submit = vi.fn();
    let gameState = {
      round: makeRound("daily", "apotheosis"),
      roundToken: 1,
      error: null,
      submit,
      setMode: vi.fn(),
      nextRound: vi.fn(),
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    gameState = { ...gameState, round: makeRound("practice", "apparition"), roundToken: 2 };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    gameState = { ...gameState, round: makeRound("practice", "apotheosis"), roundToken: 3 };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("locks the search from row insertion through the eleventh tile reveal", async () => {
    const submit = vi.fn();
    let gameState = {
      round: {
        mode: "daily" as const,
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [] as Array<typeof submittedGuess>,
        status: "playing" as const,
        error: null,
      },
      roundToken: 1,
      error: null,
      submit,
      setMode: vi.fn(),
      nextRound: vi.fn(),
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    const input = await screen.findByRole("combobox");
    expect(input).toBeEnabled();

    gameState = {
      ...gameState,
      round: {
        ...gameState.round,
        guesses: [submittedGuess],
      },
    };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toBeDisabled();

    const surfaces = view.container.querySelectorAll(".feature-tile__surface");
    dispatchTransformEnd(surfaces[surfaces.length - 1]!);
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  test("keeps the search locked until a missing transition reaches the fallback", async () => {
    let gameState = {
      round: {
        mode: "daily" as const,
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [] as Array<typeof submittedGuess>,
        status: "playing" as const,
        error: null,
      },
      roundToken: 1,
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      nextRound: vi.fn(),
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    await screen.findByRole("combobox");
    vi.useFakeTimers();

    gameState = { ...gameState, round: { ...gameState.round, guesses: [submittedGuess] } };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    act(() => vi.advanceTimersByTime(1_699));
    expect(screen.getByRole("combobox")).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("combobox")).toBeEnabled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
});
