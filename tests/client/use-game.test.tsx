// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/shared/random.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/shared/random.js")>(),
  createDailyRandom: vi.fn(async (_date: string, _revision: string, namespace: string) => ({ nextUint32: () => namespace === "daily" ? 0 : 1 })),
  createPracticeRandom: vi.fn(() => ({ nextUint32: () => 0 })),
}));
vi.mock("../../src/client/game/preload-images.js", () => ({ preloadAnswerImages: vi.fn(() => Promise.resolve()) }));

import type { LoadedSnapshot } from "../../src/client/api/load-snapshot.js";
import { createRoundState } from "../../src/client/game/game-reducer.js";
import { preloadAnswerImages } from "../../src/client/game/preload-images.js";
import {
  CURRENT_ROUND_KEYS,
  DAILY_RULESET_VERSION,
  DAILY_STATS_KEY,
  HARDCORE_DAILY_RULESET_VERSION,
  HARDCORE_DAILY_STATS_KEY,
  PRACTICE_RULESET_VERSION,
  saveCurrentRound,
} from "../../src/client/game/storage.js";
import { useGame } from "../../src/client/game/use-game.js";
import { pairKey } from "../../src/shared/feature-keys.js";
import { createDailyRandom, createPracticeRandom } from "../../src/shared/random.js";

const base = { cardClass: "Silent" as const, cardType: "Skill" as const, mana: 1, rarity: "Rare" as const, eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false };
const first = { id: "FIRST", name: "FIRST", hasUpgrade: false, artUrl: "https://art.example/first.png", baseCardUrl: null, upgradedCardUrl: null, base, upgraded: base };
const secondVector = { ...base, mana: 2 };
const second = { id: "SECOND", name: "SECOND", hasUpgrade: false, artUrl: "https://art.example/second.png", baseCardUrl: null, upgradedCardUrl: null, base: secondVector, upgraded: secondVector };
const cards = [first, second];
const snapshot: LoadedSnapshot = {
  manifest: { schemaVersion: 1, sourceRevision: "revision", sourceLastModified: null, fetchedAt: "2026-08-12T00:00:00Z", generatedAt: "2026-08-12T00:00:00Z", cardCount: 2, upgradeCount: 0, baseGroupCount: 1, pairGroupCount: 2, files: {} },
  cards,
  baseGroups: [{ key: "base", cardIds: [first.id, second.id] }],
  pairGroups: [
    { key: pairKey(first), cardIds: [first.id] },
    { key: pairKey(second), cardIds: [second.id] },
  ],
  spriteMap: { candidate: { url: "/c.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/g.png", width: 1, height: 1, displayScale: 1 }, cards: {} },
  cardsById: new Map(cards.map((card) => [card.id, card])),
  pairGroupsByKey: new Map([
    [pairKey(first), { key: pairKey(first), cardIds: [first.id] }],
    [pairKey(second), { key: pairKey(second), cardIds: [second.id] }],
  ]),
};
const firstAnswer = { baseGroupKey: "base", selectedCardId: first.id, pairKey: pairKey(first), acceptedCardIds: [first.id] };

let uuidIndex = 0;
const uuids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
] as const;

