import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_DIRECTORY = ".stsdle-e2e-fixture.lock";
const OWNER_FILE = "owner.json";
const RELEASE_PREFIX = ".stsdle-e2e-fixture.release-";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_DELAY_MS = 50;

export interface FixtureDataLockOperations {
  ensureDirectory(path: string): Promise<void>;
  resolvePath(path: string): Promise<string>;
  acquireDirectory(path: string): Promise<void>;
  writeOwner(path: string, value: string): Promise<void>;
  readOwner(path: string): Promise<string>;
  renamePath(from: string, to: string): Promise<void>;
  removeOwnedDirectory(path: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  monotonicNow(): number;
  createToken(): string;
}

interface FixtureDataLockOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
  operations?: Partial<FixtureDataLockOperations>;
}

interface LockOwner {
  token: string;
  processId: number;
  acquiredAt: string;
}

const defaultOperations: FixtureDataLockOperations = {
  ensureDirectory: async (path) => mkdir(path, { recursive: true }).then(() => undefined),
  resolvePath: realpath,
  acquireDirectory: async (path) => mkdir(path).then(() => undefined),
  writeOwner: async (path, value) => writeFile(path, value, { encoding: "utf8", flag: "wx" }),
  readOwner: async (path) => readFile(path, "utf8"),
  renamePath: rename,
  removeOwnedDirectory: async (path) => rm(path, { force: true, recursive: true }),
  wait: delay,
  monotonicNow: () => performance.now(),
  createToken: randomUUID,
};

export async function withE2eFixtureDataLock<T>(
  dataDir: string,
  action: (resolvedDataDir: string) => Promise<T>,
  options: FixtureDataLockOptions = {},
): Promise<T> {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "lock timeout");
  const retryDelayMs = positiveInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    "lock retry delay",
  );
  const operations = { ...defaultOperations, ...options.operations };
  const configuredDataPath = resolve(dataDir);
  await lockedOperation(
    () => operations.ensureDirectory(configuredDataPath),
    "Unable to prepare E2E fixture lock directory",
  );
  const dataPath = await lockedOperation(
    () => operations.resolvePath(configuredDataPath),
    "Unable to resolve E2E fixture lock directory",
  );
  const lockPath = join(dataPath, LOCK_DIRECTORY);
  assertContainedLockPath(lockPath, dataPath);

  const token = lockedValue(
    () => operations.createToken(),
    "Unable to create E2E fixture lock owner",
  );
  const deadline = monotonicNow(operations) + timeoutMs;

  while (true) {
    if (monotonicNow(operations) >= deadline) throw timeoutError(timeoutMs);
    try {
      await operations.acquireDirectory(lockPath);
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) {
        throw new Error("Unable to acquire E2E fixture data lock");
      }
      const remaining = deadline - monotonicNow(operations);
      if (remaining <= 0) throw timeoutError(timeoutMs);
      await lockedOperation(
        () => operations.wait(Math.min(retryDelayMs, remaining)),
        "Unable to wait for E2E fixture data lock",
      );
      continue;
    }

    const expiredAfterAcquisition = monotonicNow(operations) >= deadline;
    const owner: LockOwner = {
      token,
      processId: process.pid,
      acquiredAt: new Date().toISOString(),
    };
    await lockedOperation(
      () => operations.writeOwner(join(lockPath, OWNER_FILE), `${JSON.stringify(owner)}\n`),
      "Unable to initialize E2E fixture data lock",
    );

    if (expiredAfterAcquisition) {
      await releaseOwnedLock(dataPath, lockPath, token, operations);
      throw timeoutError(timeoutMs);
    }

    try {
      return await action(dataPath);
    } finally {
      await releaseOwnedLock(dataPath, lockPath, token, operations);
    }
  }
}

async function releaseOwnedLock(
  dataPath: string,
  lockPath: string,
  token: string,
  operations: FixtureDataLockOperations,
): Promise<void> {
  const quarantineToken = lockedValue(
    () => operations.createToken(),
    "Unable to create E2E fixture lock release identity",
  );
  const releasePath = join(dataPath, `${RELEASE_PREFIX}${quarantineToken}`);
  if (!isWithin(releasePath, dataPath) || basename(releasePath) !== `${RELEASE_PREFIX}${quarantineToken}`) {
    throw new Error("E2E fixture lock release path escapes the configured data directory");
  }

  await lockedOperation(
    () => operations.renamePath(lockPath, releasePath),
    "Unable to quarantine E2E fixture data lock",
  );

  let owner: LockOwner;
  try {
    const value = await operations.readOwner(join(releasePath, OWNER_FILE));
    owner = parseOwner(value);
  } catch {
    await restoreUnverifiedLock(releasePath, lockPath, operations);
    throw new Error("Unable to verify E2E fixture lock ownership");
  }

  if (owner.token !== token) {
    await restoreUnverifiedLock(releasePath, lockPath, operations);
    throw new Error("E2E fixture lock ownership changed before release");
  }

  await lockedOperation(
    () => operations.removeOwnedDirectory(releasePath),
    "Unable to remove released E2E fixture data lock",
  );
}

async function restoreUnverifiedLock(
  releasePath: string,
  lockPath: string,
  operations: FixtureDataLockOperations,
): Promise<void> {
  try {
    await operations.renamePath(releasePath, lockPath);
  } catch (error: unknown) {
    if (isAlreadyExists(error)) return;
    throw new Error("Unable to preserve unverified E2E fixture data lock");
  }
}

function parseOwner(value: string): LockOwner {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("E2E fixture lock ownership metadata is invalid");
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || !("token" in parsed)
    || typeof parsed.token !== "string"
    || !("processId" in parsed)
    || typeof parsed.processId !== "number"
    || !Number.isInteger(parsed.processId)
    || !("acquiredAt" in parsed)
    || typeof parsed.acquiredAt !== "string"
  ) {
    throw new Error("E2E fixture lock ownership metadata is invalid");
  }
  return parsed as LockOwner;
}

async function lockedOperation<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(message);
  }
}

function lockedValue<T>(operation: () => T, message: string): T {
  try {
    return operation();
  } catch {
    throw new Error(message);
  }
}

function monotonicNow(operations: FixtureDataLockOperations): number {
  const value = lockedValue(
    () => operations.monotonicNow(),
    "Unable to read E2E fixture lock deadline",
  );
  if (!Number.isFinite(value)) throw new Error("Unable to read E2E fixture lock deadline");
  return value;
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`Timed out after ${timeoutMs}ms waiting for E2E fixture data lock`);
}

function assertContainedLockPath(lockPath: string, dataPath: string): void {
  if (!isWithin(lockPath, dataPath) || basename(lockPath) !== LOCK_DIRECTORY) {
    throw new Error("E2E fixture lock path escapes the configured data directory");
  }
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function isWithin(candidate: string, parent: string): boolean {
  const pathToCandidate = relative(parent, candidate);
  return pathToCandidate !== ""
    && !isAbsolute(pathToCandidate)
    && !pathToCandidate.startsWith("..")
    && !pathToCandidate.includes(":");
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
