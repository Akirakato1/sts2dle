// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "vitest";
import { deriveSearchResults, SearchWorkspace } from "../../src/client/components/SearchWorkspace.js";
import { createDefaultCardFilter } from "../../src/client/game/card-filter.js";
import type { CardIdentity, FeatureVector, SpriteMap } from "../../src/shared/domain.js";

class MemoryStorage implements Storage { readonly values = new Map<string, string>(); get length() { return this.values.size; } clear() { this.values.clear(); } getItem(key: string) { return this.values.get(key) ?? null; } key(index: number) { return [...this.values.keys()][index] ?? null; } removeItem(key: string) { this.values.delete(key); } setItem(key: string, value: string) { this.values.set(key, value); } }
const vector: FeatureVector = { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Common", target: "Self", powers: [], keywords: [] };
const cards: CardIdentity[] = ["Zulu", "Álpha", "Alpha"].map((name, index) => ({ id: `card-${index}`, name, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: vector, upgraded: vector }));
const spriteMap: SpriteMap = { candidate: { url: "/candidate.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/guess.png", width: 1, height: 1, displayScale: 1 }, cards: Object.fromEntries(cards.map((card) => [card.id, { candidate: { x: 0, y: 0, width: 1, height: 1 }, guess: { x: 0, y: 0, width: 1, height: 1 } }])) };
afterEach(cleanup);
describe("SearchWorkspace", () => {
  test("derives stable name/id-sorted NFKC substring matches without a guessed-card input", () => {
    const tiedCards = [
      { ...cards[0]!, id: "z-card", name: "Same" },
      { ...cards[1]!, id: "a-card", name: "Same" },
    ];
    expect(deriveSearchResults(cards, createDefaultCardFilter(), " Ａｌｐｈａ ").map(({ card }) => card.name)).toEqual(["Alpha"]);
    expect(deriveSearchResults(cards, createDefaultCardFilter(), "").map(({ card }) => card.name)).toEqual(["Alpha", "Álpha", "Zulu"]);
    expect(deriveSearchResults(tiedCards, createDefaultCardFilter(), "").map(({ card }) => card.id)).toEqual(["a-card", "z-card"]);
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} />); expect(screen.queryByRole("combobox", { name: /Guess a card/i })).not.toBeInTheDocument(); expect(screen.getAllByRole("button", { name: /Preview/ })).toHaveLength(cards.length);
  });
  test("narrows by name and keeps an empty result list beside the no-results status", () => {
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} />); fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), { target: { value: "zul" } }); expect(screen.getAllByRole("button", { name: /Preview/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("group", { name: "Class" }).getElementsByTagName("input")[0]!); expect(screen.getByRole("status")).toHaveTextContent("No cards match these filters."); expect(screen.getByRole("list", { name: "Search results" })).toBeEmptyDOMElement();
  });
  test("persists selected filters but resets query and nonzero list scroll across remount", () => {
    const storage = new MemoryStorage(); const first = render(<SearchWorkspace cards={cards} spriteMap={spriteMap} storage={storage} />); const classGroup = screen.getByRole("group", { name: "Class" }); fireEvent.click(classGroup.getElementsByTagName("input")[0]!); fireEvent.click(classGroup.getElementsByTagName("input")[1]!); const list = screen.getByRole("list", { name: "Search results" }); list.scrollTop = 48; expect(list.scrollTop).toBe(48); fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), { target: { value: "zul" } }); first.unmount();
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} storage={storage} />); const restoredClass = screen.getByRole("group", { name: "Class" }); expect(restoredClass.getElementsByTagName("input")[0]).not.toBeChecked(); expect(restoredClass.getElementsByTagName("input")[1]).toBeChecked(); expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue(""); expect(screen.getByRole("list", { name: "Search results" }).scrollTop).toBe(0);
  });
});
