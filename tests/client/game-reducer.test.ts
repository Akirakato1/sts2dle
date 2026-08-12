import { describe, expect, test } from "vitest";

import type { CardIdentity } from "../../src/shared/domain.js";
import { pairKey } from "../../src/shared/feature-keys.js";
import { gameReducer, type RoundState } from "../../src/client/game/game-reducer.js";

function card(id: string, mana: number): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "https://art.example/card.png", baseCardUrl: null, upgradedCardUrl: null,
    base: { cardClass: "Silent", cardType: "Skill", mana, rarity: "Rare", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false },
    upgraded: { cardClass: "Silent", cardType: "Skill", mana: mana - 1, rarity: "Rare", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false },
  };
}

const answer = card("ANSWER", 2);
const guess = card("GUESS", 1);
const equivalent = card("EQUIVALENT", 2);
const round: RoundState = { mode: "daily", answer: { baseGroupKey: "base", selectedCardId: "ANSWER", pairKey: pairKey(answer), acceptedCardIds: ["ANSWER", "EQUIVALENT"] }, guesses: [], status: "playing", error: null };

describe("gameReducer", () => {
  test("records comparison results for a valid card without ending the round", () => {
    const next = gameReducer(round, { type: "submit", card: guess, answerCard: answer });
    expect(next.guesses[0]?.results).toHaveLength(10);
    expect(next.status).toBe("playing");
  });

  test("rejects a duplicate card without adding another guess", () => {
    const submitted = gameReducer(round, { type: "submit", card: guess, answerCard: answer });
    const next = gameReducer(submitted, { type: "submit", card: guess, answerCard: answer });
    expect(next.guesses).toHaveLength(1);
    expect(next.error).toMatch(/already guessed/i);
  });

  test("wins when an accepted pair-equivalent card is submitted", () => {
    const next = gameReducer(round, { type: "submit", card: equivalent, answerCard: answer });
    expect(next.status).toBe("won");
  });

  test("starts a blank practice round with a replacement answer", () => {
    const replacement = { ...round.answer, selectedCardId: "GUESS" };
    const played = gameReducer(round, { type: "submit", card: guess, answerCard: answer });
    const next = gameReducer(played, { type: "new-practice-round", answer: replacement });
    expect(next).toMatchObject({ mode: "practice", answer: replacement, guesses: [], status: "playing", error: null });
  });
});
