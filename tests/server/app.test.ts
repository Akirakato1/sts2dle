import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { main } from "../../src/server/main.js";
import type { ActivatedSnapshot } from "../../src/server/sync/build-snapshot.js";
import type { SnapshotAcceptanceReport } from "../../src/server/sync/validate-snapshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function createStaticRoots(): Promise<{ clientRoot: string; snapshotRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "stsdle-app-"));
  temporaryDirectories.push(root);
  const clientRoot = join(root, "client");
  const snapshotRoot = join(root, "snapshot");
  await Promise.all([mkdir(clientRoot), mkdir(snapshotRoot)]);
  await Promise.all([
    writeFile(join(clientRoot, "index.html"), "<!doctype html><title>STS-dle</title>"),
    writeFile(join(clientRoot, "main.js"), "globalThis.loaded = true;"),
    writeFile(join(snapshotRoot, "manifest.json"), JSON.stringify({
      sourceRevision: "source-revision",
      generatedAt: "2026-08-12T00:00:00.000Z",
    })),
  ]);
  return { clientRoot, snapshotRoot };
}

function active(path: string): ActivatedSnapshot {
  const report: SnapshotAcceptanceReport = {
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
  };
  return {
    buildId: "prior-build",
    path,
    manifest: {
      schemaVersion: 1,
      sourceRevision: "prior-revision",
      sourceLastModified: null,
      fetchedAt: "2026-08-12T00:00:00.000Z",
      generatedAt: "2026-08-12T00:00:01.000Z",
      cardCount: 0,
      upgradeCount: 0,
      baseGroupCount: 0,
      pairGroupCount: 0,
      files: {},
    },
    report,
  };
}

describe("createApp", () => {
  it("serves runtime files, built client assets, SPA routes, and health metadata", async () => {
    const roots = await createStaticRoots();
    const app = await createApp({ ...roots, logger: false });

    try {
      const runtime = await app.inject({ url: "/runtime/manifest.json" });
      expect(runtime.statusCode).toBe(200);
      expect(runtime.json()).toMatchObject({ sourceRevision: "source-revision" });
      const asset = await app.inject({ url: "/main.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("javascript");
      const route = await app.inject({ url: "/non-route" });
      expect(route.statusCode).toBe(200);
      expect(route.headers["content-type"]).toContain("text/html");
      expect(route.body).toContain("STS-dle");
      expect((await app.inject({ url: "/health" })).json()).toEqual({
        sourceRevision: "source-revision",
        generatedAt: "2026-08-12T00:00:00.000Z",
      });
    } finally {
      await app.close();
    }
  });

  it("keeps missing runtime files out of the SPA fallback", async () => {
    const roots = await createStaticRoots();
    const app = await createApp({ ...roots, logger: false });

    try {
      const response = await app.inject({ url: "/runtime/not-present.json" });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).not.toContain("text/html");
      expect(response.body).not.toContain("STS-dle");
    } finally {
      await app.close();
    }
  });
});

describe("main", () => {
  it("performs exactly one successful synchronization before listening", async () => {
    const events: string[] = [];
    const roots = await createStaticRoots();
    const listen = vi.fn(async () => {
      events.push("listen");
      return "http://127.0.0.1:3000";
    });
    const sync = vi.fn(async () => {
      events.push("sync");
      return active(roots.snapshotRoot);
    });

    await main({
      env: { STSDLE_DATA_DIR: roots.snapshotRoot },
      store: { loadActive: vi.fn(async () => null) },
      sync,
      createApp: vi.fn(async () => {
        events.push("createApp");
        return { listen };
      }),
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["sync", "createApp", "listen"]);
  });

  it("does not listen when synchronization fails and no prior snapshot exists", async () => {
    const listen = vi.fn();

    await expect(main({
      env: {},
      store: { loadActive: vi.fn(async () => null) },
      sync: vi.fn(async () => { throw new Error("refresh unavailable"); }),
      createApp: vi.fn(async () => ({ listen })),
    })).rejects.toThrow("refresh unavailable");
    expect(listen).not.toHaveBeenCalled();
  });

  it("revalidates and serves the last active snapshot when refresh fails", async () => {
    const roots = await createStaticRoots();
    const prior = active(roots.snapshotRoot);
    const loadPrior = vi.fn(async () => prior);
    const listen = vi.fn(async () => "http://127.0.0.1:3000");
    const warn = vi.fn();
    const info = vi.fn();
    const create = vi.fn(async (options: { snapshotRoot: string }) => ({
      listen,
      log: { warn, info },
      options,
    }));

    await main({
      env: {},
      store: { loadActive: vi.fn(async () => ({ buildId: prior.buildId, path: prior.path })) },
      sync: vi.fn(async () => { throw new Error("refresh unavailable"); }),
      loadActivatedSnapshot: loadPrior,
      createApp: create,
    });

    expect(loadPrior).toHaveBeenCalledWith(prior.path);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ snapshotRoot: prior.path }));
    expect(listen).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { errorName: "Error" },
      "Snapshot refresh failed; serving validated prior snapshot",
    );
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      sourceRevision: "prior-revision",
      cardCount: 0,
      fallbackCardCount: 0,
    }), "Serving validated snapshot");
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toContain("refresh unavailable");
  });

  it("does not listen when refresh and prior-snapshot validation both fail", async () => {
    const listen = vi.fn();

    await expect(main({
      env: {},
      store: { loadActive: vi.fn(async () => ({ buildId: "corrupt", path: "C:\\snapshots\\corrupt" })) },
      sync: vi.fn(async () => { throw new Error("refresh unavailable"); }),
      loadActivatedSnapshot: vi.fn(async () => { throw new Error("File hash mismatch"); }),
      createApp: vi.fn(async () => ({ listen })),
    })).rejects.toThrow("File hash mismatch");
    expect(listen).not.toHaveBeenCalled();
  });

  it("requires and validates a prior snapshot when synchronization is explicitly skipped", async () => {
    const sync = vi.fn();
    const listen = vi.fn();

    await expect(main({
      env: { STSDLE_SKIP_SYNC: "1" },
      store: { loadActive: vi.fn(async () => null) },
      sync,
      createApp: vi.fn(async () => ({ listen })),
    })).rejects.toThrow(/STSDLE_SKIP_SYNC requires a validated active snapshot/i);
    expect(sync).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});

describe("loadConfig", () => {
  it("uses the documented Spire Codex environment variable", () => {
    expect(loadConfig({ SPIRE_CODEX_BASE_URL: "https://cards.example" }).spireCodexBaseUrl)
      .toBe("https://cards.example");
  });
});
