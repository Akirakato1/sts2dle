export const FEATURE_ORDER = [
  "cardClass", "cardType", "mana", "rarity",
  "target", "powers", "keywords",
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
export const CARD_TARGETS = [
  "Self", "AnyEnemy", "AllEnemies", "RandomEnemy",
  "AnyAlly", "AllAllies", "None",
] as const;
export type CardTarget = (typeof CARD_TARGETS)[number];

export const CARD_KEYWORDS = [
  "Eternal", "Ethereal", "Exhaust", "Innate", "Retain", "Sly", "Unplayable",
] as const;
export type CardKeyword = (typeof CARD_KEYWORDS)[number];
export const UNIQUE_POWER = "Unique Buff" as const;

export interface FeatureVector {
  cardClass: CardClass;
  cardType: CardType;
  mana: ManaValue;
  rarity: CardRarity;
  target: CardTarget;
  powers: string[];
  keywords: CardKeyword[];
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
  schemaVersion: 2;
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
