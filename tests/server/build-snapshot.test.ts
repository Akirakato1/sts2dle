import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import { FEATURE_ORDER, type CardIdentity } from "../../src/shared/domain.js";
import { buildSnapshot, writeStableJson } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";
import { createApp } from "../../src/server/app.js";

const temporaryDirectories: string[] = [];
let artwork: Buffer;
let fallbackImage: Buffer;

async function createStore(): Promise<SnapshotStore> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-snapshot-"));
  temporaryDirectories.push(directory);
  return new SnapshotStore(directory);
}

function fixtureClient(
  cards: RawSpireCard[] = fixture as RawSpireCard[],
  sourceRevision = "ab".repeat(32),
) {
  return {
    async fetchCards() {
      return {
        cards,
        rawBody: JSON.stringify(cards),
        sourceRevision,
        lastModified: "Tue, 11 Aug 2026 15:34:42 GMT",
        fetchedAt: "2026-08-11T23:59:00.000Z",
      };
    },
  };
}

beforeAll(async () => {
  artwork = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "purple" },
  }).webp().toBuffer();
  fallbackImage = await sharp({
    create: { width: 400, height: 520, channels: 3, background: "purple" },
  }).webp().toBuffer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("buildSnapshot", () => {
  it("serializes builds for one data directory and leaves the later activation active", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-snapshot-serialized-"));
    temporaryDirectories.push(dataDir);
    const store = new SnapshotStore(dataDir);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted = false;
    const secondFetch = vi.fn(async () => fixtureClient(
      [fixture[0] as RawSpireCard],
      "22".repeat(32),
    ).fetchCards());
    const common = {
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    } as const;
    const first = buildSnapshot({
      ...common,
      client: {
        async fetchCards() {
          firstStarted = true;
          await firstGate;
          return fixtureClient([fixture[0] as RawSpireCard], "11".repeat(32)).fetchCards();
        },
      },
    });
    await vi.waitFor(() => expect(firstStarted).toBe(true));
    const second = buildSnapshot({ ...common, client: { fetchCards: secondFetch } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondFetch).not.toHaveBeenCalled();

    releaseFirst();
    await first;
    const secondActivated = await second;

    expect(secondFetch).toHaveBeenCalledOnce();
    await expect(store.loadActive()).resolves.toMatchObject({ buildId: secondActivated.buildId });
  });

  it("retains the active and most recent validated recovery snapshot only", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-snapshot-retention-"));
    temporaryDirectories.push(dataDir);
    const store = new SnapshotStore(dataDir);
    const build = (revisionByte: string) => buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard], revisionByte.repeat(64)),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });

    const first = await build("1");
    const second = await build("2");
    const third = await build("3");
    const entries = await readdir(join(dataDir, "snapshots"));

    expect(entries.sort()).toEqual([second.buildId, third.buildId].sort());
    expect(entries).not.toContain(first.buildId);
  });

  it("preserves invalid, unrelated, and linked production-looking snapshot paths", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-snapshot-retention-preserve-"));
    const outside = await mkdtemp(join(tmpdir(), "stsdle-snapshot-retention-outside-"));
    temporaryDirectories.push(dataDir, outside);
    const snapshots = join(dataDir, "snapshots");
    await mkdir(snapshots, { recursive: true });
    const invalid = "deadbeefdead-1234567890123";
    const linked = "feedfacefeed-1234567890123";
    await mkdir(join(snapshots, invalid));
    await writeFile(join(snapshots, invalid, "manifest.json"), "{}\n");
    await symlink(outside, join(snapshots, linked), "junction");
    await writeFile(join(snapshots, "operator-notes.txt"), "keep");
    const store = new SnapshotStore(dataDir);
    const build = (revision: string) => buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard], revision),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });

    await build("4".repeat(64));
    await build("5".repeat(64));
    await build("6".repeat(64));

    const entries = await readdir(snapshots);
    expect(entries).toEqual(expect.arrayContaining([invalid, linked, "operator-notes.txt"]));
    await expect(writeFile(join(outside, "still-present"), "yes")).resolves.toBeUndefined();
  });

  it("cleans abandoned owned staging directories while preserving unknown and linked paths", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-snapshot-staging-"));
    const outside = await mkdtemp(join(tmpdir(), "stsdle-snapshot-staging-outside-"));
    temporaryDirectories.push(dataDir, outside);
    const snapshots = join(dataDir, "snapshots");
    await mkdir(snapshots, { recursive: true });
    const abandoned = "abcdef123456-1234567890123.staging";
    const unknown = "operator-notes.staging";
    const linked = "abcdef123457-1234567890123.staging";
    await mkdir(join(snapshots, abandoned));
    await mkdir(join(snapshots, unknown));
    await symlink(outside, join(snapshots, linked), "junction");

    await buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard]),
      store: new SnapshotStore(dataDir),
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });

    const entries = await readdir(snapshots);
    expect(entries).not.toContain(abandoned);
    expect(entries).toContain(unknown);
    expect(entries).toContain(linked);
    await expect(writeFile(join(outside, "still-present"), "yes")).resolves.toBeUndefined();
  });
  it("passes canonical hosted artwork to both sprite and fallback rendering", async () => {
    const store = await createStore();
    const raw = fixture[3] as RawSpireCard;
    const requestedUrls: string[] = [];
    const render = vi.fn(async (_raw: RawSpireCard, _upgraded: boolean, destination: string) => {
      await writeFile(destination, fallbackImage);
    });

    await buildSnapshot({
      client: fixtureClient([raw]),
      store,
      baseUrl: "https://spire-codex.com",
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return new Response(new Uint8Array(artwork));
      },
      fallbackRenderer: { render },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://cdn.spire-codex.com"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });

    expect(requestedUrls).toEqual(["https://cdn.spire-codex.com/cards/mad_science_attack.webp"]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls.every(([rendered]) => rendered.image_url === "https://cdn.spire-codex.com/cards/mad_science_attack.webp"))
      .toBe(true);
  });

  it("renders every required fallback through one batch API", async () => {
    const store = await createStore();
    const render = vi.fn(async () => { throw new Error("single render must not be used"); });
    const renderBatch = vi.fn(async (requests: ReadonlyArray<{
      raw: RawSpireCard;
      upgraded: boolean;
      destination: string;
    }>) => {
      await Promise.all(requests.map((request) => writeFile(request.destination, fallbackImage)));
    });

    await buildSnapshot({
      client: fixtureClient([fixture[3] as RawSpireCard]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render, renderBatch },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });

    expect(render).not.toHaveBeenCalled();
    expect(renderBatch).toHaveBeenCalledOnce();
    expect(renderBatch.mock.calls[0]?.[0].map(({ raw, upgraded }) => [raw.id, upgraded])).toEqual([
      ["MAD_SCIENCE", false],
      ["MAD_SCIENCE", true],
    ]);
  });

  it("builds, validates, and activates a stable snapshot with only required fallbacks", async () => {
    const store = await createStore();
    const render = vi.fn(async (_raw: RawSpireCard, _upgraded: boolean, destination: string) => {
      await writeFile(destination, fallbackImage);
    });

    const activated = await buildSnapshot({
      client: fixtureClient(),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render },
      artworkConcurrency: 2,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(activated.manifest).toMatchObject({
      sourceRevision: "ab".repeat(32),
      fetchedAt: "2026-08-11T23:59:00.000Z",
      generatedAt: "2026-08-12T00:00:00.000Z",
      cardCount: fixture.length,
      upgradeCount: 6,
    });
    expect(activated.manifest.baseGroupCount).toBeGreaterThan(0);
    expect(activated.report.cardCount).toBe(fixture.length);
    await expect(readFile(join(activated.path, "candidate.webp"))).resolves.toBeInstanceOf(Buffer);
    await expect(store.loadActive()).resolves.toMatchObject({ buildId: activated.buildId });
    expect(render.mock.calls.map(([raw, upgraded]) => [raw.id, upgraded])).toEqual([
      ["MAD_SCIENCE", false],
      ["MAD_SCIENCE", true],
    ]);

    const cards = JSON.parse(
      await readFile(join(activated.path, "cards.json"), "utf8"),
    ) as CardIdentity[];
    expect(cards.map(({ id }) => id)).toEqual([...cards.map(({ id }) => id)].sort());
    const madScienceDigest = createHash("sha256").update("MAD_SCIENCE", "utf8").digest("hex");
    expect(cards.find(({ id }) => id === "MAD_SCIENCE")).toMatchObject({
      baseCardUrl: `/runtime/fallback/${madScienceDigest}.webp`,
      upgradedCardUrl: `/runtime/fallback/${madScienceDigest}_upg.webp`,
    });
    const dazed = cards.find(({ id }) => id === "DAZED");
    expect(dazed).toBeDefined();
    expect(Object.keys(dazed!.base)).toHaveLength(7);
    expect(Object.keys(dazed!.base)).toEqual([...FEATURE_ORDER].sort());
    expect(dazed!.base.keywords).toContain("Unplayable");
    const spriteMap = JSON.parse(await readFile(join(activated.path, "sprite-map.json"), "utf8")) as {
      cards: Record<string, { candidate: unknown; guess: unknown }>;
    };
    expect(spriteMap.cards.DAZED).toMatchObject({
      candidate: { width: 64, height: 64 },
      guess: { width: 160, height: 160 },
    });
    expect(Object.keys(activated.manifest.files)).not.toContain("manifest.json");
    expect(Object.keys(activated.manifest.files)).toEqual([...Object.keys(activated.manifest.files)].sort());
    expect((await readFile(join(activated.path, "manifest.json"), "utf8")).endsWith("\n")).toBe(true);
  });

  it("rejects duplicate stable IDs before creating an active snapshot", async () => {
    const store = await createStore();
    const duplicate = { ...(fixture[0] as RawSpireCard), name: "Different name" };

    await expect(buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard, duplicate]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    })).rejects.toThrow(/duplicate card ID.*ALCHEMIZE/i);
    await expect(store.loadActive()).resolves.toBeNull();
  });

  it("marks every card whose display name needs class disambiguation", async () => {
    const store = await createStore();
    const first = fixture[0] as RawSpireCard;
    const second = {
      ...first,
      id: "ALCHEMIZE_SILENT",
      color: "silent",
      image_url: "/static/images/cards/alchemize_silent.webp",
    };

    const activated = await buildSnapshot({
      client: fixtureClient([first, second]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });
    const cards = JSON.parse(await readFile(join(activated.path, "cards.json"), "utf8")) as Array<{
      id: string;
      duplicateName?: boolean;
    }>;

    expect(cards).toMatchObject([
      { id: "ALCHEMIZE", duplicateName: true },
      { id: "ALCHEMIZE_SILENT", duplicateName: true },
    ]);
  });

  it.each([
    "http://cdn.test/card.webp",
    "https://127.0.0.1/card.webp",
    "https://user:secret@cdn.test/card.webp",
    "https://cdn.test:8443/card.webp",
    "https://unapproved.test/card.webp",
  ])("rejects unsafe or unapproved full-card URL %s before image I/O", async (imageUrl) => {
    const store = await createStore();
    const raw = { ...(fixture[0] as RawSpireCard), image_url_card: imageUrl };
    const fetchImpl = vi.fn();

    await expect(buildSnapshot({
      client: fixtureClient([raw]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl,
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    })).rejects.toThrow(/full-card.*ALCHEMIZE.*not allowed/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(store.loadActive()).resolves.toBeNull();
  });

  it("rejects an unsafe supplied upgraded reveal URL even when the card has no upgrade", async () => {
    const store = await createStore();
    const raw = {
      ...(fixture[4] as RawSpireCard),
      image_url_card_upg: "https://127.0.0.1/unused.webp",
    };
    const fetchImpl = vi.fn();

    await expect(buildSnapshot({
      client: fixtureClient([raw]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl,
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    })).rejects.toThrow(/full-card.*DAZED.*not allowed/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps arbitrary stable IDs to collision-safe fallback filenames that Fastify serves", async () => {
    const store = await createStore();
    const ids = ["slash/id", "back\\slash", "%2e%2e", "..", "\u5361\u724c/\u03b2"];
    const rawCards = ids.map((id, index) => ({
      ...(fixture[3] as RawSpireCard),
      id,
      name: `Fallback ${index}`,
      image_url: `/static/images/cards/fallback-${index}.webp`,
    }));
    const activated = await buildSnapshot({
      client: fixtureClient(rawCards),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: {
        async render(_raw, _upgraded, destination) {
          await writeFile(destination, fallbackImage);
        },
      },
      artworkConcurrency: 2,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
    });
    const cards = JSON.parse(await readFile(join(activated.path, "cards.json"), "utf8")) as Array<{
      id: string;
      baseCardUrl: string;
      upgradedCardUrl: string;
    }>;
    const clientRoot = await mkdtemp(join(tmpdir(), "stsdle-client-"));
    temporaryDirectories.push(clientRoot);
    await mkdir(clientRoot, { recursive: true });
    await writeFile(join(clientRoot, "index.html"), "<!doctype html>");
    const app = await createApp({ snapshotRoot: activated.path, clientRoot, logger: false });
    try {
      for (const card of cards) {
        const digest = createHash("sha256").update(card.id, "utf8").digest("hex");
        expect(card.baseCardUrl).toBe(`/runtime/fallback/${digest}.webp`);
        expect(card.upgradedCardUrl).toBe(`/runtime/fallback/${digest}_upg.webp`);
        expect((await app.inject({ url: card.baseCardUrl })).statusCode).toBe(200);
        expect((await app.inject({ url: card.upgradedCardUrl })).statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });

  it("waits for sibling JSON writes to settle before removing a failed staging snapshot", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-snapshot-barrier-"));
    temporaryDirectories.push(dataDir);
    const store = new SnapshotStore(dataDir);
    let releaseDelayedWrite!: () => void;
    const delayedWrite = new Promise<void>((resolve) => { releaseDelayedWrite = resolve; });
    let failureObserved = false;
    let delayedWriteFinished = false;
    let buildSettled = false;
    const writeStableJsonImpl = vi.fn(async (path: string, value: unknown) => {
      if (path.endsWith("cards.json")) {
        failureObserved = true;
        throw new Error("injected JSON write failure");
      }
      if (path.endsWith("base-groups.json")) {
        await delayedWrite;
        await writeStableJson(path, value);
        delayedWriteFinished = true;
        return;
      }
      await writeStableJson(path, value);
    });

    const build = buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
      writeStableJsonImpl,
    });
    void build.finally(() => { buildSettled = true; }).catch(() => undefined);
    await vi.waitFor(() => expect(failureObserved).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(buildSettled).toBe(false);

    releaseDelayedWrite();
    await expect(build).rejects.toThrow("injected JSON write failure");
    expect(delayedWriteFinished).toBe(true);
    await expect(readdir(join(dataDir, "snapshots"))).resolves.toEqual([]);
    await expect(store.loadActive()).resolves.toBeNull();
  });

  it("waits for sibling hashes to settle before removing a failed staging snapshot", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-hash-barrier-"));
    temporaryDirectories.push(dataDir);
    const store = new SnapshotStore(dataDir);
    let releaseDelayedHash!: () => void;
    const delayedHash = new Promise<void>((resolve) => { releaseDelayedHash = resolve; });
    let failureObserved = false;
    let delayedHashFinished = false;
    let buildSettled = false;
    const hashFileImpl = vi.fn(async (path: string) => {
      if (path.endsWith("cards.json")) {
        failureObserved = true;
        throw new Error("injected hash failure");
      }
      if (path.endsWith("candidate.webp")) {
        await delayedHash;
        delayedHashFinished = true;
      }
      return createHash("sha256").update(await readFile(path)).digest("hex");
    });

    const build = buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
      hashFileImpl,
    });
    void build.finally(() => { buildSettled = true; }).catch(() => undefined);
    await vi.waitFor(() => expect(failureObserved).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(buildSettled).toBe(false);

    releaseDelayedHash();
    await expect(build).rejects.toThrow("injected hash failure");
    expect(delayedHashFinished).toBe(true);
    await expect(readdir(join(dataDir, "snapshots"))).resolves.toEqual([]);
    await expect(store.loadActive()).resolves.toBeNull();
  });

  it("preserves the primary build failure when staging cleanup also fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "stsdle-abort-failure-"));
    temporaryDirectories.push(dataDir);
    const store = new class extends SnapshotStore {
      override async createStaging(sourceRevision: string) {
        const created = await super.createStaging(sourceRevision);
        return {
          ...created,
          async abort() {
            await created.abort();
            throw new Error("injected cleanup failure");
          },
        };
      }
    }(dataDir);

    const build = buildSnapshot({
      client: fixtureClient([fixture[0] as RawSpireCard]),
      store,
      baseUrl: "https://spire-codex.test",
      fetchImpl: async () => new Response(new Uint8Array(artwork)),
      fallbackRenderer: { render: vi.fn() },
      artworkConcurrency: 1,
      allowedArtworkOrigins: ["https://spire-codex.test"],
      allowedFullCardOrigins: ["https://cdn.test"],
      writeStableJsonImpl: async (path, value) => {
        if (path.endsWith("cards.json")) throw new Error("injected primary failure");
        await writeStableJson(path, value);
      },
    });

    const error = await build.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String).join(" ")).toContain("injected primary failure");
    expect((error as AggregateError).errors.map(String).join(" ")).toContain("injected cleanup failure");
  });
});
