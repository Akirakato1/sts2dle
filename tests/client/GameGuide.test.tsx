// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { GameGuide } from "../../src/client/components/GameGuide.js";

afterEach(cleanup);

describe("GameGuide", () => {
  test("opens a sectioned help modal with the compact visual legends", () => {
    const view = render(<GameGuide />);
    const trigger = screen.getByRole("button", { name: "How to play" });

    expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "How to play" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const heading of ["Basics", "Result colors", "Keyword icons", "Orbs and filtering", "Name hints", "Modes"]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(within(dialog).getByText("Both base and upgraded features match")).toBeVisible();
    expect(within(dialog).getByText("Exactly one version matches")).toBeVisible();
    expect(within(dialog).getByText("Neither version matches")).toBeVisible();
    expect(dialog.querySelectorAll(".result-legend__swatch[aria-hidden='true']")).toHaveLength(3);
    expect(dialog.querySelectorAll("svg[data-orb-kind]")).toHaveLength(3);
    expect(dialog.querySelectorAll(".keyword-state-icons")).toHaveLength(4);
    expect(view.container.querySelector("details")).toBeNull();
  });

  test("closes with its close button and returns focus to the trigger", async () => {
    render(<GameGuide />);
    const trigger = screen.getByRole("button", { name: "How to play" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));

    expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("focuses the close button, wraps Tab, and closes with Escape", async () => {
    render(<GameGuide />);
    const trigger = screen.getByRole("button", { name: "How to play" });

    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Close help" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("closes only when the backdrop itself is clicked", () => {
    const view = render(<GameGuide />);
    const trigger = screen.getByRole("button", { name: "How to play" });

    fireEvent.click(trigger);
    const backdrop = view.container.querySelector(".game-guide__backdrop")!;
    fireEvent.click(screen.getByRole("dialog", { name: "How to play" }));
    expect(screen.getByRole("dialog", { name: "How to play" })).toBeVisible();
    fireEvent.click(backdrop);

    expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();
  });
});
