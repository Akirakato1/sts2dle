import React from "react";

import type { SpriteMap } from "../../shared/domain.js";

export interface SpriteArtProps {
  cardId: string;
  spriteMap: SpriteMap;
  kind: "candidate" | "guess";
  label: string;
}

export function SpriteArt({ cardId, spriteMap, kind, label }: SpriteArtProps) {
  const sprite = spriteMap.cards[cardId];
  if (!sprite) return <span className="sprite-art sprite-art--fallback">{label}</span>;

  const atlas = spriteMap[kind];
  const rect = sprite[kind];
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
