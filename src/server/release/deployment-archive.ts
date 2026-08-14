import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { createGunzip } from "node:zlib";
import * as tar from "tar";
import type { Stats } from "node:fs";
import type { ReadEntry } from "tar";
import { SOURCE_REVISION_PATTERN } from "../../shared/snapshot-schema.js";
import { SnapshotStore, type ActiveSnapshot } from "../sync/snapshot-store.js";
import {
  loadActivatedSnapshot,
  type SnapshotValidationOptions,
} from "../sync/validate-snapshot.js";

export const MAX_DEPLOYMENT_ARCHIVE_BYTES = 8 * 1024 * 1024;
export const MAX_DEPLOYMENT_ARCHIVE_ENTRIES = 64;
export const MAX_DEPLOYMENT_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const MAX_DEPLOYMENT_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_VALIDATION_CLEANUP_ATTEMPTS = 3;
const FIXED_MTIME = new Date(0);
const RETRY_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 50;

export interface ValidatedDeploymentArchive {
  active: ActiveSnapshot;
  sourceRevision: string;
  entryNames: readonly string[];
  extractedDataDir: string;
  cleanup(): Promise<void>;
}

export interface ArchiveValidationOperations {
  afterInspection?: () => Promise<void>;
  removeValidationRoot?: (path: string) => Promise<void>;
}

export interface PublishedArchive {
  active: ActiveSnapshot;
  finalize(): Promise<void>;
  rollback(): Promise<void>;
  recoveryArtifact?(): string | null;
}

export interface ArchivePublishOperations {
  afterPublish?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  linkFile?: (from: string, to: string) => Promise<void>;
  monotonicNow?: () => number;
  removeValidationRoot?: (path: string) => Promise<void>;
  renameFile?: (from: string, to: string) => Promise<void>;
  unlinkFile?: (path: string) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
}

interface FileIdentity {
  dev: string;
  ino: string;
  birthtimeMs: string;
}

interface OwnedParent extends FileIdentity {
  path: string;
}

interface OwnedFile {
  path: string;
  name: string;
  parent: OwnedParent;
  identity: FileIdentity;
}

