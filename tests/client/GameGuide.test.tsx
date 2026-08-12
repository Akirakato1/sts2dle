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
  });
});
