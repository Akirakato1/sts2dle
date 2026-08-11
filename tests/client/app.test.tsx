// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import React, { StrictMode } from "react";
import { describe, expect, test, vi } from "vitest";

const loads = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/api/load-snapshot.js", () => ({ loadSnapshot: loads }));
vi.mock("../../src/client/game/use-game.js", () => ({ useGame: () => ({ round: null, error: null, submit: vi.fn(), setMode: vi.fn(), nextRound: vi.fn() }) }));
import { App } from "../../src/client/App.js";

describe("App snapshot cleanup", () => {
  test("StrictMode aborts all pending loads without showing an error and remounts successfully", async () => {
    const calls: AbortSignal[] = [];
    loads.mockImplementation((_fetch: typeof fetch, signal: AbortSignal) => new Promise((_resolve, reject) => {
      calls.push(signal); signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")), { once: true });
    }));
    const first = render(<StrictMode><App /></StrictMode>);
    first.unmount();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((signal) => signal.aborted)).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    loads.mockResolvedValueOnce({});
    render(<App />);
    expect(await screen.findByRole("status")).toHaveTextContent("Loading card data");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
