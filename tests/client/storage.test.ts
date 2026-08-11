import { describe, expect, test } from "vitest";

import {
  DAILY_STATS_KEY,
  dailyStorageKey,
  loadDailyRound,
  loadDailyStats,
  msUntilNextUtcDay,
  recordDailyCompletion,
  saveDailyRound,
} from "../../src/client/game/storage.js";
import { compareGuess } from "../../src/shared/comparison.js";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import type { RoundState } from "../../src/client/game/game-reducer.js";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const base = {
  cardClass: "Silent" as const,
  cardType: "Skill" as const,
  mana: 1,
  rarity: "Rare" as const,
  eternal: false,
  ethereal: false,
  exhaust: false,
  innate: false,
  retain: false,
  sly: false,
  unplayable: false,
};

function card(id: string, vector: FeatureVector = base): CardIdentity {
  return {
    id,
    name: `Name ${id}`,
    hasUpgrade: false,
    artUrl: `https://art.example/${id}.png`,
    baseCardUrl: `https://cards.example/${id}.png`,
    upgradedCardUrl: null,
    base: vector,
    upgraded: vector,
  };
}

const answerCard = card("ANSWER");
const guessCard = card("GUESS", {
  ...base,
  cardClass: "Ironclad",
  cardType: "Attack",
  mana: 2,
  rarity: "Common",
  eternal: true,
});
const results = compareGuess(guessCard, answerCard);
const cardsById = new Map([[answerCard.id, answerCard], [guessCard.id, guessCard]]);
const identity = { sourceRevision: "abc", utcDate: "2026-08-12", ruleset: "v1" };
const round: RoundState = {
  mode: "daily",
  answer: {
    baseGroupKey: "base-key",
    selectedCardId: answerCard.id,
    pairKey: "pair-key",
    acceptedCardIds: [answerCard.id],
  },
  guesses: [{ cardId: guessCard.id, results }],
  status: "playing",
  error: "transient UI error",
};

