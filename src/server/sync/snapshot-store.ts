import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const SYNC_LOCK_DIRECTORY = ".stsdle-sync.lock";
const SYNC_LOCK_OWNER = "owner.json";
const SYNC_LOCK_RELEASE_PREFIX = ".stsdle-sync.release-";
const SYNC_LOCK_STALE_PREFIX = ".stsdle-sync.stale-";
const SNAPSHOT_LEASE_DIRECTORY = ".stsdle-snapshot-leases";
const SNAPSHOT_LEASE_RELEASE_PREFIX = ".release-";
const SNAPSHOT_LEASE_STALE_PREFIX = ".stale-";
const SYNC_LOCK_TIMEOUT_MS = 120_000;
const SYNC_LOCK_RETRY_MS = 50;
const SNAPSHOT_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,11}-[0-9]{13}$/;
const STAGING_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,11}-[0-9]{13}\.staging$/;
const SNAPSHOT_LEASE_FILE = /^([A-Za-z0-9][A-Za-z0-9_-]{0,11}-[0-9]{13})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

export interface SnapshotLockOperations {
  monotonicNow(): number;
  inspectQuarantine(dataPath: string): Promise<boolean>;
  acquireDirectory(path: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

export interface SnapshotStoreOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
  lockOperations?: Partial<SnapshotLockOperations>;
}

const DEFAULT_LOCK_OPERATIONS: SnapshotLockOperations = {
  monotonicNow: () => performance.now(),
  inspectQuarantine: hasQuarantinedRelease,
  acquireDirectory: async (path) => mkdir(path).then(() => undefined),
  wait: delay,
};

export interface ActiveSnapshot {
  buildId: string;
  path: string;
}

export interface StagingSnapshot {
  buildId: string;
  path: string;
  activate(): Promise<string>;
  abort(): Promise<void>;
}

export interface SnapshotLease {
  release(): Promise<void>;
}

interface SyncLockOwner {
  token: string;
  processId: number;
  acquiredAt: string;
}

interface SnapshotLeaseOwner extends SyncLockOwner {
  buildId: string;
}

export class SnapshotStore {
  private readonly dataPath: string;
  private readonly snapshotsPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  private readonly lockOperations: SnapshotLockOperations;

  constructor(dataDir: string, options: SnapshotStoreOptions = {}) {
    this.dataPath = resolve(dataDir);
    this.snapshotsPath = join(this.dataPath, "snapshots");
    this.lockTimeoutMs = positiveInteger(
      options.lockTimeoutMs,
      SYNC_LOCK_TIMEOUT_MS,
      "Snapshot sync lock timeout",
    );
    this.lockRetryDelayMs = positiveInteger(
      options.lockRetryDelayMs,
      SYNC_LOCK_RETRY_MS,
      "Snapshot sync lock retry delay",
    );
    this.lockOperations = { ...DEFAULT_LOCK_OPERATIONS, ...options.lockOperations };
  }

  async withSyncLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.dataPath, { recursive: true });
    const dataPath = await realpath(this.dataPath);
    const lockPath = join(dataPath, SYNC_LOCK_DIRECTORY);
    assertDirectChild(lockPath, dataPath, SYNC_LOCK_DIRECTORY, "Snapshot lock path");
    const token = randomUUID();
    const deadline = this.lockOperations.monotonicNow() + this.lockTimeoutMs;