interface PublishOperations {
  afterPublish(): Promise<void>;
  beforePublish(): Promise<void>;
  linkFile(from: string, to: string): Promise<void>;
  monotonicNow(): number;
  removeValidationRoot(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  unlinkFile(path: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

const defaultPublishOperations: PublishOperations = {
  afterPublish: async () => undefined,
  beforePublish: async () => undefined,
  linkFile: link,
  monotonicNow: () => performance.now(),
  removeValidationRoot: async (path) => { await rm(path, { recursive: true, force: true }); },
  renameFile: rename,
  unlinkFile: unlink,
  wait: delay,
};

export async function createDeploymentArchive(
  sourceDataDir: string,
  archivePath: string,
  expectedRevision: string,
  options: SnapshotValidationOptions,
  operations: ArchiveValidationOperations = {},
): Promise<void> {
  let temporaryPath: string | undefined;
  try {
    assertRevision(expectedRevision);
    const active = await loadSafeActive(sourceDataDir, options);
    if (active.sourceRevision !== expectedRevision) throw new Error("Source revision changed");
    const entries = await collectArchiveEntries(sourceDataDir, active.active);
    const target = await resolveMissingFileTarget(archivePath);
    temporaryPath = join(target.parent.path, `.${target.name}.tmp-${randomUUID()}`);
    assertDirectChild(temporaryPath, target.parent.path);
    await tar.create({
      cwd: resolve(sourceDataDir),
      file: temporaryPath,
      gzip: { level: 9, portable: true },
      mtime: FIXED_MTIME,
      noDirRecurse: true,
      noPax: true,
      portable: true,
      strict: true,
      filter: (_path: string, entry: Stats | ReadEntry) => {
        const metadata = entry as Stats;
        entry.mode = (entry.mode! & ~0o777) | (metadata.isDirectory() ? 0o755 : 0o644);
        return true;
      },
    }, entries);
    await syncFile(temporaryPath);
    const validated = await validateArchiveInternal(temporaryPath, expectedRevision, options, operations);
    await validated.cleanup();
    const temporary = await resolveOwnedFile(temporaryPath);
    await revalidateParent(target.parent);
    await linkOwnedFile(temporary, target.path, { ...defaultPublishOperations });
    await unlinkOwnedFile(temporary, { ...defaultPublishOperations });
    temporaryPath = undefined;
    await syncDirectoryIfSupported(target.parent.path);
  } catch {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error("Unable to create deployment archive");
  }
}

export async function validateDeploymentArchive(
  archivePath: string,
  expectedRevision: string,
  options: SnapshotValidationOptions,
  operations: ArchiveValidationOperations = {},
): Promise<ValidatedDeploymentArchive> {
  try {
    assertRevision(expectedRevision);
    return await validateArchiveInternal(archivePath, expectedRevision, options, operations);
  } catch {
    throw new Error("Unable to validate deployment archive");
  }
}

export async function readDeploymentRevision(
  archivePath: string,
  options: SnapshotValidationOptions,
  operations: ArchiveValidationOperations = {},
): Promise<string | null> {
  try {
    const metadata = await lstatIfPresent(archivePath);
    if (!metadata) return null;
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Unsafe archive");
    const validated = await validateArchiveInternal(archivePath, undefined, options, operations);
    await validated.cleanup();
    return validated.sourceRevision;
  } catch {
    throw new Error("Unable to read deployment revision");
  }
}

export async function beginDeploymentArchivePublish(
  stagingArchive: string,
  destinationArchive: string,
  expectedRevision: string,
  options: SnapshotValidationOptions,
  injected: ArchivePublishOperations = {},
): Promise<PublishedArchive> {
  const operations: PublishOperations = { ...defaultPublishOperations, ...withoutUndefined(injected) };
  let stagedValidation: ValidatedDeploymentArchive | undefined;
  try {
    assertRevision(expectedRevision);
    const staging = await resolveOwnedFile(stagingArchive);
    const destinationTarget = await resolveFileTarget(destinationArchive);
    if (!samePath(staging.parent.path, destinationTarget.parent.path)) throw new Error("Not siblings");
    const validationOperations = { removeValidationRoot: operations.removeValidationRoot };
    stagedValidation = await validateArchiveInternal(staging.path, expectedRevision, options, validationOperations);
    await stagedValidation.cleanup();
    stagedValidation = undefined;

    const destination = await resolveOptionalOwnedFile(destinationTarget.path);
    const id = randomUUID();
    const backupPath = join(destinationTarget.parent.path, `.${destinationTarget.name}.backup-${id}`);
    const quarantinePath = join(destinationTarget.parent.path, `.${destinationTarget.name}.quarantine-${id}`);
    await assertMissing(backupPath);
    await assertMissing(quarantinePath);
    const deadline = operations.monotonicNow() + RETRY_TIMEOUT_MS;
    let backup: OwnedFile | null = null;
    if (destination) backup = await renameOwnedFile(destination, backupPath, operations, deadline);

    let published: OwnedFile | undefined;
    try {
      await operations.beforePublish();
      published = await linkOwnedFile(staging, destinationTarget.path, operations);
      await unlinkOwnedFile(staging, operations);
    } catch (error: unknown) {
      if (published) {
        await restorePublishedFile(published, backup, quarantinePath, destinationTarget.path, operations);
        backup = null;
      } else if (backup) {
        try {
          await linkOwnedFile(backup, destinationTarget.path, operations);
          await unlinkOwnedFile(backup, operations);
          backup = null;
        } catch (restoreError: unknown) {
          if (!isNodeError(restoreError, "EEXIST")) throw restoreError;
        }
      }
      throw error;
    }

    let validation: ValidatedDeploymentArchive | undefined;
    let second: ValidatedDeploymentArchive | undefined;
    try {
      validation = await validateArchiveInternal(destinationTarget.path, expectedRevision, options, validationOperations);
      await operations.afterPublish();
      second = await validateArchiveInternal(destinationTarget.path, expectedRevision, options, validationOperations);
      await validation.cleanup();
      validation = undefined;
      validation = second;
      second = undefined;
    } catch {
      await Promise.allSettled([validation?.cleanup(), second?.cleanup()].filter(Boolean) as Promise<void>[]);
      await restorePublishedFile(published, backup, quarantinePath, destinationTarget.path, operations);
      throw new ArchivePublishedValidationError();
    }

    return createTransaction(validation!, published, backup, quarantinePath, destinationTarget.path, operations);
  } catch (error: unknown) {
    await stagedValidation?.cleanup().catch(() => undefined);
    if (error instanceof ArchivePublishedValidationError) throw error;
    throw new Error("Unable to publish deployment archive");
  }
}

class ArchivePublishedValidationError extends Error {
  constructor() { super("Published deployment archive failed validation"); }
}

function createTransaction(
  validation: ValidatedDeploymentArchive,
  published: OwnedFile,
  initialBackup: OwnedFile | null,
  quarantinePath: string,
  destinationPath: string,
  operations: PublishOperations,
): PublishedArchive {
  let backup = initialBackup;
  let current: OwnedFile | null = published;
  let lifecycle: "active" | "finalized" | "rolled-back" = "active";
  let direction: "finalize" | "rollback" | undefined;
  let settling: Promise<void> | undefined;
  const settle = (action: "finalize" | "rollback"): Promise<void> => {
    if (lifecycle !== "active") return Promise.resolve();
    direction ??= action;
    if (direction !== action) return Promise.reject(new Error("Deployment archive settlement action is locked"));
    settling ??= (async () => {
      if (action === "rollback") {
        if (current) await restorePublishedFile(current, backup, quarantinePath, destinationPath, operations);
        current = null;
        backup = null;
      } else {
        if (backup) await unlinkOwnedFile(backup, operations);
        backup = null;
      }
      await validation.cleanup();
      lifecycle = action === "rollback" ? "rolled-back" : "finalized";
    })().catch(() => {
      throw new Error(action === "rollback"
        ? "Unable to roll back deployment archive"
        : "Unable to finalize deployment archive");
    }).finally(() => { settling = undefined; });
    return settling;
  };
  return {
    active: validation.active,
    finalize: () => settle("finalize"),
    rollback: () => settle("rollback"),
    recoveryArtifact: () => backup?.name ?? null,
  };
}

async function restorePublishedFile(
  published: OwnedFile,
  backup: OwnedFile | null,
  quarantinePath: string,
  destinationPath: string,
  operations: PublishOperations,
): Promise<void> {
  const deadline = operations.monotonicNow() + RETRY_TIMEOUT_MS;
  const quarantine = await renameOwnedFile(published, quarantinePath, operations, deadline);
  if (backup) {
    await linkOwnedFile(backup, destinationPath, operations);
    await unlinkOwnedFile(backup, operations);
  }
  await unlinkOwnedFile(quarantine, operations);
}

async function validateArchiveInternal(
  archivePath: string,
  expectedRevision: string | undefined,
  options: SnapshotValidationOptions,
  operations: ArchiveValidationOperations = {},
): Promise<ValidatedDeploymentArchive> {
  const extractionRoot = await mkdtemp(join(tmpdir(), "stsdle-deployment-archive-validate-"));
  const immutableArchive = join(extractionRoot, "archive.tar.gz");
  const dataDir = join(extractionRoot, "data");
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_VALIDATION_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        if (operations.removeValidationRoot) await operations.removeValidationRoot(extractionRoot);
        else await rm(extractionRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: RETRY_DELAY_MS });
        cleaned = true;
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError;
  };
  try {
    await copyArchiveBounded(archivePath, immutableArchive);
    const inspected = createEntryInspector();
    await inspectArchive(immutableArchive, inspected);
    const { entryNames, buildId } = inspected.finish();
    await operations.afterInspection?.();
    await mkdir(dataDir);
    const extracted = createEntryInspector();
    await inspectArchive(immutableArchive, extracted, dataDir);
    const extractedResult = extracted.finish();
    if (extractedResult.entryNames.join("\n") !== entryNames.join("\n")) {
      throw new Error("Archive changed during extraction");
    }
    await assertSafeExtractedTree(dataDir, entryNames);
    const loaded = await loadSafeActive(dataDir, options);
    if (loaded.active.buildId !== buildId || expectedRevision !== undefined && loaded.sourceRevision !== expectedRevision) {
      throw new Error("Archive source identity changed");
    }
    return {
      active: loaded.active,
      sourceRevision: loaded.sourceRevision,
      entryNames,
      extractedDataDir: dataDir,
      cleanup,
    };
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}

async function inspectArchive(
  archivePath: string,
  inspector: ReturnType<typeof createEntryInspector>,
  extractionDirectory?: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    let source: ReturnType<typeof createReadStream>;
    const decompressor = createGunzip();
    let parser: tar.Parser | tar.Unpack;
    const settle = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error === undefined) {
        resolvePromise();
        return;
      }
      source.destroy();
      decompressor.destroy();
      if (source.closed) rejectPromise(error);
      else source.once("close", () => rejectPromise(error));
    };
    const filter = (_path: string, entry: Stats | ReadEntry): boolean => {
      try {
        return inspector.inspect(entry as ReadEntry);
      } catch (error: unknown) {
        const violation = error instanceof Error ? error : new Error("Unsafe archive entry");
        queueMicrotask(() => {
          parser.abort(violation);
        });
        return false;
      }
    };
    const common = {
      file: archivePath,
      filter,
      maxMetaEntrySize: MAX_MANIFEST_BYTES,
      strict: true,
    };
    parser = extractionDirectory === undefined
      ? new tar.Parser({ ...common, onReadEntry: (entry) => entry.resume() })
      : new tar.Unpack({
        ...common,
        cwd: extractionDirectory,
        preservePaths: false,
        unlink: true,
      });
    source = createReadStream(archivePath);
    let decompressedBytes = 0;
    const rawInspector = createRawTarInspector((error) => parser.abort(error));
    decompressor.on("data", (chunk: Buffer) => {
      decompressedBytes += chunk.length;
      if (decompressedBytes > MAX_DEPLOYMENT_UNCOMPRESSED_BYTES) {
        parser.abort(new Error("Archive decompressed size exceeded"));
        return;
      }
      rawInspector(chunk);
    });
    parser.on("error", settle);
    source.on("error", settle);
    decompressor.on("error", settle);
    parser.on("meta", () => parser.abort(new Error("Archive metadata entries are forbidden")));
    parser.on("ignoredEntry", (entry: ReadEntry) => {
      if (entry.meta) parser.abort(new Error("Archive metadata entries are forbidden"));
    });
    parser.on(extractionDirectory === undefined ? "end" : "close", () => settle());
    source.pipe(decompressor).pipe(parser);
  });
}

