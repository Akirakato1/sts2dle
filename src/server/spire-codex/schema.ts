import { z } from "zod";
import { CARD_KEYWORDS, CARD_RARITIES, CARD_TARGETS, CARD_TYPES } from "../../shared/domain.js";

const UpgradeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const KeywordUpgradeValueSchema = z.union([z.number(), z.boolean()]);
const keywordKeys = new Set<string>(CARD_KEYWORDS.map((keyword) => keyword.toLowerCase()));
const keywordUpgradeKeys = new Set<string>(CARD_KEYWORDS.flatMap((keyword) => {
  const suffix = keyword.toLowerCase();
  return [`add_${suffix}`, `remove_${suffix}`];
}));
const KeywordSchema = z.string().refine(
  (keyword) => keywordKeys.has(keyword.toLowerCase()),
  "Unknown card keyword",
);
const UpgradeSchema = z.record(z.string(), UpgradeValueSchema).superRefine((upgrade, context) => {
  for (const [key, value] of Object.entries(upgrade)) {
    if (!key.startsWith("add_") && !key.startsWith("remove_")) continue;
    if (!keywordUpgradeKeys.has(key)) {
      context.addIssue({ code: "custom", path: [key], message: "Unknown keyword upgrade field" });
      continue;
    }
    if (!KeywordUpgradeValueSchema.safeParse(value).success) {
      context.addIssue({ code: "custom", path: [key], message: "Invalid keyword upgrade value" });
    }
  }
});
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
  keywords_key: z.array(KeywordSchema).nullable().optional(),
  upgrade: UpgradeSchema.nullable().optional(),
  image_url: z.string().nullable(),
  image_url_card: z.string().nullable(),
  image_url_card_upg: z.string().nullable(),
  type_variants: z.unknown().nullable().optional(),
}).passthrough();

export const RawSpireCardsSchema = z.array(RawSpireCardSchema);
export type RawSpireCard = z.infer<typeof RawSpireCardSchema>;
