// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { StrictMode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/shared/random.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/shared/random.js")>(),
  createDailyRandom: vi.fn(async () => ({ nextUint32: () => 0 })),
  createPracticeRandom: vi.fn(() => ({ nextUint32: () => 0 })),
}));
vi.mock("../../src/client/game/preload-images.js", () => ({ preloadAnswerImages: vi.fn(() => Promise.resolve()) }));

import { createDailyRandom, createPracticeRandom } from "../../src/shared/random.js";
import { pairKey } from "../../src/shared/feature-keys.js";
import { useGame } from "../../src/client/game/use-game.js";
import { preloadAnswerImages } from "../../src/client/game/preload-images.js";
import type { LoadedSnapshot } from "../../src/client/api/load-snapshot.js";

const base = { cardClass: "Silent" as const, cardType: "Skill" as const, mana: 1, rarity: "Rare" as const, eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false, unplayable: false };
const cards = ["FIRST", "SECOND"].map((id) => ({ id, name: id, hasUpgrade: false, artUrl: "https://art.example/card.png", baseCardUrl: null, upgradedCardUrl: null, base, upgraded: base }));
const snapshot: LoadedSnapshot = {
  manifest: { schemaVersion: 1, sourceRevision: "revision", sourceLastModified: null, fetchedAt: "2026-08-12T00:00:00Z", generatedAt: "2026-08-12T00:00:00Z", cardCount: 2, upgradeCount: 0, baseGroupCount: 1, pairGroupCount: 1, files: {} },
  cards, baseGroups: [{ key: "base", cardIds: ["FIRST", "SECOND"] }], pairGroups: [{ key: pairKey(cards[0]!), cardIds: ["FIRST", "SECOND"] }], spriteMap: { candidate: { url: "/c.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/g.png", width: 1, height: 1, displayScale: 1 }, cards: {} },
  cardsById: new Map(cards.map((card) => [card.id, card])), pairGroupsByKey: new Map([[pairKey(cards[0]!), { key: pairKey(cards[0]!), cardIds: ["FIRST", "SECOND"] }]]),
};

describe("useGame", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createDailyRandom).mockResolvedValue({ nextUint32: () => 0 });
    vi.mocked(createPracticeRandom).mockReturnValue({ nextUint32: () => 0 });
    vi.mocked(preloadAnswerImages).mockResolvedValue();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
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
    await act(async () => { void game.result.current.setMode("practice"); void game.result.current.setMode("practice"); });
    await act(async () => { second({ nextUint32: () => 1 }); });
    vi.mocked(preloadAnswerImages).mockClear();
    await act(async () => { first({ nextUint32: () => 0 }); });
    expect(game.result.current.round?.answer.selectedCardId).toBe("SECOND");
    expect(preloadAnswerImages).not.toHaveBeenCalled();
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
});
