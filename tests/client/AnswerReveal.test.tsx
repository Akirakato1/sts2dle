// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { AnswerReveal } from "../../src/client/components/AnswerReveal.js";
import type { CardIdentity } from "../../src/shared/domain.js";

afterEach(cleanup);

const features = {
  cardClass: "Neutral" as const,
  cardType: "Skill" as const,
  mana: 1,
  rarity: "Common" as const,
  eternal: false,
  ethereal: false,
  exhaust: false,
  innate: false,
  retain: false,
  sly: false,
  unplayable: false,
};

function card(id: string, name: string, hasUpgrade = true): CardIdentity {
  return {
    id,
    name,
    hasUpgrade,
    artUrl: `https://art.example/${id}.png`,
    baseCardUrl: `https://cards.example/${id}.png`,
    upgradedCardUrl: hasUpgrade ? `https://cards.example/${id}-upgraded.png` : null,
    base: features,
    upgraded: features,
  };
}

describe("AnswerReveal", () => {
  test("reveals every accepted identity alphabetically using full-card URLs", () => {
    const cards = [card("zeta", "Zeta"), card("alpha", "Alpha", false), card("middle", "Middle")];
    const cardsById = new Map(cards.map((item) => [item.id, item]));
    const { container } = render(<AnswerReveal
      answer={{ baseGroupKey: "base", selectedCardId: "zeta", pairKey: "pair", acceptedCardIds: ["zeta", "middle", "alpha"] }}
      cardsById={cardsById}
    />);

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Alpha",
      "Middle",
      "Zeta",
    ]);
    expect(Array.from(container.querySelectorAll("img"), (image) => image.getAttribute("src"))).toEqual([
      "https://cards.example/alpha.png",
      "https://cards.example/middle.png",
      "https://cards.example/middle-upgraded.png",
      "https://cards.example/zeta.png",
      "https://cards.example/zeta-upgraded.png",
    ]);
    expect(container.querySelector(".answer-reveal__cards")).toHaveClass("answer-reveal__cards");
  });

  test("keeps the answer name and other accepted answers when one image fails, then retries it", () => {
    const failed = card("failed", "Failed Card", false);
    const healthy = card("healthy", "Healthy Card", false);
    const { container } = render(<AnswerReveal
      answer={{ baseGroupKey: "base", selectedCardId: "failed", pairKey: "pair", acceptedCardIds: ["failed", "healthy"] }}
      cardsById={new Map([[failed.id, failed], [healthy.id, healthy]])}
    />);

    fireEvent.error(screen.getByRole("img", { name: "Failed Card base card" }));
    expect(screen.getByRole("heading", { name: "Failed Card" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Healthy Card" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Healthy Card base card" })).toBeInTheDocument();
    expect(screen.getByText("Failed Card image could not be loaded.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry Failed Card base image" }));
    const retried = screen.getByRole("img", { name: "Failed Card base card" });
    expect(retried).toHaveAttribute("src", "https://cards.example/failed.png");
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });
});
