import { readdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import {
  SnapshotValidationError,
  validateSnapshot,
  type SnapshotValidationOptions,
} from "../../../src/server/sync/validate-snapshot.js";

interface ActiveFixtureSnapshot {
  buildId: string;
  path: string;
}

const SNAPSHOT_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,11}-[0-9]+$/;

export async function pruneSupersededFixtureSnapshots(
  dataDir: string,
  active: ActiveFixtureSnapshot,
  validationOptions: SnapshotValidationOptions,
): Promise<void> {
  if (!SNAPSHOT_BUILD_ID.test(active.buildId)) {
    throw new Error("Active E2E snapshot has an invalid build ID");
  }

  const configuredDataPath = resolve(dataDir);
  const configuredSnapshotsPath = join(configuredDataPath, "snapshots");
  const [dataPath, snapshotsPath, activePath] = await Promise.all([
    realpath(configuredDataPath),
    realpath(configuredSnapshotsPath),
    realpath(active.path),
  ]);

  if (!isWithin(snapshotsPath, dataPath)) {
    throw new Error("Configured E2E snapshots directory escapes the data directory");
  }
  if (
    !isWithin(activePath, snapshotsPath)
    || basename(activePath) !== active.buildId
    || relative(activePath, join(snapshotsPath, active.buildId)) !== ""
  ) {
    throw new Error("Active snapshot escapes the configured E2E snapshots directory");
  }

  const entries = await readdir(snapshotsPath, { withFileTypes: true });
  const deletionPaths: string[] = [];

  for (const entry of entries) {
    if (entry.name === active.buildId || !SNAPSHOT_BUILD_ID.test(entry.name)) continue;
    const candidatePath = join(snapshotsPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("Superseded E2E snapshot path must not be a symbolic link");
    }
    if (!entry.isDirectory()) continue;

    const candidateRealPath = await realpath(candidatePath);
    if (!isWithin(candidateRealPath, snapshotsPath) || basename(candidateRealPath) !== entry.name) {
      throw new Error("Superseded snapshot escapes the configured E2E snapshots directory");
    }
    if (await isValidatedSnapshot(candidateRealPath, validationOptions)) {
      deletionPaths.push(candidateRealPath);
    }
  }

  await Promise.all(deletionPaths.map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
}

async function isValidatedSnapshot(
  snapshotPath: string,
  options: SnapshotValidationOptions,
): Promise<boolean> {
  try {
    await validateSnapshot(snapshotPath, options);
    return true;
  } catch (error: unknown) {
    if (error instanceof SnapshotValidationError) return false;
    throw error;
  }
}

function isWithin(candidate: string, parent: string): boolean {
  const pathToCandidate = relative(parent, candidate);
  return pathToCandidate !== ""
    && !isAbsolute(pathToCandidate)
    && !pathToCandidate.startsWith("..")
    && !pathToCandidate.includes(":");
}
