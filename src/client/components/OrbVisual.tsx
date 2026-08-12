import React, { useId } from "react";

import type { OrbKind } from "../game/assistance.js";

export interface OrbVisualProps {
  kind: OrbKind;
  compact?: boolean;
}

export const ORB_LABELS: Readonly<Record<OrbKind, string>> = {
  reveal: "Reveal",
  filter: "Filter",
  negation: "Negation",
};

function OrbMotif({ kind }: { kind: OrbKind }) {
  if (kind === "reveal") {
    return <g className="orb-visual__motif orb-visual__motif--reveal">
      <path data-icon="reveal-eye" d="M13 26c5.8-8.4 16.2-8.4 22 0-5.8 8.4-16.2 8.4-22 0Z" />
      <circle data-icon="reveal-pupil" cx="24" cy="26" r="4.2" />
      <path data-icon="reveal-star" d="m35 12 1.4 3.2 3.2 1.4-3.2 1.4-1.4 3.2-1.4-3.2-3.2-1.4 3.2-1.4Z" />
    </g>;
  }

  if (kind === "filter") {
    return <g className="orb-visual__motif orb-visual__motif--filter">
      <path data-icon="filter-funnel" d="M12 14h24l-9 11v10l-6 3V25Z" />
      <path data-icon="filter-check" d="m18 27 4 4 8-9" />
      <path data-icon="filter-scan" d="M12 19h24" />
    </g>;
  }

  return <g className="orb-visual__motif orb-visual__motif--negation">
    <path data-icon="negation-x" d="m17 17 14 18M31 17 17 35" />
    <path data-icon="negation-bar" d="M13 36 35 14" />
    <path data-icon="negation-ember" d="M24 9c4 4 5 7 1 11 0-3-2-4-4-6-1 3-3 5-1 8" />
  </g>;
}

export function OrbVisual({ kind, compact = false }: OrbVisualProps) {
  const id = useId().replaceAll(":", "");
  const size = compact ? 30 : 52;

  return <svg
    aria-hidden="true"
    className={`orb-visual orb-visual--${kind}${compact ? " orb-visual--compact" : ""}`}
    data-orb-kind={kind}
    focusable="false"
    height={size}
    viewBox="0 0 48 48"
    width={size}
  >
    <defs>
      <radialGradient id={`${id}-surface`} cx="34%" cy="26%" r="68%">
        <stop className="orb-visual__highlight" offset="0" />
        <stop className="orb-visual__surface" offset=".56" />
        <stop className="orb-visual__shadow" offset="1" />
      </radialGradient>
      <radialGradient id={`${id}-shine`} cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#fff" stopOpacity=".82" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle className="orb-visual__rim" cx="24" cy="24" r="21" />
    <circle className="orb-visual__sphere" cx="24" cy="24" r="18.5" fill={`url(#${id}-surface)`} />
    <ellipse className="orb-visual__shine" cx="18" cy="15" rx="9" ry="6" fill={`url(#${id}-shine)`} />
    <OrbMotif kind={kind} />
  </svg>;
}
