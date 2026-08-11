import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import fixture from "../fixtures/spire-cards.json";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";
import { buildSnapshot, type ActivatedSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
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
