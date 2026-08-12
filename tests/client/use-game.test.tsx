// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/shared/random.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/shared/random.js")>(),
  createDailyRandom: vi.fn(async () => ({ nextUint32: () => 0 })),
  createPracticeRandom: vi.fn(() => ({ nextUint32: () => 0 })),
}));
vi.mock("../../src/client/game/preload-images.js", () => ({ preloadAnswerImages: vi.fn(() => Promise.resolve()) }));

import { createDailyRandom, createPracticeRandom } from "../../src/shared/random.js";
import { pairKey } from "../../src/shared/feature-keys.js";
import { compareGuess } from "../../src/shared/comparison.js";
import { useGame } from "../../src/client/game/use-game.js";
import { preloadAnswerImages } from "../../src/client/game/preload-images.js";
import { DAILY_STATS_KEY, dailyStorageKey } from "../../src/client/game/storage.js";
import type { LoadedSnapshot } from "../../src/client/api/load-snapshot.js";

const base = { cardClass: "Silent" as const, cardType: "Skill" as const, mana: 1, rarity: "Rare" as const, eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false };
const cards = ["FIRST", "SECOND"].map((id) => ({ id, name: id, hasUpgrade: false, artUrl: "https://art.example/card.png", baseCardUrl: null, upgradedCardUrl: null, base, upgraded: base }));
const snapshot: LoadedSnapshot = {
  manifest: { schemaVersion: 1, sourceRevision: "revision", sourceLastModified: null, fetchedAt: "2026-08-12T00:00:00Z", generatedAt: "2026-08-12T00:00:00Z", cardCount: 2, upgradeCount: 0, baseGroupCount: 1, pairGroupCount: 1, files: {} },
  cards, baseGroups: [{ key: "base", cardIds: ["FIRST", "SECOND"] }], pairGroups: [{ key: pairKey(cards[0]!), cardIds: ["FIRST", "SECOND"] }], spriteMap: { candidate: { url: "/c.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/g.png", width: 1, height: 1, displayScale: 1 }, cards: {} },
  cardsById: new Map(cards.map((card) => [card.id, card])), pairGroupsByKey: new Map([[pairKey(cards[0]!), { key: pairKey(cards[0]!), cardIds: ["FIRST", "SECOND"] }]]),
};
const dailyAnswer = { baseGroupKey: "base", selectedCardId: "FIRST", pairKey: pairKey(cards[0]!), acceptedCardIds: ["FIRST", "SECOND"] };