function createRawTarInspector(abort: (error: Error) => void): (chunk: Buffer) => void {
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let bodyBytes = 0;
  let aborted = false;
  return (chunk): void => {
    if (aborted) return;
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    while (buffered.length > 0) {
      if (bodyBytes > 0) {
        const consumed = Math.min(bodyBytes, buffered.length);
        bodyBytes -= consumed;
        buffered = buffered.subarray(consumed);
        continue;
      }
      if (buffered.length < 512) return;
      const header = buffered.subarray(0, 512);
      buffered = buffered.subarray(512);
      if (header.every((byte) => byte === 0)) continue;
      try {
        const path = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
        const type = String.fromCharCode(header[156] ?? 0).replace("\0", "");
        const size = parseRawTarSize(header.subarray(124, 136));
        if ((type === "5" || (type === "" || type === "0") && path.endsWith("/")) && size !== 0) {
          throw new Error("Archive directory has a body");
        }
        if (!["", "0", "1", "2", "3", "4", "5", "6", "7", "D"].includes(type)) {
          throw new Error("Archive metadata entries are forbidden");
        }
        bodyBytes = Math.ceil(size / 512) * 512;
      } catch (error: unknown) {
        aborted = true;
        abort(error instanceof Error ? error : new Error("Unsafe tar header"));
        return;
      }
    }
  };
}

