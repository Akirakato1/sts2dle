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
        "Both base and upgraded features match",
        "Exactly one version matches",
        "Neither version matches",
      ],
      "Keyword icons": ["Absent", "Present", "Gained on upgrade", "Lost on upgrade"],
      "Orbs and filtering": [
        "Reveal Orb: one use on a feature header to reveal the answer's base and upgraded pair.",
        "Filter Orb: one use on a green result to mark matching candidates green.",
        "Negation Orb: one use on a red result to mark impossible candidates red.",
        "Red candidate marking overrides green marking.",
        "Drag an orb, or operate it with click, tap, or keyboard.",
        "Neutral, Green, and Red visibility controls only hide or show candidate rows; accepted answers never change.",
        "Practice Filter Mode checklists: Disable accepts any value; an enabled group with no checks matches no cards.",
        "Ordinary values use OR; keywords and enabled groups use AND. Base and upgraded forms are checked separately, while orbs and category highlights pause.",
      ],
      "Name hints": [
        "After 5 wrong guesses, word-length lines appear.",
        "After 7 wrong guesses, the first word's first letter appears.",
        "Each later wrong guess reveals the next word's first letter, then random unrevealed characters.",
      ],
      "Modes": [
        "Daily: one UTC-date round that restores locally and creates a share result after a win.",
        "Hardcore Daily: a separate daily answer with no orbs or name hints.",
        "Practice: repeatable rounds that restore the current round and reset filters on a new round.",
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
    expect(dialog.querySelectorAll(".keyword-state-icons")).toHaveLength(4);
    const keywordSection = within(dialog).getByRole("heading", { name: "Keyword icons" }).closest("section")!;
    expect(keywordSection.querySelector("ul")).toHaveClass("game-guide__keyword-list");
    const expectedKeywords = [
      { label: "Absent", icons: ["x"] },
      { label: "Present", icons: ["check"] },
      { label: "Gained on upgrade", icons: ["x", "check"] },
      { label: "Lost on upgrade", icons: ["check", "x"] },
    ] as const;
    for (const [index, expected] of expectedKeywords.entries()) {
      const row = keywordSection.querySelectorAll("li")[index]!;
      expect([...row.querySelectorAll("svg[data-icon]")].map((icon) => icon.getAttribute("data-icon")))
        .toEqual(expected.icons);
      expect(row.querySelector(":scope > span:last-child")).toHaveTextContent(expected.label);
    }
    expect(dialog.querySelectorAll(".game-guide__row-icon")).toHaveLength(15);
    expect(dialog).not.toHaveTextContent("Hardcore Practice");
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
