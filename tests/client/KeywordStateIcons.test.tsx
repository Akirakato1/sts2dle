// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { KeywordStateIcons } from "../../src/client/components/KeywordStateIcons.js";

afterEach(cleanup);

function renderIcons(displayValue: "false" | "true" | "false → true" | "true → false") {
  return render(<KeywordStateIcons displayValue={displayValue} />);
}

function iconNames(displayValue: "false" | "true" | "false → true" | "true → false") {
  return Array.from(renderIcons(displayValue).container.querySelectorAll("svg"), (icon) => icon.getAttribute("data-icon"));
}

describe("KeywordStateIcons", () => {
  test("renders decorative state icons for all canonical comparisons", () => {
    expect(renderIcons("false").container.querySelectorAll("svg[data-icon='x']")).toHaveLength(1);
    expect(renderIcons("true").container.querySelectorAll("svg[data-icon='check']")).toHaveLength(1);
    expect(iconNames("false → true")).toEqual(["x", "check"]);
    expect(iconNames("true → false")).toEqual(["check", "x"]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