    while (true) {
      if (this.lockOperations.monotonicNow() >= deadline) throw this.lockTimeoutError();
      if (await this.lockOperations.inspectQuarantine(dataPath)) {
        if (this.lockOperations.monotonicNow() >= deadline) {
          throw new Error("Snapshot sync lock release state is ambiguous");
        }
        await this.waitForLockRetry(deadline);
        continue;
      }
      if (this.lockOperations.monotonicNow() >= deadline) throw this.lockTimeoutError();
      try {
        await this.lockOperations.acquireDirectory(lockPath);
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw new Error("Unable to acquire snapshot sync lock");
        let owner: SyncLockOwner;
        try {
          owner = await readLockOwner(lockPath);
        } catch {
          if (this.lockOperations.monotonicNow() >= deadline) {
            throw new Error("Snapshot sync lock ownership is ambiguous");
          }
          await this.waitForLockRetry(deadline);
          continue;
        }
        const alive = processIsAlive(owner.processId);
        if (!alive) {
          await reclaimDeadLock(dataPath, lockPath, owner);
          continue;
        }
        if (this.lockOperations.monotonicNow() >= deadline) {
          throw this.lockTimeoutError();
        }
        await this.waitForLockRetry(deadline);
        continue;
      }

      const expiredAfterAcquisition = this.lockOperations.monotonicNow() >= deadline;
      const owner: SyncLockOwner = {
        token,
        processId: process.pid,
        acquiredAt: new Date().toISOString(),
      };
      try {
        await writeFile(join(lockPath, SYNC_LOCK_OWNER), `${JSON.stringify(owner)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
      } catch {
        await rm(lockPath, { force: true, recursive: true }).catch(() => undefined);
        throw new Error("Unable to initialize snapshot sync lock");
      }
      if (expiredAfterAcquisition || this.lockOperations.monotonicNow() >= deadline) {
        await releaseLock(dataPath, lockPath, token);
        throw this.lockTimeoutError();
      }
      let quarantinedReleaseExists: boolean;
      try {
        quarantinedReleaseExists = await this.lockOperations.inspectQuarantine(dataPath);
      } catch (error: unknown) {
        await releaseLock(dataPath, lockPath, token);
        throw error;
      }
      if (this.lockOperations.monotonicNow() >= deadline) {
        await releaseLock(dataPath, lockPath, token);
        throw this.lockTimeoutError();
      }
      if (quarantinedReleaseExists) {
        await releaseLock(dataPath, lockPath, token);
        if (this.lockOperations.monotonicNow() >= deadline) {
          throw new Error("Snapshot sync lock release state is ambiguous");
        }
        await this.waitForLockRetry(deadline);
        continue;
      }

      let result: T;
      try {
        result = await action();
      } catch (actionError: unknown) {
        try {
          await releaseLock(dataPath, lockPath, token);
        } catch (releaseError: unknown) {
          throw new AggregateError(
            [actionError, releaseError],
            "Snapshot sync failed and lock release also failed",
            { cause: actionError },
          );
        }
        throw actionError;
      }
      await releaseLock(dataPath, lockPath, token);
      return result;
    }
  }

  async cleanupAbandonedStaging(): Promise<void> {
    const snapshotsPath = await this.resolveContainedSnapshotsPath();
    const entries = await readdir(snapshotsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!STAGING_BUILD_ID.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const candidatePath = join(snapshotsPath, entry.name);
      const candidateRealPath = await realpath(candidatePath);
      if (!isExactDirectChild(candidateRealPath, snapshotsPath, entry.name)) continue;
      await rm(candidateRealPath, { recursive: true, force: true });
    }
  }

  async retainValidatedSnapshots(
    active: ActiveSnapshot,
    isValidated: (path: string) => Promise<boolean>,
  ): Promise<void> {
    if (!SNAPSHOT_BUILD_ID.test(active.buildId)) {
      throw new Error("Active snapshot has an invalid production build ID");
    }
    const snapshotsPath = await this.resolveContainedSnapshotsPath();
    const activePath = await realpath(active.path);
    if (!isExactDirectChild(activePath, snapshotsPath, active.buildId)) {
      throw new Error("Active snapshot escapes the configured snapshots directory");
    }
    const leasedBuildIds = await this.collectLeasedSnapshotBuildIds();
    const entries = await readdir(snapshotsPath, { withFileTypes: true });
    const validatedPrior: Array<{ path: string; modifiedAt: number; buildId: string }> = [];
    for (const entry of entries) {
      if (
        entry.name === active.buildId ||
        !SNAPSHOT_BUILD_ID.test(entry.name) ||
        entry.isSymbolicLink() ||
        !entry.isDirectory()
      ) continue;
      const candidatePath = join(snapshotsPath, entry.name);
      const candidateRealPath = await realpath(candidatePath);
      if (!isExactDirectChild(candidateRealPath, snapshotsPath, entry.name)) continue;
      if (!await isValidated(candidateRealPath)) continue;
      const metadata = await stat(candidateRealPath);
      validatedPrior.push({
        path: candidateRealPath,
        modifiedAt: metadata.mtimeMs,
        buildId: entry.name,
      });
    }
    validatedPrior.sort((left, right) => (
      right.modifiedAt - left.modifiedAt || right.buildId.localeCompare(left.buildId, "en-US")
    ));
    const newestPriorBuildId = validatedPrior[0]?.buildId;
    for (const obsolete of validatedPrior) {
      if (obsolete.buildId === newestPriorBuildId || leasedBuildIds.has(obsolete.buildId)) continue;
      await rm(obsolete.path, { recursive: true, force: true });
    }
  }

  async acquireSnapshotLease(active: ActiveSnapshot): Promise<SnapshotLease> {
    return this.withSyncLock(async () => {
      if (!SNAPSHOT_BUILD_ID.test(active.buildId)) {
        throw new Error("Snapshot lease has an invalid production build ID");
      }
      const snapshotsPath = await this.resolveContainedSnapshotsPath();
      const activePath = await realpath(active.path);
      if (!isExactDirectChild(activePath, snapshotsPath, active.buildId)) {
        throw new Error("Snapshot lease path escapes the configured snapshots directory");
      }
      const leasesPath = await this.resolveContainedLeasesPath();
      const token = randomUUID();
      const filename = `${active.buildId}.${token}.json`;
      const leasePath = join(leasesPath, filename);
      assertDirectChild(leasePath, leasesPath, filename, "Snapshot lease path");
      const owner: SnapshotLeaseOwner = {
        token,
        processId: process.pid,
        acquiredAt: new Date().toISOString(),
        buildId: active.buildId,
      };
      await writeFile(leasePath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
      let releasePromise: Promise<void> | undefined;
      return {
        release: async () => {
          releasePromise ??= releaseSnapshotLease(leasesPath, leasePath, token);
          await releasePromise;
        },
      };
    });
  }

  async createStaging(sourceRevision: string): Promise<StagingSnapshot> {
    const snapshotsPath = await this.resolveContainedSnapshotsPath();
    const revisionPrefix = sourceRevision.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "snapshot";
    let sequence = Date.now();
    let buildId: string;
    let stagingPath: string;
    while (true) {
      buildId = `${revisionPrefix}-${sequence}`;
      stagingPath = join(snapshotsPath, `${buildId}.staging`);
      try {
        await mkdir(stagingPath);
        break;
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw error;
        sequence += 1;
      }
    }

    let phase: "staging" | "renamed" | "settled" = "staging";
    const activatedPath = join(snapshotsPath, buildId);
    return {
      buildId,
      path: stagingPath,
      activate: async () => {
        if (phase === "settled") throw new Error("Staging snapshot has already been settled");
        if (phase === "staging") {
          await rename(stagingPath, activatedPath);
          phase = "renamed";
        }
        await this.writeActivePointer(buildId);
        phase = "settled";
        return activatedPath;
      },
      abort: async () => {
        if (phase === "settled") throw new Error("Staging snapshot has already been settled");
        await rm(phase === "staging" ? stagingPath : activatedPath, { recursive: true, force: true });
        phase = "settled";
      },
    };
  }

  async loadActive(): Promise<ActiveSnapshot | null> {
    const activePointerPath = join(this.dataPath, "active.json");
    let pointerBody: string;
    try {
      const pointer = await open(activePointerPath, "r");
      try {
        pointerBody = await pointer.readFile({ encoding: "utf8" });
      } finally {
        await pointer.close();
      }
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }

    const pointer = parsePointer(pointerBody);
    if (!isValidBuildId(pointer.buildId)) {
      throw new Error("Invalid active snapshot build ID");
    }
    const snapshotPath = join(this.snapshotsPath, pointer.buildId);
    const [snapshotsRealPath, snapshotRealPath] = await Promise.all([
      realpath(this.snapshotsPath),
      realpath(snapshotPath),
    ]);
    if (!isWithin(snapshotRealPath, snapshotsRealPath)) {
      throw new Error("Active snapshot pointer escapes snapshots directory");
    }
    const snapshotStats = await stat(snapshotRealPath);
    if (!snapshotStats.isDirectory()) {
      throw new Error("Active snapshot pointer does not reference a directory");
    }
    return { buildId: pointer.buildId, path: snapshotRealPath };
  }

  private async writeActivePointer(buildId: string): Promise<void> {
    await mkdir(this.dataPath, { recursive: true });
    const temporaryPath = join(this.dataPath, "active.json.tmp");
    const pointer = await open(temporaryPath, "w");
    try {
      await pointer.writeFile(JSON.stringify({ buildId }), "utf8");
      await pointer.sync();
    } finally {
      await pointer.close();
    }
    await rename(temporaryPath, join(this.dataPath, "active.json"));
  }

  private async resolveContainedSnapshotsPath(): Promise<string> {
    await mkdir(this.dataPath, { recursive: true });
    await mkdir(this.snapshotsPath, { recursive: true });
    const [dataPath, snapshotsPath] = await Promise.all([
      realpath(this.dataPath),
      realpath(this.snapshotsPath),
    ]);
    if (!isExactDirectChild(snapshotsPath, dataPath, "snapshots")) {
      throw new Error("Snapshots directory escapes the configured data directory");
    }
    return snapshotsPath;
  }

  private async resolveContainedLeasesPath(): Promise<string> {
    await mkdir(this.dataPath, { recursive: true });
    const dataPath = await realpath(this.dataPath);
    const configuredLeasesPath = join(dataPath, SNAPSHOT_LEASE_DIRECTORY);
    await mkdir(configuredLeasesPath, { recursive: true });
    const leasesPath = await realpath(configuredLeasesPath);
    if (!isExactDirectChild(leasesPath, dataPath, SNAPSHOT_LEASE_DIRECTORY)) {
      throw new Error("Snapshot lease directory escapes the configured data directory");
    }
    return leasesPath;
  }

  private async collectLeasedSnapshotBuildIds(): Promise<Set<string>> {
    const leasesPath = await this.resolveContainedLeasesPath();
    const leasedBuildIds = new Set<string>();
    const entries = await readdir(leasesPath, { withFileTypes: true });
    for (const entry of entries) {
      const scopedBuildId = entry.name.split(".", 1)[0];
      if (!scopedBuildId || !SNAPSHOT_BUILD_ID.test(scopedBuildId)) continue;
      const match = SNAPSHOT_LEASE_FILE.exec(entry.name);
      if (!match) {
        leasedBuildIds.add(scopedBuildId);
        continue;
      }
      const buildId = match[1]!;
      const token = match[2]!;
      if (entry.isSymbolicLink() || !entry.isFile()) {
        leasedBuildIds.add(buildId);
        continue;
      }
      const leasePath = join(leasesPath, entry.name);
      let leaseRealPath: string;
      try {
        leaseRealPath = await realpath(leasePath);
      } catch (error: unknown) {
        if (isNotFound(error)) continue;
        leasedBuildIds.add(buildId);
        continue;
      }
      if (!isExactDirectChild(leaseRealPath, leasesPath, entry.name)) {
        leasedBuildIds.add(buildId);
        continue;
      }
      let owner: SnapshotLeaseOwner;
      try {
        owner = await readSnapshotLeaseOwner(leaseRealPath);
      } catch {
        leasedBuildIds.add(buildId);
        continue;
      }
      if (owner.token !== token || owner.buildId !== buildId) {
        leasedBuildIds.add(buildId);
        continue;
      }
      let alive: boolean;
      try {
        alive = processIsAlive(owner.processId);
      } catch {
        leasedBuildIds.add(buildId);
        continue;
      }
      if (alive || await reclaimDeadSnapshotLease(leasesPath, leaseRealPath, owner)) {
        leasedBuildIds.add(buildId);
      }
    }
    return leasedBuildIds;
  }

  private async waitForLockRetry(deadline: number): Promise<void> {
    const remaining = deadline - this.lockOperations.monotonicNow();
    if (remaining <= 0) throw this.lockTimeoutError();
    await this.lockOperations.wait(Math.min(this.lockRetryDelayMs, remaining));
  }

  private lockTimeoutError(): Error {
    return new Error(`Timed out after ${this.lockTimeoutMs}ms waiting for snapshot sync lock`);
  }
}

async function hasQuarantinedRelease(dataPath: string): Promise<boolean> {
  const entries = await readdir(dataPath);
  return entries.some((entry) => (
    entry.startsWith(SYNC_LOCK_RELEASE_PREFIX) || entry.startsWith(SYNC_LOCK_STALE_PREFIX)
  ));
}

async function readLockOwner(lockPath: string): Promise<SyncLockOwner> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(lockPath, SYNC_LOCK_OWNER), "utf8")) as unknown;
  } catch {
    throw new Error("Snapshot sync lock ownership is ambiguous");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("token" in parsed) ||
    typeof parsed.token !== "string" ||
    !("processId" in parsed) ||
    typeof parsed.processId !== "number" ||
    !Number.isInteger(parsed.processId) ||
    parsed.processId <= 0 ||
    !("acquiredAt" in parsed) ||
    typeof parsed.acquiredAt !== "string"
  ) {
    throw new Error("Snapshot sync lock ownership is ambiguous");
  }
  return parsed as SyncLockOwner;
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error, "ESRCH")) return false;
    if (isNodeError(error, "EPERM")) return true;
    throw new Error("Unable to determine snapshot sync lock owner state");
  }
}

async function reclaimDeadLock(
  dataPath: string,
  lockPath: string,
  expectedOwner: SyncLockOwner,
): Promise<void> {
  const staleName = `${SYNC_LOCK_STALE_PREFIX}${randomUUID()}`;
  const stalePath = join(dataPath, staleName);
  assertDirectChild(stalePath, dataPath, staleName, "Stale snapshot lock path");
  try {
    await rename(lockPath, stalePath);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw new Error("Unable to quarantine abandoned snapshot sync lock");
  }
  const actualOwner = await readLockOwner(stalePath);
  if (actualOwner.token !== expectedOwner.token) {
    throw new Error("Snapshot sync lock ownership changed during recovery");
  }
  await rm(stalePath, { force: true, recursive: true });
}

async function releaseLock(dataPath: string, lockPath: string, token: string): Promise<void> {
  const releaseName = `${SYNC_LOCK_RELEASE_PREFIX}${randomUUID()}`;
  const releasePath = join(dataPath, releaseName);
  assertDirectChild(releasePath, dataPath, releaseName, "Snapshot lock release path");
  try {
    await rename(lockPath, releasePath);
  } catch {
    throw new Error("Unable to quarantine released snapshot sync lock");
  }
  const owner = await readLockOwner(releasePath);
  if (owner.token !== token) {
    throw new Error("Snapshot sync lock ownership changed before release");
  }
  await rm(releasePath, { force: true, recursive: true });
}

async function readSnapshotLeaseOwner(leasePath: string): Promise<SnapshotLeaseOwner> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(leasePath, "utf8")) as unknown;
  } catch {
    throw new Error("Snapshot lease ownership is ambiguous");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("token" in parsed) ||
    typeof parsed.token !== "string" ||
    !("processId" in parsed) ||
    typeof parsed.processId !== "number" ||
    !Number.isInteger(parsed.processId) ||
    parsed.processId <= 0 ||
    !("acquiredAt" in parsed) ||
    typeof parsed.acquiredAt !== "string" ||
    !("buildId" in parsed) ||
    typeof parsed.buildId !== "string"
  ) {
    throw new Error("Snapshot lease ownership is ambiguous");
  }
  return parsed as SnapshotLeaseOwner;
}

async function reclaimDeadSnapshotLease(
  leasesPath: string,
  leasePath: string,
  expectedOwner: SnapshotLeaseOwner,
): Promise<boolean> {
  const staleName = `${SNAPSHOT_LEASE_STALE_PREFIX}${randomUUID()}`;
  const stalePath = join(leasesPath, staleName);
  assertDirectChild(stalePath, leasesPath, staleName, "Stale snapshot lease path");
  try {
    await rename(leasePath, stalePath);
  } catch (error: unknown) {
    if (isNotFound(error)) return false;
    throw new Error("Unable to quarantine abandoned snapshot lease");
  }
  const actualOwner = await readSnapshotLeaseOwner(stalePath);
  if (
    actualOwner.token !== expectedOwner.token ||
    actualOwner.buildId !== expectedOwner.buildId ||
    actualOwner.processId !== expectedOwner.processId
  ) {
    throw new Error("Snapshot lease ownership changed during recovery");
  }
  if (processIsAlive(actualOwner.processId)) {
    try {
      await rename(stalePath, leasePath);
    } catch {
      throw new Error("Unable to restore a live snapshot lease after recovery race");
    }
    return true;
  }
  await rm(stalePath, { force: true });
  return false;
}

async function releaseSnapshotLease(
  leasesPath: string,
  leasePath: string,
  token: string,
): Promise<void> {
  const dataPath = resolve(leasesPath, "..");
  let currentDataPath: string;
  let currentLeasesPath: string;
  try {
    [currentDataPath, currentLeasesPath] = await Promise.all([
      realpath(dataPath),
      realpath(leasesPath),
    ]);
  } catch {
    throw new Error("Unable to resolve snapshot lease directory for release");
  }
  if (
    relative(dataPath, currentDataPath) !== "" ||
    !isExactDirectChild(currentLeasesPath, currentDataPath, SNAPSHOT_LEASE_DIRECTORY)
  ) {
    throw new Error("Snapshot lease directory escapes the configured data directory");
  }
  const leaseName = basename(leasePath);
  let currentLeasePath: string;
  try {
    currentLeasePath = await realpath(leasePath);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw new Error("Unable to resolve snapshot lease for release");
  }
  if (!isExactDirectChild(currentLeasePath, currentLeasesPath, leaseName)) {
    throw new Error("Snapshot lease path escapes the configured lease directory");
  }
  const releaseName = `${SNAPSHOT_LEASE_RELEASE_PREFIX}${randomUUID()}`;
  const releasePath = join(currentLeasesPath, releaseName);
  assertDirectChild(releasePath, currentLeasesPath, releaseName, "Snapshot lease release path");
  try {
    await rename(currentLeasePath, releasePath);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw new Error("Unable to quarantine released snapshot lease");
  }
  const owner = await readSnapshotLeaseOwner(releasePath);
  if (owner.token !== token) {
    throw new Error("Snapshot lease ownership changed before release");
  }
  await rm(releasePath, { force: true });
}

function assertDirectChild(candidate: string, parent: string, name: string, label: string): void {
  if (!isExactDirectChild(candidate, parent, name)) throw new Error(`${label} escapes the data directory`);
}

function isExactDirectChild(candidate: string, parent: string, name: string): boolean {
  return isWithin(candidate, parent) && basename(candidate) === name && relative(join(parent, name), candidate) === "";
}

function parsePointer(value: string): { buildId: string } {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("buildId" in parsed) ||
    typeof parsed.buildId !== "string" ||
    parsed.buildId.length === 0
  ) {
    throw new Error("Invalid active snapshot pointer");
  }
  return { buildId: parsed.buildId };
}

function isWithin(candidate: string, parent: string): boolean {
  const pathToCandidate = relative(parent, candidate);
  return (
    pathToCandidate !== "" &&
    !isAbsolute(pathToCandidate) &&
    !pathToCandidate.startsWith("..") &&
    !pathToCandidate.includes(":")
  );
}

function isValidBuildId(buildId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(buildId);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return isNodeError(error, "ENOENT");
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return isNodeError(error, "EEXIST");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return selected;
}
