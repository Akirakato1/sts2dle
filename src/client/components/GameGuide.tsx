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
      <p>Each orb is a one-use aid and is permanently consumed for that round. Use an orb by drag and drop, or with click, tap, or keyboard controls.</p>
      <p>Reveal Orb targets a feature header and shows the answer&apos;s full base and upgraded pair. Filter Orb targets a green result and marks candidates with that exact pair in green. Negation Orb targets a red result to exclude that pair; red exclusion takes priority over green.</p>
      <p>Candidate controls are advisory and can show or hide neutral, green, and red candidates without changing which names are accepted. If filtering produces an empty candidate list, focus remains on the search field and the empty candidate list is announced.</p>
      <p>After five wrong guesses, the name appears as blank boxes. At seven wrong guesses, the first word&apos;s initial appears. Subsequent guesses reveal the remaining word initials, then other letters progressively.</p>
      <p>Hardcore Daily is a separate daily round with no orbs or name hints.</p>
      <p>Practice remembers the current random round in this browser. Its Hardcore choice is locked after the first guess or orb. Use End game to forfeit and reveal the answers, then choose New Practice Round; the next-round choice persists locally.</p>
    </details>
  </section>;
}
