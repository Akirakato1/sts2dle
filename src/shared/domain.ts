export const FEATURE_ORDER = [
  "cardClass", "cardType", "mana", "rarity",
  "eternal", "ethereal", "exhaust", "innate",
  "retain", "sly",
] as const;

export type FeatureName = (typeof FEATURE_ORDER)[number];
export type CardClass =
  | "Ironclad" | "Silent" | "Defect" | "Necrobinder"
  | "Regent" | "Neutral" | "Event";
export const CARD_TYPES = ["Attack", "Skill", "Power", "Quest", "Status", "Curse"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_RARITIES = [
  "Ancient", "Basic", "Common", "Curse", "Event",
  "Quest", "Rare", "Status", "Token", "Uncommon",
] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];
export type ManaValue = number | "X" | "None";

export interface FeatureVector {
  cardClass: CardClass;
  cardType: CardType;
  mana: ManaValue;
  rarity: CardRarity;
  eternal: boolean;
  ethereal: boolean;
  exhaust: boolean;
  innate: boolean;
  retain: boolean;
  sly: boolean;
}

export interface CardIdentity {
  id: string;
  name: string;
  duplicateName?: boolean;
  hasUpgrade: boolean;
  artUrl: string;
  baseCardUrl: string | null;
  upgradedCardUrl: string | null;
  base: FeatureVector;
  upgraded: FeatureVector;
}

export interface BaseGroup { key: string; cardIds: string[] }
export interface PairGroup { key: string; cardIds: string[] }

export interface SpriteRect { x: number; y: number; width: number; height: number }
export interface SpriteAtlasMeta { url: string; width: number; height: number; displayScale: number }
export interface SpriteMap {
  candidate: SpriteAtlasMeta;
  guess: SpriteAtlasMeta;
  cards: Record<string, { candidate: SpriteRect; guess: SpriteRect }>;
}

export interface SnapshotManifest {
  schemaVersion: 1;
  sourceRevision: string;
  sourceLastModified: string | null;
  fetchedAt: string;
  generatedAt: string;
  cardCount: number;
  upgradeCount: number;
  baseGroupCount: number;
  pairGroupCount: number;
  files: Record<string, string>;
}
