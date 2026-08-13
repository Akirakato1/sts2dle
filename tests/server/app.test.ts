import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { logStartupFailure, main } from "../../src/server/main.js";
import type { ActivatedSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import type { SnapshotAcceptanceReport } from "../../src/server/sync/validate-snapshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function createStaticRoots(): Promise<{ root: string; clientRoot: string; snapshotRoot: string }> {
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
  return { root, clientRoot, snapshotRoot };
}

function active(path: string, buildId = "prior-build"): ActivatedSnapshot {
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
    buildId,
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

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
    if (error) rejectClose(error);
    else resolveClose();
  }));
  return port;
}

async function rawHttpRequest(
  port: number,
  method: "GET" | "HEAD",
  path: string,
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, method, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolveRequest({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", rejectRequest);
    request.end();
  });
}

describe("createApp", () => {
  it("serves runtime files, built client assets, SPA routes, and health metadata", async () => {
    const roots = await createStaticRoots();
    const app = await createApp({ ...roots, logger: false });

    try {
      const runtime = await app.inject({ url: "/runtime/manifest.json" });
      expect(runtime.statusCode).toBe(200);
      expect(runtime.json()).toMatchObject({ sourceRevision: "source-revision" });
      const asset = await app.inject({ url: "/main.js?source=%2Fclient%5Casset" });
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

  it("bounds recursive path decoding independently of input nesting depth", async () => {
    const roots = await createStaticRoots();
    const app = await createApp({ ...roots, logger: false });
    const deeplyEncodedDot = `/cards/%${"25".repeat(64)}2e`;
    const decode = vi.spyOn(globalThis, "decodeURIComponent");

    try {
      const response = await app.inject({ url: deeplyEncodedDot });
      expect(response.statusCode).toBe(404);
      expect(decode.mock.calls.length).toBeLessThanOrEqual(8);
    } finally {
      await app.close();
    }
  });

  it("fails closed over real HTTP for deeply and malformed encoded paths while preserving Unicode routes", async () => {
    const roots = await createStaticRoots();
    const app = await createApp({ ...roots, logger: false });

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const port = (app.server.address() as AddressInfo).port;
      const deeplyEncodedDot = `/cards/%${"25".repeat(7_000)}2e`;

      const deeplyEncoded = await rawHttpRequest(port, "GET", deeplyEncodedDot);
      expect(deeplyEncoded.statusCode).toBe(404);
      expect(deeplyEncoded.headers["content-type"] ?? "").not.toContain("text/html");
      expect(deeplyEncoded.body).not.toContain("STS-dle");

      const malformed = await rawHttpRequest(port, "GET", "/cards/%E0%A4%A");
      expect([400, 404]).toContain(malformed.statusCode);
      expect(malformed.headers["content-type"] ?? "").not.toContain("text/html");
      expect(malformed.body).not.toContain("STS-dle");

      const unicodeRoute = await rawHttpRequest(port, "GET", "/cards/%E6%97%A5%E6%9C%AC");
      expect(unicodeRoute.statusCode).toBe(200);
      expect(unicodeRoute.headers["content-type"]).toContain("text/html");
      expect(unicodeRoute.body).toContain("STS-dle");
    } finally {
      await app.close();
    }
  });

  it.each(["GET", "HEAD"] as const)(
    "keeps canonical, encoded, and malformed runtime namespace forms out of the SPA for %s",
    async (method) => {
      const roots = await createStaticRoots();
      const app = await createApp({ ...roots, logger: false });

      try {
        for (const url of [
          "/runtime?x=1",
          "/runtime%2Fmissing.json",
          "/runtime%5Cmissing.json",
          "/runtime%252Fmissing.json",
          "/runtime%252525252Fmissing.json",
          "/runtime%ZZ",
        ]) {
          const response = await app.inject({ method, url });
          expect([400, 404], `${method} ${url}`).toContain(response.statusCode);
          expect(response.headers["content-type"] ?? "", `${method} ${url}`).not.toContain("text/html");
          expect(response.body, `${method} ${url}`).not.toContain("STS-dle");
        }
      } finally {
        await app.close();
      }
    },
  );

  it.each(["GET", "HEAD"] as const)(
    "strictly rejects non-canonical static paths before runtime, asset, or SPA routing for %s",
    async (method) => {
      const roots = await createStaticRoots();
      await Promise.all([
        writeFile(join(roots.root, "outside-secret.txt"), "OUTSIDE_ROOT_SECRET"),
        writeFile(join(roots.clientRoot, ".client-secret.txt"), "CLIENT_DOTFILE_SECRET"),
      ]);
      const app = await createApp({
        clientRoot: roots.clientRoot,
        snapshotRoot: roots.snapshotRoot,
        logger: false,
      });

      try {
        await app.listen({ host: "127.0.0.1", port: 0 });
        const port = (app.server.address() as AddressInfo).port;
        for (const url of [
          "/runtime/../main.js",
          "/runtime/%2e%2e/main.js",
          "/runtime//missing.json",
          "/./runtime/missing.json",
          "//runtime/missing.json",
          "/safe/../runtime/missing.json",
          "/safe/%2e%2e/runtime/missing.json",
          "/safe%2fruntime/missing.json",
          "/safe%5cruntime/missing.json",
          "/../outside-secret.txt",
          "/%2e%2e/outside-secret.txt",
          "/foo/../.client-secret.txt",
          "/foo/%2e%2e/.client-secret.txt",
          "/foo%2f..%2f.client-secret.txt",
          "/foo%5c..%5c.client-secret.txt",
        ]) {
          const response = await rawHttpRequest(port, method, url);
          expect(response.statusCode, `${method} ${url}`).toBe(404);
          expect(response.headers["content-type"] ?? "", `${method} ${url}`).not.toContain("text/html");
          expect(response.body, `${method} ${url}`).not.toContain("STS-dle");
          expect(response.body, `${method} ${url}`).not.toContain("OUTSIDE_ROOT_SECRET");
          expect(response.body, `${method} ${url}`).not.toContain("CLIENT_DOTFILE_SECRET");
          expect(response.body, `${method} ${url}`).not.toContain("globalThis.loaded");
        }
      } finally {
        await app.close();
      }
    },
  );

  it("keeps route matching case-sensitive when isolating the runtime namespace", async () => {
    const roots = await createStaticRoots();
    const app = await createApp({ ...roots, logger: false });
    try {
      const response = await app.inject({ url: "/Runtime?x=1" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
    } finally {
      await app.close();
    }
  });
});

describe("main", () => {
  it("keeps a running server snapshot through two later EADDRINUSE startups", async () => {
    const root = await mkdtemp(join(tmpdir(), "stsdle-live-snapshot-"));
    temporaryDirectories.push(root);
    const dataDir = join(root, "data");
    const clientRoot = join(root, "client");
    await mkdir(clientRoot, { recursive: true });
    await writeFile(join(clientRoot, "index.html"), "<!doctype html><title>STS-dle</title>");
    const port = await unusedPort();
    const buildIds: string[] = [];

    const start = async (label: string) => {
      const store = new SnapshotStore(dataDir);
      return main({
        env: {
          STSDLE_DATA_DIR: dataDir,
          STSDLE_HOST: "127.0.0.1",
          STSDLE_PORT: String(port),
        },
        clientRoot,
        store,
        sync: async () => store.withSyncLock(async () => {
          const staging = await store.createStaging(label.repeat(64));
          await Promise.all([
            writeFile(join(staging.path, "manifest.json"), JSON.stringify({
              sourceRevision: label.repeat(64),
              generatedAt: "2026-08-12T00:00:00.000Z",
            })),
            writeFile(join(staging.path, "probe.txt"), label),
          ]);
          const path = await staging.activate();
          const activated = { ...active(path), buildId: staging.buildId };
          buildIds.push(staging.buildId);
          await store.retainValidatedSnapshots(activated, async () => true);
          return activated;
        }),
        createApp: async (options) => createApp({ ...options, logger: false }),
      });
    };

    const running = await start("a") as FastifyInstance;
    try {
      await expect(start("b")).rejects.toMatchObject({ code: "EADDRINUSE" });
      await expect(start("c")).rejects.toMatchObject({ code: "EADDRINUSE" });

      const leases = await readdir(join(dataDir, ".stsdle-snapshot-leases"));
      expect(leases.filter((entry) => entry.endsWith(".json"))).toHaveLength(1);
      const response = await fetch(`http://127.0.0.1:${port}/runtime/probe.txt`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("a");
      await expect(readdir(join(dataDir, "snapshots"))).resolves.toContain(buildIds[0]);
    } finally {
      await running.close();
    }
    await expect(readdir(join(dataDir, ".stsdle-snapshot-leases"))).resolves.toEqual([]);
  });

  it("logs only a fixed startup failure category without feed-derived error text", () => {
    const error = vi.fn();
    logStartupFailure(new Error("SECRET_MARKER_CARD_ID_MAD_SCIENCE"), { error });

    expect(error).toHaveBeenCalledWith("STS-dle server startup failed", { category: "startup_failure" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET_MARKER");
    expect(JSON.stringify(error.mock.calls)).not.toContain("MAD_SCIENCE");
  });

  it("loads and runs the production synchronizer once before creating and listening with the app", async () => {
    const events: string[] = [];
    const roots = await createStaticRoots();
    const store = new SnapshotStore(join(roots.root, "data"));
    const staging = await store.createStaging("prebuilt");
    const snapshot = active(await staging.activate(), staging.buildId);
    const listen = vi.fn(async () => {
      events.push("listen");
      return "http://127.0.0.1:3000";
    });
    const synchronize = vi.fn(async () => {
      events.push("synchronize");
      return snapshot;
    });
    const loadProductionSync = vi.fn(async () => {
      events.push("loadProductionSync");
      return synchronize;
    });

    await main({
      env: { STSDLE_DATA_DIR: join(roots.root, "data") },
      store,
      loadProductionSync,
      createApp: vi.fn(async () => {
        events.push("createApp");
        return { listen, addHook: vi.fn() };
      }),
    });

    expect(loadProductionSync).toHaveBeenCalledOnce();
    expect(synchronize).toHaveBeenCalledOnce();
    expect(events).toEqual(["loadProductionSync", "synchronize", "createApp", "listen"]);
  });

  it("closes before releasing a failed-startup lease and preserves cleanup failures", async () => {
    const roots = await createStaticRoots();
    const startupError = new Error("listen failed");
    const leaseError = new Error("lease release failed");
    const events: string[] = [];
    let closeHook: (() => Promise<void>) | undefined;
    let releasePromise: Promise<void> | undefined;
    const release = vi.fn(async () => {
      events.push("release");
      releasePromise ??= Promise.reject(leaseError);
      await releasePromise;
    });
    const close = vi.fn(async () => {
      events.push("close");
      await closeHook?.();
    });

    const rejection = await main({
      env: { STSDLE_DATA_DIR: roots.snapshotRoot },
      store: {
        loadActive: vi.fn(async () => null),
        acquireSnapshotLease: vi.fn(async () => ({ release })),
      },
      sync: vi.fn(async () => active(roots.snapshotRoot)),
      createApp: vi.fn(async () => ({
        listen: vi.fn(async () => { throw startupError; }),
        addHook: (_name: "onClose", hook: () => Promise<void>) => { closeHook = hook; },
        close,
      })),
    }).then(() => undefined, (error: unknown) => error);

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).cause).toBe(startupError);
    expect((rejection as AggregateError).errors).toEqual([startupError, leaseError]);
    expect(events).toEqual(["close", "release", "release"]);
    expect(close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(2);
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

    expect(loadPrior).toHaveBeenCalledWith(prior.path, {
      allowedArtworkOrigins: ["https://cdn.spire-codex.com", "https://spire-codex.com"],
      allowedFullCardOrigins: ["https://cdn.spire-codex.com", "https://spire-codex.com"],
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ snapshotRoot: prior.path }));
    expect(listen).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { errorName: "Error" },
      "Snapshot refresh failed; serving validated prior snapshot",
    );
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith({
      sourceRevision: "prior-revision",
      sourceLastModified: null,
      cardCount: 0,
      upgradeCount: 0,
      baseGroupCount: 0,
      pairGroupCount: 0,
      baseGroupHistogram: {},
      pairGroupHistogram: {},
      candidateSpriteBytes: 1,
      guessSpriteBytes: 1,
      fallbackCardCount: 0,
    }, "Snapshot startup acceptance passed");
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
    expect(loadConfig({ SPIRE_CODEX_BASE_URL: "https://cards.example" })).toMatchObject({
      spireCodexBaseUrl: "https://cards.example",
      artworkAllowedOrigins: ["https://cards.example"],
      fullCardAllowedOrigins: ["https://cards.example"],
    });
  });

  it("parses explicit artwork and full-card origin allowlists", () => {
    expect(loadConfig({
      SPIRE_CODEX_BASE_URL: "https://cards.example",
      STSDLE_ARTWORK_ALLOWED_ORIGINS: "https://art.example, https://cards.example",
      STSDLE_FULL_CARD_ALLOWED_ORIGINS: "https://cdn.example,https://cards.example",
    })).toMatchObject({
      artworkAllowedOrigins: ["https://art.example", "https://cards.example"],
      fullCardAllowedOrigins: ["https://cards.example", "https://cdn.example"],
    });
  });

  it.each([
    "http://cdn.example",
    "https://127.0.0.1",
    "https://localhost",
    "https://user:secret@cdn.example",
    "https://cdn.example:8443",
    "https://cdn.example/path",
  ])("rejects unsafe configured image origin %s", (origin) => {
    expect(() => loadConfig({ STSDLE_FULL_CARD_ALLOWED_ORIGINS: origin })).toThrow(/origin/i);
  });
});
