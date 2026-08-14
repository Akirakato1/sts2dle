import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import sharp from "sharp";
import * as tar from "tar";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import {
  beginDeploymentArchivePublish,
  createDeploymentArchive,
  MAX_DEPLOYMENT_ENTRY_BYTES,
  MAX_DEPLOYMENT_UNCOMPRESSED_BYTES,
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

    const validationRootsBefore = await validationTemporaryRoots();
    let cleanupCalls = 0;
    const error = await captureError(beginDeploymentArchivePublish(
      staging,
      destination,
      newRevision,
      validationOptions,
      {
        afterPublish: async () => { throw new Error(`secret ${destination}`); },
        removeValidationRoot: async (path) => {
          cleanupCalls += 1;
          if (cleanupCalls === 2) throw new Error(`private after-publish cleanup ${root}`);
          await rm(path, { recursive: true, force: true });
        },
      },
    ));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Published deployment archive failed validation");
    expect(reachableErrorText(error)).not.toContain(destination);
    expect(await readFile(destination)).toEqual(before);
    expect(cleanupCalls).toBe(3);
    expect(await validationTemporaryRoots()).toEqual(validationRootsBefore);
  });

  it("validates and extracts only the immutable private copy when the source pathname is swapped", async () => {
    const revision = "8b".repeat(32);
    const source = await createValidSource(revision);
    const root = await temporaryRoot();
    const archive = join(root, "snapshot-data.tar.gz");
    const displaced = join(root, "displaced.tar.gz");
    const maliciousRoot = join(root, "malicious");
    const malicious = join(root, "malicious.tar.gz");
    await createDeploymentArchive(source.dataDir, archive, revision, validationOptions);
    await mkdir(maliciousRoot);
    await writeFile(join(maliciousRoot, "unexpected"), "malicious");
    await tar.create({ cwd: maliciousRoot, file: malicious, gzip: true }, ["unexpected"]);

    const validated = await validateDeploymentArchive(archive, revision, validationOptions, {
      afterInspection: async () => {
        await rename(archive, displaced);
        await rename(malicious, archive);
      },
    });
    try {
      expect(validated.sourceRevision).toBe(revision);
      expect(validated.active.buildId).toBe(source.buildId);
    } finally {
      await validated.cleanup();
    }
  });

  it("never clobbers a concurrent final-path winner after backing up the old archive", async () => {
    const oldRevision = "6c".repeat(32);
    const nextRevision = "7d".repeat(32);
    const oldSource = await createValidSource(oldRevision);
    const nextSource = await createValidSource(nextRevision);
    const root = await temporaryRoot();
    const destination = join(root, "snapshot-data.tar.gz");
    const staging = join(root, ".snapshot-data.tar.gz.staging");
    await createDeploymentArchive(oldSource.dataDir, destination, oldRevision, validationOptions);
    await createDeploymentArchive(nextSource.dataDir, staging, nextRevision, validationOptions);

    await expect(beginDeploymentArchivePublish(staging, destination, nextRevision, validationOptions, {
      beforePublish: async () => { await writeFile(destination, "concurrent winner\n", { flag: "wx" }); },
    })).rejects.toThrow("Unable to publish deployment archive");

    expect(await readFile(destination, "utf8")).toBe("concurrent winner\n");
    expect((await readdir(root)).filter((name) => name.includes(".backup-"))).toHaveLength(1);
  });

  it("restores the old archive when staging unlink fails after the final hard link is installed", async () => {
    const oldRevision = "7a".repeat(32);
    const nextRevision = "7b".repeat(32);
    const oldSource = await createValidSource(oldRevision);
    const nextSource = await createValidSource(nextRevision);
    const root = await temporaryRoot();
    const destination = join(root, "snapshot-data.tar.gz");
    const staging = join(root, ".snapshot-data.tar.gz.staging");
    await createDeploymentArchive(oldSource.dataDir, destination, oldRevision, validationOptions);
    const original = await readFile(destination);
    await createDeploymentArchive(nextSource.dataDir, staging, nextRevision, validationOptions);
    let injected = false;

    await expect(beginDeploymentArchivePublish(staging, destination, nextRevision, validationOptions, {
      unlinkFile: async (path) => {
        if (path === staging && !injected) {
          injected = true;
          throw new Error(`private unlink payload ${root}`);
        }
        await unlink(path);
      },
    })).rejects.toThrow("Unable to publish deployment archive");

    expect(await readFile(destination)).toEqual(original);
    expect(await readDeploymentRevision(destination, validationOptions)).toBe(oldRevision);
  });

  it("retries cleanup of every private validation root when the first post-publish cleanup fails", async () => {
    const oldRevision = "8e".repeat(32);
    const nextRevision = "8f".repeat(32);
    const oldSource = await createValidSource(oldRevision);
    const nextSource = await createValidSource(nextRevision);
    const root = await temporaryRoot();
    const destination = join(root, "snapshot-data.tar.gz");
    const staging = join(root, ".snapshot-data.tar.gz.staging");
    await createDeploymentArchive(oldSource.dataDir, destination, oldRevision, validationOptions);
    await createDeploymentArchive(nextSource.dataDir, staging, nextRevision, validationOptions);
    const beforeTemporaryRoots = await validationTemporaryRoots();
    let cleanupCalls = 0;

    const published = await beginDeploymentArchivePublish(staging, destination, nextRevision, validationOptions, {
      removeValidationRoot: async (path) => {
        cleanupCalls += 1;
        if (cleanupCalls === 2) throw new Error(`injected cleanup payload ${root}`);
        await rm(path, { recursive: true, force: true });
      },
    });
    await published.finalize();

    expect(await readDeploymentRevision(destination, validationOptions)).toBe(nextRevision);
    expect(cleanupCalls).toBe(4);
    expect(await validationTemporaryRoots()).toEqual(beforeTemporaryRoots);
  });

  it("retries successful create and read validation cleanup without leaking private roots", async () => {
    const revision = "93".repeat(32);
    const source = await createValidSource(revision);
    const root = await temporaryRoot();
    const archive = join(root, "snapshot-data.tar.gz");
    const beforeTemporaryRoots = await validationTemporaryRoots();
    let createCleanupCalls = 0;
    await createDeploymentArchive(source.dataDir, archive, revision, validationOptions, {
      removeValidationRoot: async (path) => {
        createCleanupCalls += 1;
        if (createCleanupCalls === 1) throw new Error(`private create cleanup ${root}`);
        await rm(path, { recursive: true, force: true });
      },
    });
    let readCleanupCalls = 0;
    await expect(readDeploymentRevision(archive, validationOptions, {
      removeValidationRoot: async (path) => {
        readCleanupCalls += 1;
        if (readCleanupCalls === 1) throw new Error(`private read cleanup ${root}`);
        await rm(path, { recursive: true, force: true });
      },
    })).resolves.toBe(revision);

    expect(createCleanupCalls).toBe(2);
    expect(readCleanupCalls).toBe(2);
    expect(await validationTemporaryRoots()).toEqual(beforeTemporaryRoots);
  });

  it("cleans both validation roots when the second validation and its first cleanup attempt fail", async () => {
    const oldRevision = "91".repeat(32);
    const nextRevision = "92".repeat(32);
    const oldSource = await createValidSource(oldRevision);
    const nextSource = await createValidSource(nextRevision);
    const root = await temporaryRoot();
    const destination = join(root, "snapshot-data.tar.gz");
    const staging = join(root, ".snapshot-data.tar.gz.staging");
    await createDeploymentArchive(oldSource.dataDir, destination, oldRevision, validationOptions);
    const original = await readFile(destination);
    await createDeploymentArchive(nextSource.dataDir, staging, nextRevision, validationOptions);
    const beforeTemporaryRoots = await validationTemporaryRoots();
    let cleanupCalls = 0;

    await expect(beginDeploymentArchivePublish(staging, destination, nextRevision, validationOptions, {
      afterPublish: async () => { await writeFile(destination, "invalid second validation\n"); },
      removeValidationRoot: async (path) => {
        cleanupCalls += 1;
        if (cleanupCalls === 2) throw new Error(`injected second-validation cleanup payload ${root}`);
        await rm(path, { recursive: true, force: true });
      },
    })).rejects.toThrow("Published deployment archive failed validation");

    expect(await readFile(destination)).toEqual(original);
    expect(cleanupCalls).toBe(4);
    expect(await validationTemporaryRoots()).toEqual(beforeTemporaryRoots);
  });

  it("rejects traversal, links, duplicates, oversize entries, unexpected roots, multiple builds, and entry-count bombs", async () => {
    const revision = "9a".repeat(32);
    const root = await temporaryRoot();
    const validSource = await createValidSource(revision);
    const validArchive = join(root, "valid.tar.gz");
    await createDeploymentArchive(validSource.dataDir, validArchive, revision, validationOptions);
    const directoryBodyArchive = join(root, "directory-body.tar.gz");
    await rewriteTarEntrySize(validArchive, directoryBodyArchive, "snapshots", 1);
    const paxArchive = join(root, "pax.tar.gz");
    await createMetadataArchive(paxArchive, "ExtendedHeader", Buffer.alloc(MAX_DEPLOYMENT_UNCOMPRESSED_BYTES + 1));
    const gnuArchive = join(root, "gnu.tar.gz");
    await createMetadataArchive(gnuArchive, "NextFileHasLongPath", Buffer.from("malicious-long-path\0"));

    const linkedSource = join(root, "linked-source");
    await mkdir(linkedSource);
    await writeFile(join(linkedSource, "target"), "outside");
    await symlink(join(linkedSource, "target"), join(linkedSource, "link"), "file");
    const linkedArchive = join(root, "linked.tar.gz");
    await createNormalizedTestArchive(linkedSource, linkedArchive, ["link"]);

    const unexpectedSource = join(root, "unexpected-source");
    await mkdir(unexpectedSource);
    await writeFile(join(unexpectedSource, "payload"), "unexpected");
    const unexpectedArchive = join(root, "unexpected.tar.gz");
    await createNormalizedTestArchive(unexpectedSource, unexpectedArchive, ["payload"]);
    const traversalArchive = join(root, "traversal.tar.gz");
    await rewriteFirstTarPath(unexpectedArchive, traversalArchive, "../evil");

    const multipleSource = join(root, "multiple-source");
    await mkdir(join(multipleSource, "snapshots", "first"), { recursive: true });
    await mkdir(join(multipleSource, "snapshots", "second"), { recursive: true });
    await writeFile(join(multipleSource, "active.json"), '{"buildId":"first"}\n');
    const multipleArchive = join(root, "multiple.tar.gz");
    await createNormalizedTestArchive(multipleSource, multipleArchive, [
      "active.json", "snapshots", "snapshots/first", "snapshots/second",
    ]);

    const duplicateSource = join(root, "duplicate-source");
    await mkdir(join(duplicateSource, "snapshots", "only"), { recursive: true });
    await writeFile(join(duplicateSource, "active.json"), '{"buildId":"only"}\n');
    const duplicateArchive = join(root, "duplicate.tar.gz");
    await createNormalizedTestArchive(duplicateSource, duplicateArchive, ["active.json", "active.json"]);

    const oversizeSource = join(root, "oversize-source");
    await mkdir(join(oversizeSource, "snapshots", "only"), { recursive: true });
    await writeFile(join(oversizeSource, "active.json"), '{"buildId":"only"}\n');
    await writeFile(join(oversizeSource, "snapshots", "only", "payload.bin"), Buffer.alloc(MAX_DEPLOYMENT_ENTRY_BYTES + 1));
    const oversizeArchive = join(root, "oversize.tar.gz");
    await createNormalizedTestArchive(oversizeSource, oversizeArchive, [
      "active.json", "snapshots", "snapshots/only", "snapshots/only/payload.bin",
    ]);

    const bombSource = join(root, "bomb-source");
    await mkdir(join(bombSource, "snapshots", "only"), { recursive: true });
    await writeFile(join(bombSource, "active.json"), '{"buildId":"only"}\n');
    for (let index = 0; index < 65; index += 1) {
      await writeFile(join(bombSource, "snapshots", "only", `file-${index}.txt`), "x");
    }
    const bombArchive = join(root, "bomb.tar.gz");
    await createNormalizedTestArchive(bombSource, bombArchive, ["active.json", "snapshots"]);

    for (const [label, archive] of [
      ["traversal", traversalArchive],
      ["directory body", directoryBodyArchive],
      ["PAX metadata bomb", paxArchive],
      ["GNU metadata", gnuArchive],
      ["link", linkedArchive],
      ["duplicate", duplicateArchive],
      ["oversize", oversizeArchive],
      ["unexpected", unexpectedArchive],
      ["multiple builds", multipleArchive],
      ["entry count", bombArchive],
    ] as const) {
      const error = await captureErrorWithLabel(
        validateDeploymentArchive(archive, revision, validationOptions),
        label,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Unable to validate deployment archive");
      expect(reachableErrorText(error)).not.toContain(root);
    }
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
    fallbackRenderer: { async render(_raw, _upgraded, destination) { await writeFile(destination, fallbackImage); } },
    artworkConcurrency: 2,
    allowedArtworkOrigins: ["https://spire-codex.test"],
    allowedFullCardOrigins: ["https://cdn.test"],
    now: () => new Date("2026-08-12T00:00:01.000Z"),
  });
  return { dataDir, buildId: active.buildId };
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

async function captureErrorWithLabel(promise: Promise<unknown>, label: string): Promise<unknown> {
  try { await promise; } catch (error: unknown) { return error; }
  throw new Error(`Expected rejection for ${label}`);
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

async function validationTemporaryRoots(): Promise<string[]> {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("stsdle-deployment-archive-validate-"))
    .map((entry) => entry.name)
    .sort();
}

async function createNormalizedTestArchive(cwd: string, file: string, entries: string[]): Promise<void> {
  await tar.create({
    cwd,
    file,
    gzip: { level: 9, portable: true },
    mtime: new Date(0),
    noDirRecurse: entries.some((entry) => entry.includes("/")),
    noPax: true,
    portable: true,
    filter: (_path, entry) => {
      const directory = "isDirectory" in entry && typeof entry.isDirectory === "function"
        ? entry.isDirectory()
        : (entry as tar.ReadEntry).type === "Directory";
      entry.mode = (entry.mode! & ~0o777) | (directory ? 0o755 : 0o644);
      return true;
    },
  }, entries);
}

async function rewriteFirstTarPath(source: string, destination: string, replacement: string): Promise<void> {
  const raw = gunzipSync(await readFile(source));
  if (Buffer.byteLength(replacement) > 100) throw new Error("Test path is too long");
  raw.fill(0, 0, 100);
  raw.write(replacement, 0, "utf8");
  raw.fill(0x20, 148, 156);
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) checksum += raw[index]!;
  raw.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  await writeFile(destination, gzipSync(raw, { level: 9 }));
}

