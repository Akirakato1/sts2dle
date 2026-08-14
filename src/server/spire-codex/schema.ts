import { z } from "zod";
import { CARD_RARITIES, CARD_TARGETS, CARD_TYPES } from "../../shared/domain.js";

const UpgradeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const UpgradeSchema = z.record(z.string(), UpgradeValueSchema);
const powersAppliedSchema = z.object({
  power: z.string().min(1),
  power_key: z.string().min(1),
  amount: z.number().finite(),
}).strict();

export const RawSpireCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  type: z.string().min(1),
  type_key: z.enum(CARD_TYPES),
  rarity: z.string().nullable(),
  rarity_key: z.enum(CARD_RARITIES),
  cost: z.number().nullable(),
  is_x_cost: z.boolean().nullable().optional(),
  target: z.enum(CARD_TARGETS),
  powers_applied: z.array(powersAppliedSchema).nullable(),
  star_cost: z.union([z.number(), z.string()]).nullable().optional(),
  description: z.string().default(""),
  upgrade_description: z.string().nullable().optional(),
  keywords_key: z.array(z.string()).nullable().optional(),
  upgrade: UpgradeSchema.nullable().optional(),
  image_url: z.string().nullable(),
  image_url_card: z.string().nullable(),
  image_url_card_upg: z.string().nullable(),
  type_variants: z.unknown().nullable().optional(),
}).passthrough();

export const RawSpireCardsSchema = z.array(RawSpireCardSchema);
export type RawSpireCard = z.infer<typeof RawSpireCardSchema>;
