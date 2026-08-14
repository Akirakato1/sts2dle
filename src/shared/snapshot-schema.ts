import { z } from "zod";
import { CARD_KEYWORDS, CARD_RARITIES, CARD_TARGETS, CARD_TYPES, UNIQUE_POWER } from "./domain.js";

export const SOURCE_REVISION_PATTERN = /^[a-f0-9]{64}$/;

export function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value;
}

const sourceRevisionSchema = z.string().regex(SOURCE_REVISION_PATTERN);
const canonicalTimestampSchema = z.string().refine(isCanonicalIsoTimestamp);
const canonicalPowersSchema = z.array(z.string().min(1)).refine((powers) => {
  if (new Set(powers).size !== powers.length) return false;
  const recurring = powers.filter((power) => power !== UNIQUE_POWER);
  const expected = [...recurring].sort((left, right) => left.localeCompare(right, "en-US"));
  if (powers.includes(UNIQUE_POWER)) expected.push(UNIQUE_POWER);
  return powers.length === expected.length && powers.every((power, index) => power === expected[index]);
});
const canonicalKeywordsSchema = z.array(z.enum(CARD_KEYWORDS)).refine((keywords) => {
  if (new Set(keywords).size !== keywords.length) return false;
  const expected = CARD_KEYWORDS.filter((keyword) => keywords.includes(keyword));
  return keywords.length === expected.length && keywords.every((keyword, index) => keyword === expected[index]);
});

const featureVectorSchema = z.object({
  cardClass: z.enum(["Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event"]),
  cardType: z.enum(CARD_TYPES),
  mana: z.union([z.number(), z.literal("X"), z.literal("None")]),
  rarity: z.enum(CARD_RARITIES),
  target: z.enum(CARD_TARGETS),
  powers: canonicalPowersSchema,
  keywords: canonicalKeywordsSchema,
}).strict();

export const cardIdentitySchema = z.object({
  id: z.string(), name: z.string(), duplicateName: z.boolean().optional(), hasUpgrade: z.boolean(), artUrl: z.string(),
  baseCardUrl: z.string().nullable(), upgradedCardUrl: z.string().nullable(), base: featureVectorSchema, upgraded: featureVectorSchema,
});
export const groupSchema = z.object({ key: z.string(), cardIds: z.array(z.string()).min(1) });
export const snapshotManifestSchema = z.object({
  schemaVersion: z.literal(2), sourceRevision: sourceRevisionSchema, sourceLastModified: z.string().nullable(), fetchedAt: canonicalTimestampSchema, generatedAt: canonicalTimestampSchema,
  cardCount: z.number().int().nonnegative(), upgradeCount: z.number().int().nonnegative(), baseGroupCount: z.number().int().nonnegative(), pairGroupCount: z.number().int().nonnegative(), files: z.record(z.string(), z.string()),
});
const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const atlasSchema = z.object({ url: z.string(), width: z.number(), height: z.number(), displayScale: z.number() });
export const spriteMapSchema = z.object({ candidate: atlasSchema, guess: atlasSchema, cards: z.record(z.string(), z.object({ candidate: rectSchema, guess: rectSchema })) });