function parseRawTarSize(field: Buffer): number {
  if ((field[0]! & 0x80) !== 0) throw new Error("Binary tar sizes are forbidden");
  const value = field.toString("ascii").replace(/\0.*$/, "").trim();
  if (value !== "" && !/^[0-7]+$/.test(value)) throw new Error("Invalid tar size");
  const size = value === "" ? 0 : Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid tar size");
  return size;
}

function createEntryInspector(): {
  inspect(entry: ReadEntry): true;
  finish(): { entryNames: string[]; buildId: string };
} {
  const entryNames: string[] = [];
  const seen = new Set<string>();
  let totalSize = 0;
  let buildId: string | undefined;
  return {
    inspect(entry) {
      const name = validateEntry(entry);
      if (seen.has(name)) throw new Error("Duplicate archive entry");
      if (entry.size > MAX_DEPLOYMENT_ENTRY_BYTES ||
        /\/manifest\.json$/.test(name) && entry.size > MAX_MANIFEST_BYTES) {
        throw new Error("Archive entry is too large");
      }
      seen.add(name);
      entryNames.push(name);
      if (entry.type === "File") totalSize += entry.size;
      if (entryNames.length > MAX_DEPLOYMENT_ARCHIVE_ENTRIES || totalSize > MAX_DEPLOYMENT_UNCOMPRESSED_BYTES) {
        throw new Error("Archive limits exceeded");
      }
      const segments = name.split("/");
      if (segments[0] === "snapshots" && segments.length >= 2) {
        if (!buildId) buildId = segments[1];
        else if (buildId !== segments[1]) throw new Error("Multiple snapshot builds");
      }
      return true;
    },
    finish() {
      if (entryNames.length === 0 || entryNames.some((name, index) => index > 0 && name < entryNames[index - 1]!)) {
        throw new Error("Archive entries are not ordered");
      }
      if (!seen.has("active.json") || !seen.has("snapshots") || !buildId || !seen.has(`snapshots/${buildId}`)) {
        throw new Error("Archive structure is incomplete");
      }
      return { entryNames, buildId };
    },
  };
}

