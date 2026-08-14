import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import {
  beginDeploymentArchivePublish,
  createDeploymentArchive,
  readDeploymentRevision,
  validateDeploymentArchive,
} from "../../src/server/release/deployment-archive.js";
import { buildSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";

const roots: string[] = [];
const validationOptions = {
  allowedArtworkOrigins: ["https://spire-codex.test"],
  allowedFullCardOrigins: ["https://cdn.test"],
} as const;
let artwork: Buffer;
let fallbackImage: Buffer;

beforeAll(async () => {
  artwork = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "orange" },
  }).webp().toBuffer();
  fallbackImage = await sharp({
    create: { width: 400, height: 520, channels: 3, background: "orange" },
  }).webp().toBuffer();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("deployment snapshot archive", () => {
  it("creates byte-deterministic archives and strictly validates the one active build", async () => {
    const revision = "ab".repeat(32);
    const source = await createValidSource(revision);
    const root = await temporaryRoot();
    const first = join(root, "first.tar.gz");
    const second = join(root, "second.tar.gz");

    await createDeploymentArchive(source.dataDir, first, revision, validationOptions);
    await createDeploymentArchive(source.dataDir, second, revision, validationOptions);

    expect(sha256(await readFile(first))).toBe(sha256(await readFile(second)));
    const validated = await validateDeploymentArchive(first, revision, validationOptions);
    try {
      expect(validated.active.buildId).toBe(source.buildId);
      expect(validated.sourceRevision).toBe(revision);
      expect(validated.entryNames[0]).toBe("active.json");
      expect(validated.entryNames).toEqual([...validated.entryNames].sort());
      expect(new Set(validated.entryNames).size).toBe(validated.entryNames.length);
    } finally {
      await validated.cleanup();
    }
    await expect(readDeploymentRevision(first, validationOptions)).resolves.toBe(revision);
  });

  it("publishes a fixed archive transactionally and rolls back byte-identically", async () => {
    const oldRevision = "12".repeat(32);
    const newRevision = "34".repeat(32);
    const oldSource = await createValidSource(oldRevision);
    const newSource = await createValidSource(newRevision);
    const root = await temporaryRoot();
    const destination = join(root, "snapshot-data.tar.gz");
    const staging = join(root, ".snapshot-data.tar.gz.staging");
    await createDeploymentArchive(oldSource.dataDir, destination, oldRevision, validationOptions);
    const before = await readFile(destination);
    await createDeploymentArchive(newSource.dataDir, staging, newRevision, validationOptions);

    const published = await beginDeploymentArchivePublish(
      staging,
      destination,
      newRevision,
      validationOptions,
    );
    expect(await readDeploymentRevision(destination, validationOptions)).toBe(newRevision);
    expect(published.recoveryArtifact!()).toMatch(/^\.snapshot-data\.tar\.gz\.backup-/);
    await published.rollback();
    await published.rollback();
    await published.finalize();

    expect(await readFile(destination)).toEqual(before);
    expect(await readDeploymentRevision(destination, validationOptions)).toBe(oldRevision);
  });

  it("restores the previous archive when strict post-swap validation fails without leaking payloads", async () => {
    const oldRevision = "56".repeat(32);
    const newRevision = "78".repeat(32);
    const oldSource = await createValidSource(oldRevision);
    const newSource = await createValidSource(newRevision);
    const root = await temporaryRoot();
    const destination = join(root, "snapshot-data.tar.gz");
    const staging = join(root, ".snapshot-data.tar.gz.staging");
    await createDeploymentArchive(oldSource.dataDir, destination, oldRevision, validationOptions);
    const before = await readFile(destination);
    await createDeploymentArchive(newSource.dataDir, staging, newRevision, validationOptions);

    const error = await captureError(beginDeploymentArchivePublish(
      staging,
      destination,
      newRevision,
      validationOptions,
      { afterPublish: async () => { throw new Error(`secret ${destination}`); } },
    ));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Published deployment archive failed validation");
    expect(reachableErrorText(error)).not.toContain(destination);
    expect(await readFile(destination)).toEqual(before);
  });
});

async function createValidSource(sourceRevision: string): Promise<{ dataDir: string; buildId: string }> {
  const dataDir = await temporaryRoot();
  const active = await buildSnapshot({
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
    fallbackRenderer: { async render(_raw, _upgraded, destination) { await BunWrite(destination, fallbackImage); } },
    artworkConcurrency: 2,
    allowedArtworkOrigins: ["https://spire-codex.test"],
    allowedFullCardOrigins: ["https://cdn.test"],
    now: () => new Date("2026-08-12T00:00:01.000Z"),
  });
  return { dataDir, buildId: active.buildId };
}

async function BunWrite(path: string, data: Buffer): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, data);
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stsdle-deployment-archive-"));
  roots.push(root);
  return root;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error: unknown) { return error; }
  throw new Error("Expected rejection");
}

function reachableErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (seen.has(error)) return "";
  seen.add(error);
  if (!(error instanceof Error)) return String(error);
  const nested = [
    "cause" in error ? error.cause : undefined,
    error instanceof AggregateError ? error.errors : undefined,
  ].flatMap((value) => Array.isArray(value) ? value : [value]);
  return [error.name, error.message, ...nested.map((value) => reachableErrorText(value, seen))].join("\n");
}
