import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/server/main.js";
import type { ActivatedSnapshot } from "../../src/server/sync/build-snapshot.js";

function activated(path: string, buildId = "prebuilt-snapshot"): ActivatedSnapshot {
  return {
    buildId,
    path,
    manifest: {
      schemaVersion: 1,
      sourceRevision: "prebuilt-revision",
      sourceLastModified: null,
      fetchedAt: "2026-08-12T00:00:00.000Z",
      generatedAt: "2026-08-12T00:00:01.000Z",
      cardCount: 0,
      upgradeCount: 0,
      baseGroupCount: 0,
      pairGroupCount: 0,
      files: {},
    },
    report: {
      cardCount: 0,
      upgradeCount: 0,
      baseGroupCount: 0,
      pairGroupCount: 0,
      baseGroupHistogram: {},
      pairGroupHistogram: {},
      missingRawArtCardIds: [],
      fallbackCardIds: [],
      candidateSprite: { width: 1, height: 1, bytes: 1 },
      guessSprite: { width: 1, height: 1, bytes: 1 },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("production synchronization boundary", () => {
  it("does not load the synchronization module while serving a validated prebuilt snapshot", async () => {
    const store = { loadActive: vi.fn(async () => ({ buildId: "prebuilt-snapshot", path: "C:\\prebuilt" })) };
    const snapshot = activated("C:\\prebuilt");
    const loadProductionSync = vi.fn(async () => {
      throw new Error("synchronization module loaded");
    });
    const listen = vi.fn(async () => undefined);

    await main({
      env: { STSDLE_SKIP_SYNC: "1" },
      store,
      loadProductionSync,
      loadActivatedSnapshot: vi.fn(async () => snapshot),
      createApp: vi.fn(async () => ({ listen })),
    });

    expect(loadProductionSync).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledOnce();
  });
});
