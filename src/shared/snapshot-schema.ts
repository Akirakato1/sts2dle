import { z } from "zod";

export const SOURCE_REVISION_PATTERN = /^[a-f0-9]{64}$/;

export function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value;
}

const sourceRevisionSchema = z.string().regex(SOURCE_REVISION_PATTERN);
const canonicalTimestampSchema = z.string().refine(isCanonicalIsoTimestamp);

const featureVectorSchema = z.object({
  cardClass: z.enum(["Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event"]),
  cardType: z.enum(["Attack", "Skill", "Power", "Quest", "Status", "Curse"]),
  mana: z.union([z.number(), z.literal("X"), z.literal("\u2013")]),
  rarity: z.enum(["Common", "Uncommon", "Rare", "None"]),
  eternal: z.boolean(), ethereal: z.boolean(), exhaust: z.boolean(), innate: z.boolean(), retain: z.boolean(), sly: z.boolean(), unplayable: z.boolean(),
});

export const cardIdentitySchema = z.object({
  id: z.string(), name: z.string(), duplicateName: z.boolean().optional(), hasUpgrade: z.boolean(), artUrl: z.string(),
  baseCardUrl: z.string().nullable(), upgradedCardUrl: z.string().nullable(), base: featureVectorSchema, upgraded: featureVectorSchema,
});
export const groupSchema = z.object({ key: z.string(), cardIds: z.array(z.string()).min(1) });
export const snapshotManifestSchema = z.object({
  schemaVersion: z.literal(1), sourceRevision: sourceRevisionSchema, sourceLastModified: z.string().nullable(), fetchedAt: canonicalTimestampSchema, generatedAt: canonicalTimestampSchema,
  cardCount: z.number().int().nonnegative(), upgradeCount: z.number().int().nonnegative(), baseGroupCount: z.number().int().nonnegative(), pairGroupCount: z.number().int().nonnegative(), files: z.record(z.string(), z.string()),
});
const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const atlasSchema = z.object({ url: z.string(), width: z.number(), height: z.number(), displayScale: z.number() });
export const spriteMapSchema = z.object({ candidate: atlasSchema, guess: atlasSchema, cards: z.record(z.string(), z.object({ candidate: rectSchema, guess: rectSchema })) });
