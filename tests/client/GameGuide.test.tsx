// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { GameGuide } from "../../src/client/components/GameGuide.js";

afterEach(cleanup);

describe("GameGuide", () => {
  test("explains all result colors and keeps rules collapsed until requested", () => {
    const view = render(<GameGuide />);

    expect(screen.getByText("Both base and upgraded features match")).toBeVisible();
    expect(screen.getByText("Exactly one version matches")).toBeVisible();
    expect(screen.getByText("Neither version matches")).toBeVisible();
    expect(view.container.querySelectorAll(".result-legend__swatch[aria-hidden='true']")).toHaveLength(3);

    const disclosure = screen.getByText("How to play").closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("How to play"));
    expect(disclosure).toHaveAttribute("open");
    expect(disclosure).toHaveTextContent(/Guess a base card name/i);
    expect(disclosure).toHaveTextContent(/base-to-base/i);
    expect(disclosure).toHaveTextContent(/upgraded-to-upgraded/i);
    expect(disclosure).toHaveTextContent(/X.*keyword absent/i);
    expect(disclosure).toHaveTextContent(/checkmark.*keyword present/i);
    expect(disclosure).toHaveTextContent(/identical complete paired feature sets.*equivalent answers/i);
    expect(disclosure).toHaveTextContent(/UTC date.*restores your progress.*share result after a win/i);
    expect(disclosure).toHaveTextContent(/Practice.*unlimited random rounds.*no share result/i);
    expect(disclosure).toHaveTextContent(/each orb.*one.use.*permanently consumed.*round/i);
    expect(disclosure).toHaveTextContent(/drag.*click.*tap.*keyboard/i);
    expect(disclosure).toHaveTextContent(/Reveal.*header.*full base.*upgraded pair/i);
    expect(disclosure).toHaveTextContent(/Filter.*green.*exact pair/i);
    expect(disclosure).toHaveTextContent(/Negation.*red.*exclude.*red.*priority/i);
    expect(disclosure).toHaveTextContent(/badges.*persist/i);
    expect(disclosure).toHaveTextContent(/colored candidates.*guessable/i);
    expect(disclosure).toHaveTextContent(/category checkboxes.*only hide.*list rows/i);
    expect(disclosure).toHaveTextContent(/candidate controls.*advisory/i);
    expect(disclosure).toHaveTextContent(/empty.*focus.*candidate list/i);
    expect(disclosure).toHaveTextContent("The name-hint mask uses the deterministically selected answer name. Equivalent answers with the same complete paired-feature set remain accepted.");
    expect(disclosure).toHaveTextContent("After five wrong guesses, the selected answer name appears as blank continuous word boxes.");
    expect(disclosure).toHaveTextContent("After six wrong guesses, the mask is unchanged.");
    expect(disclosure).toHaveTextContent("At seven wrong guesses, the first character of the first word appears.");
    expect(disclosure).toHaveTextContent("Each subsequent wrong guess reveals the first character of one later word until all word initials are shown.");
    expect(disclosure).toHaveTextContent("After that, each wrong guess reveals exactly one deterministic seeded unrevealed Unicode code-point position until none remain.");
    expect(disclosure).toHaveTextContent(/Hardcore Daily.*separate.*no orbs.*name hints/i);
    expect(disclosure).toHaveTextContent(/Practice.*locked.*first guess or orb/i);
    expect(disclosure).toHaveTextContent("The current Practice round persists locally in this browser.");
    expect(disclosure).toHaveTextContent(/End game.*forfeit.*New Practice Round/i);
    expect(disclosure).toHaveTextContent("After a win or forfeit, the terminal toggle selects the setting used when New Practice Round is activated, is saved locally across reloads, and does not mutate the completed round.");
  });
});
