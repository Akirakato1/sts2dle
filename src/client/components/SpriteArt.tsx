import React from "react";

import type { SpriteAtlasMeta, SpriteMap, SpriteRect } from "../../shared/domain.js";

export interface SpriteArtProps {
  cardId: string;
  spriteMap: SpriteMap;
  kind: "candidate" | "guess";
  label: string;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidAtlas(value: unknown): value is SpriteAtlasMeta {
  return isRecord(value)
    && typeof value.url === "string"
    && value.url.trim().length > 0
    && isPositiveFinite(value.width)
    && isPositiveFinite(value.height)
    && isPositiveFinite(value.displayScale);
}

function isValidRect(value: unknown, atlas: SpriteAtlasMeta): value is SpriteRect {
  return isRecord(value)
    && typeof value.x === "number" && Number.isFinite(value.x) && value.x >= 0
    && typeof value.y === "number" && Number.isFinite(value.y) && value.y >= 0
    && isPositiveFinite(value.width)
    && isPositiveFinite(value.height)
    && value.x + value.width <= atlas.width
    && value.y + value.height <= atlas.height;
}

export function SpriteArt({ cardId, spriteMap, kind, label }: SpriteArtProps) {
  const fallback = <span className="sprite-art sprite-art--fallback">{label}</span>;
  const cards: unknown = spriteMap.cards;
  if (!isRecord(cards) || !Object.hasOwn(cards, cardId)) return fallback;

  const sprite = cards[cardId];
  const atlas: unknown = spriteMap[kind];
  if (!isRecord(sprite) || !isValidAtlas(atlas)) return fallback;
  const rect = sprite[kind];
  if (!isValidRect(rect, atlas)) return fallback;
  const scale = atlas.displayScale;
  return <span
    className={`sprite-art sprite-art--${kind}`}
    role="img"
    aria-label={label}
    style={{
      width: rect.width * scale,
      height: rect.height * scale,
      backgroundImage: `url(${atlas.url})`,
      backgroundPosition: `${-rect.x * scale}px ${-rect.y * scale}px`,
      backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
      backgroundRepeat: "no-repeat",
    }}
  />;
}
