import { describe, expect, test } from "vitest";

import { createDefaultAssistance } from "../../src/client/game/assistance.js";
import { createRoundState, type RoundState } from "../../src/client/game/game-reducer.js";
import { createDefaultPracticeFilter } from "../../src/client/game/practice-filter.js";
import {
  CURRENT_ROUND_KEYS,
  CURRENT_ROUND_VERSION,
  DAILY_RULESET_VERSION,
  DAILY_STATS_KEY,
  HARDCORE_DAILY_RULESET_VERSION,
  HARDCORE_DAILY_STATS_KEY,
  PRACTICE_RULESET_VERSION,
  loadCurrentRound,
  loadDailyStats,
  msUntilNextUtcDay,
  recordDailyCompletion,
  removeLegacyCurrentRoundKeys,
  saveCurrentRound,
  type RoundStorageIdentity,
} from "../../src/client/game/storage.js";
import { compareGuess } from "../../src/shared/comparison.js";
import type { CardIdentity, FeatureVector, PairGroup } from "../../src/shared/domain.js";
import { baseKey, pairKey } from "../../src/shared/feature-keys.js";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const base: FeatureVector = {
  cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Rare",
  eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false,
};

function card(id: string, vector: FeatureVector = base): CardIdentity {
  return {
    id, name: `Name ${id}`, hasUpgrade: false, artUrl: `https://art.example/${id}.png`,
    baseCardUrl: null, upgradedCardUrl: null, base: vector, upgraded: vector,
  };
}

const answerCard = card("ANSWER");
const equivalentCard = card("EQUIVALENT");
const guessCard = card("GUESS", { ...base, cardClass: "Ironclad", cardType: "Attack", mana: 2, rarity: "Common", eternal: true });
const laterGuessCard = card("LATER", { ...base, cardClass: "Defect", cardType: "Power", mana: 3, rarity: "Uncommon", ethereal: true });
const cardsById = new Map([answerCard, equivalentCard, guessCard, laterGuessCard].map((value) => [value.id, value]));
const answer = {
  baseGroupKey: baseKey(answerCard.base),
  selectedCardId: answerCard.id,
  pairKey: pairKey(answerCard),
  acceptedCardIds: [answerCard.id, equivalentCard.id],
};
const pairGroupsByKey = new Map<string, PairGroup>([[answer.pairKey, { key: answer.pairKey, cardIds: answer.acceptedCardIds }]]);
const identities: Record<RoundState["mode"], RoundStorageIdentity> = {
  daily: { mode: "daily", sourceRevision: "abc", ruleset: DAILY_RULESET_VERSION, utcDate: "2026-08-12" },
  "hardcore-daily": { mode: "hardcore-daily", sourceRevision: "abc", ruleset: HARDCORE_DAILY_RULESET_VERSION, utcDate: "2026-08-12" },
  practice: { mode: "practice", sourceRevision: "abc", ruleset: PRACTICE_RULESET_VERSION, utcDate: null },
};

function round(mode: RoundState["mode"], status: RoundState["status"] = "playing"): RoundState {
  const hardcore = mode === "hardcore-daily";
  const wrongGuess = { cardId: guessCard.id, results: compareGuess(guessCard, answerCard) };
  const guesses = status === "won"
    ? [wrongGuess, { cardId: equivalentCard.id, results: compareGuess(equivalentCard, answerCard) }]
    : [wrongGuess];
  const identity = identities[mode];
  const roundId = mode === "practice"
    ? "practice:123e4567-e89b-42d3-a456-426614174000"
    : `${mode}:${identity.utcDate}:${identity.sourceRevision}`;
  const assistance = hardcore ? null : {
    ...createDefaultAssistance(),
    reveal: { feature: "mana" as const },
    filter: { guessIndex: 0, cardId: guessCard.id, feature: "retain" as const },
    negation: { guessIndex: 0, cardId: guessCard.id, feature: "mana" as const },
    visibility: { neutral: true, green: false, red: true },
  };
  return createRoundState({
    mode,
    hardcore,
    roundId,
    hintSeed: mode === "practice" ? "123e4567-e89b-42d3-a456-426614174000" : roundId,
    answer,
    guesses,
    status,
    terminalGuessCount: status === "playing" ? null : guesses.length,
    assistance,
    practiceFilter: mode === "practice" ? {
      ...createDefaultPracticeFilter(),
      enabled: true,
      cardClass: { disabled: false, selected: ["Silent"] },
      keywords: { disabled: false, selected: ["eternal"] },
    } : null,
  });
}

function stored(storage: MemoryStorage, mode: RoundState["mode"]): Record<string, any> {
  return JSON.parse(storage.getItem(CURRENT_ROUND_KEYS[mode])!);
}

