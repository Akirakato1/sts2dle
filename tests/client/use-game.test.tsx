// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { StrictMode } from "react";
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
import { baseKey } from "../../src/shared/feature-keys.js";
import { createDailyRandom, createPracticeRandom } from "../../src/shared/random.js";

const base = { cardClass: "Silent" as const, cardType: "Skill" as const, mana: 1, rarity: "Rare" as const, target: "Self" as const, powers: [], keywords: [] };
const first = { id: "FIRST", name: "FIRST", hasUpgrade: false, artUrl: "https://art.example/first.png", baseCardUrl: null, upgradedCardUrl: null, base, upgraded: base };
const secondVector = { ...base, mana: 2 };
const second = { id: "SECOND", name: "SECOND", hasUpgrade: false, artUrl: "https://art.example/second.png", baseCardUrl: null, upgradedCardUrl: null, base: secondVector, upgraded: secondVector };
const cards = [first, second];
const firstBaseKey = baseKey(first.base);
const secondBaseKey = baseKey(second.base);
const snapshot: LoadedSnapshot = {
  manifest: { schemaVersion: 2, sourceRevision: "revision", sourceLastModified: null, fetchedAt: "2026-08-12T00:00:00Z", generatedAt: "2026-08-12T00:00:00Z", cardCount: 2, upgradeCount: 0, baseGroupCount: 2, pairGroupCount: 2, files: {} },
  cards,
  baseGroups: [{ key: firstBaseKey, cardIds: [first.id] }, { key: secondBaseKey, cardIds: [second.id] }],
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
const firstAnswer = { baseGroupKey: firstBaseKey, selectedCardId: first.id, pairKey: pairKey(first), acceptedCardIds: [first.id] };

let uuidIndex = 0;
const uuids = [
  "123e4567-e89b-42d3-a456-426614174000",
  "123e4567-e89b-42d3-a456-426614174001",
  "123e4567-e89b-42d3-a456-426614174002",
] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

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
    expect(game.result.current.status).toBe("loading");
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    expect(game.result.current.status).toBe("ready");
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
    expect(game.result.current.round?.hardcore).toBe(false);
    expect(game.result.current.round?.assistance).not.toBeNull();
    expect(game.result.current.practiceHardcoreChoice).toBe(false);
    expect(localStorage.getItem(CURRENT_ROUND_KEYS.practice)).not.toBeNull();
  });

  test("rerolls Hardcore deterministically when its first draw collides with Daily", async () => {
    vi.mocked(createDailyRandom).mockImplementation(async (_date, _revision, namespace) => {
      if (namespace === "daily") return { nextUint32: () => 0 };
      const values = [0, 0, 1, 0];
      return { nextUint32: () => values.shift() ?? 0 };
    });

    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    expect(game.result.current.round?.answer.selectedCardId).toBe(first.id);

    act(() => game.result.current.setMode("hardcore-daily"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("hardcore-daily"));
    expect(game.result.current.round?.answer.selectedCardId).toBe(second.id);
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
      answer: mode === "hardcore-daily" ? { baseGroupKey: secondBaseKey, selectedCardId: second.id, pairKey: pairKey(second), acceptedCardIds: [second.id] } : firstAnswer,
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

  test("persists a selected Hardcore Practice round and carries its choice into the next round", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    expect(game.result.current.practiceHardcoreChoice).toBe(false);
    act(() => game.result.current.setPracticeHardcoreChoice(true));
    expect(game.result.current.round).toMatchObject({ mode: "practice", hardcore: true, assistance: null });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(CURRENT_ROUND_KEYS.practice)!).round.hardcore).toBe(true));
    const roundId = game.result.current.round!.roundId;
    game.unmount();

    const restored = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(restored.result.current.round?.mode).toBe("daily"));
    act(() => restored.result.current.setMode("practice"));
    await waitFor(() => expect(restored.result.current.round?.roundId).toBe(roundId));
    expect(restored.result.current.practiceHardcoreChoice).toBe(true);
    expect(restored.result.current.round?.hardcore).toBe(true);
    act(() => restored.result.current.forfeitPractice());
    await act(async () => restored.result.current.nextPracticeRound());
    await waitFor(() => expect(restored.result.current.round?.roundId).not.toBe(roundId));
    expect(restored.result.current.round).toMatchObject({ hardcore: true, assistance: null });
  });

  test("ignores Hardcore Practice choice changes outside an untouched Practice round", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    const daily = game.result.current.round;
    act(() => game.result.current.setPracticeHardcoreChoice(true));
    expect(game.result.current.round).toBe(daily);

    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    act(() => game.result.current.submit(second.id));
    const played = game.result.current.round;
    act(() => game.result.current.setPracticeHardcoreChoice(true));
    expect(game.result.current.round).toBe(played);
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
    act(() => game.result.current.forfeitPractice());
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

  test("UTC rollover immediately invalidates an active Daily until the new answer is ready", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T23:59:59.900Z"));
    const nextDaily = deferred<{ nextUint32(): number }>();
    const nextHardcore = deferred<{ nextUint32(): number }>();
    vi.mocked(createDailyRandom).mockImplementation((_date, _revision, namespace) => {
      if (_date === "2026-08-12") return Promise.resolve({ nextUint32: () => namespace === "daily" ? 0 : 1 });
      return namespace === "daily" ? nextDaily.promise : nextHardcore.promise;
    });
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(game.result.current.round?.roundId).toBe("daily:2026-08-12:revision");

    await act(async () => vi.advanceTimersByTimeAsync(100));

    expect(game.result.current.dailyUtcDate).toBe("2026-08-13");
    expect(game.result.current.status).toBe("loading");
    expect(game.result.current.round).toBeNull();
    act(() => game.result.current.submit(first.id));
    expect(game.result.current.round).toBeNull();

    await act(async () => nextDaily.resolve({ nextUint32: () => 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(game.result.current.round?.roundId).toBe("daily:2026-08-13:revision");
    await act(async () => nextHardcore.resolve({ nextUint32: () => 0 }));
  });

  test("visibility rollover ignores an old-date completion and keeps the selected Daily mode disabled", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
    const oldHardcore = deferred<{ nextUint32(): number }>();
    const nextDaily = deferred<{ nextUint32(): number }>();
    const nextHardcore = deferred<{ nextUint32(): number }>();
    vi.mocked(createDailyRandom).mockImplementation((date, _revision, namespace) => {
      if (date === "2026-08-12" && namespace === "daily") return Promise.resolve({ nextUint32: () => 0 });
      if (date === "2026-08-12") return oldHardcore.promise;
      return namespace === "daily" ? nextDaily.promise : nextHardcore.promise;
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(game.result.current.round?.roundId).toBe("daily:2026-08-12:revision");

    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => game.result.current.setMode("hardcore-daily"));
    expect(game.result.current.dailyUtcDate).toBe("2026-08-13");
    expect(game.result.current.status).toBe("loading");
    expect(game.result.current.round).toBeNull();

    await act(async () => oldHardcore.resolve({ nextUint32: () => 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(game.result.current.status).toBe("loading");
    expect(game.result.current.round).toBeNull();

    await act(async () => nextDaily.resolve({ nextUint32: () => 1 }));
    await act(async () => nextHardcore.resolve({ nextUint32: () => 0 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(game.result.current.round?.roundId).toBe("hardcore-daily:2026-08-13:revision");
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
      answer: { baseGroupKey: secondBaseKey, selectedCardId: second.id, pairKey: pairKey(second), acceptedCardIds: [second.id] },
      guesses: [{ cardId: second.id, results: [
        { feature: "cardClass", color: "green", displayValue: "Silent" },
        { feature: "cardType", color: "green", displayValue: "Skill" },
        { feature: "mana", color: "green", displayValue: "2" },
        { feature: "rarity", color: "green", displayValue: "Rare" },
        { feature: "target", color: "green", displayValue: "Self" },
        { feature: "powers", color: "green", displayValue: "None" },
        { feature: "keywords", color: "green", displayValue: "None" },
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

  test("StrictMode allocates one UUID only for the committed initial Practice round", async () => {
    const firstSource = deferred<{ nextUint32(): number }>();
    const secondSource = deferred<{ nextUint32(): number }>();
    vi.mocked(createPracticeRandom)
      .mockImplementationOnce(() => firstSource.promise as never)
      .mockImplementationOnce(() => secondSource.promise as never);
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>;
    renderHook(() => useGame(snapshot), { wrapper });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    await act(async () => firstSource.resolve({ nextUint32: () => 0 }));
    await act(async () => secondSource.resolve({ nextUint32: () => 0 }));
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  test("rapid next-Practice requests allocate one UUID only for the committed generation", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    act(() => game.result.current.forfeitPractice());
    const initialAllocations = vi.mocked(crypto.randomUUID).mock.calls.length;
    const staleSource = deferred<{ nextUint32(): number }>();
    const latestSource = deferred<{ nextUint32(): number }>();
    vi.mocked(createPracticeRandom)
      .mockImplementationOnce(() => staleSource.promise as never)
      .mockImplementationOnce(() => latestSource.promise as never);
    act(() => { void game.result.current.nextPracticeRound(); void game.result.current.nextPracticeRound(); });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(initialAllocations);
    await act(async () => staleSource.resolve({ nextUint32: () => 0 }));
    expect(crypto.randomUUID).toHaveBeenCalledTimes(initialAllocations);
    await act(async () => latestSource.resolve({ nextUint32: () => 1 }));
    expect(crypto.randomUUID).toHaveBeenCalledTimes(initialAllocations + 1);
    expect(game.result.current.round?.roundId).toBe(`practice:${uuids[initialAllocations]}`);
    expect(game.result.current.round?.hardcore).toBe(false);
  });

  test("ignores New Practice Round while the current Practice round is still playing", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    act(() => game.result.current.setMode("practice"));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("practice"));
    const roundId = game.result.current.round!.roundId;
    vi.mocked(createPracticeRandom).mockClear();

    act(() => game.result.current.nextPracticeRound());

    expect(createPracticeRandom).not.toHaveBeenCalled();
    expect(game.result.current.round?.roundId).toBe(roundId);
  });

  test("StrictMode reducer replay persists one transition and records one completion", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const game = renderHook(() => useGame(snapshot), { wrapper });
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    setItem.mockClear();
    act(() => game.result.current.submit(first.id));
    await waitFor(() => expect(game.result.current.round?.status).toBe("won"));
    expect(setItem.mock.calls.filter(([key]) => key === CURRENT_ROUND_KEYS.daily)).toHaveLength(1);
    expect(setItem.mock.calls.filter(([key]) => key === DAILY_STATS_KEY)).toHaveLength(1);
  });

  test("resolving a mode selected while missing does not increment its switch token twice", async () => {
    const hardcoreSource = deferred<{ nextUint32(): number }>();
    vi.mocked(createDailyRandom).mockImplementation(async (_date, _revision, mode) => {
      if (mode === "hardcore-daily") return hardcoreSource.promise;
      return { nextUint32: () => 0 };
    });
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    const dailyToken = game.result.current.roundToken;
    act(() => game.result.current.setMode("hardcore-daily"));
    expect(game.result.current.roundToken).toBe(dailyToken + 1);
    await act(async () => hardcoreSource.resolve({ nextUint32: () => 1 }));
    expect(game.result.current.round?.mode).toBe("hardcore-daily");
    expect(game.result.current.roundToken).toBe(dailyToken + 1);
  });

  test("inactive initialization cannot clear the active mode error", async () => {
    const dailySource = deferred<{ nextUint32(): number }>();
    const hardcoreSource = deferred<{ nextUint32(): number }>();
    vi.mocked(createDailyRandom).mockImplementation((_date, _revision, mode) => (
      mode === "daily" ? dailySource.promise : hardcoreSource.promise
    ));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => dailySource.reject(new Error("daily failed")));
    expect(game.result.current.error).toBe("Unable to prepare this game mode.");
    expect(game.result.current.error).not.toContain("daily failed");
    await act(async () => hardcoreSource.resolve({ nextUint32: () => 1 }));
    expect(game.result.current.error).toBe("Unable to prepare this game mode.");
  });

  test("switching to an inactive failed mode exposes its error and retries it", async () => {
    let hardcoreCalls = 0;
    vi.mocked(createDailyRandom).mockImplementation(async (_date, _revision, mode) => {
      if (mode === "daily") return { nextUint32: () => 0 };
      hardcoreCalls += 1;
      if (hardcoreCalls === 1) throw new Error("hardcore failed");
      return { nextUint32: () => 1 };
    });
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    await waitFor(() => expect(hardcoreCalls).toBe(1));
    act(() => game.result.current.setMode("hardcore-daily"));
    expect(game.result.current.error).toBe("Unable to prepare this game mode.");
    await waitFor(() => expect(game.result.current.round?.mode).toBe("hardcore-daily"));
    expect(hardcoreCalls).toBe(2);
    expect(game.result.current.error).toBeNull();
  });

  test("retries a failed active mode without exposing the thrown answer identifier", async () => {
    let dailyCalls = 0;
    vi.mocked(createDailyRandom).mockImplementation(async (_date, _revision, mode) => {
      if (mode === "hardcore-daily") return { nextUint32: () => 1 };
      dailyCalls += 1;
      if (dailyCalls === 1) throw new Error("secret-card-id:BEAT_DOWN");
      return { nextUint32: () => 0 };
    });
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.error).toBe("Unable to prepare this game mode."));
    expect(game.result.current.error).not.toContain("BEAT_DOWN");

    act(() => game.result.current.retryActiveMode());

    await waitFor(() => expect(game.result.current.round?.mode).toBe("daily"));
    expect(dailyCalls).toBe(2);
    expect(game.result.current.error).toBeNull();
  });
});
