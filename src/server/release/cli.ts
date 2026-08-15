import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createReleaseSnapshotDependencies,
  releaseSnapshot,
  SnapshotPostCommitCleanupError,
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
  if (args.length === 1 && args[0] === "--recover") return { recover: true };
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
    const releaseDependencies = resolvedDependencies.createDependencies(resolvedDependencies.repositoryRoot);
    if (options.recover) {
      await releaseDependencies.gitClient.recoverSnapshot(releaseDependencies.outputDir);
      resolvedDependencies.writeOutput("Card snapshot recovery completed and pushed to main");
      return 0;
    }
    const result = await resolvedDependencies.release(options, releaseDependencies);
    if (result.status === "released") {
      const audit = result.releaseAudit;
      resolvedDependencies.writeOutput(`Source revision: ${audit.sourceRevision}`);
      resolvedDependencies.writeOutput(`Cards: ${audit.cardCount}`);
      resolvedDependencies.writeOutput(`Upgrades: ${audit.upgradeCount}`);
      resolvedDependencies.writeOutput(`Base groups: ${audit.baseGroupCount}`);
      resolvedDependencies.writeOutput(`Pair groups: ${audit.pairGroupCount}`);
      resolvedDependencies.writeOutput(
        `Candidate sprite: ${audit.candidateSprite.width}x${audit.candidateSprite.height}; ${audit.candidateSprite.bytes} bytes`,
      );
      resolvedDependencies.writeOutput(
        `Guess sprite: ${audit.guessSprite.width}x${audit.guessSprite.height}; ${audit.guessSprite.bytes} bytes`,
      );
      resolvedDependencies.writeOutput(
        `Fallback invariant: ${audit.fallbackInvariantSatisfied ? "validated" : "failed"}`,
      );
      resolvedDependencies.writeOutput(`Fallback cards: ${audit.fallbackCardCount}`);
      resolvedDependencies.writeOutput(`Archive compressed bytes: ${audit.archiveCompressedBytes}`);
      resolvedDependencies.writeOutput(`Archive SHA-256: ${audit.archiveSha256}`);
    }
    resolvedDependencies.writeOutput(`Targets: ${result.sourceFeatureAudit.targets.join(", ")}`);
    resolvedDependencies.writeOutput(
      `Power keys: ${result.sourceFeatureAudit.singletonPowerKeyCount} singleton; ${result.sourceFeatureAudit.recurringPowerKeyCount} recurring`,
    );
    resolvedDependencies.writeOutput(
      `Multiple unique powers: ${result.sourceFeatureAudit.cardsWithMultipleSingletonPowers.join(", ") || "none"}`,
    );
    resolvedDependencies.writeOutput(`Keywords: ${result.sourceFeatureAudit.keywords.join(", ")}`);
    resolvedDependencies.writeOutput(
      result.status === "unchanged"
        ? "Card snapshot is already current"
        : "Card snapshot committed and pushed to main",
    );
    return 0;
  } catch (error: unknown) {
    if (error instanceof SnapshotPostCommitCleanupError) {
      resolvedDependencies.writeError("Snapshot committed but local cleanup failed");
      resolvedDependencies.writeError("Retry cleanup before pushing: npm run release:snapshot -- --recover");
    } else {
      resolvedDependencies.writeError("Card snapshot release failed");
    }
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