async function rewriteTarEntrySize(
  source: string,
  destination: string,
  targetPath: string,
  replacementSize: number,
): Promise<void> {
  const raw = gunzipSync(await readFile(source));
  for (let offset = 0; offset + 512 <= raw.length; ) {
    const name = raw.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/, "").replace(/\/$/, "");
    const sizeText = raw.subarray(offset + 124, offset + 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (name === targetPath) {
      raw.fill(0, offset + 124, offset + 136);
      raw.write(replacementSize.toString(8).padStart(11, "0"), offset + 124, 11, "ascii");
      rewriteTarChecksum(raw, offset);
      await writeFile(destination, gzipSync(raw, { level: 9 }));
      return;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Test tar entry was not found");
}

async function createMetadataArchive(
  destination: string,
  type: "ExtendedHeader" | "NextFileHasLongPath",
  body: Buffer,
): Promise<void> {
  const header = new tar.Header({ path: "metadata", type, size: body.length, mode: 0o644 });
  header.encode();
  if (!header.block) throw new Error("Unable to encode test tar header");
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  await writeFile(destination, gzipSync(Buffer.concat([header.block, body, padding, Buffer.alloc(1024)]), { level: 9 }));
}

function rewriteTarChecksum(raw: Buffer, offset: number): void {
  raw.fill(0x20, offset + 148, offset + 156);
  let checksum = 0;
  for (let index = offset; index < offset + 512; index += 1) checksum += raw[index]!;
  raw.write(`${checksum.toString(8).padStart(6, "0")}\0 `, offset + 148, 8, "ascii");
}