async function copyArchiveBounded(sourcePath: string, destinationPath: string): Promise<void> {
  const before = await lstat(sourcePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Unsafe archive file");
  const source = await open(sourcePath, "r");
  let destination: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const opened = await source.stat();
    if (!sameIdentity(identityOf(opened), identityOf(before))) throw new Error("Archive identity changed");
    if (opened.size > MAX_DEPLOYMENT_ARCHIVE_BYTES) throw new Error("Archive too large");
    destination = await open(destinationPath, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > MAX_DEPLOYMENT_ARCHIVE_BYTES) throw new Error("Archive too large");
      await destination.write(buffer.subarray(0, bytesRead));
    }
    await destination.sync();
  } finally {
    await Promise.allSettled([source.close(), destination?.close()]);
  }
}

function validateEntry(entry: ReadEntry): string {
  const raw = entry.path;
  if (!raw || raw.includes("\\") || raw.includes("\0") || isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith("//")) {
    throw new Error("Unsafe archive path");
  }
  const name = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Unsafe archive path");
  }
  if (entry.type !== "File" && entry.type !== "Directory") throw new Error("Unsafe archive entry type");
  if (entry.linkpath) throw new Error("Archive links are forbidden");
  const isDirectory = entry.type === "Directory";
  if (isDirectory && entry.size !== 0) throw new Error("Archive directory has a body");
  if ((entry.mode! & 0o777) !== (isDirectory ? 0o755 : 0o644)) throw new Error("Archive mode is not normalized");
  if (entry.uid !== undefined || entry.gid !== undefined || (entry.mtime !== undefined && entry.mtime.getTime() !== 0)) {
    throw new Error("Archive metadata is not normalized");
  }
  if (name === "active.json") {
    if (isDirectory) throw new Error("Invalid active pointer entry");
    return name;
  }
  if (segments[0] !== "snapshots" || segments.length > 2 && segments[2] === "") {
    throw new Error("Unexpected archive top level");
  }
  if (segments.length <= 2 && !isDirectory) throw new Error("Invalid snapshot directory entry");
  if (segments.length > 2 && isDirectory && name.endsWith("manifest.json")) throw new Error("Invalid archive entry");
  return name;
}

