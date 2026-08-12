import React, { useEffect, useState, type CSSProperties } from "react";

import type { FeatureResult, TileColor } from "../../shared/comparison.js";
import type { FeatureName } from "../../shared/domain.js";

export const REVEAL_STAGGER_MS = 110;
export const REVEAL_DURATION_MS = 420;

export const FEATURE_LABELS: Record<FeatureName, string> = {
  cardClass: "Class",
  cardType: "Type",
  mana: "Mana",
  rarity: "Rarity",
  eternal: "Eternal",
  ethereal: "Ethereal",
  exhaust: "Exhaust",
  innate: "Innate",
  retain: "Retain",
  sly: "Sly",
};

const TILE_COLORS: Record<TileColor, string> = {
  green: "#2f7d4a",
  yellow: "#a7791d",
  red: "#963d36",
};

function keywordVisualValue(value: string): string {
  return value.split(" \u2192 ").map((part) => part === "true" ? "Yes" : "").join(" \u2192 ");
}

function keywordAccessibleValue(value: string): string {
  return value.split(" \u2192 ")
    .map((part) => part === "true" ? "present" : "absent")
    .join(" to ");
}

function isCoreFeature(feature: FeatureName): boolean {
  return feature === "cardClass" || feature === "cardType" || feature === "mana" || feature === "rarity";
}

export interface FeatureTileProps {
  result: FeatureResult;
  revealIndex: number;
  animate?: boolean;
  onRevealEnd?: (event: React.TransitionEvent<HTMLDivElement>) => void;
}

export function FeatureTile({ result, revealIndex, animate = true, onRevealEnd }: FeatureTileProps) {
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => {
    if (!animate) {
      setRevealed(true);
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      setRevealed(true);
      return;
    }
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  const coreFeature = isCoreFeature(result.feature);
  const visualValue = coreFeature ? result.displayValue : keywordVisualValue(result.displayValue);
  const accessibleValue = coreFeature ? result.displayValue : keywordAccessibleValue(result.displayValue);
  const label = `${FEATURE_LABELS[result.feature]}: ${accessibleValue}. Result: ${result.color}.`;
  const style = {
    "--reveal-index": String(revealIndex),
    "--tile-color": TILE_COLORS[result.color],
    "--reveal-stagger": `${REVEAL_STAGGER_MS}ms`,
    "--reveal-duration": `${REVEAL_DURATION_MS}ms`,
  } as CSSProperties;

  return <div
    className={`feature-tile feature-tile--${result.color}${revealed ? " feature-tile--revealed" : ""}${animate ? "" : " feature-tile--immediate"}`}
    role="cell"
    aria-label={label}
    style={style}
  >
    <div className="feature-tile__surface" onTransitionEnd={onRevealEnd}>
      <span className="feature-tile__face feature-tile__front" aria-hidden="true" />
      <span className="feature-tile__face feature-tile__back" aria-hidden="true">
        <span className="feature-tile__value">{visualValue}</span>
      </span>
    </div>
  </div>;
}
