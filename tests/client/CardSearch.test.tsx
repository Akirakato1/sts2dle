// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CardSearch, searchCards } from "../../src/client/components/CardSearch.js";
import type { CardClass, CardIdentity, SpriteMap } from "../../src/shared/domain.js";

afterEach(cleanup);

function card(id: string, name: string, cardClass: CardClass = "Silent", duplicateName = false): CardIdentity {
  const features = {
    cardClass,
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
  return {
    id,
    name,
    duplicateName,
    hasUpgrade: true,
    artUrl: `https://art.example/${id}.png`,
    baseCardUrl: null,
    upgradedCardUrl: null,
    base: features,
    upgraded: features,
  };
}

const cards = [
  card("scrap", "Scrap"),
  card("apparition", "Apparition", "Neutral"),
  card("apotheosis", "Apotheosis", "Neutral"),
  card("anger", "Anger", "Ironclad"),
];

const spriteMap: SpriteMap = {
  candidate: { url: "/runtime/candidates.webp", width: 256, height: 64, displayScale: 0.5 },
  guess: { url: "/runtime/guesses.webp", width: 640, height: 160, displayScale: 0.5 },
  cards: Object.fromEntries(cards.map((item, index) => [item.id, {
    candidate: { x: index * 64, y: 0, width: 64, height: 64 },
    guess: { x: index * 160, y: 0, width: 160, height: 160 },
  }])),
};

function renderSearch(overrides: Partial<React.ComponentProps<typeof CardSearch>> = {}) {
  const onSelect = vi.fn();
  render(<CardSearch cards={cards} spriteMap={spriteMap} guessedCardIds={new Set()} onSelect={onSelect} {...overrides} />);
  return { input: screen.getByRole("combobox"), onSelect };
}

describe("searchCards", () => {
  test("matches a trimmed prefix case-insensitively and orders matching names alphabetically", () => {
    expect(searchCards(cards, "  A  ", new Set()).map((item) => item.name))
      .toEqual(["Anger", "Apotheosis", "Apparition"]);
  });

  test("does not return names that merely contain the query or cards that were already guessed", () => {
    expect(searchCards(cards, "a", new Set(["anger"])).map((item) => item.name))
      .toEqual(["Apotheosis", "Apparition"]);
    expect(searchCards(cards, "rap", new Set())).toEqual([]);
  });

  test("uses a locale-independent card-ID tie-break for duplicate names in every input order", () => {
    const originalLocaleCompare = String.prototype.localeCompare;
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (
      this: string,
      that: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      if (locales === undefined) return originalLocaleCompare.call(that, this);
      return originalLocaleCompare.call(this, that, locales, options);
    });
    const first = card("z-id", "Echo");
    const second = card("a-id", "Echo");
    try {
      expect([
        searchCards([first, second], "e", new Set()).map((item) => item.id),
        searchCards([second, first], "e", new Set()).map((item) => item.id),
      ]).toEqual([["a-id", "z-id"], ["a-id", "z-id"]]);
    } finally {
      localeCompare.mockRestore();
    }
  });
});

describe("CardSearch", () => {
  test("keeps the listbox closed for empty or whitespace-only input", () => {
    const { input } = renderSearch();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("renders all prefix matches", () => {
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getAllByRole("option").map((node) => node.textContent)).toEqual(["Apotheosis", "Apparition"]);
    expect(screen.queryByText("Scrap")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Apotheosis artwork" })).toHaveStyle({ width: "32px", height: "32px" });
  });

  test("uses class labels to disambiguate duplicate names while keeping card IDs distinct", () => {
    const duplicateCards = [
      card("echo-ironclad", "Echo", "Ironclad", true),
      card("echo-silent", "Echo", "Silent", true),
    ];
    const duplicateSprite = { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } };
    const duplicateMap: SpriteMap = { ...spriteMap, cards: { "echo-ironclad": duplicateSprite, "echo-silent": duplicateSprite } };
    const { input, onSelect } = renderSearch({ cards: duplicateCards, spriteMap: duplicateMap });
    fireEvent.change(input, { target: { value: "echo" } });
    const options = screen.getAllByRole("option");
    expect(options.map((node) => node.textContent)).toEqual(["EchoIronclad", "EchoSilent"]);
    fireEvent.click(options[1]!);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("echo-silent");
  });

  test("ArrowDown and ArrowUp move the active descendant through the options", () => {
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "a" } });
    const options = screen.getAllByRole("option");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
  });

  test("Home and End move to list boundaries and Enter selects the active boundary option", () => {
    const { input, onSelect } = renderSearch();
    fireEvent.change(input, { target: { value: "a" } });
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute("aria-activedescendant", options.at(-1)!.id);
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Home" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("apparition");
  });

  test("Home and End leave empty or explicitly closed listboxes closed", () => {
    const { input } = renderSearch();
    fireEvent.keyDown(input, { key: "Home" });
    fireEvent.keyDown(input, { key: "End" });
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("Enter selects the active card exactly once and clears the menu", () => {
    const { input, onSelect } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("apotheosis");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("click selects one card even when the input receives a pointer-driven blur", () => {
    const { input, onSelect } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    const option = screen.getAllByRole("option")[1]!;
    fireEvent.pointerDown(option);
    fireEvent.blur(input);
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("apparition");
  });

  test("a pointer selection does not cause the next genuine blur to be ignored or submit twice", () => {
    const { input, onSelect } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    const option = screen.getAllByRole("option")[0]!;
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledOnce();

    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  test("Escape closes the menu without selecting a card", () => {
    const { input, onSelect } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
