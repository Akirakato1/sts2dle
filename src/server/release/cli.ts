import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createReleaseSnapshotDependencies,
  releaseSnapshot,
  SnapshotPushError,
  type ReleaseSnapshotDependencies,
  type ReleaseSnapshotOptions,
} from "./release-snapshot.js";

interface ReleaseCliDependencies {
  repositoryRoot: string;
  createDependencies(repositoryRoot: string): ReleaseSnapshotDependencies;
  release: typeof releaseSnapshot;
  writeOutput(line: string): void;
  writeError(line: string): void;
}

export function parseReleaseOptions(args: readonly string[]): ReleaseSnapshotOptions {
  if (args.length === 0) return { force: false };
  if (args.length === 1 && args[0] === "--force") return { force: true };
  throw new Error("Unknown snapshot release option");
}

export async function runReleaseCli(
  args: readonly string[],
  dependencies?: ReleaseCliDependencies,
): Promise<number> {
  let resolvedDependencies: ReleaseCliDependencies;
  let options: ReleaseSnapshotOptions;
  try {
    resolvedDependencies = dependencies ?? defaultCliDependencies();
    options = parseReleaseOptions(args);
  } catch {
    const writeError = dependencies?.writeError ?? ((line: string) => console.error(line));
    writeError("Unknown snapshot release option");
    writeError("Card snapshot release failed");
    return 1;
  }

  try {
    const result = await resolvedDependencies.release(
      options,
      resolvedDependencies.createDependencies(resolvedDependencies.repositoryRoot),
    );
    resolvedDependencies.writeOutput(
      result.status === "unchanged"
        ? "Card snapshot is already current"
        : "Card snapshot committed and pushed to main",
    );
    return 0;
  } catch (error: unknown) {
    resolvedDependencies.writeError("Card snapshot release failed");
    if (error instanceof SnapshotPushError) {
      resolvedDependencies.writeError("Retry: git push origin HEAD:main");
    }
    return 1;
  }
}

function defaultCliDependencies(): ReleaseCliDependencies {
  return {
    repositoryRoot: process.cwd(),
    createDependencies: (repositoryRoot) => createReleaseSnapshotDependencies({ repositoryRoot }),
    release: releaseSnapshot,
    writeOutput: (line) => console.log(line),
    writeError: (line) => console.error(line),
  };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await runReleaseCli(process.argv.slice(2));
}

function isDirectExecution(moduleUrl: string, entryPath: string | undefined): boolean {
  if (!entryPath) return false;
  return resolve(fileURLToPath(moduleUrl)) === resolve(entryPath);
}
