import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import * as tar from "tar";
import type { Stats } from "node:fs";
import type { ReadEntry } from "tar";
import { SOURCE_REVISION_PATTERN } from "../../shared/snapshot-schema.js";
import { SnapshotStore, type ActiveSnapshot } from "../sync/snapshot-store.js";
import {
  loadActivatedSnapshot,
  type SnapshotValidationOptions,
} from "../sync/validate-snapshot.js";

export const MAX_DEPLOYMENT_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_DEPLOYMENT_ARCHIVE_ENTRIES = 64;
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

export interface PublishedArchive {
  active: ActiveSnapshot;
  finalize(): Promise<void>;
  rollback(): Promise<void>;
  recoveryArtifact?(): string | null;
}

export interface ArchivePublishOperations {
  afterPublish?: () => Promise<void>;
  monotonicNow?: () => number;
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
  monotonicNow(): number;
  renameFile(from: string, to: string): Promise<void>;
  unlinkFile(path: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

const defaultPublishOperations: PublishOperations = {
  afterPublish: async () => undefined,
  monotonicNow: () => performance.now(),
  renameFile: rename,
  unlinkFile: unlink,
  wait: delay,
};

export async function createDeploymentArchive(
  sourceDataDir: string,
  archivePath: string,
  expectedRevision: string,
  options: SnapshotValidationOptions,
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
    const validated = await validateArchiveInternal(temporaryPath, expectedRevision, options);
    await validated.cleanup();
    await revalidateParent(target.parent);
    await rename(temporaryPath, target.path);
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
): Promise<ValidatedDeploymentArchive> {
  try {
    assertRevision(expectedRevision);
    return await validateArchiveInternal(archivePath, expectedRevision, options);
  } catch {
    throw new Error("Unable to validate deployment archive");
  }
}

export async function readDeploymentRevision(
  archivePath: string,
  options: SnapshotValidationOptions,
): Promise<string | null> {
  try {
    const metadata = await lstatIfPresent(archivePath);
    if (!metadata) return null;
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Unsafe archive");
    const revision = await inspectManifestRevision(archivePath);
    const validated = await validateArchiveInternal(archivePath, revision, options);
    await validated.cleanup();
    return revision;
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
    stagedValidation = await validateArchiveInternal(staging.path, expectedRevision, options);
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

    let published: OwnedFile;
    try {
      published = await renameOwnedFile(staging, destinationTarget.path, operations, deadline);
    } catch (error: unknown) {
      if (backup) await renameOwnedFile(backup, destinationTarget.path, operations, operations.monotonicNow() + RETRY_TIMEOUT_MS);
      throw error;
    }

    let validation: ValidatedDeploymentArchive;
    try {
      validation = await validateArchiveInternal(destinationTarget.path, expectedRevision, options);
      await operations.afterPublish();
      const second = await validateArchiveInternal(destinationTarget.path, expectedRevision, options);
      await validation.cleanup();
      validation = second;
    } catch {
      await restorePublishedFile(published, backup, quarantinePath, destinationTarget.path, operations);
      throw new ArchivePublishedValidationError();
    }

    return createTransaction(validation, published, backup, quarantinePath, destinationTarget.path, operations);
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
        lifecycle = "rolled-back";
      } else {
        if (backup) await unlinkOwnedFile(backup, operations);
        backup = null;
        lifecycle = "finalized";
      }
      await validation.cleanup();
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
  if (backup) await renameOwnedFile(backup, destinationPath, operations, deadline);
  await unlinkOwnedFile(quarantine, operations);
}

async function validateArchiveInternal(
  archivePath: string,
  expectedRevision: string,
  options: SnapshotValidationOptions,
): Promise<ValidatedDeploymentArchive> {
  const owned = await resolveOwnedFile(archivePath);
  const compressed = await stat(owned.path);
  if (compressed.size > MAX_DEPLOYMENT_ARCHIVE_BYTES) throw new Error("Archive too large");
  const entryNames: string[] = [];
  const seen = new Set<string>();
  let totalSize = 0;
  let buildId: string | undefined;
  let inspectionError: unknown;
  await tar.list({
    file: owned.path,
    strict: true,
    onReadEntry: (entry) => {
      if (inspectionError) return;
      try {
        const name = validateEntry(entry);
        if (seen.has(name)) throw new Error("Duplicate archive entry");
        seen.add(name);
        entryNames.push(name);
        if (entry.type === "File") totalSize += entry.size;
        if (entryNames.length > MAX_DEPLOYMENT_ARCHIVE_ENTRIES || totalSize > MAX_DEPLOYMENT_ARCHIVE_BYTES) {
          throw new Error("Archive limits exceeded");
        }
        const segments = name.split("/");
        if (segments[0] === "snapshots" && segments.length >= 2) {
          if (!buildId) buildId = segments[1];
          else if (buildId !== segments[1]) throw new Error("Multiple snapshot builds");
        }
      } catch (error: unknown) {
        inspectionError = error;
      }
    },
  });
  if (inspectionError) throw inspectionError;
  if (entryNames.length === 0 || entryNames.some((name, index) => index > 0 && name < entryNames[index - 1]!)) {
    throw new Error("Archive entries are not ordered");
  }
  if (!seen.has("active.json") || !seen.has("snapshots") || !buildId || !seen.has(`snapshots/${buildId}`)) {
    throw new Error("Archive structure is incomplete");
  }
  const extractionRoot = await mkdtemp(join(tmpdir(), "stsdle-deployment-archive-validate-"));
  const dataDir = join(extractionRoot, "data");
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await rm(extractionRoot, { recursive: true, force: true });
  };
  try {
    await mkdir(dataDir);
    await tar.extract({
      cwd: dataDir,
      file: owned.path,
      preservePaths: false,
      strict: true,
      unlink: true,
    });
    await assertSafeExtractedTree(dataDir, entryNames);
    const loaded = await loadSafeActive(dataDir, options);
    if (loaded.active.buildId !== buildId || loaded.sourceRevision !== expectedRevision) {
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

async function inspectManifestRevision(archivePath: string): Promise<string> {
  let revision: string | undefined;
  await tar.list({
    file: archivePath,
    strict: true,
    onReadEntry: (entry) => {
      const name = entry.path.replace(/\/$/, "");
      if (/^snapshots\/[^/]+\/manifest\.json$/.test(name)) {
        const chunks: Buffer[] = [];
        entry.on("data", (chunk: Buffer) => chunks.push(chunk));
        entry.on("end", () => {
          const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (isRecord(value) && typeof value.sourceRevision === "string") revision = value.sourceRevision;
        });
      }
    },
  });
  if (!revision || !SOURCE_REVISION_PATTERN.test(revision)) throw new Error("Invalid revision");
  return revision;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
