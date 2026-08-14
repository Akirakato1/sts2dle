import type { RawSpireCard } from "../../../src/server/spire-codex/schema.js";

const FULL_CARD_ORIGIN = "https://cdn.test";

function fixtureCard(card: Pick<RawSpireCard,
  "id" | "name" | "color" | "type" | "type_key" | "rarity" | "rarity_key"
  | "cost" | "target" | "powers_applied" | "keywords_key" | "upgrade"
>): RawSpireCard {
  const filename = card.id.toLowerCase();
  return {
    ...card,
    is_x_cost: null,
    description: `${card.name} fixture card.`,
    upgrade_description: null,
    image_url: `/fixture-art/${filename}.webp`,
    image_url_card: `${FULL_CARD_ORIGIN}/${filename}.webp`,
    image_url_card_upg: `${FULL_CARD_ORIGIN}/${filename}_upg.webp`,
  };
}

const SET_FIXTURE_CARDS: readonly RawSpireCard[] = [
  fixtureCard({
    id: "SET_SENTINEL",
    name: "Set Sentinel",
    color: "necrobinder",
    type: "Skill",
    type_key: "Skill",
    rarity: "Rare",
    rarity_key: "Rare",
    cost: 2,
    target: "AllAllies",
    powers_applied: [
      { power: "Strength", power_key: "strength", amount: 1 },
      { power: "Weak", power_key: "weak", amount: 1 },
    ],
    keywords_key: ["Ethereal", "Exhaust"],
    upgrade: { remove_ethereal: 1 },
  }),
  fixtureCard({
    id: "EXACT_SET_SENTINEL",
    name: "Exact Set Sentinel",
    color: "ironclad",
    type: "Skill",
    type_key: "Skill",
    rarity: "Uncommon",
    rarity_key: "Uncommon",
    cost: 2,
    target: "AnyAlly",
    powers_applied: [
      { power: "Strength", power_key: "strength", amount: 1 },
      { power: "Weak", power_key: "weak", amount: 1 },
    ],
    keywords_key: ["Ethereal", "Exhaust"],
    upgrade: { remove_ethereal: 1 },
  }),
  fixtureCard({
    id: "FILTER_FORM_SENTINEL",
    name: "Filter Form Sentinel",
    color: "silent",
    type: "Skill",
    type_key: "Skill",
    rarity: "Common",
    rarity_key: "Common",
    cost: 1,
    target: "Self",
    powers_applied: [],
    keywords_key: ["Ethereal", "Exhaust"],
    upgrade: { add_innate: 1 },
  }),
  fixtureCard({
    id: "OVERLAP_SENTINEL",
    name: "Overlap Sentinel",
    color: "ironclad",
    type: "Skill",
    type_key: "Skill",
    rarity: "Uncommon",
    rarity_key: "Uncommon",
    cost: 2,
    target: "AnyAlly",
    powers_applied: [
      { power: "Weak", power_key: "weak", amount: 1 },
      { power: "Vulnerable", power_key: "vulnerable", amount: 1 },
    ],
    keywords_key: ["Exhaust", "Innate"],
    upgrade: { fixture_upgrade: true },
  }),
  fixtureCard({
    id: "DISJOINT_SENTINEL",
    name: "Disjoint Sentinel",
    color: "regent",
    type: "Attack",
    type_key: "Attack",
    rarity: "Common",
    rarity_key: "Common",
    cost: 1,
    target: "RandomEnemy",
    powers_applied: [
      { power: "Afterimage", power_key: "afterimage", amount: 1 },
    ],
    keywords_key: ["Innate"],
    upgrade: { fixture_upgrade: true },
  }),
  fixtureCard({
    id: "NEGATION_SOURCE_SENTINEL",
    name: "Negation Source Sentinel",
    color: "regent",
    type: "Attack",
    type_key: "Attack",
    rarity: "Common",
    rarity_key: "Common",
    cost: 1,
    target: "RandomEnemy",
    powers_applied: [
      { power: "Afterimage", power_key: "afterimage", amount: 1 },
    ],
    keywords_key: ["Innate"],
    upgrade: { remove_innate: 1, add_retain: 1 },
  }),
  fixtureCard({
    id: "NEGATION_FORM_SENTINEL",
    name: "Negation Form Sentinel",
    color: "colorless",
    type: "Skill",
    type_key: "Skill",
    rarity: "Token",
    rarity_key: "Token",
    cost: 0,
    target: "None",
    powers_applied: [],
    keywords_key: ["Innate"],
    upgrade: { add_retain: 1 },
  }),
  fixtureCard({
    id: "LONG_SET",
    name: "Ossuary Concord",
    color: "necrobinder",
    type: "Power",
    type_key: "Power",
    rarity: "Ancient",
    rarity_key: "Ancient",
    cost: 3,
    target: "AllAllies",
    powers_applied: [
      { power: "Afterimage", power_key: "afterimage", amount: 1 },
      { power: "Strength", power_key: "strength", amount: 1 },
      { power: "Vulnerable", power_key: "vulnerable", amount: 1 },
      { power: "Weak", power_key: "weak", amount: 1 },
    ],
    keywords_key: ["Ethereal", "Exhaust", "Retain", "Unplayable"],
    upgrade: { fixture_upgrade: true },
  }),
  fixtureCard({
    id: "UNIQUE_SENTINEL",
    name: "Unique Sentinel",
    color: "colorless",
    type: "Power",
    type_key: "Power",
    rarity: "Token",
    rarity_key: "Token",
    cost: 1,
    target: "None",
    powers_applied: [
      { power: "Fixture Original", power_key: "fixture_unique_original", amount: 1 },
    ],
    keywords_key: [],
    upgrade: { fixture_upgrade: true },
  }),
];

function withE2eUpgrade(card: RawSpireCard): RawSpireCard {
  const copy = structuredClone(card);
  if (!copy.upgrade || Object.keys(copy.upgrade).length === 0) {
    copy.upgrade = { fixture_upgrade: true };
  }
  copy.image_url_card_upg ??= `${FULL_CARD_ORIGIN}/${copy.id.toLowerCase()}_upg.webp`;
  return copy;
}

function pairedCopy(card: RawSpireCard): RawSpireCard {
  const copy = {
    ...structuredClone(card),
    id: `${card.id}_PAIR`,
    name: `${card.name} Pair`,
    image_url: `/fixture-art/${card.id.toLowerCase()}-pair.webp`,
    image_url_card: `${FULL_CARD_ORIGIN}/${card.id.toLowerCase()}_pair.webp`,
    image_url_card_upg: `${FULL_CARD_ORIGIN}/${card.id.toLowerCase()}_pair_upg.webp`,
  };
  if (card.id === "UNIQUE_SENTINEL") {
    copy.powers_applied = [
      { power: "Fixture Pair", power_key: "fixture_unique_pair", amount: 1 },
    ];
  }
  return copy;
}

export function buildE2eFixtureCards(originals: readonly RawSpireCard[]): RawSpireCard[] {
  return [...originals, ...SET_FIXTURE_CARDS]
    .map(withE2eUpgrade)
    .flatMap((card) => [card, pairedCopy(card)]);
}
