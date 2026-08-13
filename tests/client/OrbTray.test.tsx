// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  OrbInteractionProvider,
} from "../../src/client/components/OrbInteractionContext.js";
import { OrbTray } from "../../src/client/components/OrbTray.js";
import type { AssistanceState } from "../../src/client/game/assistance.js";

afterEach(cleanup);

const availableAssistance: AssistanceState = {
  reveal: null,
  filter: null,
  negation: null,
  visibility: { neutral: true, green: true, red: true },
};

function renderTray({
  assistance = availableAssistance,
  providerDisabled = false,
  trayDisabled = false,
}: {
  assistance?: AssistanceState;
  providerDisabled?: boolean;
  trayDisabled?: boolean;
} = {}) {
  return render(
    <OrbInteractionProvider
      roundKey="round-one"
      assistance={assistance}
      disabled={providerDisabled}
      onUse={vi.fn(() => ({ accepted: true, announcement: "Orb consumed." }))}
    >
      <OrbTray assistance={assistance} disabled={trayDisabled} />
    </OrbInteractionProvider>,
  );
}

describe("OrbTray", () => {
  test("renders exactly one accessible Reveal, Filter, and Negation slot in that order", () => {
    const view = renderTray();

    const slots = [...view.container.querySelectorAll(".orb-tray__slot")];
    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.querySelector(".orb-tray__label")?.textContent))
      .toEqual(["Reveal", "Filter", "Negation"]);

    for (const label of ["Reveal", "Filter", "Negation"]) {
      const button = screen.getByRole("button", { name: `${label} Orb, available` });
      expect(button).toHaveAttribute("aria-pressed", "false");
    }

    for (const well of view.container.querySelectorAll(".orb-tray__well")) {
      const button = well.querySelector<HTMLButtonElement>(":scope > .orb-button");
      expect(button).not.toBeNull();
      expect(button).not.toHaveAttribute("style");
      expect(button!.querySelector(":scope > .orb-visual")).not.toBeNull();
    }
  });

  test("renders used orbs as grayscale compact remnants without interactive buttons", () => {
    const assistance: AssistanceState = {
      ...availableAssistance,
      reveal: { feature: "mana" },
    };
    const view = renderTray({ assistance });

    expect(screen.queryByRole("button", { name: /Reveal Orb/i })).not.toBeInTheDocument();
    const remnant = screen.getByLabelText("Reveal Orb, used");
    expect(remnant).toHaveClass("orb-remnant");
    expect(remnant.querySelector(".orb-visual--compact")).toBeInTheDocument();
    expect(view.container.querySelectorAll(".orb-remnant")).toHaveLength(1);
  });

  test("disables available buttons from either the provider or tray boundary", () => {
    const providerView = renderTray({ providerDisabled: true });
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeDisabled();
    providerView.unmount();

    renderTray({ trayDisabled: true });
    expect(screen.getByRole("button", { name: "Filter Orb, available" })).toBeDisabled();
  });

  test("selects and cancels an orb with pressed state and a visible selection class", () => {
    renderTray();
    const reveal = screen.getByRole("button", { name: "Reveal Orb, available" });

    fireEvent.click(reveal);
    expect(reveal).toHaveAttribute("aria-pressed", "true");
    expect(reveal).toHaveClass("orb-button--selected");

    fireEvent.click(reveal);
    expect(reveal).toHaveAttribute("aria-pressed", "false");
    expect(reveal).not.toHaveClass("orb-button--selected");
  });

  test("uses original local SVG motifs without image assets or external references", () => {
    const view = renderTray();

    const visuals = [...view.container.querySelectorAll<SVGSVGElement>("svg[data-orb-kind]")];
    expect(visuals.map((visual) => visual.dataset.orbKind))
      .toEqual(["reveal", "filter", "negation"]);
    expect(view.container.querySelector('[data-icon="reveal-eye"]')).toBeVisible();
    expect(view.container.querySelector('[data-icon="filter-funnel"]')).toBeVisible();
    expect(view.container.querySelector('[data-icon="negation-bar"]')).toBeVisible();
    expect(view.container.querySelector("image")).toBeNull();
    expect(view.container.querySelector('[href^="http"], [href^="//"]')).toBeNull();
  });
});
