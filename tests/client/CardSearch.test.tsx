// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CardSearch, searchCards } from "../../src/client/components/CardSearch.js";
import type { AssistanceState } from "../../src/client/game/assistance.js";
import type { CardClass, CardIdentity, SpriteMap } from "../../src/shared/domain.js";

afterEach(cleanup);

function card(
  id: string,
  name: string,
  cardClass: CardClass = "Silent",
  duplicateName = false,
  featuresOverride: Partial<CardIdentity["base"]> = {},
): CardIdentity {
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
  };
  const completeFeatures = { ...features, ...featuresOverride };
  return {
    id,
    name,
    duplicateName,
    hasUpgrade: true,
    artUrl: `https://art.example/${id}.png`,
    baseCardUrl: null,
    upgradedCardUrl: null,
    base: completeFeatures,
    upgraded: completeFeatures,
  };
}

const cards = [
  card("scrap", "Scrap", "Silent", false, { mana: 3 }),
  card("apparition", "Apparition", "Neutral", false, { mana: 2 }),
  card("apotheosis", "Apotheosis", "Neutral", false, { mana: 2 }),
  card("anger", "Anger", "Ironclad", false, { rarity: "Rare" }),
];

const filterSource = card("filter-source", "Filter source", "Silent", false, { mana: 2 });
const negationSource = card("negation-source", "Negation source", "Silent", false, { rarity: "Rare" });
const cardsById = new Map([...cards, filterSource, negationSource].map((item) => [item.id, item]));
const assisted: AssistanceState = {
  reveal: null,
  filter: { guessIndex: 0, cardId: filterSource.id, feature: "mana" },
  negation: { guessIndex: 1, cardId: negationSource.id, feature: "rarity" },
  visibility: { neutral: true, green: true, red: true },
};

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
  const view = render(<CardSearch
    cards={cards}
    cardsById={cardsById}
    spriteMap={spriteMap}
    guessedCardIds={new Set()}
    assistance={null}
    roundKey="round-1"
    onVisibilityChange={vi.fn()}
    onSelect={onSelect}
    {...overrides}
  />);
  return { input: screen.getByRole("combobox"), onSelect, view };
}

describe("searchCards", () => {
  test("matches a trimmed prefix case-insensitively and orders matching names alphabetically", () => {
    expect(searchCards(cards, "  A  ", new Set(), assisted, cardsById).map((item) => item.card.name))
      .toEqual(["Anger", "Apotheosis", "Apparition"]);
  });

  test("does not return names that merely contain the query or cards that were already guessed", () => {
    expect(searchCards(cards, "a", new Set(["anger"]), assisted, cardsById).map((item) => item.card.name))
      .toEqual(["Apotheosis", "Apparition"]);
    expect(searchCards(cards, "rap", new Set(), assisted, cardsById)).toEqual([]);
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
        searchCards([first, second], "e", new Set(), null, new Map()).map((item) => item.card.id),
        searchCards([second, first], "e", new Set(), null, new Map()).map((item) => item.card.id),
      ]).toEqual([["a-id", "z-id"], ["a-id", "z-id"]]);
    } finally {
      localeCompare.mockRestore();
    }
  });
});

