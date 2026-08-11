// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { SpriteArt } from "../../src/client/components/SpriteArt.js";
import type { SpriteMap } from "../../src/shared/domain.js";

afterEach(cleanup);

const spriteMap: SpriteMap = {
  candidate: { url: "/runtime/candidates.webp", width: 512, height: 256, displayScale: 0.5 },
  guess: { url: "/runtime/guesses.webp", width: 640, height: 480, displayScale: 0.5 },
  cards: {
    apotheosis: {
      candidate: { x: 128, y: 64, width: 64, height: 64 },
      guess: { x: 160, y: 320, width: 160, height: 160 },
    },
  },
};

describe("SpriteArt", () => {
  test("scales candidate dimensions, coordinates, and atlas without creating an image request", () => {
    const { container } = render(<SpriteArt cardId="apotheosis" spriteMap={spriteMap} kind="candidate" label="Apotheosis artwork" />);
    const art = screen.getByRole("img", { name: "Apotheosis artwork" });
    expect(art).toHaveStyle({
      width: "32px",
      height: "32px",
      backgroundPosition: "-64px -32px",
      backgroundSize: "256px 128px",
      backgroundRepeat: "no-repeat",
    });
    expect(art).toHaveStyle({ backgroundImage: "url(/runtime/candidates.webp)" });
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  test("uses the guess atlas and renders 160-pixel source art at 80 pixels", () => {
    render(<SpriteArt cardId="apotheosis" spriteMap={spriteMap} kind="guess" label="Apotheosis guess artwork" />);
    expect(screen.getByRole("img", { name: "Apotheosis guess artwork" })).toHaveStyle({
      width: "80px",
      height: "80px",
      backgroundPosition: "-80px -160px",
      backgroundSize: "320px 240px",
    });
  });

  test("renders a text-only accessible fallback when the card has no sprite entry", () => {
    const { container } = render(<SpriteArt cardId="missing" spriteMap={spriteMap} kind="candidate" label="Missing card artwork" />);
    expect(screen.getByText("Missing card artwork")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
