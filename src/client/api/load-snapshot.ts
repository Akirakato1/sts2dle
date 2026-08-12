import type { BaseGroup, CardIdentity, PairGroup, SnapshotManifest, SpriteMap } from "../../shared/domain.js";
import { cardIdentitySchema, groupSchema, snapshotManifestSchema, spriteMapSchema } from "../../shared/snapshot-schema.js";
import { preloadSpriteAtlases } from "./preload-sprite-atlases.js";

export interface LoadedSnapshot {
  manifest: SnapshotManifest;
  cards: CardIdentity[];
  baseGroups: BaseGroup[];
  pairGroups: PairGroup[];
  spriteMap: SpriteMap;
  cardsById: Map<string, CardIdentity>;
  pairGroupsByKey: Map<string, PairGroup>;
}

export type SpriteAtlasPreloader = (spriteMap: SpriteMap, signal?: AbortSignal) => Promise<void>;

const runtimeUrls = ["/runtime/manifest.json", "/runtime/cards.json", "/runtime/base-groups.json", "/runtime/pair-groups.json", "/runtime/sprite-map.json"] as const;

async function getJson(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetchImpl(url, signal ? { signal } : undefined); }
  catch { throw new Error(`Failed to load ${url}`); }
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  try { return await response.json(); }
  catch { throw new Error(`Failed to parse ${url}`); }
}

function assertGroupReferences(groups: readonly BaseGroup[] | readonly PairGroup[], cardsById: ReadonlyMap<string, CardIdentity>, name: string): void {
  for (const group of groups) for (const id of group.cardIds) {
    if (!cardsById.has(id)) throw new Error(`${name} ${group.key} references unknown card ${id}`);
  }
}

function toCardIdentity(value: ReturnType<typeof cardIdentitySchema.parse>): CardIdentity {
  if (value.duplicateName === undefined) {
    const { duplicateName: _duplicateName, ...card } = value;
    return card as CardIdentity;
  }
  return { ...value, duplicateName: value.duplicateName } as CardIdentity;
}

function parseRuntime<T>(url: string, parse: () => T): T { try { return parse(); } catch { throw new Error(`Invalid snapshot data at ${url}`); } }

export async function loadSnapshot(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  preloadImpl: SpriteAtlasPreloader = preloadSpriteAtlases,
): Promise<LoadedSnapshot> {
  const [manifestValue, cardsValue, baseGroupsValue, pairGroupsValue, spriteMapValue] = await Promise.all(runtimeUrls.map((url) => getJson(fetchImpl, url, signal)));
  const manifest = parseRuntime("/runtime/manifest.json", () => snapshotManifestSchema.parse(manifestValue));
  const cards = parseRuntime("/runtime/cards.json", () => cardIdentitySchema.array().parse(cardsValue).map(toCardIdentity));
  const baseGroups = parseRuntime("/runtime/base-groups.json", () => groupSchema.array().parse(baseGroupsValue));
  const pairGroups = parseRuntime("/runtime/pair-groups.json", () => groupSchema.array().parse(pairGroupsValue));
  const spriteMap = parseRuntime("/runtime/sprite-map.json", () => spriteMapSchema.parse(spriteMapValue));
  if (manifest.cardCount !== cards.length) throw new Error(`manifest cardCount (${manifest.cardCount}) does not match cards (${cards.length})`);
  if (manifest.upgradeCount !== cards.filter((card) => card.hasUpgrade).length) throw new Error("manifest upgradeCount does not match cards");
  if (manifest.baseGroupCount !== baseGroups.length) throw new Error("manifest baseGroupCount does not match base groups");
  if (manifest.pairGroupCount !== pairGroups.length) throw new Error("manifest pairGroupCount does not match pair groups");
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  if (cardsById.size !== cards.length) throw new Error("cards contains duplicate ids");
  assertGroupReferences(baseGroups, cardsById, "base group");
  assertGroupReferences(pairGroups, cardsById, "pair group");
  const pairGroupsByKey = new Map(pairGroups.map((group) => [group.key, group]));
  if (pairGroupsByKey.size !== pairGroups.length) throw new Error("pair groups contains duplicate keys");
  await preloadImpl(spriteMap, signal);
  return { manifest, cards, baseGroups, pairGroups, spriteMap, cardsById, pairGroupsByKey };
}