describe("CardSearch", () => {
  test("composes assisted controls under the input as tray, visibility, then name hint", () => {
    const { view } = renderSearch({
      assistance: assisted,
      assistanceSlot: <section aria-label="Test orb tray">Orb assistance</section>,
      nameHintSlot: <section aria-label="Test name hint">Name hint</section>,
    });

    const search = view.container.querySelector(".card-search")!;
    expect([...search.children].map((child) => child.getAttribute("aria-label") ?? child.tagName)).toEqual([
      "LABEL",
      "INPUT",
      "Test orb tray",
      "Candidate visibility",
      "Test name hint",
    ]);
  });

  test("shows classified visible candidates on empty focus and applies visibility without blocking red guesses", () => {
    const onVisibilityChange = vi.fn();
    const { input, onSelect, view } = renderSearch({ assistance: assisted, onVisibilityChange });

    fireEvent.focus(input);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Angerexcluded by Negation Orb",
      "Apotheosismatches Filter Orb",
      "Apparitionmatches Filter Orb",
      "Scrapunhighlighted candidate",
    ]);
    expect(screen.getAllByRole("option", { name: /matches Filter Orb/ })[0]).toHaveClass("card-search__option--green");
    const red = screen.getByRole("option", { name: /excluded by Negation Orb/ });
    expect(red).toHaveClass("card-search__option--red");
    fireEvent.click(red);
    expect(onSelect).toHaveBeenCalledWith("anger");

    fireEvent.focus(input);

    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));
    expect(onVisibilityChange).toHaveBeenCalledWith("red", false);
    view.rerender(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set()}
      assistance={{ ...assisted, visibility: { ...assisted.visibility, red: false } }}
      roundKey="round-1"
      onVisibilityChange={onVisibilityChange}
      onSelect={onSelect}
    />);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Apotheosismatches Filter Orb",
      "Apparitionmatches Filter Orb",
      "Scrapunhighlighted candidate",
    ]);

  });

  test("narrows only visible categories, keeps guessed cards absent, and reports no visible candidates", () => {
    const onVisibilityChange = vi.fn();
    const { input, view } = renderSearch({ assistance: assisted, guessedCardIds: new Set(["apparition"]), onVisibilityChange });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "a" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Angerexcluded by Negation Orb",
      "Apotheosismatches Filter Orb",
    ]);

    for (const category of ["Neutral", "Green", "Red"]) fireEvent.click(screen.getByRole("checkbox", { name: category }));
    expect(onVisibilityChange).toHaveBeenNthCalledWith(1, "neutral", false);
    expect(onVisibilityChange).toHaveBeenNthCalledWith(2, "green", false);
    expect(onVisibilityChange).toHaveBeenNthCalledWith(3, "red", false);
    input.focus();
    expect(input).toHaveFocus();
    view.rerender(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set(["apparition"])}
      assistance={{ ...assisted, visibility: { neutral: false, green: false, red: false } }}
      roundKey="round-1"
      onVisibilityChange={onVisibilityChange}
      onSelect={vi.fn()}
    />);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No visible candidates");
  });

  test("clears a stale active option when visibility removes it", () => {
    const onSelect = vi.fn();
    const { input, view } = renderSearch({ assistance: assisted, onSelect });

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("apparition"));

    expect(() => view.rerender(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set()}
      assistance={{ ...assisted, visibility: { ...assisted.visibility, green: false } }}
      roundKey="round-1"
      onVisibilityChange={vi.fn()}
      onSelect={onSelect}
    />)).not.toThrow();
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("keeps the candidate list open through a pointer interaction on a visibility label", () => {
    const onVisibilityChange = vi.fn();
    const { input, view } = renderSearch({ assistance: assisted, onVisibilityChange });
    fireEvent.focus(input);
    const redLabel = screen.getByText("Red").closest("label")!;

    fireEvent.pointerDown(redLabel);
    fireEvent.mouseDown(redLabel);
    fireEvent.blur(input);
    fireEvent.click(redLabel);
    expect(onVisibilityChange).toHaveBeenCalledWith("red", false);

    view.rerender(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set()}
      assistance={{ ...assisted, visibility: { ...assisted.visibility, red: false } }}
      roundKey="round-1"
      onVisibilityChange={onVisibilityChange}
      onSelect={vi.fn()}
    />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /excluded by Negation Orb/ })).not.toBeInTheDocument();
  });

  test("omits orb controls and slots in Hardcore mode", () => {
    renderSearch({
      assistance: null,
      assistanceSlot: <p>Orb assistance</p>,
      nameHintSlot: <p>Name hint</p>,
    });

    expect(screen.queryByRole("group", { name: "Candidate visibility" })).not.toBeInTheDocument();
    expect(screen.queryByText("Orb assistance")).not.toBeInTheDocument();
    expect(screen.queryByText("Name hint")).not.toBeInTheDocument();
  });

  test("resets query and menu state for a new round key", () => {
    const { input, onSelect, view } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    view.rerender(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set()}
      assistance={null}
      roundKey="round-2"
      onVisibilityChange={vi.fn()}
      onSelect={onSelect}
    />);

    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("locks search interaction while a guess row is revealing", () => {
    const { input, onSelect } = renderSearch({ disabled: true });

    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "ap" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("opens every candidate for empty or whitespace-only input", () => {
    const { input } = renderSearch();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getAllByRole("option").map((node) => node.textContent)).toEqual([
      "Angerunhighlighted candidate",
      "Apotheosisunhighlighted candidate",
      "Apparitionunhighlighted candidate",
      "Scrapunhighlighted candidate",
    ]);
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getAllByRole("option").map((node) => node.textContent)).toEqual([
      "Angerunhighlighted candidate",
      "Apotheosisunhighlighted candidate",
      "Apparitionunhighlighted candidate",
      "Scrapunhighlighted candidate",
    ]);
  });

  test("renders all prefix matches", () => {
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getAllByRole("option").map((node) => node.textContent)).toEqual(["Apotheosisunhighlighted candidate", "Apparitionunhighlighted candidate"]);
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
    expect(options.map((node) => node.textContent)).toEqual(["EchoIroncladunhighlighted candidate", "EchoSilentunhighlighted candidate"]);
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

  test("scrolls each keyboard-active option into the nearest visible area", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "a" } });
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(options[0]);
    fireEvent.keyDown(input, { key: "End" });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(options.at(-1));
    fireEvent.keyDown(input, { key: "Home" });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(options[0]);
  });

  test("does not scroll stale options after close, empty reset, disable, or unmount", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onSelect = vi.fn();
    const view = render(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set()}
      assistance={null}
      roundKey="round-1"
      onVisibilityChange={vi.fn()}
      onSelect={onSelect}
    />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.change(input, { target: { value: "" } });
    view.rerender(<CardSearch
      cards={cards}
      cardsById={cardsById}
      spriteMap={spriteMap}
      guessedCardIds={new Set()}
      assistance={null}
      roundKey="round-1"
      disabled
      onVisibilityChange={vi.fn()}
      onSelect={onSelect}
    />);
    view.unmount();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
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
