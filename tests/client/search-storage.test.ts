import { expect, test } from "vitest";

import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { collectCardFilterOptions, createDefaultCardFilter, updateCardFilterGroupValue } from "../../src/client/game/card-filter.js";
import {
  SEARCH_FILTER_STORAGE_KEY,
  createDefaultSearchPreferences,
  loadSearchPreferences,
  saveSearchPreferences,
} from "../../src/client/game/search-storage.js";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); } getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; } removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const vector: FeatureVector = { cardClass: "Ironclad", cardType: "Attack", mana: 2, rarity: "Basic", target: "Self", powers: ["Strength"], keywords: ["Exhaust"] };
const card: CardIdentity = { id: "card", name: "Card", hasUpgrade: false, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: vector, upgraded: vector };
const options = collectCardFilterOptions([card]);

test("round-trips only versioned Search filter preferences", () => {
  const storage = new MemoryStorage();
  const preferences = {
    filter: updateCardFilterGroupValue(createDefaultCardFilter(), "mana", 2, true),
    collapsed: true,
  };
  saveSearchPreferences(storage, preferences);
  expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!)).toEqual({ version: 2, ...preferences });
  expect(loadSearchPreferences(storage, options)).toEqual(preferences);
});

test.each([
  "not-json",
  JSON.stringify({ version: 1, filter: createDefaultCardFilter() }),
  JSON.stringify({ version: 2, filter: createDefaultCardFilter() }),
  JSON.stringify({ version: 2, filter: createDefaultCardFilter(), collapsed: "yes" }),
  JSON.stringify({ version: 2, filter: { ...createDefaultCardFilter(), mana: { disabled: false, selected: [99] } }, collapsed: false }),
  JSON.stringify({ version: 2, filter: { ...createDefaultCardFilter(), powers: { disabled: false, selected: ["power:none", "Strength"] } }, collapsed: false }),
])("resets invalid Search preferences", (value) => {
  const storage = new MemoryStorage(); storage.setItem(SEARCH_FILTER_STORAGE_KEY, value);
  expect(loadSearchPreferences(storage, options)).toEqual(createDefaultSearchPreferences());
  expect(storage.getItem(SEARCH_FILTER_STORAGE_KEY)).toBeNull();
});

test("writes no query, modal, card data, or image bytes", () => {
  const storage = new MemoryStorage(); saveSearchPreferences(storage, createDefaultSearchPreferences());
  expect(Object.keys(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!))).toEqual(["version", "filter", "collapsed"]);
});

test("persists only canonical preference and group fields from runtime objects", () => {
  const storage = new MemoryStorage();
  const preferences = {
    filter: {
      ...createDefaultCardFilter(),
      mana: { disabled: false, selected: [2], imageBytes: "not-a-group" },
    },
    collapsed: true,
    query: "Dazed",
    modal: { open: true },
    card: { id: "card", name: "Dazed" },
    imageBytes: "not-a-filter",
  };

  saveSearchPreferences(storage, preferences as typeof preferences & Parameters<typeof saveSearchPreferences>[1]);

  expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!)).toEqual({
    version: 2,
    filter: {
      cardClass: { disabled: false, selected: [] }, cardType: { disabled: false, selected: [] },
      mana: { disabled: false, selected: [2] }, rarity: { disabled: false, selected: [] },
      target: { disabled: false, selected: [] }, powers: { disabled: false, selected: [] },
      keywords: { disabled: false, selected: [] },
    },
    collapsed: true,
  });
});
