import { z } from "zod";

import { type CardFilterOptions, type CardFilterState, createDefaultCardFilter, validCardFilter } from "./card-filter.js";

export const SEARCH_FILTER_STORAGE_KEY = "stsdle:search:filters:v1";
export const SEARCH_FILTER_STORAGE_VERSION = 1;

const groupSchema = z.object({ disabled: z.boolean(), selected: z.array(z.union([z.string(), z.number()])) }).strict();
const filterSchema = z.object({
  cardClass: groupSchema, cardType: groupSchema, mana: groupSchema, rarity: groupSchema,
  target: groupSchema, powers: groupSchema, keywords: groupSchema,
}).strict();
const envelopeSchema = z.object({ version: z.literal(SEARCH_FILTER_STORAGE_VERSION), filter: filterSchema }).strict();

function removeSearchFilter(storage: Storage): void { try { storage.removeItem(SEARCH_FILTER_STORAGE_KEY); } catch { /* Best effort. */ } }

export function loadSearchFilter(storage: Storage | null | undefined, options: CardFilterOptions): CardFilterState {
  if (storage === null || storage === undefined) return createDefaultCardFilter();
  let raw: string | null;
  try { raw = storage.getItem(SEARCH_FILTER_STORAGE_KEY); } catch { return createDefaultCardFilter(); }
  if (raw === null) return createDefaultCardFilter();
  try {
    const parsed = envelopeSchema.parse(JSON.parse(raw));
    const filter = parsed.filter as CardFilterState;
    if (!validCardFilter(filter, options)) throw new Error("Invalid stored Search filter");
    return filter;
  } catch {
    removeSearchFilter(storage);
    return createDefaultCardFilter();
  }
}

export function saveSearchFilter(storage: Storage | null | undefined, state: CardFilterState): void {
  if (storage === null || storage === undefined) return;
  try { storage.setItem(SEARCH_FILTER_STORAGE_KEY, JSON.stringify({ version: SEARCH_FILTER_STORAGE_VERSION, filter: state })); } catch { /* Best effort. */ }
}
