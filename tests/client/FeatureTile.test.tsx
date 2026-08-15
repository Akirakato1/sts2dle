// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { FeatureTile, REVEAL_DURATION_MS, REVEAL_STAGGER_MS } from "../../src/client/components/FeatureTile.js";
import { OrbInteractionProvider, type OrbTargetDescriptor } from "../../src/client/components/OrbInteractionContext.js";
import { OrbTray } from "../../src/client/components/OrbTray.js";
import { createDefaultAssistance } from "../../src/client/game/assistance.js";
import { compareFeature, type FeatureResult } from "../../src/shared/comparison.js";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";

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

const targetVector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 1, rarity: "Common",
  target: "AnyEnemy", powers: [], keywords: [],
};

function targetCard(id: string): CardIdentity {
  return {
    id, name: id, hasUpgrade: false, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
    base: targetVector, upgraded: targetVector,
  };
}

function renderTile(
  props: Partial<React.ComponentProps<typeof FeatureTile>> = {},
  onUse = vi.fn(() => ({ accepted: true, announcement: "Orb consumed." })),
) {
  const assistance = createDefaultAssistance();
  const view = render(<OrbInteractionProvider
    assistance={assistance}
    disabled={false}
    onUse={onUse}
    roundKey="round-one"
  >
    <OrbTray assistance={assistance} disabled={false} />
    <FeatureTile
      result={result()}
      cardId="guess-one"
      chronologicalGuessIndex={0}
      revealIndex={0}
      {...props}
    />
  </OrbInteractionProvider>);
  return { onUse, view };
}

describe("FeatureTile", () => {
  test.each([
    ["green", "Ironclad"],
    ["yellow", "Skill"],
    ["red", "Rare"],
  ] as const)("shows the guessed value with a color-independent %s result label", (color, displayValue) => {
    renderTile({ result: result({ color, displayValue }) });

    const tile = screen.getByRole("cell", { name: new RegExp(`Result: ${color}`) });
    expect(tile).toHaveClass(`feature-tile--${color}`);
    expect(tile).toHaveTextContent(displayValue);
  });

  test("shows paired base and upgraded core values", () => {
    renderTile({ result: result({ feature: "mana", displayValue: "2 \u2192 1" }), revealIndex: 1 });
    expect(screen.getByText("2 \u2192 1")).toBeInTheDocument();

  });

  test("shows a friendly target comparison in both the tile and its accessible label", () => {
    renderTile({ result: compareFeature("target", targetCard("guess"), targetCard("answer")), animate: false });

    expect(screen.getByRole("cell", { name: "Target: Single Enemy. Result: green." }))
      .toHaveTextContent("Single Enemy");
  });

  test.each([
    ["powers", "Strength, Dexterity", "Powers: Strength, Dexterity. Result: yellow."],
    ["keywords", "None", "Keywords: None. Result: yellow."],
    ["keywords", "None \u2192 Exhaust", "Keywords: None \u2192 Exhaust. Result: yellow."],
  ] as const)("renders textual %s value %s with its complete accessible label", (feature, displayValue, accessibleName) => {
    renderTile({ result: result({ feature, color: "yellow", displayValue }), revealIndex: 1 });
    const tile = screen.getByRole("cell", { name: accessibleName });

    expect(tile).toHaveTextContent(displayValue);
    expect(tile.querySelector(".feature-tile__value")).toHaveClass(`feature-tile__value--${feature}`);
  });

  test("adds the compact class-value modifier only for Necrobinder", () => {
    renderTile({ result: result({ displayValue: "Necrobinder" }) });
    renderTile({ result: result({ displayValue: "Ironclad" }) });

    expect(screen.getByText("Necrobinder")).toHaveClass("feature-tile__value--cardClass", "feature-tile__value--necrobinder");
    expect(screen.getByText("Ironclad")).toHaveClass("feature-tile__value--cardClass");
    expect(screen.getByText("Ironclad")).not.toHaveClass("feature-tile__value--necrobinder");
  });

  test("sets the reveal index and uses an immediate final surface when animation is disabled", () => {
    renderTile({ revealIndex: 4, animate: false });

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
    renderTile();

    const tile = screen.getByRole("cell");
    expect(tile).not.toHaveClass("feature-tile--revealed");
    act(() => reveal?.(0));
    expect(tile).toHaveClass("feature-tile--revealed");
  });

  test.each([
    ["green", "filter", "Filter", "mana"],
    ["red", "negation", "Negation", "rarity"],
  ] as const)("registers a settled %s tile only for the %s orb", (color, orb, orbLabel, feature) => {
    const onUse = vi.fn((_kind, _target: OrbTargetDescriptor) => ({ accepted: true, announcement: "Orb consumed." }));
    renderTile({
      result: result({ feature, color, displayValue: feature === "mana" ? "2" : "Rare" }),
      animate: false,
      chronologicalGuessIndex: 4,
      cardId: "stable-card",
    }, onUse);

    fireEvent.click(screen.getByRole("button", { name: `${orbLabel} Orb, available` }));
    const target = screen.getByRole("button", { name: new RegExp(`Use ${orbLabel} Orb`) });
    fireEvent.click(target);

    expect(onUse).toHaveBeenCalledWith(orb, {
      kind: "tile",
      guessIndex: 4,
      cardId: "stable-card",
      feature,
      color,
      revealed: true,
    });
  });

  test("exposes yellow and hidden tiles as rejected controls while a Filter Orb is selected", () => {
    let reveal: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      reveal = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const assistance = createDefaultAssistance();
    const view = render(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      onUse={vi.fn(() => ({ accepted: true, announcement: "Orb consumed." }))}
      roundKey="round-one"
    >
      <OrbTray assistance={assistance} disabled={false} />
      <FeatureTile result={result({ color: "yellow" })} cardId="yellow" chronologicalGuessIndex={0} revealIndex={0} animate={false} />
      <FeatureTile result={result({ color: "green" })} cardId="hidden" chronologicalGuessIndex={1} revealIndex={0} />
    </OrbInteractionProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Filter Orb, available" }));
    const invalidTargets = screen.getAllByRole("button", { name: /Invalid target for Filter Orb/ });
    expect(invalidTargets).toHaveLength(2);
    fireEvent.click(invalidTargets[0]!);
    expect(screen.getByRole("status")).toHaveTextContent("yellow result tile is an invalid target for the Filter Orb");
    expect(screen.getByRole("button", { name: "Filter Orb, available" })).toHaveAttribute("aria-pressed", "true");
    expect(reveal).toBeTypeOf("function");
  });

  test("renders a compact accessible badge outside the visible value", () => {
    const { view } = renderTile({ animate: false, orbBadge: "filter" });

    const badge = screen.getByRole("img", { name: "Filter Orb used here" });
    expect(badge).toHaveClass("feature-tile__orb-badge");
    expect(badge.querySelector('.orb-visual--compact')).toBeInTheDocument();
    expect(view.container.querySelector(".feature-tile__value")?.contains(badge)).toBe(false);
  });
});
