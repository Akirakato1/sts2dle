import type { RawSpireCard } from "../spire-codex/schema.js";

export interface RendererConfig {
  card_name: string;
  description: string;
  card_type: string;
  character: string;
  rarity: string;
  cost: string;
  star_cost: string | number | null;
  upgraded: boolean;
  cost_green: false;
  portrait_url: string;
}

const PREFIX_KEYWORDS = ["unplayable", "innate"] as const;
const SUFFIX_KEYWORDS = ["ethereal", "retain", "sly", "exhaust", "eternal"] as const;
type RendererKeyword = (typeof PREFIX_KEYWORDS)[number] | (typeof SUFFIX_KEYWORDS)[number];

function keywordLine(keyword: string): string {
  return keyword[0]!.toUpperCase() + keyword.slice(1) + ".";
}

function effectiveStarCost(raw: RawSpireCard, upgraded: boolean): string | number | null {
  const upgradedStarCost = raw.upgrade?.star_cost;
  if (upgraded && (typeof upgradedStarCost === "number" || typeof upgradedStarCost === "string")) {
    return upgradedStarCost;
  }
  return raw.star_cost ?? null;
}

function effectiveRawKeyword(raw: RawSpireCard, keyword: RendererKeyword, upgraded: boolean): boolean {
  const base = new Set(raw.keywords_key?.map((value) => value.toLowerCase()) ?? []);
  let present = base.has(keyword);
  if (upgraded && raw.upgrade?.[`add_${keyword}`]) present = true;
  if (upgraded && raw.upgrade?.[`remove_${keyword}`]) present = false;
  return present;
}

function rendererCost(raw: RawSpireCard, upgraded: boolean): string {
  const upgradedCost = raw.upgrade?.cost;
  const cost = upgraded && typeof upgradedCost === "number" ? upgradedCost : raw.cost;
  if (raw.is_x_cost) return "X";
  if (!Number.isInteger(cost) || cost === null || cost < 0) return "–";
  return String(cost);
}

export function buildRendererConfig(raw: RawSpireCard, upgraded: boolean): RendererConfig {
  if (!raw.image_url) throw new Error(`Card portrait URL is required: ${raw.id}`);

  const description = upgraded
    ? (raw.upgrade_description || raw.description)
    : raw.description;
  const lines: string[] = [];
  for (const keyword of PREFIX_KEYWORDS) {
    if (effectiveRawKeyword(raw, keyword, upgraded)) lines.push(keywordLine(keyword));
  }
  if (description) lines.push(description);
  for (const keyword of SUFFIX_KEYWORDS) {
    if (effectiveRawKeyword(raw, keyword, upgraded)) lines.push(keywordLine(keyword));
  }

  return {
    card_name: raw.name,
    description: lines.join("\n"),
    card_type: raw.type.toLowerCase(),
    character: raw.color.toLowerCase(),
    rarity: (raw.rarity ?? "").toLowerCase(),
    cost: rendererCost(raw, upgraded),
    star_cost: effectiveStarCost(raw, upgraded),
    upgraded,
    cost_green: false,
    portrait_url: raw.image_url,
  };
}
