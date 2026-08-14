import type {
  CardKeyword,
  CardClass,
  CardIdentity,
  CardTarget,
  FeatureVector,
  ManaValue,
} from "../../shared/domain.js";
import { CARD_KEYWORDS, UNIQUE_POWER } from "../../shared/domain.js";
import type { RawSpireCard } from "../spire-codex/schema.js";

const CLASS_BY_COLOR = {
  ironclad: "Ironclad",
  silent: "Silent",
  defect: "Defect",
  necrobinder: "Necrobinder",
  regent: "Regent",
  event: "Event",
  colorless: "Neutral",
  token: "Neutral",
  quest: "Neutral",
  status: "Neutral",
  curse: "Neutral",
} as const satisfies Record<string, CardClass>;

const OFFICIAL_ARTWORK_SOURCE_ORIGIN = "https://spire-codex.com";
const OFFICIAL_ARTWORK_SOURCE_PREFIX = "/static/images/cards/";
const OFFICIAL_ARTWORK_CDN_ORIGIN = "https://cdn.spire-codex.com";

export interface SourceFeatureAnalysis {
  powerCardCounts: ReadonlyMap<string, number>;
  observedTargets: ReadonlySet<CardTarget>;
  observedKeywords: ReadonlySet<CardKeyword>;
  singletonPowerCount: number;
  recurringPowerCount: number;
  publicCardNamesWithMultipleSingletonKeys: readonly string[];
}

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
  }

  get size(): number { return this.#values.size; }
  get(key: K): V | undefined { return this.#values.get(key); }
  has(key: K): boolean { return this.#values.has(key); }
  entries(): MapIterator<[K, V]> { return this.#values.entries(); }
  keys(): MapIterator<K> { return this.#values.keys(); }
  values(): MapIterator<V> { return this.#values.values(); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#values[Symbol.iterator](); }
}

class ImmutableSet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values: Iterable<T>) {
    this.#values = new Set(values);
  }

  get size(): number { return this.#values.size; }
  has(value: T): boolean { return this.#values.has(value); }
  entries(): SetIterator<[T, T]> { return this.#values.entries(); }
  keys(): SetIterator<T> { return this.#values.keys(); }
  values(): SetIterator<T> { return this.#values.values(); }
  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    this.#values.forEach((value) => callbackfn.call(thisArg, value, value, this));
  }
  [Symbol.iterator](): SetIterator<T> { return this.#values[Symbol.iterator](); }
}

function normalizeMana(cost: number | null, isX: boolean | null | undefined): ManaValue {
  if (isX) return "X";
  if (!Number.isInteger(cost) || cost === null || cost < 0) return "None";
  return cost;
}

function normalizeClass(value: string): CardClass {
  const result = CLASS_BY_COLOR[value.toLowerCase() as keyof typeof CLASS_BY_COLOR];
  if (!result) throw new Error("Unsupported card color: " + value);
  return result;
}

export function analyzeSourceFeatures(cards: readonly RawSpireCard[]): SourceFeatureAnalysis {
  const powerKeyNames = new Map<string, string>();
  const powerCardCounts = new Map<string, number>();
  const observedTargets = new Set<CardTarget>();
  const observedKeywords = new Set<CardKeyword>();
  const singletonKeysByCard = new Map<string, Set<string>>();
  for (const card of cards) {
    observedTargets.add(card.target);
    const rawKeywords = new Set(card.keywords_key?.map((keyword) => keyword.toLowerCase()));
    for (const keyword of CARD_KEYWORDS) {
      if (rawKeywords.has(keyword.toLowerCase())) observedKeywords.add(keyword);
    }
    const cardPowerKeys = new Set<string>();
    for (const power of card.powers_applied ?? []) {
      const knownName = powerKeyNames.get(power.power_key);
      if (knownName !== undefined && knownName !== power.power) {
        throw new Error(`Conflicting power display names for ${power.power_key}: ${knownName}, ${power.power}`);
      }
      powerKeyNames.set(power.power_key, power.power);
      cardPowerKeys.add(power.power_key);
    }
    singletonKeysByCard.set(card.id, cardPowerKeys);
  }
  for (const keys of singletonKeysByCard.values()) {
    for (const key of keys) {
      const displayName = powerKeyNames.get(key)!;
      powerCardCounts.set(displayName, (powerCardCounts.get(displayName) ?? 0) + 1);
    }
  }
  const singletonKeys = new Set([...powerKeyNames].filter(([, name]) => powerCardCounts.get(name) === 1).map(([key]) => key));
  const publicCardNamesWithMultipleSingletonKeys = cards
    .filter((card) => [...(singletonKeysByCard.get(card.id) ?? [])].filter((key) => singletonKeys.has(key)).length > 1)
    .map((card) => card.name);
  const singletonPowerCount = [...powerCardCounts.values()].filter((count) => count === 1).length;
  return {
    powerCardCounts: new ImmutableMap(powerCardCounts),
    observedTargets: new ImmutableSet(observedTargets),
    observedKeywords: new ImmutableSet(observedKeywords),
    singletonPowerCount,
    recurringPowerCount: powerCardCounts.size - singletonPowerCount,
    publicCardNamesWithMultipleSingletonKeys,
  };
}

function buildPowers(raw: RawSpireCard, powerCardCounts: ReadonlyMap<string, number>): string[] {
  const recurring = new Set<string>();
  let hasUnique = false;
  for (const power of raw.powers_applied ?? []) {
    if (powerCardCounts.get(power.power) === 1) hasUnique = true;
    else recurring.add(power.power);
  }
  return [...recurring].sort((left, right) => left.localeCompare(right, "en-US")).concat(hasUnique ? [UNIQUE_POWER] : []);
}

function buildKeywords(keywords: string[] | null | undefined): CardKeyword[] {
  const sourceKeywords = new Set(keywords?.map((keyword) => keyword.toLowerCase()));
  return CARD_KEYWORDS.filter((keyword) => sourceKeywords.has(keyword.toLowerCase()));
}

function buildFeatures(raw: RawSpireCard, mana: ManaValue, powerCardCounts: ReadonlyMap<string, number>): FeatureVector {
  return {
    cardClass: normalizeClass(raw.color),
    cardType: raw.type_key,
    mana,
    rarity: raw.rarity_key,
    target: raw.target,
    powers: buildPowers(raw, powerCardCounts),
    keywords: buildKeywords(raw.keywords_key),
  };
}

function applyUpgrade(base: FeatureVector, raw: RawSpireCard): FeatureVector {
  const upgrade = raw.upgrade;
  if (!upgrade || Object.keys(upgrade).length === 0) {
    return { ...base, powers: [...base.powers], keywords: [...base.keywords] };
  }

  const cost = typeof upgrade.cost === "number" ? upgrade.cost : raw.cost;
  const upgradedKeywords = new Set(base.keywords);
  for (const keyword of CARD_KEYWORDS) {
    const suffix = keyword.toLowerCase();
    if (upgrade[`add_${suffix}`]) upgradedKeywords.add(keyword);
    if (upgrade[`remove_${suffix}`]) upgradedKeywords.delete(keyword);
  }
  return {
    ...base,
    mana: normalizeMana(cost, raw.is_x_cost),
    powers: [...base.powers],
    keywords: CARD_KEYWORDS.filter((keyword) => upgradedKeywords.has(keyword)),
  };
}

function resolveArtworkUrl(value: string, baseUrl: string): string {
  const resolved = new URL(value, baseUrl);
  const filename = resolved.pathname.startsWith(OFFICIAL_ARTWORK_SOURCE_PREFIX)
    ? resolved.pathname.slice(OFFICIAL_ARTWORK_SOURCE_PREFIX.length)
    : "";
  if (
    resolved.origin === OFFICIAL_ARTWORK_SOURCE_ORIGIN
    && resolved.search === ""
    && resolved.hash === ""
    && /^[A-Za-z0-9_-]+\.webp$/.test(filename)
  ) {
    return new URL(`/cards/${filename}`, OFFICIAL_ARTWORK_CDN_ORIGIN).toString();
  }
  return resolved.toString();
}

export function normalizeCard(
  raw: RawSpireCard,
  baseUrl: string,
  powerCardCounts: ReadonlyMap<string, number>,
): CardIdentity {
  if (!raw.image_url) throw new Error("Card image URL is required: " + raw.id);

  const base = buildFeatures(raw, normalizeMana(raw.cost, raw.is_x_cost), powerCardCounts);
  const upgraded = applyUpgrade(base, raw);
  const hasUpgrade = Boolean(raw.upgrade && Object.keys(raw.upgrade).length > 0);

  return {
    id: raw.id,
    name: raw.name,
    hasUpgrade,
    artUrl: resolveArtworkUrl(raw.image_url, baseUrl),
    baseCardUrl: raw.image_url_card,
    upgradedCardUrl: raw.image_url_card_upg,
    base,
    upgraded,
  };
}