function assertRejected(mode: RoundState["mode"], mutate: (value: Record<string, any>) => void, source = round(mode)): void {
  const storage = new MemoryStorage();
  const key = CURRENT_ROUND_KEYS[mode];
  storage.setItem("unrelated:key", "keep");
  storage.setItem(DAILY_STATS_KEY, "normal stats");
  storage.setItem(HARDCORE_DAILY_STATS_KEY, "hardcore stats");
  saveCurrentRound(storage, identities[mode], source);
  const value = stored(storage, mode);
  mutate(value);
  storage.setItem(key, JSON.stringify(value));
  expect(loadCurrentRound(storage, identities[mode], cardsById, pairGroupsByKey, answer)).toBeNull();
  expect(storage.getItem(key)).toBeNull();
  expect(storage.getItem("unrelated:key")).toBe("keep");
  expect(storage.getItem(DAILY_STATS_KEY)).toBe("normal stats");
  expect(storage.getItem(HARDCORE_DAILY_STATS_KEY)).toBe("hardcore stats");
}

describe("current round storage", () => {
  test("uses three fixed owned keys and schema version 4", () => {
    expect(CURRENT_ROUND_KEYS).toEqual({
      daily: "stsdle:round:daily:v1",
      "hardcore-daily": "stsdle:round:hardcore-daily:v1",
      practice: "stsdle:round:practice:v1",
    });
    expect(CURRENT_ROUND_VERSION).toBe(4);
    expect(PRACTICE_RULESET_VERSION).toBe("practice-v2");
  });

  test.each(["daily", "hardcore-daily", "practice"] as const)("round-trips complete %s state", (mode) => {
    const storage = new MemoryStorage();
    const source = round(mode, mode === "practice" ? "forfeited" : "won");
    saveCurrentRound(storage, identities[mode], source);
    expect(loadCurrentRound(storage, identities[mode], cardsById, pairGroupsByKey, answer)).toEqual({ round: source });
    expect(storage.getItem(CURRENT_ROUND_KEYS[mode])).not.toContain("error");
  });

  test("round-trips a won assisted Practice round", () => {
    const storage = new MemoryStorage();
    const source = round("practice", "won");
    saveCurrentRound(storage, identities.practice, source);
    expect(loadCurrentRound(storage, identities.practice, cardsById, pairGroupsByKey, answer)).toEqual({ round: source });
  });

  test("round-trips a Practice filter selecting keyword None", () => {
    const storage = new MemoryStorage();
    const source = round("practice");
    source.practiceFilter!.keywords = { disabled: false, selected: ["none"] };
    saveCurrentRound(storage, identities.practice, source);
    expect(loadCurrentRound(storage, identities.practice, cardsById, pairGroupsByKey, answer)).toEqual({ round: source });
  });

  test("new envelopes omit the obsolete pending Practice Hardcore choice", () => {
    const storage = new MemoryStorage();
    const source = round("practice", "forfeited");
    saveCurrentRound(storage, identities.practice, source);
    expect(stored(storage, "practice")).not.toHaveProperty("practiceHardcoreChoice");
  });

  test.each(["daily", "hardcore-daily"] as const)("loads a literal pre-filter %s envelope", (mode) => {
    const storage = new MemoryStorage();
    const source = round(mode);
    const legacyEnvelope = {
      version: 4,
      mode,
      sourceRevision: "abc",
      ruleset: identities[mode].ruleset,
      utcDate: "2026-08-12",
      practiceHardcoreChoice: null,
      round: {
        mode,
        hardcore: source.hardcore,
        roundId: source.roundId,
        hintSeed: source.hintSeed,
        answer: source.answer,
        guesses: source.guesses,
        status: source.status,
        terminalGuessCount: source.terminalGuessCount,
        assistance: source.assistance,
      },
    };
    storage.setItem(CURRENT_ROUND_KEYS[mode], JSON.stringify(legacyEnvelope));
    expect(loadCurrentRound(storage, identities[mode], cardsById, pairGroupsByKey, answer)?.round)
      .toEqual({ ...source, practiceFilter: null });
  });

  test("invalidates legacy Practice only, preserving both Dailies, stats, and unrelated data", () => {
    const storage = new MemoryStorage();
    const legacy = round("practice");
    storage.setItem(CURRENT_ROUND_KEYS.practice, JSON.stringify({
      version: 4,
      mode: "practice",
      sourceRevision: "abc",
      ruleset: "practice-v1",
      utcDate: null,
      practiceHardcoreChoice: true,
      round: { ...legacy, hardcore: true, assistance: null, practiceFilter: undefined, error: undefined },
    }));
    storage.setItem(CURRENT_ROUND_KEYS.daily, "daily progress");
    storage.setItem(CURRENT_ROUND_KEYS["hardcore-daily"], "hardcore progress");
    storage.setItem(DAILY_STATS_KEY, "daily stats");
    storage.setItem(HARDCORE_DAILY_STATS_KEY, "hardcore stats");
    storage.setItem("unrelated:key", "keep");

    expect(loadCurrentRound(storage, identities.practice, cardsById, pairGroupsByKey, answer)).toBeNull();
    expect(storage.getItem(CURRENT_ROUND_KEYS.practice)).toBeNull();
    expect(storage.getItem(CURRENT_ROUND_KEYS.daily)).toBe("daily progress");
    expect(storage.getItem(CURRENT_ROUND_KEYS["hardcore-daily"])).toBe("hardcore progress");
    expect(storage.getItem(DAILY_STATS_KEY)).toBe("daily stats");
    expect(storage.getItem(HARDCORE_DAILY_STATS_KEY)).toBe("hardcore stats");
    expect(storage.getItem("unrelated:key")).toBe("keep");
  });

  test("strictly validates complete Practice filter groups and canonical snapshot values", () => {
    assertRejected("practice", (value) => { value.round.practiceFilter.extra = true; });
    assertRejected("practice", (value) => { delete value.round.practiceFilter.rarity; });
    assertRejected("practice", (value) => { value.round.practiceFilter.cardClass.selected = ["Silent", "Silent"]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.cardClass.selected = [false]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.cardClass.selected = ["Regent"]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.mana.selected = [true]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.mana.selected = [99]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.keywords.selected = ["retain"]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.keywords.selected = ["none", "eternal"]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.keywords.selected = ["none", "none"]; });
    assertRejected("practice", (value) => { value.round.practiceFilter.keywords.selected = ["unknown"]; });
    assertRejected("daily", (value) => { value.round.practiceFilter = createDefaultPracticeFilter(); });
  });

  test("rejects strict envelope identity and mode inconsistencies", () => {
    assertRejected("daily", (value) => { value.version = 3; });
    assertRejected("daily", (value) => { value.sourceRevision = "other"; });
    assertRejected("daily", (value) => { value.ruleset = "other"; });
    assertRejected("daily", (value) => { value.utcDate = "2026-08-13"; });
    assertRejected("daily", (value) => { value.extra = true; });
    assertRejected("daily", (value) => { value.round.mode = "practice"; });
    assertRejected("daily", (value) => { value.round.hardcore = true; });
    assertRejected("hardcore-daily", (value) => { value.round.hardcore = false; });
    assertRejected("practice", (value) => { value.round.roundId = "practice:not-a-uuid"; });
    assertRejected("practice", (value) => { value.round.hintSeed = "different"; });
  });

  test("rejects tampered answer identity and pair membership", () => {
    assertRejected("daily", (value) => { value.round.answer.selectedCardId = guessCard.id; });
    assertRejected("daily", (value) => { value.round.answer.pairKey = "wrong"; });
    assertRejected("daily", (value) => { value.round.answer.acceptedCardIds = [answerCard.id]; });
    assertRejected("daily", (value) => { value.round.answer.extra = true; });
  });

  test("rejects a tampered Practice base-group key without an expected answer", () => {
    const storage = new MemoryStorage();
    saveCurrentRound(storage, identities.practice, round("practice"));
    const value = stored(storage, "practice");
    value.round.answer.baseGroupKey = "tampered-base-group";
    storage.setItem(CURRENT_ROUND_KEYS.practice, JSON.stringify(value));
    expect(loadCurrentRound(storage, identities.practice, cardsById, pairGroupsByKey)).toBeNull();
    expect(storage.getItem(CURRENT_ROUND_KEYS.practice)).toBeNull();
  });

  test("rejects tampered canonical results, duplicate guesses, and post-win guesses", () => {
    assertRejected("daily", (value) => { value.round.guesses[0].results[0].displayValue = "tampered"; });
    assertRejected("daily", (value) => { value.round.guesses[0].results[0].color = "green"; });
    assertRejected("daily", (value) => { value.round.guesses[0].results.reverse(); });
    assertRejected("daily", (value) => { value.round.guesses[0].results[0].extra = true; });
    assertRejected("daily", (value) => { value.round.guesses.push(value.round.guesses[0]); });
    assertRejected("daily", (value) => {
      value.round.guesses.push({ cardId: answerCard.id, results: compareGuess(answerCard, answerCard) });
      value.round.guesses.push({ cardId: laterGuessCard.id, results: compareGuess(laterGuessCard, answerCard) });
      value.round.status = "won";
      value.round.terminalGuessCount = 3;
    });
  });

  test("rejects status and terminal marker disagreement, including post-forfeit guesses", () => {
    assertRejected("daily", (value) => { value.round.status = "won"; value.round.terminalGuessCount = 1; });
    assertRejected("daily", (value) => { value.round.terminalGuessCount = 1; });
    assertRejected("practice", (value) => { value.round.status = "forfeited"; value.round.terminalGuessCount = 0; });
    assertRejected("practice", (value) => {
      value.round.guesses.push({ cardId: laterGuessCard.id, results: compareGuess(laterGuessCard, answerCard) });
    }, round("practice", "forfeited"));
    assertRejected("daily", (value) => { value.round.status = "forfeited"; value.round.terminalGuessCount = 1; });
  });

  test("rejects invalid orb targets, visibility shapes, and any Hardcore assistance", () => {
    assertRejected("daily", (value) => { value.round.assistance.filter.cardId = laterGuessCard.id; });
    assertRejected("daily", (value) => { value.round.assistance.filter.feature = "mana"; });
    assertRejected("daily", (value) => { value.round.assistance.negation.feature = "retain"; });
    assertRejected("daily", (value) => { value.round.assistance.reveal.extra = "display"; });
    assertRejected("daily", (value) => { value.round.assistance.visibility.extra = true; });
    assertRejected("daily", (value) => { delete value.round.assistance.visibility.green; });
    assertRejected("hardcore-daily", (value) => { value.round.assistance = createDefaultAssistance(); });
  });

  test("rejects a constraint orb target on the terminal winning guess but restores a pre-win target", () => {
    const won = round("daily", "won");
    assertRejected("daily", (value) => {
      value.round.assistance.filter = {
        guessIndex: 1,
        cardId: equivalentCard.id,
        feature: "mana",
      };
    }, won);

    const storage = new MemoryStorage();
    saveCurrentRound(storage, identities.daily, won);
    expect(loadCurrentRound(storage, identities.daily, cardsById, pairGroupsByKey, answer)?.round.assistance?.filter)
      .toEqual({ guessIndex: 0, cardId: guessCard.id, feature: "retain" });
  });

  test("removes only exact legacy application round keys", () => {
    const storage = new MemoryStorage();
    storage.setItem("stsdle:daily:v2:abc:2026-08-12", "old");
    storage.setItem("stsdle:daily:v3:def:2026-08-13", "old");
    storage.setItem("stsdle:daily:v4:keep", "keep");
    storage.setItem("prefix:stsdle:daily:v2:keep", "keep");
    storage.setItem(DAILY_STATS_KEY, "keep");
    storage.setItem(HARDCORE_DAILY_STATS_KEY, "keep");
    storage.setItem("unrelated:key", "keep");
    removeLegacyCurrentRoundKeys(storage);
    expect([...storage.values.keys()].sort()).toEqual([
      DAILY_STATS_KEY,
      HARDCORE_DAILY_STATS_KEY,
      "prefix:stsdle:daily:v2:keep",
      "stsdle:daily:v4:keep",
      "unrelated:key",
    ].sort());
  });
});

