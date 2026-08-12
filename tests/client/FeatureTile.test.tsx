// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { FeatureTile, REVEAL_DURATION_MS, REVEAL_STAGGER_MS } from "../../src/client/components/FeatureTile.js";
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

  test("shows paired base and upgraded core values", () => {
    render(<FeatureTile result={result({ feature: "mana", displayValue: "2 \u2192 1" })} revealIndex={1} />);
    expect(screen.getByText("2 \u2192 1")).toBeInTheDocument();

  });

  test.each([
    ["false", "absent"],
    ["true", "present"],
    ["false → true", "absent to present"],
    ["true → false", "present to absent"],
  ] as const)("renders keyword state %s without text labels", (displayValue, accessibleValue) => {
    const view = render(<FeatureTile result={result({ feature: "exhaust", color: "red", displayValue })} revealIndex={1} />);
    const tile = screen.getByRole("cell", { name: `Exhaust: ${accessibleValue}. Result: red.` });

    expect(tile).toHaveAccessibleName(`Exhaust: ${accessibleValue}. Result: red.`);
    expect(view.container.textContent).not.toMatch(/Yes|true|false/);
    expect(view.container.querySelector(".feature-tile__result-mark")).toBeNull();
    expect(view.container.querySelector(".feature-tile__hint")).toBeNull();
  });

  test("sets the reveal index and uses an immediate final surface when animation is disabled", () => {
    render(<FeatureTile result={result()} revealIndex={4} animate={false} />);

    const tile = screen.getByRole("cell");
    expect(tile).toHaveStyle({
      "--reveal-index": "4",
      "--tile-color": "#2f7d4a",
      "--reveal-stagger": `${REVEAL_STAGGER_MS}ms`,
      "--reveal-duration": `${REVEAL_DURATION_MS}ms`,
    });
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
