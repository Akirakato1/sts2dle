import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSnapshotBundle,
  type BuildSnapshotBundleOptions,
} from "./release-snapshot.js";
import type { ActiveSnapshot } from "../sync/snapshot-store.js";

interface BuildCliDependencies {
  repositoryRoot: string;
  build(options: BuildSnapshotBundleOptions): Promise<ActiveSnapshot>;
  writeOutput(line: string): void;
  writeError(line: string): void;
}

export function resolveBuildOutput(repositoryRoot: string, args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--output" || args[1] === undefined) {
    throw new Error("Invalid snapshot build output");
  }
  const output = args[1];
  if (output === "" || isAbsolute(output)) throw new Error("Invalid snapshot build output");
  const resolvedRoot = resolve(repositoryRoot);
  const resolvedOutput = resolve(resolvedRoot, output);
  const pathFromRoot = relative(resolvedRoot, resolvedOutput);
  if (
    pathFromRoot === "" ||
    isAbsolute(pathFromRoot) ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    pathFromRoot.includes(":")
  ) {
    throw new Error("Invalid snapshot build output");
  }
  return resolvedOutput;
}

export async function runBuildCli(
  args: readonly string[],
  dependencies?: BuildCliDependencies,
): Promise<number> {
  let resolvedDependencies: BuildCliDependencies;
  let outputDir: string;
  try {
    resolvedDependencies = dependencies ?? defaultCliDependencies();
    outputDir = resolveBuildOutput(resolvedDependencies.repositoryRoot, args);
  } catch {
    const writeError = dependencies?.writeError ?? ((line: string) => console.error(line));
    writeError("Invalid snapshot build output");
    writeError("Card snapshot build failed");
    return 1;
  }
  try {
    await resolvedDependencies.build({ outputDir });
    resolvedDependencies.writeOutput("Card snapshot bundle built");
    return 0;
  } catch {
    resolvedDependencies.writeError("Card snapshot build failed");
    return 1;
  }
}

function defaultCliDependencies(): BuildCliDependencies {
  return {
    repositoryRoot: process.cwd(),
    build: buildSnapshotBundle,
    writeOutput: (line) => console.log(line),
    writeError: (line) => console.error(line),
  };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await runBuildCli(process.argv.slice(2));
}

function isDirectExecution(moduleUrl: string, entryPath: string | undefined): boolean {
  if (!entryPath) return false;
  return resolve(fileURLToPath(moduleUrl)) === resolve(entryPath);
}
