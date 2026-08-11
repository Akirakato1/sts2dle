// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { CardStack } from "../../src/client/components/CardStack.js";

afterEach(cleanup);

describe("CardStack", () => {
  test("swaps the masked, offset upgrade with the base card by click and Enter", () => {
    const { container } = render(<CardStack
      name="Alchemize"
      baseUrl="https://cdn.example/alchemize.png"
      upgradedUrl="https://cdn.example/alchemize-upgraded.png"
    />);

    const stack = screen.getByRole("button", { name: "Show upgraded Alchemize" });
    const base = screen.getByRole("img", { name: "Alchemize base card" }).parentElement;
    const upgraded = screen.getByRole("img", { name: "Alchemize upgraded card" }).parentElement;
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(base).toHaveClass("card-stack__front");
    expect(base).not.toHaveClass("card-stack__masked");
    expect(upgraded).toHaveClass("card-stack__back", "card-stack__masked");

    fireEvent.click(stack);
    expect(stack).toHaveAccessibleName("Show base Alchemize");
    expect(base).toHaveClass("card-stack__back", "card-stack__masked");
    expect(upgraded).toHaveClass("card-stack__front");
    expect(upgraded).not.toHaveClass("card-stack__masked");

    fireEvent.keyDown(stack, { key: "Enter" });
    expect(stack).toHaveAccessibleName("Show upgraded Alchemize");
    expect(base).toHaveClass("card-stack__front");
    expect(upgraded).toHaveClass("card-stack__back", "card-stack__masked");

    fireEvent.click(stack);
    fireEvent.click(stack);
    expect(stack).toHaveAccessibleName("Show upgraded Alchemize");
  });

  test("renders a non-upgradable card as one static image without button semantics", () => {
    const { container } = render(<CardStack
      name="Apparition"
      baseUrl="https://cdn.example/apparition.png"
      upgradedUrl={null}
    />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Apparition base card" })).toHaveAttribute(
      "src",
      "https://cdn.example/apparition.png",
    );
  });

  test("keeps image retry actions outside the interactive swap button", () => {
    render(<CardStack
      name="Alchemize"
      baseUrl="https://cdn.example/alchemize.png"
      upgradedUrl="https://cdn.example/alchemize-upgraded.png"
    />);
    const swap = screen.getByRole("button", { name: "Show upgraded Alchemize" });
    fireEvent.error(screen.getByRole("img", { name: "Alchemize upgraded card" }));
    const retry = screen.getByRole("button", { name: "Retry Alchemize upgraded image" });
    expect(swap).not.toContainElement(retry);
  });
});
