import { describe, expect, expectTypeOf, test } from "vitest";

import { createDefaultAssistance } from "../../src/client/game/assistance.js";
import {
  createRoundState,
  gameReducer,
  type RoundState,
} from "../../src/client/game/game-reducer.js";
import { createDefaultPracticeFilter } from "../../src/client/game/practice-filter.js";
import type { CardIdentity } from "../../src/shared/domain.js";
import { pairKey } from "../../src/shared/feature-keys.js";

function card(id: string, mana: number): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "https://art.example/card.png", baseCardUrl: null, upgradedCardUrl: null,
    base: { cardClass: "Silent", cardType: "Skill", mana, rarity: "Rare", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false },
    upgraded: { cardClass: "Silent", cardType: "Skill", mana: mana - 1, rarity: "Rare", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false },
  };
}

const answerCard = card("ANSWER", 2);
const guessCard = card("GUESS", 1);
const equivalentCard = card("EQUIVALENT", 2);
const otherCard = card("OTHER", 3);
const cardsById = new Map([
  [answerCard.id, answerCard],
  [guessCard.id, guessCard],
  [equivalentCard.id, equivalentCard],
  [otherCard.id, otherCard],
]);
const selectedAnswer = {
  baseGroupKey: "base",
  selectedCardId: answerCard.id,
  pairKey: pairKey(answerCard),
  acceptedCardIds: [answerCard.id, equivalentCard.id],
};

function practice(): RoundState {
  return createRoundState({
    mode: "practice",
    hardcore: false,
    roundId: "practice:round-id",
    hintSeed: "round-id",
    answer: selectedAnswer,
  });
}

