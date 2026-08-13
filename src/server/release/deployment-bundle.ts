import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { SOURCE_REVISION_PATTERN } from "../../shared/snapshot-schema.js";
import { SnapshotStore, type ActiveSnapshot } from "../sync/snapshot-store.js";
import {
  loadActivatedSnapshot,
  type SnapshotValidationOptions,
} from "../sync/validate-snapshot.js";

const PUBLISH_TIMEOUT_MS = 5_000;
const PUBLISH_RETRY_DELAY_MS = 50;
const MAX_RENAME_ATTEMPTS = Math.ceil(PUBLISH_TIMEOUT_MS / PUBLISH_RETRY_DELAY_MS) + 1;

export interface PublishOperations {
  beforeMutation?: () => Promise<void>;
  monotonicNow?: () => number;
  removeDirectory?: (path: string) => Promise<void>;
  renameDirectory?: (from: string, to: string) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  validatePublishedBundle?: (
    dataDir: string,
    options: SnapshotValidationOptions,
  ) => Promise<unknown>;
}

export interface PublishedBundle {
  active: ActiveSnapshot;
  finalize(): Promise<void>;
  rollback(): Promise<void>;
}

interface ResolvedPublishOperations {
  beforeMutation(): Promise<void>;
  monotonicNow(): number;
  removeDirectory(path: string): Promise<void>;
  renameDirectory(from: string, to: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  validatePublishedBundle(
    dataDir: string,
    options: SnapshotValidationOptions,
  ): Promise<unknown>;
}

interface DirectoryIdentity {
  dev: string;
  ino: string;
  birthtimeMs: string;
}

interface OwnedDirectory {
  path: string;
  parent: OwnedParent;
  name: string;
  identity: DirectoryIdentity;
}

interface OwnedPathIdentity extends DirectoryIdentity {
  path: string;
}

interface OwnedParent {
  path: string;
  ancestry: readonly OwnedPathIdentity[];
}

interface DirectChildTarget {
  path: string;
  parent: OwnedParent;
  name: string;
}

interface RollbackState {
  published: OwnedDirectory | null;
  backup: OwnedDirectory | null;
  quarantine: OwnedDirectory | null;
  quarantineTarget: DirectChildTarget;
  destinationTarget: DirectChildTarget;
}

class DeploymentBundleError extends Error {}

const DEFAULT_PUBLISH_OPERATIONS: ResolvedPublishOperations = {
  beforeMutation: async () => undefined,
  monotonicNow: () => performance.now(),
  removeDirectory: async (path) => rm(path, { recursive: true, force: false, maxRetries: 0 }),
  renameDirectory: rename,
  wait: delay,
  validatePublishedBundle: async () => undefined,
};

export async function readDeploymentRevision(dataDir: string): Promise<string | null> {
  try {
    const active = await loadSafeActiveSnapshot(dataDir);
    if (!active) return null;
    const manifestValue: unknown = JSON.parse(await readFile(join(active.path, "manifest.json"), "utf8"));
    if (!isRecord(manifestValue) ||
      typeof manifestValue.sourceRevision !== "string" ||
      !SOURCE_REVISION_PATTERN.test(manifestValue.sourceRevision)) {
      throw new Error("Deployment manifest has an invalid source revision");
    }
    return manifestValue.sourceRevision;
  } catch (error: unknown) {
    throw fixedError("Unable to read deployment revision", error);
  }
}

export async function stageDeploymentBundle(
  sourceDataDir: string,
  stagingDir: string,
  options: SnapshotValidationOptions,
  operations: Pick<PublishOperations, "beforeMutation"> = {},
): Promise<ActiveSnapshot> {
  let sourceActive: ActiveSnapshot | null;
  try {
    sourceActive = await loadSafeActiveSnapshot(sourceDataDir);
  } catch (error: unknown) {
    throw fixedError("Unable to stage deployment bundle", error);
  }
  if (!sourceActive) throw new Error("Source snapshot is unavailable");

  let ownedStaging: OwnedDirectory | undefined;
  try {
    await assertTreeContainsNoLinks(sourceActive.path);
    await loadActivatedSnapshot(sourceActive.path, options);

    const stagingTarget = await resolveNewDirectChild(stagingDir);
    const beforeMutation = operations.beforeMutation ?? DEFAULT_PUBLISH_OPERATIONS.beforeMutation;
    ownedStaging = await createOwnedDirectory(stagingTarget, beforeMutation);
    const snapshotsTarget = createSiblingTarget(asOwnedParent(ownedStaging), "snapshots");
    const resolvedSnapshots = await createOwnedDirectory(snapshotsTarget);
    const stagedSnapshotPath = join(resolvedSnapshots.path, sourceActive.buildId);
    assertExactDirectChild(stagedSnapshotPath, resolvedSnapshots.path, sourceActive.buildId);
    await revalidateOwnedDirectory(resolvedSnapshots);
    await cp(sourceActive.path, stagedSnapshotPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
      verbatimSymlinks: true,
    });
    await assertTreeContainsNoLinks(stagedSnapshotPath);
    await revalidateOwnedDirectory(ownedStaging);
    await writeFile(
      join(ownedStaging.path, "active.json"),
      `${JSON.stringify({ buildId: sourceActive.buildId })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const stagedActive = await loadValidatedDeploymentBundle(ownedStaging.path, options);
    if (stagedActive.buildId !== sourceActive.buildId) {
      throw new Error("Staged deployment build identity changed");
    }
    return stagedActive;
  } catch (error: unknown) {
    if (ownedStaging) {
      try {
        await removeOwnedDirectory(ownedStaging, DEFAULT_PUBLISH_OPERATIONS);
      } catch (cleanupError: unknown) {
        throw fixedError(
          "Unable to stage deployment bundle",
          new AggregateError([error, cleanupError], "Deployment staging cleanup failed", { cause: error }),
        );
      }
    }
    throw fixedError("Unable to stage deployment bundle", error);
  }
}

export async function beginDeploymentBundlePublish(
  stagingDir: string,
  destinationDir: string,
  options: SnapshotValidationOptions,
  operations: PublishOperations = {},
): Promise<PublishedBundle> {
  const publishOperations: ResolvedPublishOperations = {
    ...DEFAULT_PUBLISH_OPERATIONS,
    ...withoutUndefined(operations),
  };
  try {
    return await publishDeploymentBundle(
      stagingDir,
      destinationDir,
      options,
      publishOperations,
    );
  } catch (error: unknown) {
    if (error instanceof DeploymentBundleError) throw error;
    throw fixedError("Unable to publish deployment bundle", error);
  }
}

async function publishDeploymentBundle(
  stagingDir: string,
  destinationDir: string,
  options: SnapshotValidationOptions,
  operations: ResolvedPublishOperations,
): Promise<PublishedBundle> {
  const destinationTarget = await resolveConfiguredDirectChild(destinationDir);
  const stagingTarget = await resolveConfiguredDirectChild(stagingDir);
  if (!samePath(destinationTarget.parent.path, stagingTarget.parent.path)) {
    throw new Error("Deployment staging and destination directories must be siblings");
  }
  const staging = await resolveOwnedDirectory(
    stagingTarget.path,
    stagingTarget.parent,
    stagingTarget.name,
  );
  await assertTreeContainsNoLinks(staging.path);
  const stagedActive = await loadValidatedDeploymentBundle(staging.path, options);
  const destination = await resolveOptionalOwnedDirectory(
    destinationTarget.path,
    destinationTarget.parent,
    destinationTarget.name,
  );
  const transactionId = randomUUID();
  const backupTarget = createSiblingTarget(
    destinationTarget.parent,
    `.${destinationTarget.name}.backup-${transactionId}`,
  );
  const quarantineTarget = createSiblingTarget(
    destinationTarget.parent,
    `.${destinationTarget.name}.quarantine-${transactionId}`,
  );
  await Promise.all([assertPathMissing(backupTarget.path), assertPathMissing(quarantineTarget.path)]);

  let backup: OwnedDirectory | null = null;
  const publicationDeadline = createDeadline(operations);
  if (destination) {
    backup = await renameOwnedDirectory(
      destination,
      backupTarget,
      operations,
      publicationDeadline,
      "Unable to publish deployment bundle",
    );
  }

  let publishedDirectory: OwnedDirectory;
  try {
    publishedDirectory = await renameOwnedDirectory(
      staging,
      destinationTarget,
      operations,
      publicationDeadline,
      "Unable to publish deployment bundle",
    );
  } catch (publishError: unknown) {
    if (backup) {
      try {
        await renameOwnedDirectory(
          backup,
          destinationTarget,
          operations,
          createDeadline(operations),
          "Unable to restore previous deployment bundle",
        );
      } catch (restoreError: unknown) {
        throw fixedError(
          "Unable to restore previous deployment bundle",
          new AggregateError([publishError, restoreError], "Deployment publication and recovery failed", {
            cause: publishError,
          }),
        );
      }
    }
    throw publishError;
  }

  let active: ActiveSnapshot;
  try {
    active = await loadValidatedDeploymentBundle(destinationTarget.path, options);
    await operations.validatePublishedBundle(destinationTarget.path, options);
    active = await loadValidatedDeploymentBundle(destinationTarget.path, options);
    await assertPublishedActive(active, publishedDirectory, stagedActive.buildId);
  } catch (validationError: unknown) {
    const recoveryState = createRollbackState(
      publishedDirectory,
      backup,
      quarantineTarget,
      destinationTarget,
    );
    try {
      await resumeRollback(recoveryState, operations);
    } catch (restoreError: unknown) {
      throw fixedError(
        "Unable to restore previous deployment bundle",
        new AggregateError([validationError, restoreError], "Published validation and recovery failed", {
          cause: validationError,
        }),
      );
    }
    throw fixedError("Published deployment bundle failed validation", validationError);
  }

  return createPublishedBundleTransaction(
    active,
    createRollbackState(
      publishedDirectory,
      backup,
      quarantineTarget,
      destinationTarget,
    ),
    operations,
  );
}

function createPublishedBundleTransaction(
  active: ActiveSnapshot,
  rollbackState: RollbackState,
  operations: ResolvedPublishOperations,
): PublishedBundle {
  let lifecycle: "active" | "finalized" | "rolled-back" = "active";
  let settlementDirection: "finalize" | "rollback" | undefined;
  let settlement: Promise<void> | undefined;
  const settle = (action: "finalize" | "rollback"): Promise<void> => {
    if (lifecycle !== "active") return Promise.resolve();
    settlementDirection ??= action;
    if (settlementDirection !== action) {
      return Promise.reject(fixedError("Deployment bundle settlement action is locked", undefined));
    }
    if (settlement) return settlement;
    settlement = (async () => {
      if (action === "finalize") {
        if (rollbackState.backup) {
          await removeOwnedDirectory(rollbackState.backup, operations);
          rollbackState.backup = null;
        }
        lifecycle = "finalized";
        return;
      }
      await resumeRollback(rollbackState, operations);
      lifecycle = "rolled-back";
    })().catch((error: unknown) => {
      throw fixedError(
        action === "finalize"
          ? "Unable to finalize deployment bundle"
          : "Unable to roll back deployment bundle",
        error,
      );
    }).finally(() => {
      settlement = undefined;
    });
    return settlement;
  };
  return {
    active,
    finalize: () => settle("finalize"),
    rollback: () => settle("rollback"),
  };
}

function createRollbackState(
  publishedDirectory: OwnedDirectory,
  backup: OwnedDirectory | null,
  quarantineTarget: DirectChildTarget,
  destinationTarget: DirectChildTarget,
): RollbackState {
  return {
    published: publishedDirectory,
    backup,
    quarantine: null,
    quarantineTarget,
    destinationTarget,
  };
}

async function resumeRollback(
  state: RollbackState,
  operations: ResolvedPublishOperations,
): Promise<void> {
  const deadline = createDeadline(operations);
  if (state.published) {
    if (!state.quarantine) await assertPathMissing(state.quarantineTarget.path);
    state.quarantine = await renameOwnedDirectory(
      state.published,
      state.quarantineTarget,
      operations,
      deadline,
      "Unable to restore previous deployment bundle",
    );
    state.published = null;
  }
  if (state.backup) {
    await renameOwnedDirectory(
      state.backup,
      state.destinationTarget,
      operations,
      deadline,
      "Unable to restore previous deployment bundle",
    );
    state.backup = null;
  }
  if (state.quarantine) {
    await removeOwnedDirectory(state.quarantine, operations);
    state.quarantine = null;
  }
}

async function loadValidatedDeploymentBundle(
  dataDir: string,
  options: SnapshotValidationOptions,
): Promise<ActiveSnapshot> {
  const active = await loadSafeActiveSnapshot(dataDir);
  if (!active) throw new Error("Deployment bundle is unavailable");
  await assertTreeContainsNoLinks(active.path);
  await loadActivatedSnapshot(active.path, options);
  return active;
}

async function loadSafeActiveSnapshot(dataDir: string): Promise<ActiveSnapshot | null> {
  const configuredRoot = resolve(dataDir);
  const root = await resolveOptionalRootDirectory(configuredRoot);
  if (!root) return null;
  const store = new SnapshotStore(root.path);
  const active = await store.loadActive();
  if (!active) return null;
  const snapshots = await resolveOwnedDirectory(
    join(root.path, "snapshots"),
    asOwnedParent(root),
    "snapshots",
  );
  const pointer = await readStrictActivePointer(root.path);
  if (pointer.buildId !== active.buildId) throw new Error("Active snapshot pointer changed while loading");
  const resolvedActive = await resolveOwnedDirectory(
    join(snapshots.path, active.buildId),
    asOwnedParent(snapshots),
    active.buildId,
  );
  if (!samePath(resolvedActive.path, active.path)) {
    throw new Error("Active snapshot escapes the configured snapshots directory");
  }
  return { buildId: active.buildId, path: resolvedActive.path };
}

async function readStrictActivePointer(dataDir: string): Promise<{ buildId: string }> {
  const value: unknown = JSON.parse(await readFile(join(dataDir, "active.json"), "utf8"));
  if (!isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.buildId !== "string" ||
    value.buildId.length === 0) {
    throw new Error("Invalid active snapshot pointer");
  }
  return { buildId: value.buildId };
}

async function assertPublishedActive(
  active: ActiveSnapshot,
  publishedDirectory: OwnedDirectory,
  expectedBuildId: string,
): Promise<void> {
  if (active.buildId !== expectedBuildId) throw new Error("Published deployment build identity changed");
  const snapshots = await resolveOwnedDirectory(
    join(publishedDirectory.path, "snapshots"),
    asOwnedParent(publishedDirectory),
    "snapshots",
  );
  const expectedActive = await resolveOwnedDirectory(
    join(snapshots.path, expectedBuildId),
    asOwnedParent(snapshots),
    expectedBuildId,
  );
  if (!samePath(expectedActive.path, active.path)) {
    throw new Error("Published active snapshot escapes the deployment bundle");
  }
}

async function resolveOptionalRootDirectory(path: string): Promise<OwnedDirectory | null> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Deployment data directory is unsafe");
  }
  const resolvedPath = await realpath(path);
  if (!samePath(resolvedPath, path)) throw new Error("Deployment data directory is unsafe");
  const parent = await resolveOwnedParent(dirname(resolvedPath));
  return {
    path: resolvedPath,
    parent,
    name: basename(resolvedPath),
    identity: identityOf(metadata),
  };
}

async function resolveConfiguredDirectChild(path: string): Promise<DirectChildTarget> {
  const configuredPath = resolve(path);
  const configuredParent = dirname(configuredPath);
  const parent = await resolveOwnedParent(configuredParent);
  const name = basename(configuredPath);
  const resolvedPath = join(parent.path, name);
  assertExactDirectChild(resolvedPath, parent.path, name);
  return { path: resolvedPath, parent, name };
}

async function resolveNewDirectChild(path: string): Promise<DirectChildTarget> {
  const target = await resolveConfiguredDirectChild(path);
  await revalidateOwnedParent(target.parent);
  await assertPathMissing(target.path);
  return target;
}

async function resolveOptionalOwnedDirectory(
  path: string,
  parent: OwnedParent,
  name: string,
): Promise<OwnedDirectory | null> {
  try {
    return await resolveOwnedDirectory(path, parent, name);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

async function resolveOwnedDirectory(
  path: string,
  parent: OwnedParent,
  name: string,
): Promise<OwnedDirectory> {
  assertExactDirectChild(path, parent.path, name);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Deployment directory is unsafe");
  }
  const resolvedPath = await realpath(path);
  if (!isExactDirectChild(resolvedPath, parent.path, name)) {
    throw new Error("Deployment directory escapes its configured parent");
  }
  return { path: resolvedPath, parent, name, identity: identityOf(metadata) };
}

async function revalidateOwnedDirectory(directory: OwnedDirectory): Promise<void> {
  await revalidateOwnedParent(directory.parent);
  const current = await resolveOwnedDirectory(directory.path, directory.parent, directory.name);
  if (!sameIdentity(current.identity, directory.identity)) {
    throw new Error("Deployment directory ownership changed");
  }
}

async function resolveOwnedParent(path: string): Promise<OwnedParent> {
  const configuredPath = resolve(path);
  const ancestry: OwnedPathIdentity[] = [];
  let currentPath = configuredPath;
  while (true) {
    const metadata = await lstat(currentPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Deployment parent directory is unsafe");
    }
    const resolvedPath = await realpath(currentPath);
    if (!samePath(resolvedPath, currentPath)) {
      throw new Error("Deployment parent directory is unsafe");
    }
    ancestry.push({ path: resolvedPath, ...identityOf(metadata) });
    const nextPath = dirname(currentPath);
    if (samePath(nextPath, currentPath)) break;
    currentPath = nextPath;
  }
  return { path: configuredPath, ancestry };
}

async function revalidateOwnedParent(parent: OwnedParent): Promise<void> {
  for (const expected of parent.ancestry) {
    const metadata = await lstat(expected.path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Deployment parent ownership changed");
    }
    const resolvedPath = await realpath(expected.path);
    if (!samePath(resolvedPath, expected.path) || !sameIdentity(identityOf(metadata), expected)) {
      throw new Error("Deployment parent ownership changed");
    }
  }
}

function asOwnedParent(directory: OwnedDirectory): OwnedParent {
  return {
    path: directory.path,
    ancestry: [
      { path: directory.path, ...directory.identity },
      ...directory.parent.ancestry,
    ],
  };
}

async function createOwnedDirectory(
  target: DirectChildTarget,
  beforeMutation: () => Promise<void> = DEFAULT_PUBLISH_OPERATIONS.beforeMutation,
): Promise<OwnedDirectory> {
  await beforeMutation();
  await revalidateOwnedParent(target.parent);
  await assertPathMissing(target.path);
  await mkdir(target.path);
  return resolveOwnedDirectory(target.path, target.parent, target.name);
}

async function renameOwnedDirectory(
  source: OwnedDirectory,
  target: DirectChildTarget,
  operations: ResolvedPublishOperations,
  deadline: number,
  publicMessage: string,
): Promise<OwnedDirectory> {
  let attempts = 0;
  let lastError: unknown;
  while (attempts < MAX_RENAME_ATTEMPTS) {
    if (operations.monotonicNow() >= deadline) throw fixedError(publicMessage, lastError);
    try {
      await operations.beforeMutation();
      await revalidateOwnedDirectory(source);
      await revalidateOwnedParent(target.parent);
      await assertPathMissing(target.path);
    } catch (error: unknown) {
      throw fixedError(publicMessage, error);
    }
    attempts += 1;
    let operationError: unknown;
    try {
      await operations.renameDirectory(source.path, target.path);
    } catch (error: unknown) {
      operationError = error;
    }
    let renameState: { moved: true; directory: OwnedDirectory } | { moved: false };
    try {
      renameState = await inspectRenameState(source, target);
    } catch (error: unknown) {
      throw fixedError(publicMessage, error);
    }
    if (renameState.moved) return renameState.directory;
    lastError = operationError;
    if (!isTransientRenameError(operationError)) throw fixedError(publicMessage, operationError);
    const remaining = deadline - operations.monotonicNow();
    if (remaining <= 0 || attempts >= MAX_RENAME_ATTEMPTS) {
      throw fixedError(publicMessage, operationError);
    }
    try {
      await operations.wait(Math.min(PUBLISH_RETRY_DELAY_MS, remaining));
    } catch (waitError: unknown) {
      throw fixedError(publicMessage, waitError);
    }
  }
  throw fixedError(publicMessage, lastError);
}

async function inspectRenameState(
  source: OwnedDirectory,
  target: DirectChildTarget,
): Promise<{ moved: true; directory: OwnedDirectory } | { moved: false }> {
  const moved = await resolveOptionalOwnedDirectory(target.path, target.parent, target.name);
  if (moved) {
    if (!sameIdentity(moved.identity, source.identity)) {
      throw new Error("Deployment directory ownership changed during rename");
    }
    return { moved: true, directory: moved };
  }
  try {
    await revalidateOwnedDirectory(source);
    return { moved: false };
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      throw new Error("Deployment directory move state is ambiguous");
    }
    throw error;
  }
}

async function removeOwnedDirectory(
  directory: OwnedDirectory,
  operations: ResolvedPublishOperations,
): Promise<void> {
  await operations.beforeMutation();
  await revalidateOwnedDirectory(directory);
  try {
    await operations.removeDirectory(directory.path);
  } catch (error: unknown) {
    try {
      await lstat(directory.path);
    } catch (inspectionError: unknown) {
      if (isNodeError(inspectionError, "ENOENT")) return;
      throw inspectionError;
    }
    await revalidateOwnedDirectory(directory);
    throw error;
  }
}

async function assertTreeContainsNoLinks(root: string): Promise<void> {
  const rootPath = await realpath(root);
  await inspectDirectory(rootPath, rootPath);
}

async function inspectDirectory(root: string, directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = join(directory, entry.name);
    const metadata = await lstat(childPath);
    if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
      throw new Error("Deployment bundle contains a symbolic link");
    }
    if (metadata.isDirectory()) {
      const childRealPath = await realpath(childPath);
      if (!isWithinOrEqual(childRealPath, root)) {
        throw new Error("Deployment bundle directory escapes its root");
      }
      await inspectDirectory(root, childRealPath);
    } else if (!metadata.isFile()) {
      throw new Error("Deployment bundle contains an unsupported filesystem entry");
    }
  }
}

function createSiblingTarget(parent: OwnedParent, name: string): DirectChildTarget {
  const path = join(parent.path, name);
  assertExactDirectChild(path, parent.path, name);
  return { path, parent, name };
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  throw new Error("Deployment transaction path already exists");
}

function assertExactDirectChild(candidate: string, parent: string, name: string): void {
  if (!isExactDirectChild(candidate, parent, name)) {
    throw new Error("Deployment path escapes its configured parent");
  }
}

function isExactDirectChild(candidate: string, parent: string, name: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === name && basename(candidate) === name &&
    !isAbsolute(pathFromParent) && !pathFromParent.includes(":");
}

function isWithinOrEqual(candidate: string, parent: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (
    !isAbsolute(pathFromParent) &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !pathFromParent.includes(":")
  );
}

function identityOf(metadata: Awaited<ReturnType<typeof lstat>>): DirectoryIdentity {
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    birthtimeMs: metadata.birthtimeMs.toString(),
  };
}

function sameIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function createDeadline(operations: ResolvedPublishOperations): number {
  const startedAt = operations.monotonicNow();
  if (!Number.isFinite(startedAt)) throw new Error("Deployment monotonic clock is invalid");
  return startedAt + PUBLISH_TIMEOUT_MS;
}

function fixedError(message: string, cause: unknown): DeploymentBundleError {
  void cause;
  return new DeploymentBundleError(message);
}

function isTransientRenameError(error: unknown): boolean {
  return isNodeError(error, "EPERM") || isNodeError(error, "EBUSY");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutUndefined(operations: PublishOperations): PublishOperations {
  return Object.fromEntries(
    Object.entries(operations).filter(([, value]) => value !== undefined),
  ) as PublishOperations;
}
