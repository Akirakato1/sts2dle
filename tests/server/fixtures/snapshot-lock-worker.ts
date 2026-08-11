import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { SnapshotStore } from "../../../src/server/sync/snapshot-store.js";

const [dataDir, releaseSignal, createStaging] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!dataDir || !releaseSignal) throw new Error("missing worker input");
  const store = new SnapshotStore(dataDir);
  await store.withSyncLock(async () => {
    if (createStaging === "staging") {
      await mkdir(join(dataDir, "snapshots", "abcdef123456-1234567890123.staging"), {
        recursive: true,
      });
    }
    process.stdout.write("LOCK_ACQUIRED\n");
    while (!await signalExists(releaseSignal)) await delay(5);
  });
  process.stdout.write("LOCK_RELEASED\n");
}

async function signalExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
    ) return false;
    throw new Error("Unable to read snapshot lock worker signal");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`Snapshot lock worker failed: ${message}\n`);
  process.exitCode = 1;
});