describe("gameReducer", () => {
  test("RoundState requires every durable field and rejects deterministic mode contradictions", () => {
    expectTypeOf<RoundState>().toMatchTypeOf<{
      hardcore: boolean;
      roundId: string;
      hintSeed: string;
      terminalGuessCount: number | null;
      assistance: ReturnType<typeof createDefaultAssistance> | null;
      practiceFilter: ReturnType<typeof createDefaultPracticeFilter> | null;
    }>();
    expect(() => createRoundState({
      mode: "daily", hardcore: true, roundId: "daily:date:revision", hintSeed: "seed", answer: selectedAnswer,
    })).toThrow(/hardcore/i);
    expect(() => createRoundState({
      mode: "hardcore-daily", hardcore: false, roundId: "hardcore-daily:date:revision", hintSeed: "seed", answer: selectedAnswer,
    })).toThrow(/hardcore/i);
    expect(() => createRoundState({
      mode: "practice", hardcore: true, roundId: "practice:round-id", hintSeed: "seed", answer: selectedAnswer,
    })).toThrow(/hardcore/i);
  });

  test("submits canonical results and wins only for an accepted card ID", () => {
    const round = practice();
    const played = gameReducer(round, { type: "submit", cardId: guessCard.id, cardsById });
    expect(played.guesses[0]?.results).toHaveLength(10);
    expect(played.status).toBe("playing");
    expect(played.terminalGuessCount).toBeNull();

    const won = gameReducer(played, { type: "submit", cardId: equivalentCard.id, cardsById });
    expect(won.status).toBe("won");
    expect(won.terminalGuessCount).toBe(2);
  });

  test("rejects missing, duplicate, and post-terminal submissions idempotently", () => {
    const round = practice();
    expect(gameReducer(round, { type: "submit", cardId: "MISSING", cardsById })).toBe(round);
    const submitted = gameReducer(round, { type: "submit", cardId: guessCard.id, cardsById });
    expect(gameReducer(submitted, { type: "submit", cardId: guessCard.id, cardsById })).toBe(submitted);
    const won = gameReducer(round, { type: "submit", cardId: answerCard.id, cardsById });
    expect(gameReducer(won, { type: "submit", cardId: otherCard.id, cardsById })).toBe(won);
  });

  test("consumes each orb once and validates constraint colors against canonical guesses", () => {
    const normalPractice = gameReducer(practice(), { type: "submit", cardId: guessCard.id, cardsById });
    const greenTarget = { guessIndex: 0, cardId: guessCard.id, feature: "rarity" as const };
    const otherGreenTarget = { guessIndex: 0, cardId: guessCard.id, feature: "cardType" as const };
    const redTarget = { guessIndex: 0, cardId: guessCard.id, feature: "mana" as const };

    const filtered = gameReducer(normalPractice, { type: "consume-filter", target: greenTarget });
    expect(filtered.assistance?.filter).toEqual(greenTarget);
    expect(gameReducer(filtered, { type: "consume-filter", target: otherGreenTarget })).toBe(filtered);
    expect(gameReducer(normalPractice, { type: "consume-filter", target: redTarget })).toBe(normalPractice);

    const negated = gameReducer(normalPractice, { type: "consume-negation", target: redTarget });
    expect(negated.assistance?.negation).toEqual(redTarget);
    expect(gameReducer(negated, { type: "consume-negation", target: redTarget })).toBe(negated);
    expect(gameReducer(normalPractice, { type: "consume-negation", target: greenTarget })).toBe(normalPractice);

    const revealed = gameReducer(practice(), { type: "consume-reveal", target: { feature: "mana" } });
    expect(revealed.assistance?.reveal).toEqual({ feature: "mana" });
    expect(gameReducer(revealed, { type: "consume-reveal", target: { feature: "rarity" } })).toBe(revealed);
  });

  test("rejects malformed constraint references, Hardcore Daily orb use, and terminal orb use", () => {
    const played = gameReducer(practice(), { type: "submit", cardId: guessCard.id, cardsById });
    const valid = { guessIndex: 0, cardId: guessCard.id, feature: "rarity" as const };
    for (const target of [
      { ...valid, guessIndex: -1 },
      { ...valid, guessIndex: 0.5 },
      { ...valid, guessIndex: 1 },
      { ...valid, cardId: otherCard.id },
    ]) expect(gameReducer(played, { type: "consume-filter", target })).toBe(played);

    const hardcore = createRoundState({
      mode: "hardcore-daily",
      hardcore: true,
      roundId: "hardcore-daily:2026-08-13:revision",
      hintSeed: "hardcore-daily:2026-08-13:revision",
      answer: selectedAnswer,
    });
    expect(gameReducer(hardcore, { type: "consume-reveal", target: { feature: "mana" } })).toBe(hardcore);
    const won = gameReducer(practice(), { type: "submit", cardId: answerCard.id, cardsById });
    expect(gameReducer(won, { type: "consume-reveal", target: { feature: "mana" } })).toBe(won);
    expect(gameReducer(won, { type: "set-candidate-visibility", category: "green", visible: false })).toBe(won);
  });

  test("visibility changes are idempotent", () => {
    const round = practice();
    const hidden = gameReducer(round, { type: "set-candidate-visibility", category: "green", visible: false });
    expect(hidden.assistance?.visibility.green).toBe(false);
    expect(gameReducer(hidden, { type: "set-candidate-visibility", category: "green", visible: false })).toBe(hidden);
  });

  test("new Practice rounds always use standard assistance and a default manual filter", () => {
    const round = practice();
    expect(round.hardcore).toBe(false);
    expect(round.assistance).toEqual(createDefaultAssistance());
    expect(round.practiceFilter).toEqual(createDefaultPracticeFilter());
  });

  test("updates Practice filter mode, group disable, and selected values immutably and idempotently", () => {
    const round = practice();
    const enabled = gameReducer(round, { type: "set-practice-filter-enabled", enabled: true });
    expect(enabled.practiceFilter?.enabled).toBe(true);
    expect(gameReducer(enabled, { type: "set-practice-filter-enabled", enabled: true })).toBe(enabled);

    const selected = gameReducer(enabled, {
      type: "set-practice-filter-value", group: "cardClass", value: "Silent", selected: true,
    });
    expect(selected.practiceFilter?.cardClass.selected).toEqual(["Silent"]);
    expect(selected.practiceFilter).not.toBe(enabled.practiceFilter);
    expect(gameReducer(selected, {
      type: "set-practice-filter-value", group: "cardClass", value: "Silent", selected: true,
    })).toBe(selected);

    const activeGroup = gameReducer(selected, {
      type: "set-practice-filter-group-disabled", group: "cardClass", disabled: false,
    });
    expect(activeGroup.practiceFilter?.cardClass).toEqual({ disabled: false, selected: ["Silent"] });
    expect(gameReducer(activeGroup, {
      type: "set-practice-filter-group-disabled", group: "cardClass", disabled: false,
    })).toBe(activeGroup);
  });

  test("Practice filter actions are ignored outside active Practice", () => {
    const daily = createRoundState({
      mode: "daily", hardcore: false, roundId: "daily:2026-08-13:revision", hintSeed: "daily:2026-08-13:revision", answer: selectedAnswer,
    });
    const hardcoreDaily = createRoundState({
      mode: "hardcore-daily", hardcore: true, roundId: "hardcore-daily:2026-08-13:revision", hintSeed: "hardcore-daily:2026-08-13:revision", answer: selectedAnswer,
    });
    const terminal = gameReducer(practice(), { type: "forfeit-practice" });
    const action = { type: "set-practice-filter-enabled", enabled: true } as const;
    expect(daily.practiceFilter).toBeNull();
    expect(hardcoreDaily.practiceFilter).toBeNull();
    expect(gameReducer(daily, action)).toBe(daily);
    expect(gameReducer(hardcoreDaily, action)).toBe(hardcoreDaily);
    expect(gameReducer(terminal, action)).toBe(terminal);
  });

  test("submissions retain the Practice filter and replacement uses the supplied filter state", () => {
    const configured = gameReducer(
      gameReducer(practice(), { type: "set-practice-filter-enabled", enabled: true }),
      { type: "set-practice-filter-value", group: "mana", value: 1, selected: true },
    );
    const submitted = gameReducer(configured, { type: "submit", cardId: guessCard.id, cardsById });
    expect(submitted.practiceFilter).toBe(configured.practiceFilter);

    const replacement = gameReducer(practice(), { type: "set-practice-filter-enabled", enabled: true });
    expect(gameReducer(configured, { type: "replace-round", round: replacement })).toBe(replacement);
  });

  test("forfeits only an active Practice round and records the terminal guess count", () => {
    const normalPractice = practice();
    expect(gameReducer(normalPractice, { type: "forfeit-practice" })).toMatchObject({
      status: "forfeited",
      terminalGuessCount: 0,
    });
    const dailyRound = createRoundState({
      mode: "daily", hardcore: false, roundId: "daily:2026-08-13:revision", hintSeed: "daily-seed", answer: selectedAnswer,
    });
    expect(gameReducer(dailyRound, { type: "forfeit-practice" })).toBe(dailyRound);
    const won = gameReducer(normalPractice, { type: "submit", cardId: answerCard.id, cardsById });
    expect(gameReducer(won, { type: "forfeit-practice" })).toBe(won);
  });

  test("replace-round returns the supplied state without mutating it", () => {
    const original = practice();
    const replacement = createRoundState({
      mode: "hardcore-daily", hardcore: true, roundId: "hardcore-daily:2026-08-13:revision", hintSeed: "hardcore-seed", answer: selectedAnswer,
    });
    expect(gameReducer(original, { type: "replace-round", round: replacement })).toBe(replacement);
  });
});
