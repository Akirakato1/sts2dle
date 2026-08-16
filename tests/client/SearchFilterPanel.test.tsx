// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SEARCH_FILTER_HELP_DISMISSED_KEY, SearchFilterPanel } from "../../src/client/components/SearchFilterPanel.js";
import { createDefaultCardFilter, KEYWORD_FILTER_NONE, POWER_FILTER_NONE, type CardFilterOptions, type CardFilterState } from "../../src/client/game/card-filter.js";

const nativeLocalStorage = window.localStorage;
const OPTIONS: CardFilterOptions = {
  cardClass: ["Ironclad", "Silent"], cardType: ["Attack", "Skill"], mana: [0, 1, "X", "None"], rarity: ["Common", "Rare"],
  target: ["Self", "AnyEnemy", "AllEnemies", "RandomEnemy", "AnyAlly", "AllAllies", "None"], powers: ["Dexterity", "Strength", POWER_FILTER_NONE], keywords: ["Ethereal", "Innate", KEYWORD_FILTER_NONE],
};
function localStorage(): Storage { const values = new Map<string, string>(); return { get length() { return values.size; }, clear() { values.clear(); }, getItem(key) { return values.get(key) ?? null; }, key(index) { return [...values.keys()][index] ?? null; }, removeItem(key) { values.delete(key); }, setItem(key, value) { values.set(String(key), String(value)); } }; }
function state(): CardFilterState { return { ...createDefaultCardFilter(), cardClass: { disabled: false, selected: ["Ironclad"] } }; }
function renderPanel(filter = state()) { const onGroupDisabledChange = vi.fn(); const onValueChange = vi.fn(); return { ...render(<SearchFilterPanel state={filter} options={OPTIONS} onGroupDisabledChange={onGroupDisabledChange} onValueChange={onValueChange} />), onGroupDisabledChange, onValueChange }; }
beforeEach(() => { Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage() }); });
afterEach(() => { cleanup(); Object.defineProperty(window, "localStorage", { configurable: true, value: nativeLocalStorage }); });

describe("SearchFilterPanel", () => {
  test("uses the Search region and stable ordered filter groups", () => {
    window.localStorage.setItem(SEARCH_FILTER_HELP_DISMISSED_KEY, "1"); renderPanel();
    expect(screen.getByRole("region", { name: "Search filters" })).toBeVisible();
    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual(["Class", "Type", "Mana", "Rarity", "Target", "Powers", "Keywords"]);
  });
  test("calls generic update callbacks and warns on enabled empty groups", () => {
    window.localStorage.setItem(SEARCH_FILTER_HELP_DISMISSED_KEY, "1"); const empty = createDefaultCardFilter(); empty.cardClass = { disabled: false, selected: [] }; const { onGroupDisabledChange, onValueChange } = renderPanel(empty);
    const group = screen.getByRole("group", { name: "Class" });
    expect(within(group).getByText("Choose at least one.")).toBeVisible();
    fireEvent.click(within(group).getByRole("checkbox", { name: "Ironclad" }));
    fireEvent.click(within(group).getByRole("checkbox", { name: "Disable" }));
    expect(onGroupDisabledChange).toHaveBeenCalledWith("cardClass", true); expect(onValueChange).toHaveBeenCalledWith("cardClass", "Ironclad", true);
  });
  test("opens first-time help, explains every matching rule, traps Tab and Shift+Tab, and restores focus", async () => {
    const view = renderPanel(); const trigger = screen.getByRole("button", { name: "Filter help" }); const close = screen.getByRole("button", { name: "Close filter help" });
    const dialog = screen.getByRole("dialog", { name: "Filter help" }); expect(close).toHaveFocus();
    expect(dialog).toHaveTextContent("Disable accepts any value for that group"); expect(dialog).toHaveTextContent("An enabled group with nothing checked matches no cards"); expect(dialog).toHaveTextContent("Class, Type, Mana, Rarity, and Target use OR within each group"); expect(dialog).toHaveTextContent("Powers and Keywords use AND"); expect(dialog).toHaveTextContent("None means that form has no Powers or Keywords and clears other choices"); expect(dialog).toHaveTextContent("Enabled groups combine with AND"); expect(dialog).toHaveTextContent("Base and upgraded forms are evaluated separately");
    const tab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }); document.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(true); expect(close).toHaveFocus();
    const shiftTab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true }); document.dispatchEvent(shiftTab); expect(shiftTab.defaultPrevented).toBe(true); expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" }); await waitFor(() => expect(trigger).toHaveFocus()); expect(window.localStorage.getItem(SEARCH_FILTER_HELP_DISMISSED_KEY)).toBe("1");
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("dialog", { name: "Filter help" })); expect(screen.getByRole("dialog", { name: "Filter help" })).toBeVisible();
    fireEvent.click(view.container.querySelector(".search-filter-help__backdrop")!); expect(screen.queryByRole("dialog", { name: "Filter help" })).not.toBeInTheDocument();
  });
  test("keeps 44px controls and marks disabled values visually", () => {
    window.localStorage.setItem(SEARCH_FILTER_HELP_DISMISSED_KEY, "1"); renderPanel();
    const stylesheet = readFileSync(resolve(process.cwd(), "src/client/styles/search.css"), "utf8"); expect(stylesheet).toContain(".search-filter__help-trigger, .search-filter-help__close { display: inline-flex; min-width: 44px; min-height: 44px;"); expect(stylesheet).toContain(".search-filter__choice { display: flex; min-height: 44px;");
    expect(screen.getByRole("group", { name: "Type" }).querySelector(".search-filter__values--disabled")).not.toBeNull();
  });
});