describe("Daily round storage", () => {
  test("uses ruleset, source revision, and UTC date in the Daily key", () => {
    expect(dailyStorageKey(identity)).toBe("stsdle:daily:v1:abc:2026-08-12");
  });

  test("round-trips only serializable Daily answer IDs, guesses/results, and status", () => {
    const storage = new MemoryStorage();
    saveDailyRound(storage, identity, round);

    const raw = storage.getItem(dailyStorageKey(identity));
    expect(raw).not.toContain("transient UI error");
    expect(raw).not.toContain("https://cards.example");
    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toEqual({
      ...round,
      error: null,
    });
  });

  test("separates dates and source revisions without deleting valid sibling keys", () => {
    const storage = new MemoryStorage();
    saveDailyRound(storage, identity, round);
    const otherDate = { ...identity, utcDate: "2026-08-13" };
    const otherRevision = { ...identity, sourceRevision: "def" };

    expect(loadDailyRound(storage, otherDate, cardsById, round.answer)).toBeNull();
    expect(loadDailyRound(storage, otherRevision, cardsById, round.answer)).toBeNull();
    expect(storage.getItem(dailyStorageKey(identity))).not.toBeNull();
  });

  test("deletes only corrupt or snapshot-invalid Daily state", () => {
    const storage = new MemoryStorage();
    const corruptKey = dailyStorageKey(identity);
    const validIdentity = { ...identity, utcDate: "2026-08-11" };
    saveDailyRound(storage, validIdentity, round);
    storage.setItem("unrelated", "keep me");
    storage.setItem(corruptKey, "{ definitely not json");

    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toBeNull();
    expect(storage.getItem(corruptKey)).toBeNull();
    expect(storage.getItem(dailyStorageKey(validIdentity))).not.toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep me");

    saveDailyRound(storage, identity, round);
    expect(loadDailyRound(storage, identity, new Map([[answerCard.id, answerCard]]), round.answer)).toBeNull();
    expect(storage.getItem(corruptKey)).toBeNull();
  });

  test("restores settled results without persisting animation state", () => {
    const storage = new MemoryStorage();
    saveDailyRound(storage, identity, round);
    const raw = storage.getItem(dailyStorageKey(identity));
    expect(raw).not.toMatch(/animat|reveal/i);
    expect(loadDailyRound(storage, identity, cardsById, round.answer)?.guesses).toEqual(round.guesses);
  });

  test("rejects tampered results instead of trusting structurally valid values", () => {
    const storage = new MemoryStorage();
    saveDailyRound(storage, identity, round);
    const key = dailyStorageKey(identity);
    const stored = JSON.parse(storage.getItem(key)!);
    stored.guesses[0].results[0].color = "green";
    storage.setItem(key, JSON.stringify(stored));

    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  test("rejects status that disagrees with whether an accepted answer was guessed", () => {
    const storage = new MemoryStorage();
    const winningGuess = { cardId: answerCard.id, results: compareGuess(answerCard, answerCard) };

    saveDailyRound(storage, identity, { ...round, guesses: [winningGuess], status: "playing" });
    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toBeNull();

    saveDailyRound(storage, identity, { ...round, status: "won" });
    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toBeNull();
  });

  test("rejects duplicate guesses and guesses submitted after the winning answer", () => {
    const storage = new MemoryStorage();
    const winningGuess = { cardId: answerCard.id, results: compareGuess(answerCard, answerCard) };

    saveDailyRound(storage, identity, { ...round, guesses: [round.guesses[0]!, round.guesses[0]!] });
    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toBeNull();

    saveDailyRound(storage, identity, { ...round, guesses: [winningGuess, round.guesses[0]!], status: "won" });
    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toBeNull();

    const alternateAnswerCard = card("ANSWER_ALT");
    const multiAnswer = { ...round.answer, acceptedCardIds: [answerCard.id, alternateAnswerCard.id] };
    const multiCardsById = new Map([...cardsById, [alternateAnswerCard.id, alternateAnswerCard] as const]);
    saveDailyRound(storage, identity, {
      ...round,
      answer: multiAnswer,
      guesses: [winningGuess, { cardId: alternateAnswerCard.id, results: compareGuess(alternateAnswerCard, answerCard) }],
      status: "won",
    });
    expect(loadDailyRound(storage, identity, multiCardsById, multiAnswer)).toBeNull();
  });

  test("returns canonical recomputed results for a valid winning round", () => {
    const storage = new MemoryStorage();
    const winningGuess = { cardId: answerCard.id, results: compareGuess(answerCard, answerCard) };
    saveDailyRound(storage, identity, { ...round, guesses: [round.guesses[0]!, winningGuess], status: "won" });

    expect(loadDailyRound(storage, identity, cardsById, round.answer)).toMatchObject({
      status: "won",
      guesses: [round.guesses[0]!, winningGuess],
    });
  });

  test("does not write Daily state for Practice", () => {
    const storage = new MemoryStorage();
    saveDailyRound(storage, identity, { ...round, mode: "practice" });
    expect(storage.length).toBe(0);
  });
});

describe("UTC rollover", () => {
  test.each([
    ["2026-08-12T23:59:59.250Z", 750],
    ["2026-08-31T23:59:00.000Z", 60_000],
    ["2026-12-31T23:00:00.000Z", 3_600_000],
    ["2027-01-01T00:00:00.000Z", 86_400_000],
  ])("calculates the next UTC day from %s", (timestamp, expected) => {
    expect(msUntilNextUtcDay(new Date(timestamp))).toBe(expected);
  });
});

describe("global Daily streak storage", () => {
  test("starts at one, increments on the next day, and preserves its maximum after a gap", () => {
    const storage = new MemoryStorage();
    expect(recordDailyCompletion(storage, "2026-08-10")).toEqual({
      lastCompletedUtcDate: "2026-08-10",
      currentStreak: 1,
      maxStreak: 1,
    });
    expect(recordDailyCompletion(storage, "2026-08-11")).toEqual({
      lastCompletedUtcDate: "2026-08-11",
      currentStreak: 2,
      maxStreak: 2,
    });
    expect(recordDailyCompletion(storage, "2026-08-13")).toEqual({
      lastCompletedUtcDate: "2026-08-13",
      currentStreak: 1,
      maxStreak: 2,
    });
  });

  test("increments at most once per UTC date across source revisions", () => {
    const storage = new MemoryStorage();
    recordDailyCompletion(storage, "2026-08-12");
    expect(recordDailyCompletion(storage, "2026-08-12")).toEqual({
      lastCompletedUtcDate: "2026-08-12",
      currentStreak: 1,
      maxStreak: 1,
    });
    expect(storage.values.has(DAILY_STATS_KEY)).toBe(true);
  });

  test("isolates corrupt stats and ignores attempts to move the streak backward", () => {
    const storage = new MemoryStorage();
    storage.setItem(DAILY_STATS_KEY, "bad json");
    storage.setItem("unrelated", "keep me");
    expect(loadDailyStats(storage)).toEqual({ lastCompletedUtcDate: null, currentStreak: 0, maxStreak: 0 });
    expect(storage.getItem(DAILY_STATS_KEY)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep me");

    recordDailyCompletion(storage, "2026-08-12");
    expect(recordDailyCompletion(storage, "2026-08-11")).toEqual({
      lastCompletedUtcDate: "2026-08-12",
      currentStreak: 1,
      maxStreak: 1,
    });
  });

  test.each([
    { lastCompletedUtcDate: "2026-08-12", currentStreak: Number.MAX_SAFE_INTEGER + 1, maxStreak: Number.MAX_SAFE_INTEGER + 1 },
    { lastCompletedUtcDate: "2026-08-12", currentStreak: 1, maxStreak: Number.MAX_SAFE_INTEGER + 1 },
    { lastCompletedUtcDate: "2026-08-12", currentStreak: -1, maxStreak: 1 },
    { lastCompletedUtcDate: "2026-08-12", currentStreak: 2, maxStreak: 1 },
    { lastCompletedUtcDate: null, currentStreak: 0, maxStreak: 1 },
    { lastCompletedUtcDate: "2026-08-12", currentStreak: 0, maxStreak: 0 },
  ])("rejects invalid safe-integer and cross-field stats invariants: $currentStreak/$maxStreak/$lastCompletedUtcDate", (stats) => {
    const storage = new MemoryStorage();
    storage.setItem(DAILY_STATS_KEY, JSON.stringify(stats));
    storage.setItem("unrelated", "keep me");
    expect(loadDailyStats(storage)).toEqual({ lastCompletedUtcDate: null, currentStreak: 0, maxStreak: 0 });
    expect(storage.getItem(DAILY_STATS_KEY)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep me");
  });

  test("keeps streak arithmetic within safe integers", () => {
    const storage = new MemoryStorage();
    storage.setItem(DAILY_STATS_KEY, JSON.stringify({
      lastCompletedUtcDate: "2026-08-11",
      currentStreak: Number.MAX_SAFE_INTEGER,
      maxStreak: Number.MAX_SAFE_INTEGER,
    }));
    expect(recordDailyCompletion(storage, "2026-08-12")).toEqual({
      lastCompletedUtcDate: "2026-08-12",
      currentStreak: Number.MAX_SAFE_INTEGER,
      maxStreak: Number.MAX_SAFE_INTEGER,
    });
  });
});
