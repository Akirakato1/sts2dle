import React, { useEffect, useState, type CSSProperties } from "react";

import { KeywordStateIcons, type KeywordStateDisplayValue } from "./KeywordStateIcons.js";
import { useOrbInteraction } from "./OrbInteractionContext.js";
import { OrbVisual } from "./OrbVisual.js";
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

export function keywordAccessibleValue(value: string): string {
  return value.split(" \u2192 ")
    .map((part) => part === "true" ? "present" : "absent")
    .join(" to ");
}

function isCoreFeature(feature: FeatureName): boolean {
  return feature === "cardClass" || feature === "cardType" || feature === "mana" || feature === "rarity";
}

export interface FeatureTileProps {
  result: FeatureResult;
  cardId: string;
  chronologicalGuessIndex: number;
  revealIndex: number;
  animate?: boolean;
  orbBadge?: "filter" | "negation";
  onRevealEnd?: (event: React.TransitionEvent<HTMLDivElement>) => void;
}

export function FeatureTile({
  result,
  cardId,
  chronologicalGuessIndex,
  revealIndex,
  animate = true,
  orbBadge,
  onRevealEnd,
}: FeatureTileProps) {
  const [revealed, setRevealed] = useState(!animate);
  const [fullyRevealed, setFullyRevealed] = useState(!animate);
  useEffect(() => {
    if (!animate) {
      setRevealed(true);
      setFullyRevealed(true);
      return;
    }
    setFullyRevealed(false);
    if (typeof requestAnimationFrame !== "function") {
      setRevealed(true);
      return;
    }
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  const coreFeature = isCoreFeature(result.feature);
  const visualValue = coreFeature ? result.displayValue : <KeywordStateIcons displayValue={result.displayValue as KeywordStateDisplayValue} />;
  const accessibleValue = coreFeature ? result.displayValue : keywordAccessibleValue(result.displayValue);
  const label = `${FEATURE_LABELS[result.feature]}: ${accessibleValue}. Result: ${result.color}.`;
  const target = {
    kind: "tile" as const,
    guessIndex: chronologicalGuessIndex,
    cardId,
    feature: result.feature,
    color: result.color,
    revealed: !animate || fullyRevealed,
  };
  const validFor = target.revealed
    ? result.color === "green"
      ? ["filter"] as const
      : result.color === "red"
        ? ["negation"] as const
        : []
    : [];
  const binding = useOrbInteraction().bindTarget(target, validFor, `${FEATURE_LABELS[result.feature]} ${result.color} result tile`);
  const style = {
    "--reveal-index": String(revealIndex),
    "--tile-color": TILE_COLORS[result.color],
    "--reveal-stagger": `${REVEAL_STAGGER_MS}ms`,
    "--reveal-duration": `${REVEAL_DURATION_MS}ms`,
  } as CSSProperties;

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "transform") setFullyRevealed(true);
    onRevealEnd?.(event);
  };

  return <div
    className={`feature-tile feature-tile--${result.color}${revealed ? " feature-tile--revealed" : ""}${animate ? "" : " feature-tile--immediate"}`}
    role="cell"
    aria-label={label}
    style={style}
  >
    <div className="feature-tile__surface" onTransitionEnd={handleTransitionEnd}>
      <span className="feature-tile__face feature-tile__front" aria-hidden="true" />
      <span className="feature-tile__face feature-tile__back" aria-hidden="true">
        <span className="feature-tile__value">{visualValue}</span>
      </span>
    </div>
    {orbBadge && <span className={`feature-tile__orb-badge feature-tile__orb-badge--${orbBadge}`} role="img" aria-label={`${orbBadge === "filter" ? "Filter" : "Negation"} Orb used here`}>
      <OrbVisual compact kind={orbBadge} />
    </span>}
    {binding.active && <button
      {...binding.targetProps}
      type="button"
      className={`feature-tile__target orb-target--active${binding.valid ? " orb-target--valid" : ""}`}
    />}
  </div>;
}