async function loadSafeActive(
  dataDir: string,
  options: SnapshotValidationOptions,
): Promise<{ active: ActiveSnapshot; sourceRevision: string }> {
  const root = resolve(dataDir);
  if (!samePath(await realpath(root), root)) throw new Error("Unsafe data root");
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Unsafe data root");
  const active = await new SnapshotStore(root).loadActive();
  if (!active) throw new Error("Snapshot is unavailable");
  const expectedParent = join(root, "snapshots");
  if (!samePath(dirname(active.path), expectedParent)) throw new Error("Snapshot escaped data root");
  const loaded = await loadActivatedSnapshot(active.path, options);
  assertRevision(loaded.manifest.sourceRevision);
  return { active, sourceRevision: loaded.manifest.sourceRevision };
}

async function collectArchiveEntries(dataDir: string, active: ActiveSnapshot): Promise<string[]> {
  const root = resolve(dataDir);
  const snapshots = join(root, "snapshots");
  const activePath = join(snapshots, active.buildId);
  if (!samePath(resolve(active.path), activePath)) throw new Error("Unsafe active snapshot");
  const entries = ["active.json", "snapshots", `snapshots/${active.buildId}`];
  await collectTree(root, activePath, entries);
  return entries.sort();
}

async function collectTree(root: string, directory: string, entries: string[]): Promise<void> {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const child of children) {
    const absolute = join(directory, child.name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) throw new Error("Unsafe snapshot tree");
    const name = relative(root, absolute).split(sep).join("/");
    entries.push(name);
    if (metadata.isDirectory()) await collectTree(root, absolute, entries);
  }
}

async function assertSafeExtractedTree(root: string, expectedEntries: readonly string[]): Promise<void> {
  const actual: string[] = [];
  await collectExtracted(root, root, actual);
  if (actual.sort().join("\n") !== [...expectedEntries].sort().join("\n")) throw new Error("Extracted archive file set changed");
}

async function collectExtracted(root: string, directory: string, entries: string[]): Promise<void> {
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, child.name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) throw new Error("Unsafe extracted tree");
    entries.push(relative(root, absolute).split(sep).join("/"));
    if (metadata.isDirectory()) await collectExtracted(root, absolute, entries);
  }
}

async function resolveMissingFileTarget(path: string): Promise<{ path: string; name: string; parent: OwnedParent }> {
  const target = await resolveFileTarget(path);
  await assertMissing(target.path);
  return target;
}

