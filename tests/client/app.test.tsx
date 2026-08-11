// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const loads = vi.hoisted(() => vi.fn());
const games = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/api/load-snapshot.js", () => ({ loadSnapshot: loads }));
vi.mock("../../src/client/game/use-game.js", () => ({ useGame: games }));
import { App } from "../../src/client/App.js";

beforeEach(() => {
  loads.mockReset();
  games.mockReset();
  games.mockReturnValue({ round: null, error: null, submit: vi.fn(), setMode: vi.fn(), nextRound: vi.fn() });
});
afterEach(cleanup);

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
    const card = (id: string, name: string) => ({
      id, name, hasUpgrade: true, artUrl: `${id}.png`, baseCardUrl: null, upgradedCardUrl: null,
      base: { cardClass: "Neutral", cardType: "Skill", mana: 1, rarity: "Common", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false, unplayable: false },
      upgraded: { cardClass: "Neutral", cardType: "Skill", mana: 1, rarity: "Common", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false, unplayable: false },
    });
    const cards = [card("apotheosis", "Apotheosis"), card("apparition", "Apparition")];
    const sprite = { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } };
    loads.mockResolvedValue({
      cards,
      spriteMap: {
        candidate: { url: "/candidate.webp", width: 128, height: 64, displayScale: 0.5 },
        guess: { url: "/guess.webp", width: 320, height: 160, displayScale: 0.5 },
        cards: { apotheosis: sprite, apparition: sprite },
      },
    });
    games.mockReturnValue({
      round: {
        mode: "daily",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [{ cardId: "apparition", results: [] }],
        status: "playing",
        error: null,
      },
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
});
