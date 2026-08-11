import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { withE2eFixtureDataLock } from "./fixture-data-lock.js";

const [dataDir, releaseSignal] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!dataDir || !releaseSignal) throw new Error("missing worker input");
  await withE2eFixtureDataLock(dataDir, async () => {
    process.stdout.write("LOCK_ACQUIRED\n");
    while (!(await signalExists(releaseSignal))) await delay(5);
  });
  process.stdout.write("LOCK_RELEASED\n");
}

async function signalExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) return false;
    throw new Error("Unable to read E2E fixture lock worker signal");
  }
}

main().catch(() => {
  process.stderr.write("E2E fixture lock worker failed\n");
  process.exitCode = 1;
});
