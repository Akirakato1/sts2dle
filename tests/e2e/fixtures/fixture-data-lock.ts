import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_DIRECTORY = ".stsdle-e2e-fixture.lock";
const OWNER_FILE = "owner.json";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_DELAY_MS = 50;

interface FixtureDataLockOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
}

interface LockOwner {
  token: string;
  processId: number;
  acquiredAt: string;
}

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
  const configuredDataPath = resolve(dataDir);
  await mkdir(configuredDataPath, { recursive: true });
  const dataPath = await realpath(configuredDataPath);
  const lockPath = join(dataPath, LOCK_DIRECTORY);
  if (!isWithin(lockPath, dataPath) || basename(lockPath) !== LOCK_DIRECTORY) {
    throw new Error("E2E fixture lock path escapes the configured data directory");
  }

  const token = randomUUID();
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) throw error;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for E2E fixture data lock`);
      }
      await delay(Math.min(retryDelayMs, timeoutMs - elapsed));
    }
  }

  const owner: LockOwner = {
    token,
    processId: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  try {
    await writeFile(join(lockPath, OWNER_FILE), `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error: unknown) {
    await rm(lockPath, { force: true, recursive: true });
    throw error;
  }

  try {
    return await action(dataPath);
  } finally {
    await releaseOwnedLock(dataPath, lockPath, token);
  }
}

async function releaseOwnedLock(dataPath: string, lockPath: string, token: string): Promise<void> {
  const owner = parseOwner(await readFile(join(lockPath, OWNER_FILE), "utf8"));
  if (owner.token !== token) {
    throw new Error("E2E fixture lock ownership changed before release");
  }

  const releasePath = join(dataPath, `.stsdle-e2e-fixture.release-${token}`);
  if (!isWithin(releasePath, dataPath)) {
    throw new Error("E2E fixture lock release path escapes the configured data directory");
  }
  await rename(lockPath, releasePath);
  await rm(releasePath, { force: true, recursive: true });
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
