import { z } from "zod";

import { type CardFilterOptions, type CardFilterState, createDefaultCardFilter, validCardFilter } from "./card-filter.js";

export const SEARCH_FILTER_STORAGE_KEY = "stsdle:search:filters:v1";
export const SEARCH_FILTER_STORAGE_VERSION = 2;

export interface SearchPreferences {
  filter: CardFilterState;
  collapsed: boolean;
}

const groupSchema = z.object({ disabled: z.boolean(), selected: z.array(z.union([z.string(), z.number()])) }).strict();
const filterSchema = z.object({
  cardClass: groupSchema, cardType: groupSchema, mana: groupSchema, rarity: groupSchema,
  target: groupSchema, powers: groupSchema, keywords: groupSchema,
}).strict();
const envelopeSchema = z.object({
  version: z.literal(SEARCH_FILTER_STORAGE_VERSION),
  filter: filterSchema,
  collapsed: z.boolean(),
}).strict();

function removeSearchFilter(storage: Storage): void { try { storage.removeItem(SEARCH_FILTER_STORAGE_KEY); } catch { /* Best effort. */ } }

function persistenceFilter(state: CardFilterState): CardFilterState {
  return {
    cardClass: { disabled: state.cardClass.disabled, selected: [...state.cardClass.selected] },
    cardType: { disabled: state.cardType.disabled, selected: [...state.cardType.selected] },
    mana: { disabled: state.mana.disabled, selected: [...state.mana.selected] },
    rarity: { disabled: state.rarity.disabled, selected: [...state.rarity.selected] },
    target: { disabled: state.target.disabled, selected: [...state.target.selected] },
    powers: { disabled: state.powers.disabled, selected: [...state.powers.selected] },
    keywords: { disabled: state.keywords.disabled, selected: [...state.keywords.selected] },
  };
}

export function createDefaultSearchPreferences(): SearchPreferences {
  return { filter: createDefaultCardFilter(), collapsed: false };
}

export function loadSearchPreferences(storage: Storage | null | undefined, options: CardFilterOptions): SearchPreferences {
  if (storage === null || storage === undefined) return createDefaultSearchPreferences();
  let raw: string | null;
  try { raw = storage.getItem(SEARCH_FILTER_STORAGE_KEY); } catch { return createDefaultSearchPreferences(); }
  if (raw === null) return createDefaultSearchPreferences();
  try {
    const parsed = envelopeSchema.parse(JSON.parse(raw));
    const filter = parsed.filter as CardFilterState;
    if (!validCardFilter(filter, options)) throw new Error("Invalid stored Search filter");
    return { filter, collapsed: parsed.collapsed };
  } catch {
    removeSearchFilter(storage);
    return createDefaultSearchPreferences();
  }
}

export function saveSearchPreferences(storage: Storage | null | undefined, preferences: SearchPreferences): void {
  if (storage === null || storage === undefined) return;
  try {
    storage.setItem(SEARCH_FILTER_STORAGE_KEY, JSON.stringify({
      version: SEARCH_FILTER_STORAGE_VERSION,
      filter: persistenceFilter(preferences.filter),
      collapsed: preferences.collapsed,
    }));
  } catch { /* Best effort. */ }
}
