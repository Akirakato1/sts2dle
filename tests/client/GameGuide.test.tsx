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

    expect(trigger).toHaveAttribute("aria-label", "How to play");
    expect(trigger).toHaveTextContent(/^$/);
    expect(trigger.querySelector(".game-guide__trigger-art[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "How to play" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const expectedRows = {
      "Basics": [
        "Guess a base card name.",
        "Compare the guess's base and upgraded versions with the answer's corresponding versions.",
        "Cards with an identical complete paired feature set are accepted as equivalent answers.",
      ],
      "Result colors": [
        "Both corresponding forms match exactly",
        "One corresponding form is exact, or a set has corresponding overlap",
        "Neither scalar form matches; sets have no corresponding overlap",
      ],
      "Set features": [
        "Powers and Keywords are sets. Exact sets match green. Any corresponding overlap is yellow. No overlap is red.",
      ],
      "Orbs and filtering": [
        "Reveal Orb: one use on a feature header to reveal the answer's base and upgraded pair.",
        "Filter Orb: one use on a green result to mark matching candidates green.",
        "Negation Orb: one use on a red result to mark impossible candidates red.",
        "Red candidate marking overrides green marking.",
        "Drag an orb, or operate it with click, tap, or keyboard.",
        "Neutral, Green, and Red visibility controls only hide or show candidate rows; accepted answers never change.",
      ],
      "Search": [
        "Search filters all snapshot cards and is not a game round.",
        "Disable accepts any value; an enabled empty group matches no cards.",
        "Scalar choices use OR, Powers and Keywords use AND, and groups combine with AND.",
        "Base and upgraded forms are checked separately; None matches an empty set.",
        "Open a result to compare its Base and Upgraded cards.",
      ],
      "Name hints": [
        "After 5 wrong guesses, word-length lines appear.",
        "After 7 wrong guesses, the first word's first letter appears.",
        "Each later wrong guess reveals the next word's first letter, then random unrevealed characters.",
      ],
      "Modes": [
        "Daily: one UTC-date round that restores locally and creates a share result after a win.",
        "Hardcore Daily: no candidate list, orbs, or progressive name hints; enter a complete card name from memory (punctuation, case, and spacing ignored).",
        "Practice: repeatable assisted rounds; choose Hardcore Practice before play for assistance-free memory entry. The choice persists across reloads and new rounds, and locks after the first guess or orb.",
        "End game forfeits the current Practice round.",
      ],
    } as const;
    for (const [heading, rows] of Object.entries(expectedRows)) {
      const section = within(dialog).getByRole("heading", { name: heading }).closest("section")!;
      expect(section).toBeVisible();
      const listItems = [...section.querySelectorAll("li")];
      expect(listItems.map((item) => {
        const copy = item.cloneNode(true) as HTMLElement;
        for (const icon of copy.querySelectorAll("[aria-hidden='true']")) icon.remove();
        return copy.textContent?.replace(/\s+/g, " ").trim();
      })).toEqual(rows);
      for (const item of listItems) expect(item.querySelector("[aria-hidden='true']")).not.toBeNull();
    }
    expect(dialog.querySelectorAll(".result-legend__swatch[aria-hidden='true']")).toHaveLength(3);
    expect(dialog.querySelectorAll("svg[data-orb-kind]")).toHaveLength(3);
    expect(dialog.querySelectorAll(".game-guide__row-icon")).toHaveLength(19);
    expect(dialog).not.toHaveTextContent("Practice Filter Mode");
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

  test("prevents forward and reverse Tab from escaping the close-button-only dialog", async () => {
    render(<GameGuide />);
    const trigger = screen.getByRole("button", { name: "How to play" });

    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Close help" });
    expect(close).toHaveFocus();

    const forwardTab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    document.dispatchEvent(forwardTab);
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(close).toHaveFocus();

    const reverseTab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true });
    document.dispatchEvent(reverseTab);
    expect(reverseTab.defaultPrevented).toBe(true);
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
