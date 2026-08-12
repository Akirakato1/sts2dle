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
      <p>Each guess compares its base card and upgrade together. Match every trait to find today&apos;s card.</p>
      <p>Multiple cards may be accepted when they share the same base card.</p>
      <p>Daily puzzles use the UTC date. Practice lets you play a random card anytime.</p>
    </details>
  </section>;
}
