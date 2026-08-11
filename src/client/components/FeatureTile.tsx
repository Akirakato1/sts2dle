import React, { useEffect, useState, type CSSProperties } from "react";

import type { FeatureResult, ManaHint, TileColor } from "../../shared/comparison.js";
import type { FeatureName } from "../../shared/domain.js";

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
  unplayable: "Unplayable",
};

const HINT_TEXT: Record<ManaHint, string> = {
  none: "",
  up: "\u2191",
  down: "\u2193",
  dash: "\u2013",
  both: "\u2191\u2193",
  "up-dash": "\u2191 \u2013",
  "down-dash": "\u2193 \u2013",
};

const HINT_LABELS: Record<ManaHint, string> = {
  none: "",
  up: "up",
  down: "down",
  dash: "dash",
  both: "both",
  "up-dash": "up and dash",
  "down-dash": "down and dash",
};

const TILE_COLORS: Record<TileColor, string> = {
  green: "#2f7d4a",
  yellow: "#a7791d",
  red: "#963d36",
};

const RESULT_MARKS: Record<TileColor, string> = {
  green: "\u2713",
  yellow: "\u2248",
  red: "\u00d7",
};

function formatBooleanValue(result: FeatureResult): string {
  if (result.feature === "cardClass" || result.feature === "cardType" || result.feature === "mana" || result.feature === "rarity") {
    return result.displayValue;
  }
  return result.displayValue
    .split(" \u2192 ")
    .map((value) => value === "false" ? "-" : value)
    .join(" \u2192 ");
}

export interface FeatureTileProps {
  result: FeatureResult;
  revealIndex: number;
  animate?: boolean;
  onRevealEnd?: () => void;
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

  const displayValue = formatBooleanValue(result);
  const hint = result.color === "green" ? "none" : result.hint;
  const hintText = HINT_TEXT[hint];
  const label = `${FEATURE_LABELS[result.feature]}: ${displayValue}. Result: ${result.color}.${hint === "none" ? "" : ` Direction: ${HINT_LABELS[hint]}.`}`;
  const style = {
    "--reveal-index": String(revealIndex),
    "--tile-color": TILE_COLORS[result.color],
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
        <span className="feature-tile__result-mark">{RESULT_MARKS[result.color]}</span>
        <span className="feature-tile__value">{displayValue}</span>
        {hintText && <span className={`feature-tile__hint feature-tile__hint--${result.color}`}>{hintText}</span>}
      </span>
    </div>
  </div>;
}
