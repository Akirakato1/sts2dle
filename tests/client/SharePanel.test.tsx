// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SharePanel } from "../../src/client/components/SharePanel.js";
import { FEATURE_ORDER } from "../../src/shared/domain.js";
import type { RoundState } from "../../src/client/game/game-reducer.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const round: RoundState = {
  mode: "daily",
  answer: { baseGroupKey: "base", selectedCardId: "answer", pairKey: "pair", acceptedCardIds: ["answer"] },
  guesses: [{
    cardId: "SECRET_GUESS_ID",
    results: FEATURE_ORDER.map((feature) => ({ feature, color: "green" as const, displayValue: "SECRET_VALUE" })),
  }],
  status: "won",
  error: null,
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("SharePanel", () => {
  test("copies a completed Daily result and announces success", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<SharePanel round={round} utcDate="2026-08-12" siteUrl="https://example.test/daily" onNextRound={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Daily result" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = writeText.mock.calls[0]![0];
    expect(copied).toContain("STS-dle 2026-08-12 1/∞");
    expect(copied).not.toContain("SECRET_GUESS_ID");
    expect(screen.getByRole("status")).toHaveTextContent("Daily result copied");
  });

  test("announces clipboard failure accessibly", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    render(<SharePanel round={round} utcDate="2026-08-12" siteUrl="https://example.test/" onNextRound={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Daily result" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not copy");
  });

  test("does not let an older success overwrite a newer clipboard failure", async () => {
    const first = deferred();
    const second = deferred();
    const writeText = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<SharePanel round={round} utcDate="2026-08-12" siteUrl="https://example.test/" onNextRound={vi.fn()} />);
    const copy = screen.getByRole("button", { name: "Copy Daily result" });

    fireEvent.click(copy);
    fireEvent.click(copy);
    expect(screen.getByRole("status")).toHaveTextContent("Copying Daily result");
    await act(async () => { second.reject(new Error("denied")); });
    expect(screen.getByRole("alert")).toHaveTextContent("could not copy");
    await act(async () => { first.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("could not copy");
    expect(screen.queryByText("Daily result copied.")).not.toBeInTheDocument();
  });

  test("keeps pending state after an older failure and reports the newer success", async () => {
    const first = deferred();
    const second = deferred();
    const writeText = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<SharePanel round={round} utcDate="2026-08-12" siteUrl="https://example.test/" onNextRound={vi.fn()} />);
    const copy = screen.getByRole("button", { name: "Copy Daily result" });

    fireEvent.click(copy);
    fireEvent.click(copy);
    await act(async () => { first.reject(new Error("denied")); });
    expect(screen.getByRole("status")).toHaveTextContent("Copying Daily result");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { second.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent("Daily result copied");
  });

  test("shows only the next-random-card action after a Practice win", () => {
    const onNextRound = vi.fn();
    render(<SharePanel round={{ ...round, mode: "practice" }} utcDate="2026-08-12" siteUrl="https://example.test/" onNextRound={onNextRound} />);
    expect(screen.queryByRole("button", { name: "Copy Daily result" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next random card" }));
    expect(onNextRound).toHaveBeenCalledOnce();
  });

  test("renders no result action while a round is unfinished", () => {
    const { container } = render(<SharePanel round={{ ...round, status: "playing" }} utcDate="2026-08-12" siteUrl="https://example.test/" onNextRound={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
