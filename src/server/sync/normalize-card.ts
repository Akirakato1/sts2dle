import type {
  CardClass,
  CardIdentity,
  CardRarity,
  CardType,
  FeatureVector,
  ManaValue,
} from "../../shared/domain.js";
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

const KEYWORDS = [
  "eternal", "ethereal", "exhaust", "innate",
  "retain", "sly", "unplayable",
] as const;

type Keyword = (typeof KEYWORDS)[number];

function normalizeMana(cost: number | null, isX: boolean | null | undefined): ManaValue {
  if (isX || cost === -1) return "X";
  if (!Number.isInteger(cost) || cost === null || cost < 0) return "–";
  return cost;
}

function normalizeClass(value: string): CardClass {
  const result = CLASS_BY_COLOR[value.toLowerCase() as keyof typeof CLASS_BY_COLOR];
  if (!result) throw new Error("Unsupported card color: " + value);
  return result;
}

function normalizeType(value: string): CardType {
  if (["Attack", "Skill", "Power", "Quest", "Status", "Curse"].includes(value)) {
    return value as CardType;
  }
  throw new Error("Unsupported card type: " + value);
}

function normalizeRarity(value: string | null): CardRarity {
  if (value === "Common" || value === "Uncommon" || value === "Rare") return value;
  return "None";
}

function keywordFlags(keywords: string[] | null | undefined): Record<Keyword, boolean> {
  const values = new Set(keywords?.map((keyword) => keyword.toLowerCase()));
  return Object.fromEntries(KEYWORDS.map((keyword) => [keyword, values.has(keyword)])) as Record<Keyword, boolean>;
}

function buildFeatures(raw: RawSpireCard, mana: ManaValue): FeatureVector {
  const flags = keywordFlags(raw.keywords_key);
  return {
    cardClass: normalizeClass(raw.color),
    cardType: normalizeType(raw.type),
    mana,
    rarity: normalizeRarity(raw.rarity),
    eternal: flags.eternal,
    ethereal: flags.ethereal,
    exhaust: flags.exhaust,
    innate: flags.innate,
    retain: flags.retain,
    sly: flags.sly,
    unplayable: flags.unplayable,
  };
}

function applyUpgrade(base: FeatureVector, raw: RawSpireCard): FeatureVector {
  const upgrade = raw.upgrade;
  if (!upgrade || Object.keys(upgrade).length === 0) return base;

  const cost = typeof upgrade.cost === "number" ? upgrade.cost : raw.cost;
  const upgraded: FeatureVector = { ...base, mana: normalizeMana(cost, raw.is_x_cost) };
  for (const keyword of KEYWORDS) {
    if (upgrade[`add_${keyword}`]) upgraded[keyword] = true;
    if (upgrade[`remove_${keyword}`]) upgraded[keyword] = false;
  }
  return upgraded;
}

export function normalizeCard(raw: RawSpireCard, baseUrl: string): CardIdentity {
  if (!raw.image_url) throw new Error("Card image URL is required: " + raw.id);

  const base = buildFeatures(raw, normalizeMana(raw.cost, raw.is_x_cost));
  const upgraded = applyUpgrade(base, raw);
  const hasUpgrade = Boolean(raw.upgrade && Object.keys(raw.upgrade).length > 0);

  return {
    id: raw.id,
    name: raw.name,
    hasUpgrade,
    artUrl: new URL(raw.image_url, baseUrl).toString(),
    baseCardUrl: raw.image_url_card,
    upgradedCardUrl: raw.image_url_card_upg,
    base,
    upgraded,
  };
}
