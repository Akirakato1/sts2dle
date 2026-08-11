import { createHash } from "node:crypto";

export function fallbackFilename(cardId: string, upgraded: boolean): string {
  const digest = createHash("sha256").update(cardId, "utf8").digest("hex");
  return `${digest}${upgraded ? "_upg" : ""}.webp`;
}

export function fallbackUrl(cardId: string, upgraded: boolean): string {
  return `/runtime/fallback/${fallbackFilename(cardId, upgraded)}`;
}
