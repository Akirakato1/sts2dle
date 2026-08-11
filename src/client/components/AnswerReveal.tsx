import React, { useMemo } from "react";

import type { CardIdentity } from "../../shared/domain.js";
import type { SelectedAnswer } from "../../shared/selection.js";
import { CardStack } from "./CardStack.js";

export interface AnswerRevealProps {
  answer: SelectedAnswer;
  cardsById: ReadonlyMap<string, CardIdentity>;
}

export function AnswerReveal({ answer, cardsById }: AnswerRevealProps) {
  const cards = useMemo(() => answer.acceptedCardIds
    .map((id) => cardsById.get(id))
    .filter((card): card is CardIdentity => card !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name)), [answer.acceptedCardIds, cardsById]);

  return <section className="answer-reveal" aria-labelledby="answer-reveal-heading">
    <h2 id="answer-reveal-heading">Accepted answer{cards.length === 1 ? "" : "s"}</h2>
    <div className="answer-reveal__cards">
      {cards.map((card) => <article className="answer-reveal__card" key={card.id}>
        <h3>{card.name}</h3>
        <CardStack
          name={card.name}
          baseUrl={card.baseCardUrl ?? ""}
          upgradedUrl={card.hasUpgrade ? card.upgradedCardUrl : null}
        />
      </article>)}
    </div>
  </section>;
}
