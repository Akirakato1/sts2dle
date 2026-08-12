import React, { type CSSProperties } from "react";

import type { NameHintView } from "../game/name-hints.js";

export interface NameHintProps {
  hint: NameHintView | null;
  cardName: string;
}

type HintStyle = CSSProperties & { "--hint-length": number };

export function NameHint({ hint, cardName }: NameHintProps) {
  if (hint === null) return null;

  const nameWords = [...cardName.matchAll(/[^ ]+/gu)].map((match) => Array.from(match[0]));
  const accessibleWords = hint.words.map((word, wordIndex) => word.characters
    .map((character) => character.revealed
      ? (nameWords[wordIndex]?.[character.position] ?? character.value)
      : "blank")
    .join(" "));

  return <section
    className="name-hint"
    aria-label={`Card name hint: ${accessibleWords.join("; ")}`}
  >
    {hint.words.map((word, wordIndex) => <span
      key={wordIndex}
      className="name-hint__word"
      style={{ "--hint-length": word.length } as HintStyle}
      aria-hidden="true"
    >
      <span className="name-hint__characters">
        {word.characters.map((character) => <span
          key={character.position}
          className={`name-hint__character${character.revealed ? "" : " name-hint__character--hidden"}`}
          aria-hidden="true"
        >{character.revealed ? (nameWords[wordIndex]?.[character.position] ?? character.value) : ""}</span>)}
      </span>
      <span className="name-hint__line" aria-hidden="true" />
    </span>)}
  </section>;
}
