import React from "react";

const RESULT_LEGEND = [
  ["green", "Both base and upgraded features match"],
  ["yellow", "Exactly one version matches"],
  ["red", "Neither version matches"],
] as const;

export function GameGuide() {
  return <section className="game-guide" aria-label="Guess result legend and rules">
    <ul className="result-legend">
      {RESULT_LEGEND.map(([color, meaning]) => <li key={color}>
        <span className={`result-legend__swatch result-legend__swatch--${color}`} aria-hidden="true" />
        <span>{meaning}</span>
      </li>)}
    </ul>
    <details className="game-rules">
      <summary>How to play</summary>
      <p>Guess a base card name. Each guess compares the guessed base to the answer base and the guessed upgraded card to the answer upgraded card: base-to-base and upgraded-to-upgraded.</p>
      <p>An X means keyword absent; a checkmark means keyword present.</p>
      <p>Cards with identical complete paired feature sets are accepted as equivalent answers.</p>
      <p>Daily uses the UTC date, restores your progress, and produces a share result after a win.</p>
      <p>Practice provides unlimited random rounds and no share result.</p>
    </details>
  </section>;
}