describe("Daily streak storage", () => {
  test("keeps normal and Hardcore streak domains independent", () => {
    const storage = new MemoryStorage();
    expect(recordDailyCompletion(storage, "2026-08-12")).toMatchObject({ currentStreak: 1 });
    expect(recordDailyCompletion(storage, "2026-08-12", HARDCORE_DAILY_STATS_KEY)).toMatchObject({ currentStreak: 1 });
    expect(recordDailyCompletion(storage, "2026-08-13", HARDCORE_DAILY_STATS_KEY)).toMatchObject({ currentStreak: 2 });
    expect(loadDailyStats(storage)).toMatchObject({ currentStreak: 1 });
    expect(loadDailyStats(storage, HARDCORE_DAILY_STATS_KEY)).toMatchObject({ currentStreak: 2 });
    expect(storage.getItem(DAILY_STATS_KEY)).not.toBeNull();
    expect(storage.getItem(HARDCORE_DAILY_STATS_KEY)).not.toBeNull();
  });

  test("fails closed on corrupt stats without touching another key", () => {
    const storage = new MemoryStorage();
    storage.setItem(DAILY_STATS_KEY, "bad json");
    storage.setItem(HARDCORE_DAILY_STATS_KEY, JSON.stringify({ lastCompletedUtcDate: "2026-08-12", currentStreak: 2, maxStreak: 2 }));
    expect(loadDailyStats(storage)).toEqual({ lastCompletedUtcDate: null, currentStreak: 0, maxStreak: 0 });
    expect(storage.getItem(DAILY_STATS_KEY)).toBeNull();
    expect(loadDailyStats(storage, HARDCORE_DAILY_STATS_KEY)).toMatchObject({ currentStreak: 2 });
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