describe("useGame", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(createDailyRandom).mockImplementation(async (_date, _revision, namespace) => ({ nextUint32: () => namespace === "daily" ? 0 : 1 }));
    vi.mocked(createPracticeRandom).mockReturnValue({ nextUint32: () => 0 });
    vi.mocked(preloadAnswerImages).mockResolvedValue();
    uuidIndex = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => uuids[uuidIndex++]!);
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  test("initializes independent deterministic Daily modes and a persisted Practice round", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-12", "revision", "daily");
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-12", "revision", "hardcore-daily");
    expect(game.result.current.round?.answer.selectedCardId).toBe(first.id);
    act(() => game.result.current.setMode("hardcore-daily"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("hardcore-daily"));
    expect(game.result.current.round?.answer.selectedCardId).toBe(second.id);
    expect(game.result.current.round?.assistance).toBeNull();
    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    expect(game.result.current.round?.roundId).toBe(`practice:${uuids[0]}`);
    expect(game.result.current.round?.hintSeed).toBe(uuids[0]);
    expect(localStorage.getItem(CURRENT_ROUND_KEYS.practice)).not.toBeNull();
  });

  test.each(["daily", "hardcore-daily", "practice"] as const)("restores persisted %s progress on refresh", async (mode) => {
    const daily = mode !== "practice";
    const utcDate = daily ? "2026-08-12" : null;
    const ruleset = mode === "daily" ? DAILY_RULESET_VERSION : mode === "hardcore-daily" ? HARDCORE_DAILY_RULESET_VERSION : PRACTICE_RULESET_VERSION;
    const restored = createRoundState({
      mode,
      hardcore: mode === "hardcore-daily",
      roundId: daily ? `${mode}:${utcDate}:revision` : `practice:${uuids[0]}`,
      hintSeed: daily ? `${mode}:${utcDate}:revision` : uuids[0],
      answer: mode === "hardcore-daily" ? { baseGroupKey: "base", selectedCardId: second.id, pairKey: pairKey(second), acceptedCardIds: [second.id] } : firstAnswer,
      guesses: [],
    });
    saveCurrentRound(localStorage, { mode, sourceRevision: "revision", ruleset, utcDate }, restored);
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.setMode(mode));
    await waitFor(() => expect(game.result.current.round?.roundId).toBe(restored.roundId));
    expect(game.result.current.round).toEqual(restored);
    if (mode === "practice") expect(createPracticeRandom).not.toHaveBeenCalled();
  });

  test("persists visibility, orb use, guesses, and forfeit for Practice", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    act(() => game.result.current.setCandidateVisibility("green", false));
    act(() => game.result.current.consumeReveal({ feature: "mana" }));
    act(() => game.result.current.submit(second.id));
    act(() => game.result.current.consumeNegation({ guessIndex: 0, cardId: second.id, feature: "mana" }));
    act(() => game.result.current.forfeitPractice());
    expect(JSON.parse(localStorage.getItem(CURRENT_ROUND_KEYS.practice)!).round).toMatchObject({
      status: "forfeited",
      terminalGuessCount: 1,
      assistance: { reveal: { feature: "mana" }, negation: { guessIndex: 0, cardId: second.id, feature: "mana" }, visibility: { green: false } },
    });
  });

  test("Practice Hardcore choice toggles the unstarted round, locks after play, and controls only the next round after terminal", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    act(() => game.result.current.setPracticeHardcoreChoice(true));
    expect(game.result.current.practiceHardcoreChoice).toBe(true);
    expect(game.result.current.round?.hardcore).toBe(true);
    expect(game.result.current.round?.assistance).toBeNull();
    act(() => game.result.current.setPracticeHardcoreChoice(false));
    act(() => game.result.current.consumeReveal({ feature: "mana" }));
    act(() => game.result.current.setPracticeHardcoreChoice(true));
    expect(game.result.current.round?.hardcore).toBe(false);
    act(() => game.result.current.forfeitPractice());
    act(() => game.result.current.setPracticeHardcoreChoice(true));
    expect(game.result.current.round?.hardcore).toBe(false);
    await act(async () => game.result.current.nextPracticeRound());
    await waitFor(() => expect(game.result.current.round?.roundId).toBe(`practice:${uuids[1]}`));
    expect(game.result.current.round?.hardcore).toBe(true);
    expect(game.result.current.round?.assistance).toBeNull();
  });

  test("roundToken changes only for mode switches, Daily replacement, and new Practice", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    const initial = game.result.current.roundToken;
    game.rerender();
    act(() => game.result.current.submit(second.id));
    expect(game.result.current.roundToken).toBe(initial);
    act(() => game.result.current.setMode("practice"));
    expect(game.result.current.roundToken).toBe(initial + 1);
    await act(async () => game.result.current.nextPracticeRound());
    await waitFor(() => expect(game.result.current.roundToken).toBe(initial + 2));
  });

  test("UTC rollover replaces both Daily modes without touching Practice progress", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T23:59:59.900Z"));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(game.result.current.round?.mode).toBe("daily");
    act(() => game.result.current.setMode("practice"));
    act(() => game.result.current.submit(second.id));
    const practiceId = game.result.current.round?.roundId;
    const token = game.result.current.roundToken;
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(game.result.current.dailyUtcDate).toBe("2026-08-13");
    expect(game.result.current.round?.roundId).toBe(practiceId);
    expect(game.result.current.round?.guesses).toHaveLength(1);
    expect(game.result.current.roundToken).toBe(token);
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-13", "revision", "daily");
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-13", "revision", "hardcore-daily");
    act(() => game.result.current.setMode("daily"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(game.result.current.round?.roundId).toBe("daily:2026-08-13:revision");
  });

  test("Daily and Hardcore wins update separate streak keys", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.submit(first.id));
    expect(JSON.parse(localStorage.getItem(DAILY_STATS_KEY)!).currentStreak).toBe(1);
    act(() => game.result.current.setMode("hardcore-daily"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("hardcore-daily"));
    act(() => game.result.current.submit(second.id));
    expect(JSON.parse(localStorage.getItem(HARDCORE_DAILY_STATS_KEY)!).currentStreak).toBe(1);
    expect(JSON.parse(localStorage.getItem(DAILY_STATS_KEY)!).currentStreak).toBe(1);
  });

  test("restored Daily wins repair only their matching streak domain", async () => {
    const won = createRoundState({
      mode: "hardcore-daily",
      hardcore: true,
      roundId: "hardcore-daily:2026-08-12:revision",
      hintSeed: "hardcore-daily:2026-08-12:revision",
      answer: { baseGroupKey: "base", selectedCardId: second.id, pairKey: pairKey(second), acceptedCardIds: [second.id] },
      guesses: [{ cardId: second.id, results: [
        { feature: "cardClass", color: "green", displayValue: "Silent" },
        { feature: "cardType", color: "green", displayValue: "Skill" },
        { feature: "mana", color: "green", displayValue: "2" },
        { feature: "rarity", color: "green", displayValue: "Rare" },
        { feature: "eternal", color: "green", displayValue: "false" },
        { feature: "ethereal", color: "green", displayValue: "false" },
        { feature: "exhaust", color: "green", displayValue: "false" },
        { feature: "innate", color: "green", displayValue: "false" },
        { feature: "retain", color: "green", displayValue: "false" },
        { feature: "sly", color: "green", displayValue: "false" },
      ] }],
      status: "won",
      terminalGuessCount: 1,
    });
    saveCurrentRound(localStorage, {
      mode: "hardcore-daily", sourceRevision: "revision", ruleset: HARDCORE_DAILY_RULESET_VERSION, utcDate: "2026-08-12",
    }, won);
    renderHook(() => useGame(snapshot));
    await waitFor(() => expect(localStorage.getItem(HARDCORE_DAILY_STATS_KEY)).not.toBeNull());
    expect(localStorage.getItem(DAILY_STATS_KEY)).toBeNull();
  });

  test("invalid persisted Daily is replaced without touching the other mode", async () => {
    localStorage.setItem(CURRENT_ROUND_KEYS.daily, "bad json");
    localStorage.setItem("unrelated:key", "keep");
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    expect(game.result.current.round?.roundId).toBe("daily:2026-08-12:revision");
    expect(localStorage.getItem("unrelated:key")).toBe("keep");
    expect(localStorage.getItem(CURRENT_ROUND_KEYS["hardcore-daily"])).not.toBeNull();
  });
});
