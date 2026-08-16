// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { deriveSearchResults, SearchWorkspace } from "../../src/client/components/SearchWorkspace.js";
import { SEARCH_FILTER_HELP_DISMISSED_KEY } from "../../src/client/components/SearchFilterPanel.js";
import { createDefaultCardFilter } from "../../src/client/game/card-filter.js";
import { preloadCardPreview } from "../../src/client/game/preload-card-preview.js";
import { loadSearchPreferences, saveSearchPreferences } from "../../src/client/game/search-storage.js";
import type { CardIdentity, FeatureVector, SpriteMap } from "../../src/shared/domain.js";

vi.mock("../../src/client/game/preload-card-preview.js", () => ({ preloadCardPreview: vi.fn() }));

class MemoryStorage implements Storage { readonly values = new Map<string, string>(); get length() { return this.values.size; } clear() { this.values.clear(); } getItem(key: string) { return this.values.get(key) ?? null; } key(index: number) { return [...this.values.keys()][index] ?? null; } removeItem(key: string) { this.values.delete(key); } setItem(key: string, value: string) { this.values.set(key, value); } }
const vector: FeatureVector = { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Common", target: "Self", powers: [], keywords: [] };
const cards: CardIdentity[] = ["Zulu", "Álpha", "Alpha"].map((name, index) => ({ id: `card-${index}`, name, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: vector, upgraded: vector }));
const spriteMap: SpriteMap = { candidate: { url: "/candidate.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/guess.png", width: 1, height: 1, displayScale: 1 }, cards: Object.fromEntries(cards.map((card) => [card.id, { candidate: { x: 0, y: 0, width: 1, height: 1 }, guess: { x: 0, y: 0, width: 1, height: 1 } }])) };
function passThroughFilter() { const filter = createDefaultCardFilter(); for (const group of Object.values(filter)) group.disabled = true; return filter; }
function seed(storage: Storage, collapsed = false) { saveSearchPreferences(storage, { filter: passThroughFilter(), collapsed }); }
afterEach(cleanup);
describe("SearchWorkspace", () => {
  test("renders query, filters, and results in the approved DOM order", () => {
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} />);
    const workspace = screen.getByRole("region", { name: "Card search workspace" });
    const query = screen.getByRole("searchbox", { name: "Search cards" }).closest("label")!;
    const filters = screen.getByRole("region", { name: "Search filters" });
    const results = screen.getByRole("list", { name: "Search results" });

    expect(workspace).toContainElement(query);
    expect(query.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filters.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("derives stable name/id-sorted NFKC substring matches without a guessed-card input", () => {
    const tiedCards = [
      { ...cards[0]!, id: "z-card", name: "Same" },
      { ...cards[1]!, id: "a-card", name: "Same" },
    ];
    expect(deriveSearchResults(cards, passThroughFilter(), " Ａｌｐｈａ ").map(({ card }) => card.name)).toEqual(["Alpha"]);
    expect(deriveSearchResults(cards, passThroughFilter(), "").map(({ card }) => card.name)).toEqual(["Alpha", "Álpha", "Zulu"]);
    expect(deriveSearchResults(tiedCards, passThroughFilter(), "").map(({ card }) => card.id)).toEqual(["a-card", "z-card"]);
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} />); expect(screen.queryByRole("combobox", { name: /Guess a card/i })).not.toBeInTheDocument(); expect(screen.queryAllByRole("button", { name: /Preview/ })).toHaveLength(0); expect(screen.getByRole("status")).toHaveTextContent("No cards match these filters.");
  });
  test("narrows by name and keeps an empty result list beside the no-results status", () => {
    const storage = new MemoryStorage(); seed(storage);
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} storage={storage} />); fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), { target: { value: "zul" } }); expect(screen.getAllByRole("button", { name: /Preview/ })).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), { target: { value: "missing" } }); expect(screen.getByRole("status")).toHaveTextContent("No cards match these filters."); expect(screen.getByRole("list", { name: "Search results" })).toBeEmptyDOMElement();
  });
  test("persists collapse and filters, resets query on remount, and resets filters without clearing query", () => {
    const storage = new MemoryStorage(); seed(storage); const first = render(<SearchWorkspace cards={cards} spriteMap={spriteMap} storage={storage} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), { target: { value: "zul" } });
    fireEvent.click(screen.getByRole("button", { name: "Collapse filters" }));
    expect(screen.getByRole("button", { name: "Expand filters" })).toBeVisible(); first.unmount();

    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} storage={storage} />);
    expect(screen.getByRole("button", { name: "Expand filters" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Expand filters" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), { target: { value: "zul" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("zul");
    expect(screen.queryAllByRole("button", { name: /Preview/ })).toHaveLength(0);
    expect(screen.getAllByRole("group").flatMap((group) => [...group.getElementsByTagName("input")]).every((input) => !input.checked)).toBe(true);
    expect(loadSearchPreferences(storage, { cardClass: ["Silent"], cardType: ["Skill"], mana: [1], rarity: ["Common"], target: ["Self"], powers: [], keywords: [] })).toEqual({ filter: createDefaultCardFilter(), collapsed: false });
  });
  test("warms a result on hover or focus and opens an inert-background preview that returns focus on close", async () => {
    window.localStorage.setItem(SEARCH_FILTER_HELP_DISMISSED_KEY, "1");
    const storage = new MemoryStorage(); seed(storage);
    render(<SearchWorkspace cards={cards} spriteMap={spriteMap} storage={storage} />);
    const result = screen.getByRole("button", { name: "Preview Zulu" });

    fireEvent.pointerEnter(result);
    fireEvent.focus(result);
    expect(preloadCardPreview).toHaveBeenCalledWith(cards[0]);

    fireEvent.click(result);
    expect(screen.getByRole("dialog", { name: "Preview Zulu" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Card search workspace" })).toHaveAttribute("inert", "");

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog", { name: "Preview Zulu" })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(result).toHaveFocus();
  });
});