async function resolveFileTarget(path: string): Promise<{ path: string; name: string; parent: OwnedParent }> {
  const configured = resolve(path);
  const parentPath = dirname(configured);
  const resolvedParent = await realpath(parentPath);
  if (!samePath(resolvedParent, parentPath)) throw new Error("Unsafe archive parent");
  const parentStat = await lstat(resolvedParent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("Unsafe archive parent");
  const name = basename(configured);
  const target = join(resolvedParent, name);
  assertDirectChild(target, resolvedParent);
  return { path: target, name, parent: { path: resolvedParent, ...identityOf(parentStat) } };
}

async function resolveOwnedFile(path: string): Promise<OwnedFile> {
  const target = await resolveFileTarget(path);
  const metadata = await lstat(target.path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Unsafe archive file");
  if (!samePath(await realpath(target.path), target.path)) throw new Error("Unsafe archive file");
  return { ...target, identity: identityOf(metadata) };
}

async function resolveOptionalOwnedFile(path: string): Promise<OwnedFile | null> {
  try { return await resolveOwnedFile(path); } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

async function renameOwnedFile(
  file: OwnedFile,
  targetPath: string,
  operations: PublishOperations,
  deadline: number,
): Promise<OwnedFile> {
  assertDirectChild(targetPath, file.parent.path);
  for (;;) {
    await revalidateOwnedFile(file);
    await assertMissing(targetPath);
    try {
      await operations.renameFile(file.path, targetPath);
      await syncDirectoryIfSupported(file.parent.path);
      return resolveOwnedFile(targetPath);
    } catch (error: unknown) {
      if (!isTransient(error) || operations.monotonicNow() >= deadline) throw error;
      await operations.wait(RETRY_DELAY_MS);
    }
  }
}

async function linkOwnedFile(
  file: OwnedFile,
  targetPath: string,
  operations: Pick<PublishOperations, "linkFile" | "monotonicNow" | "wait">,
): Promise<OwnedFile> {
  assertDirectChild(targetPath, file.parent.path);
  const deadline = operations.monotonicNow() + RETRY_TIMEOUT_MS;
  for (;;) {
    await revalidateOwnedFile(file);
    try {
      await operations.linkFile(file.path, targetPath);
      const linked = await resolveOwnedFile(targetPath);
      if (!sameIdentity(linked.identity, file.identity)) throw new Error("Published archive identity changed");
      await syncDirectoryIfSupported(file.parent.path);
      return linked;
    } catch (error: unknown) {
      if (!isTransient(error) || operations.monotonicNow() >= deadline) throw error;
      await operations.wait(RETRY_DELAY_MS);
    }
  }
}

async function unlinkOwnedFile(file: OwnedFile, operations: PublishOperations): Promise<void> {
  await revalidateOwnedFile(file);
  await operations.unlinkFile(file.path);
  await syncDirectoryIfSupported(file.parent.path);
}

async function revalidateOwnedFile(file: OwnedFile): Promise<void> {
  await revalidateParent(file.parent);
  const current = await resolveOwnedFile(file.path);
  if (!sameIdentity(current.identity, file.identity)) throw new Error("Archive identity changed");
}

async function revalidateParent(parent: OwnedParent): Promise<void> {
  const metadata = await lstat(parent.path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !sameIdentity(identityOf(metadata), parent)) {
    throw new Error("Archive parent changed");
  }
  if (!samePath(await realpath(parent.path), parent.path)) throw new Error("Archive parent changed");
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectoryIfSupported(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error: unknown) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function identityOf(metadata: Awaited<ReturnType<typeof lstat>>): FileIdentity {
  return { dev: String(metadata.dev), ino: String(metadata.ino), birthtimeMs: String(metadata.birthtimeMs) };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}

async function assertMissing(path: string): Promise<void> {
  if (await lstatIfPresent(path)) throw new Error("Archive path already exists");
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path); } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

function assertDirectChild(path: string, parent: string): void {
  if (!samePath(dirname(resolve(path)), resolve(parent)) || basename(path) === "" || basename(path) === "." || basename(path) === "..") {
    throw new Error("Unsafe archive path");
  }
}

function assertRevision(value: string): void {
  if (!SOURCE_REVISION_PATTERN.test(value)) throw new Error("Invalid source revision");
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isTransient(error: unknown): boolean {
  return isNodeError(error, "EPERM") || isNodeError(error, "EBUSY");
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (
    error.code === "EISDIR" || error.code === "EINVAL" || error.code === "ENOTSUP" ||
    error.code === "EBADF" || process.platform === "win32" && (error.code === "EPERM" || error.code === "EACCES")
  );
}
