import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

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

export class SnapshotStore {
  private readonly dataPath: string;
  private readonly snapshotsPath: string;

  constructor(dataDir: string) {
    this.dataPath = resolve(dataDir);
    this.snapshotsPath = join(this.dataPath, "snapshots");
  }

  async createStaging(sourceRevision: string): Promise<StagingSnapshot> {
    await mkdir(this.snapshotsPath, { recursive: true });
    const revisionPrefix = sourceRevision.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "snapshot";
    const buildId = `${revisionPrefix}-${Date.now()}`;
    const stagingPath = join(this.snapshotsPath, `${buildId}.staging`);
    await mkdir(stagingPath);

    let phase: "staging" | "renamed" | "settled" = "staging";
    const activatedPath = join(this.snapshotsPath, buildId);
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
  return pathToCandidate !== "" && !pathToCandidate.startsWith("..") && !pathToCandidate.includes(":");
}

function isValidBuildId(buildId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(buildId);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
