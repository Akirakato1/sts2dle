import { expect, test } from "vitest";

import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import { collectCardFilterOptions, createDefaultCardFilter, updateCardFilterGroupDisabled, updateCardFilterGroupValue } from "../../src/client/game/card-filter.js";
import { SEARCH_FILTER_STORAGE_KEY, loadSearchFilter, saveSearchFilter } from "../../src/client/game/search-storage.js";

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

test("round-trips only the versioned Search filter", () => {
  const storage = new MemoryStorage();
  const state = updateCardFilterGroupValue(updateCardFilterGroupDisabled(createDefaultCardFilter(), "mana", false), "mana", 2, true);
  saveSearchFilter(storage, state);
  expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!)).toEqual({ version: 1, filter: state });
  expect(loadSearchFilter(storage, options)).toEqual(state);
});

test.each([
  "not-json",
  JSON.stringify({ version: 2, filter: createDefaultCardFilter() }),
  JSON.stringify({ version: 1, filter: { ...createDefaultCardFilter(), mana: { disabled: false, selected: [99] } } }),
  JSON.stringify({ version: 1, filter: { ...createDefaultCardFilter(), powers: { disabled: false, selected: ["power:none", "Strength"] } } }),
])("resets invalid Search storage", (value) => {
  const storage = new MemoryStorage(); storage.setItem(SEARCH_FILTER_STORAGE_KEY, value);
  expect(loadSearchFilter(storage, options)).toEqual(createDefaultCardFilter());
  expect(storage.getItem(SEARCH_FILTER_STORAGE_KEY)).toBeNull();
});

test("writes no query, modal, card data, or image bytes", () => {
  const storage = new MemoryStorage(); saveSearchFilter(storage, createDefaultCardFilter());
  expect(Object.keys(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!))).toEqual(["version", "filter"]);
});

test("persists only canonical filter and group fields from runtime objects", () => {
  const storage = new MemoryStorage();
  const state = {
    ...createDefaultCardFilter(),
    query: "Dazed",
    modal: { open: true },
    card: { id: "card", name: "Dazed" },
    imageBytes: "not-a-filter",
    mana: { disabled: false, selected: [2], imageBytes: "not-a-group" },
  };

  saveSearchFilter(storage, state as typeof state & Parameters<typeof saveSearchFilter>[1]);

  expect(JSON.parse(storage.getItem(SEARCH_FILTER_STORAGE_KEY)!)).toEqual({
    version: 1,
    filter: {
      cardClass: { disabled: true, selected: [] }, cardType: { disabled: true, selected: [] },
      mana: { disabled: false, selected: [2] }, rarity: { disabled: true, selected: [] },
      target: { disabled: true, selected: [] }, powers: { disabled: true, selected: [] },
      keywords: { disabled: true, selected: [] },
    },
  });
});
