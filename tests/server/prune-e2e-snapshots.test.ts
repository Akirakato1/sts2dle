import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import fixture from "../fixtures/spire-cards.json";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";
import { buildSnapshot, type ActivatedSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import { validateSnapshot } from "../../src/server/sync/validate-snapshot.js";
import { withE2eFixtureDataLock } from "../e2e/fixtures/fixture-data-lock.js";
import { pruneSupersededFixtureSnapshots } from "../e2e/fixtures/prune-test-snapshots.js";

const temporaryDirectories: string[] = [];
const VALIDATION_OPTIONS = {
  allowedArtworkOrigins: ["https://spire-codex.test"],
  allowedFullCardOrigins: ["https://cdn.test"],
} as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

async function temporaryDirectory(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), name));
  temporaryDirectories.push(directory);
  return directory;
}

async function snapshot(root: string, buildId: string): Promise<string> {
  const directory = join(root, "snapshots", buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    sourceRevision: buildId.split("-")[0],
  }));
  return directory;
}

async function validSnapshot(dataDir: string, sourceRevision: string): Promise<ActivatedSnapshot> {
  const artwork = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "orange" },
  }).webp().toBuffer();
  const fallback = await sharp({
    create: { width: 400, height: 520, channels: 3, background: "orange" },
  }).webp().toBuffer();

  return buildSnapshot({
    client: {
      async fetchCards() {
        return {
          cards: fixture as RawSpireCard[],
          rawBody: JSON.stringify(fixture),
          sourceRevision,
          lastModified: null,
          fetchedAt: "2026-08-12T00:00:00.000Z",
        };
      },
    },
    store: new SnapshotStore(dataDir),
    baseUrl: "https://spire-codex.test",
    fetchImpl: async () => new Response(new Uint8Array(artwork)),
    fallbackRenderer: {
      async render(_raw, _upgraded, destination) {
        await writeFile(destination, fallback);
      },
    },
    artworkConcurrency: 2,
    ...VALIDATION_OPTIONS,
    now: () => new Date("2026-08-12T00:00:01.000Z"),
  });
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("pruneSupersededFixtureSnapshots", () => {
  it("keeps only the active validated E2E snapshot while preserving unrelated paths", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-prune-");
    const unrelatedRoot = await temporaryDirectory("stsdle-e2e-unrelated-");
    const obsoleteOne = await validSnapshot(dataDir, "obsoleteone");
    const obsoleteTwo = await validSnapshot(dataDir, "obsoletetwo");
    const hashMismatch = await validSnapshot(dataDir, "hashmismatch");
    await writeFile(join(hashMismatch.path, "cards.json"), "[]\n");
    const active = await validSnapshot(dataDir, "activefixture");
    await mkdir(join(dataDir, "snapshots", "notes"));
    await snapshot(dataDir, "notasnapshot-400");
    await mkdir(join(dataDir, "snapshots", "corruptsnap1-500"));
    await writeFile(join(dataDir, "snapshots", "corruptsnap1-500", "manifest.json"), "{");
    await writeFile(join(unrelatedRoot, "keep.txt"), "keep");

    await pruneSupersededFixtureSnapshots(dataDir, active, VALIDATION_OPTIONS);

    expect((await readdir(join(dataDir, "snapshots"))).sort()).toEqual([
      active.buildId,
      hashMismatch.buildId,
      "corruptsnap1-500",
      "notasnapshot-400",
      "notes",
    ].sort());
    expect(obsoleteOne.buildId).not.toBe(obsoleteTwo.buildId);
    expect(await readFile(join(unrelatedRoot, "keep.txt"), "utf8")).toBe("keep");
  });

  it("rejects an active path outside the configured snapshots directory before deleting anything", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-escape-");
    const unrelatedRoot = await temporaryDirectory("stsdle-e2e-outside-");
    const supersededPath = await snapshot(dataDir, "fixtureabc12-100");
    await writeFile(join(unrelatedRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      sourceRevision: "outside",
    }));

    await expect(pruneSupersededFixtureSnapshots(dataDir, {
      buildId: "outsidebuild-300",
      path: unrelatedRoot,
    }, VALIDATION_OPTIONS)).rejects.toThrow(/escapes the configured E2E snapshots directory/i);

    expect(await readdir(supersededPath)).toContain("manifest.json");
    expect(await readdir(unrelatedRoot)).toContain("manifest.json");
  });
});

describe("withE2eFixtureDataLock", () => {
  it("serializes two complete fixture build sequences without deleting the active snapshot", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-concurrent-");
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];

    const first = withE2eFixtureDataLock(dataDir, async (lockedDataDir) => {
      order.push("first:start");
      const active = await validSnapshot(lockedDataDir, "firstfixture");
      firstEntered.resolve();
      await releaseFirst.promise;
      await pruneSupersededFixtureSnapshots(lockedDataDir, active, VALIDATION_OPTIONS);
      order.push("first:end");
      return active;
    });
    await firstEntered.promise;

    const second = withE2eFixtureDataLock(dataDir, async (lockedDataDir) => {
      order.push("second:start");
      const active = await validSnapshot(lockedDataDir, "secondfixtur");
      await pruneSupersededFixtureSnapshots(lockedDataDir, active, VALIDATION_OPTIONS);
      order.push("second:end");
      return active;
    });
    await delay(30);
    expect(order).toEqual(["first:start"]);
    releaseFirst.resolve();

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(firstSnapshot.buildId).not.toBe(secondSnapshot.buildId);

    const pointer = JSON.parse(await readFile(join(dataDir, "active.json"), "utf8")) as { buildId: string };
    const snapshotDirectories = await readdir(join(dataDir, "snapshots"));
    expect(pointer.buildId).toBe(secondSnapshot.buildId);
    expect(snapshotDirectories).toEqual([secondSnapshot.buildId]);
    await expect(validateSnapshot(secondSnapshot.path, VALIDATION_OPTIONS)).resolves.toMatchObject({
      cardCount: 6,
    });
  });

  it("releases lock ownership when the critical section throws", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-error-");

    await expect(withE2eFixtureDataLock(dataDir, async () => {
      throw new Error("fixture build failed");
    })).rejects.toThrow("fixture build failed");

    let entered = false;
    await withE2eFixtureDataLock(dataDir, async () => { entered = true; });
    expect(entered).toBe(true);
    expect(await readdir(dataDir)).not.toContain(".stsdle-e2e-fixture.lock");
  });

  it("times out without entering or reclaiming a held critical section", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-timeout-");
    const holderEntered = deferred();
    const releaseHolder = deferred();
    const holder = withE2eFixtureDataLock(dataDir, async () => {
      holderEntered.resolve();
      await releaseHolder.promise;
    });
    await holderEntered.promise;

    let contenderEntered = false;
    await expect(withE2eFixtureDataLock(dataDir, async () => {
      contenderEntered = true;
    }, { retryDelayMs: 5, timeoutMs: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for E2E fixture data lock",
    );
    expect(contenderEntered).toBe(false);
    expect(await readdir(dataDir)).toContain(".stsdle-e2e-fixture.lock");

    releaseHolder.resolve();
    await holder;
    expect(await readdir(dataDir)).not.toContain(".stsdle-e2e-fixture.lock");
  });
});
