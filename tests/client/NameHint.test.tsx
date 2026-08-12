// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { NameHint } from "../../src/client/components/NameHint.js";
import type { NameHintView } from "../../src/client/game/name-hints.js";

afterEach(cleanup);

describe("NameHint", () => {
  test("renders one proportional continuous underline per space-separated Unicode word", () => {
    const hint: NameHintView = {
      words: [
        {
          length: 2,
          characters: [
            { value: "A", position: 0, revealed: true },
            { value: "!", position: 1, revealed: false },
          ],
        },
        {
          length: 2,
          characters: [
            { value: "B", position: 0, revealed: false },
            { value: "🌟", position: 1, revealed: true },
          ],
        },
      ],
      complete: false,
    };

    const view = render(<NameHint hint={hint} cardName={"A! B🌟"} />);

    expect(screen.getByLabelText("Card name hint: A blank; blank 🌟")).toBeVisible();
    const words = view.container.querySelectorAll(".name-hint__word");
    expect(words).toHaveLength(2);
    expect(Array.from(words, (word) => word.getAttribute("style"))).toEqual([
      "--hint-length: 2;",
      "--hint-length: 2;",
    ]);
    expect(view.container.querySelectorAll(".name-hint__line")).toHaveLength(2);
    expect(view.container.querySelectorAll(".name-hint__character")).toHaveLength(4);
    expect(view.container.querySelectorAll(".name-hint__character--hidden")).toHaveLength(2);
    expect(Array.from(view.container.querySelectorAll(".name-hint__character--hidden"), (cell) => cell.textContent)).toEqual(["", ""]);
    expect(view.container.querySelector(".name-hint")?.textContent).toBe("A🌟");
    expect(view.container.querySelector(".name-hint")?.textContent).not.toContain("!");
  });

  test("renders nothing before the progressive hint begins", () => {
    const { container } = render(<NameHint hint={null} cardName="Secret Name" />);
    expect(container).toBeEmptyDOMElement();
  });
});
