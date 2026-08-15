// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { GuessGridOverflowFrame } from "../../src/client/components/GuessGridOverflowFrame.js";

interface Geometry {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
}

const resizeObservers: FakeResizeObserver[] = [];

class FakeResizeObserver implements ResizeObserver {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  trigger(): void {
    this.callback([], this);
  }
}

function renderFrame({
  geometry,
  reducedMotion = false,
  resetKey = "round-1",
}: {
  geometry: Geometry;
  reducedMotion?: boolean;
  resetKey?: string;
}) {
  const scrollBy = vi.fn();
  const view = render(<GuessGridOverflowFrame resetKey={resetKey} reducedMotion={reducedMotion}>
    <div className="guess-grid">grid contents</div>
  </GuessGridOverflowFrame>);
  const scroller = view.container.querySelector<HTMLElement>(".guess-grid-scroll")!;
  const grid = view.container.querySelector<HTMLElement>(".guess-grid")!;

  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, get: () => geometry.clientWidth },
    scrollWidth: { configurable: true, get: () => geometry.scrollWidth },
    scrollLeft: {
      configurable: true,
      get: () => geometry.scrollLeft,
      set: (value: number) => { geometry.scrollLeft = value; },
    },
    scrollBy: { configurable: true, value: scrollBy },
  });

  act(() => resizeObservers.at(-1)!.trigger());
  return { ...view, grid, scroller, scrollBy };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resizeObservers.length = 0;
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

describe("GuessGridOverflowFrame", () => {
  test("shows no overflow affordances when the complete grid fits", () => {
    renderFrame({ geometry: { clientWidth: 695, scrollWidth: 695, scrollLeft: 0 } });

    expect(screen.queryByText("Swipe or scroll for more columns")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Scroll guesses/ })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".guess-grid-overflow__fade")).toHaveLength(0);
  });

  test("shows the one-time hint and only rightward affordances at the starting edge", () => {
    renderFrame({ geometry: { clientWidth: 390, scrollWidth: 695, scrollLeft: 0 } });

    expect(screen.getByText("Swipe or scroll for more columns")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scroll guesses left" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll guesses right" })).toHaveClass("guess-grid-overflow__control");
    expect(document.querySelector(".guess-grid-overflow__fade--left")).not.toBeInTheDocument();
    expect(document.querySelector(".guess-grid-overflow__fade--right")).toBeInTheDocument();
  });

  test("a real horizontal scroll retires the hint and exposes both directions", () => {
    const geometry = { clientWidth: 390, scrollWidth: 695, scrollLeft: 0 };
    const { scroller } = renderFrame({ geometry });

    geometry.scrollLeft = 86;
    fireEvent.scroll(scroller);

    expect(screen.queryByText("Swipe or scroll for more columns")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll guesses left" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll guesses right" })).toBeInTheDocument();
    expect(document.querySelector(".guess-grid-overflow__fade--left")).toBeInTheDocument();
    expect(document.querySelector(".guess-grid-overflow__fade--right")).toBeInTheDocument();
  });

  test("shows only the leftward affordances at the ending edge", () => {
    renderFrame({ geometry: { clientWidth: 390, scrollWidth: 695, scrollLeft: 305 } });

    expect(screen.getByRole("button", { name: "Scroll guesses left" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scroll guesses right" })).not.toBeInTheDocument();
    expect(document.querySelector(".guess-grid-overflow__fade--left")).toBeInTheDocument();
    expect(document.querySelector(".guess-grid-overflow__fade--right")).not.toBeInTheDocument();
  });

  test("restores the overflow hint once when the round key changes", () => {
    const geometry = { clientWidth: 390, scrollWidth: 695, scrollLeft: 0 };
    const view = renderFrame({ geometry });
    geometry.scrollLeft = 86;
    fireEvent.scroll(view.scroller);
    expect(screen.queryByText("Swipe or scroll for more columns")).not.toBeInTheDocument();

    view.rerender(<GuessGridOverflowFrame resetKey="round-2" reducedMotion={false}>
      <div className="guess-grid">grid contents</div>
    </GuessGridOverflowFrame>);

    expect(screen.getByText("Swipe or scroll for more columns")).toBeInTheDocument();
  });

  test("observes both the scroller and grid content and recomputes after resize", () => {
    const geometry = { clientWidth: 695, scrollWidth: 695, scrollLeft: 0 };
    const { grid, scroller } = renderFrame({ geometry });
    const observer = resizeObservers.at(-1)!;
    expect(observer.observe).toHaveBeenCalledWith(scroller);
    expect(observer.observe).toHaveBeenCalledWith(grid);
    expect(screen.queryByRole("button", { name: "Scroll guesses right" })).not.toBeInTheDocument();

    geometry.clientWidth = 390;
    act(() => observer.trigger());

    expect(screen.getByRole("button", { name: "Scroll guesses right" })).toBeInTheDocument();
  });

  test("advances exactly one feature column with smooth accessible controls", () => {
    const geometry = { clientWidth: 390, scrollWidth: 695, scrollLeft: 86 };
    const { scrollBy } = renderFrame({ geometry });
    const left = screen.getByRole("button", { name: "Scroll guesses left" });
    const right = screen.getByRole("button", { name: "Scroll guesses right" });

    expect(left).toHaveClass("guess-grid-overflow__control");
    expect(right).toHaveClass("guess-grid-overflow__control");
    fireEvent.click(right);
    fireEvent.click(left);

    expect(scrollBy).toHaveBeenNthCalledWith(1, { left: 88, behavior: "smooth" });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { left: -88, behavior: "smooth" });
  });

  test("uses immediate scrolling when reduced motion is requested", () => {
    const { scrollBy } = renderFrame({
      geometry: { clientWidth: 390, scrollWidth: 695, scrollLeft: 0 },
      reducedMotion: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Scroll guesses right" }));

    expect(scrollBy).toHaveBeenCalledWith({ left: 88, behavior: "auto" });
    expect(screen.queryByText("Swipe or scroll for more columns")).not.toBeInTheDocument();
  });
});
