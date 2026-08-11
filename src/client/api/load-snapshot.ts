import type { BaseGroup, CardIdentity, PairGroup, SnapshotManifest, SpriteMap } from "../../shared/domain.js";
import { cardIdentitySchema, groupSchema, snapshotManifestSchema, spriteMapSchema } from "../../shared/snapshot-schema.js";

export interface LoadedSnapshot {
  manifest: SnapshotManifest;
  cards: CardIdentity[];
  baseGroups: BaseGroup[];
  pairGroups: PairGroup[];
  spriteMap: SpriteMap;
  cardsById: Map<string, CardIdentity>;
  pairGroupsByKey: Map<string, PairGroup>;
}

const runtimeUrls = ["/runtime/manifest.json", "/runtime/cards.json", "/runtime/base-groups.json", "/runtime/pair-groups.json", "/runtime/sprite-map.json"] as const;

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url);
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

export async function loadSnapshot(fetchImpl: typeof fetch = fetch): Promise<LoadedSnapshot> {
  const [manifestValue, cardsValue, baseGroupsValue, pairGroupsValue, spriteMapValue] = await Promise.all(runtimeUrls.map((url) => getJson(fetchImpl, url)));
  const manifest = snapshotManifestSchema.parse(manifestValue);
  const cards = cardIdentitySchema.array().parse(cardsValue).map(toCardIdentity);
  const baseGroups = groupSchema.array().parse(baseGroupsValue);
  const pairGroups = groupSchema.array().parse(pairGroupsValue);
  const spriteMap = spriteMapSchema.parse(spriteMapValue);
  if (manifest.cardCount !== cards.length) throw new Error(`manifest cardCount (${manifest.cardCount}) does not match cards (${cards.length})`);
  if (manifest.baseGroupCount !== baseGroups.length) throw new Error("manifest baseGroupCount does not match base groups");
  if (manifest.pairGroupCount !== pairGroups.length) throw new Error("manifest pairGroupCount does not match pair groups");
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  if (cardsById.size !== cards.length) throw new Error("cards contains duplicate ids");
  assertGroupReferences(baseGroups, cardsById, "base group");
  assertGroupReferences(pairGroups, cardsById, "pair group");
  const pairGroupsByKey = new Map(pairGroups.map((group) => [group.key, group]));
  if (pairGroupsByKey.size !== pairGroups.length) throw new Error("pair groups contains duplicate keys");
  return { manifest, cards, baseGroups, pairGroups, spriteMap, cardsById, pairGroupsByKey };
}