describe("useGame", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(createDailyRandom).mockResolvedValue({ nextUint32: () => 0 });
    vi.mocked(createPracticeRandom).mockReturnValue({ nextUint32: () => 0 });
    vi.mocked(preloadAnswerImages).mockResolvedValue();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  test("selects the same Daily answer for two mounts with the same revision", async () => {
    const first = renderHook(() => useGame(snapshot));
    const second = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(first.result.current.round).not.toBeNull());
    await waitFor(() => expect(second.result.current.round).not.toBeNull());
    expect(first.result.current.round?.answer.selectedCardId).toBe(second.result.current.round?.answer.selectedCardId);
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-12", "revision");
  });

  test("uses a fresh random source when starting the next Practice round", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round).not.toBeNull());
    await act(async () => { await game.result.current.setMode("practice"); });
    await act(async () => { game.result.current.nextRound(); });
    expect(createPracticeRandom).toHaveBeenCalledTimes(2);
  });

  test("changes its stable round token only when an active round is replaced", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round).not.toBeNull());
    const dailyToken = game.result.current.roundToken;
    expect(dailyToken).toBeGreaterThan(0);
    game.rerender();
    expect(game.result.current.roundToken).toBe(dailyToken);

    act(() => { game.result.current.submit("SECOND"); });
    expect(game.result.current.roundToken).toBe(dailyToken);

    await act(async () => { await game.result.current.setMode("practice"); });
    const practiceToken = game.result.current.roundToken;
    expect(practiceToken).toBe(dailyToken + 1);
    await act(async () => { game.result.current.nextRound(); });
    await waitFor(() => expect(game.result.current.roundToken).toBe(practiceToken + 1));
  });

  test("keeps a newer Practice round when a pending Daily request resolves later", async () => {
    let resolveDaily!: (source: { nextUint32(): number }) => void;
    vi.mocked(createDailyRandom).mockImplementationOnce(() => new Promise((resolve) => { resolveDaily = resolve; }));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await game.result.current.setMode("practice"); });
    expect(game.result.current.round?.mode).toBe("practice");
    vi.mocked(preloadAnswerImages).mockClear();
    await act(async () => { resolveDaily({ nextUint32: () => 1 }); });
    expect(game.result.current.round?.mode).toBe("practice");
    expect(preloadAnswerImages).not.toHaveBeenCalled();
  });

  test("last overlapping Practice request wins and preloads once", async () => {
    let first!: (source: { nextUint32(): number }) => void;
    let second!: (source: { nextUint32(): number }) => void;
    vi.mocked(createPracticeRandom)
      .mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }) as never);
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round).not.toBeNull());
    vi.mocked(preloadAnswerImages).mockClear();
    await act(async () => { void game.result.current.setMode("practice"); void game.result.current.setMode("practice"); });
    await act(async () => { second({ nextUint32: () => 1 }); });
    expect(game.result.current.round?.answer.selectedCardId).toBe("SECOND");
    expect(preloadAnswerImages).toHaveBeenCalledTimes(1);
    expect(preloadAnswerImages).toHaveBeenCalledWith(expect.objectContaining({ selectedCardId: "SECOND" }), snapshot.cardsById);
    await act(async () => { first({ nextUint32: () => 0 }); });
    expect(game.result.current.round?.answer.selectedCardId).toBe("SECOND");
    expect(preloadAnswerImages).toHaveBeenCalledTimes(1);
  });

  test("does not surface a stale Daily rejection after Practice succeeds", async () => {
    let rejectDaily!: (error: Error) => void;
    vi.mocked(createDailyRandom).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDaily = reject; }));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await game.result.current.setMode("practice"); });
    await act(async () => { rejectDaily(new Error("stale failure")); });
    expect(game.result.current.round?.mode).toBe("practice");
    expect(game.result.current.error).toBeNull();
  });

  test("StrictMode replay and unmount invalidate pending Daily work while a remount succeeds", async () => {
    let resolve!: (source: { nextUint32(): number }) => void;
    vi.mocked(createDailyRandom).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>;
    const first = renderHook(() => useGame(snapshot), { wrapper });
    first.unmount();
    await act(async () => { resolve({ nextUint32: () => 1 }); });
    expect(preloadAnswerImages).not.toHaveBeenCalled();
    const remount = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(remount.result.current.round?.mode).toBe("daily"));
    expect(preloadAnswerImages).toHaveBeenCalled();
  });

  test("the latest active Daily request commits both success and error", async () => {
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round).not.toBeNull());
    expect(preloadAnswerImages).toHaveBeenCalled();
    vi.mocked(createDailyRandom).mockRejectedValueOnce(new Error("active failure"));
    await act(async () => { await game.result.current.setMode("daily"); });
    expect(game.result.current.error).toBe("active failure");
  });

  test("restores the current revision/date Daily and persists later guesses", async () => {
    const key = dailyStorageKey({ sourceRevision: "revision", utcDate: "2026-08-12", ruleset: "v3" });
    localStorage.setItem(key, JSON.stringify({
      version: 3,
      answer: dailyAnswer,
      guesses: [{ cardId: "SECOND", results: compareGuess(cards[1]!, cards[0]!) }],
      status: "won",
    }));

    const restored = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(restored.result.current.round?.status).toBe("won"));
    expect(restored.result.current.round?.guesses).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(DAILY_STATS_KEY)!)).toEqual({
      lastCompletedUtcDate: "2026-08-12",
      currentStreak: 1,
      maxStreak: 1,
    });

    localStorage.clear();
    const fresh = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(fresh.result.current.round?.status).toBe("playing"));
    act(() => fresh.result.current.submit("SECOND"));
    await waitFor(() => expect(fresh.result.current.round?.status).toBe("won"));
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      answer: dailyAnswer,
      status: "won",
      guesses: [{ cardId: "SECOND" }],
    });
  });

  test("does not award a streak for forged won storage", async () => {
    const key = dailyStorageKey({ sourceRevision: "revision", utcDate: "2026-08-12", ruleset: "v3" });
    localStorage.setItem(key, JSON.stringify({
      version: 3,
      answer: dailyAnswer,
      guesses: [],
      status: "won",
    }));

    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round).not.toBeNull());
    expect(game.result.current.round?.status).toBe("playing");
    expect(localStorage.getItem(DAILY_STATS_KEY)).toBeNull();
  });

  test("a completed Practice round never reads or writes Daily streak stats", async () => {
    localStorage.setItem(DAILY_STATS_KEY, JSON.stringify({
      lastCompletedUtcDate: "2026-08-11",
      currentStreak: 7,
      maxStreak: 7,
    }));
    const game = renderHook(() => useGame(snapshot));
    await waitFor(() => expect(game.result.current.round).not.toBeNull());
    await act(async () => { await game.result.current.setMode("practice"); });
    act(() => game.result.current.submit("FIRST"));
    expect(game.result.current.round?.status).toBe("won");
    expect(JSON.parse(localStorage.getItem(DAILY_STATS_KEY)!)).toEqual({
      lastCompletedUtcDate: "2026-08-11",
      currentStreak: 7,
      maxStreak: 7,
    });
  });

  test("starts the new Daily at UTC midnight with one rollover timer", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T23:59:59.900Z"));
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); });
    expect(game.result.current.round?.mode).toBe("daily");
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-12", "revision");
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 100)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-13", "revision");
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 86_400_000)).toHaveLength(1);
  });

  test("keeps an active Practice round intact across UTC midnight and uses the new date when Daily is selected", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T23:59:59.900Z"));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await game.result.current.setMode("practice"); });
    const practiceToken = game.result.current.roundToken;

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(game.result.current.round?.mode).toBe("practice");
    expect(game.result.current.roundToken).toBe(practiceToken);
    expect(game.result.current.dailyUtcDate).toBe("2026-08-13");
    expect(createDailyRandom).not.toHaveBeenCalledWith("2026-08-13", "revision");

    await act(async () => { await game.result.current.setMode("daily"); });
    expect(game.result.current.round?.mode).toBe("daily");
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-13", "revision");
  });

  test("re-arms after an early timer fires before the UTC date changes", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T23:59:59.900Z"));
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); });
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 100)).toHaveLength(1);

    vi.setSystemTime(new Date("2026-08-12T23:59:59.800Z"));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(createDailyRandom).not.toHaveBeenCalledWith("2026-08-13", "revision");
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 100)).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-13", "revision");
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 86_400_000)).toHaveLength(1);
  });

  test("rechecks the UTC date when a suspended tab becomes visible", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T18:00:00Z"));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); });
    expect(game.result.current.round?.mode).toBe("daily");

    vi.setSystemTime(new Date("2026-08-13T08:00:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(createDailyRandom).toHaveBeenCalledWith("2026-08-13", "revision");
  });

  test("visibility rollover advances Daily availability without replacing Practice", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T18:00:00Z"));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await game.result.current.setMode("practice"); });
    const practiceToken = game.result.current.roundToken;

    vi.setSystemTime(new Date("2026-08-13T08:00:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

    expect(game.result.current.round?.mode).toBe("practice");
    expect(game.result.current.roundToken).toBe(practiceToken);
    expect(game.result.current.dailyUtcDate).toBe("2026-08-13");
  });

  test("cleans up the UTC rollover timer and visibility listener on unmount", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T23:59:59.900Z"));
    const game = renderHook(() => useGame(snapshot));
    await act(async () => { await Promise.resolve(); });
    expect(createDailyRandom).toHaveBeenCalledTimes(1);

    game.unmount();
    vi.setSystemTime(new Date("2026-08-13T00:00:00Z"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(createDailyRandom).toHaveBeenCalledTimes(1);
  });
});
