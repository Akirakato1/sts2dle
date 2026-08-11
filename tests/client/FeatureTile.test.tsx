// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { FeatureTile } from "../../src/client/components/FeatureTile.js";
import type { FeatureResult } from "../../src/shared/comparison.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function result(overrides: Partial<FeatureResult> = {}): FeatureResult {
  return {
    feature: "cardClass",
    color: "green",
    displayValue: "Ironclad",
    hint: "none",
    ...overrides,
  };
}

describe("FeatureTile", () => {
  test.each([
    ["green", "Ironclad"],
    ["yellow", "Skill"],
    ["red", "Rare"],
  ] as const)("shows the guessed value with a color-independent %s result label", (color, displayValue) => {
    render(<FeatureTile result={result({ color, displayValue })} revealIndex={0} />);

    const tile = screen.getByRole("cell", { name: new RegExp(`Result: ${color}`) });
    expect(tile).toHaveClass(`feature-tile--${color}`);
    expect(tile).toHaveTextContent(displayValue);
  });

  test("shows paired base and upgraded values while rendering false booleans as a dash", () => {
    const view = render(<FeatureTile result={result({ feature: "mana", displayValue: "2 \u2192 1" })} revealIndex={1} />);
    expect(screen.getByText("2 \u2192 1")).toBeInTheDocument();

    view.rerender(<FeatureTile result={result({ feature: "exhaust", color: "red", displayValue: "false" })} revealIndex={1} />);
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByRole("cell")).toHaveAccessibleName(/Exhaust: -\. Result: red\./);
  });

  test.each([
    ["up", "\u2191", "red"],
    ["down", "\u2193", "yellow"],
    ["dash", "\u2013", "red"],
    ["both", "\u2191\u2193", "red"],
    ["up-dash", "\u2191 \u2013", "red"],
    ["down-dash", "\u2193 \u2013", "yellow"],
  ] as const)("renders the %s mana hint in the tile result color", (hint, symbol, color) => {
    render(<FeatureTile result={result({ feature: "mana", color, displayValue: "2 \u2192 1", hint })} revealIndex={2} />);

    expect(screen.getByText(symbol)).toHaveClass(`feature-tile__hint--${color}`);
    expect(screen.getByRole("cell")).toHaveAccessibleName(new RegExp(`Direction: ${hint.replace("-", " and ")}`));
  });

  test("does not render a mana arrow on a green match even if malformed input contains a hint", () => {
    render(<FeatureTile result={result({ feature: "mana", color: "green", displayValue: "2", hint: "up" })} revealIndex={0} />);

    expect(screen.queryByText("\u2191")).not.toBeInTheDocument();
    expect(screen.getByRole("cell")).not.toHaveAccessibleName(/Direction:/);
  });

  test("sets the reveal index and uses an immediate final surface when animation is disabled", () => {
    render(<FeatureTile result={result()} revealIndex={4} animate={false} />);

    const tile = screen.getByRole("cell");
    expect(tile).toHaveStyle({ "--reveal-index": "4", "--tile-color": "#2f7d4a" });
    expect(tile).toHaveClass("feature-tile--immediate");
  });

  test("changes from the front face to the revealed face on the next animation frame", () => {
    let reveal: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      reveal = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<FeatureTile result={result()} revealIndex={0} />);

    const tile = screen.getByRole("cell");
    expect(tile).not.toHaveClass("feature-tile--revealed");
    act(() => reveal?.(0));
    expect(tile).toHaveClass("feature-tile--revealed");
  });
});
