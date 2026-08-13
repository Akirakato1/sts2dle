import { spawn } from "node:child_process";
import { resolve } from "node:path";

const SNAPSHOT_PATH = "deploy/snapshot-data";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const APPROVED_ORIGINS = new Set([
  "git@github.com:Akirakato1/sts2dle.git",
  "ssh://git@github.com/Akirakato1/sts2dle.git",
]);

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface ProcessRunOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export type ArgumentArrayRunner = (
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
) => Promise<ProcessResult>;

export class GitPushError extends Error {
  constructor() {
    super("Unable to push card snapshot");
    this.name = "GitPushError";
  }
}

class GitSafetyError extends Error {}

export class GitClient {
  readonly #repositoryRoot: string;
  readonly #runner: ArgumentArrayRunner;

  constructor(repositoryRoot: string, runner?: ArgumentArrayRunner);
  constructor(options: { repositoryRoot: string; runner?: ArgumentArrayRunner });
  constructor(
    repositoryRootOrOptions: string | { repositoryRoot: string; runner?: ArgumentArrayRunner },
    runner: ArgumentArrayRunner = runBoundedProcess,
  ) {
    if (typeof repositoryRootOrOptions === "string") {
      this.#repositoryRoot = resolve(repositoryRootOrOptions);
      this.#runner = runner;
    } else {
      this.#repositoryRoot = resolve(repositoryRootOrOptions.repositoryRoot);
      this.#runner = repositoryRootOrOptions.runner ?? runBoundedProcess;
    }
  }

  async assertReady(): Promise<void> {
    try {
      const repository = await this.#git(["rev-parse", "--show-toplevel"]);
      if (!samePath(resolve(repository.stdout.trim()), this.#repositoryRoot)) throw new GitSafetyError();

      const status = await this.#git(["status", "--porcelain=v1", "--untracked-files=all"]);
      if (status.stdout !== "") throw new GitSafetyError();

      const origin = await this.#git(["remote", "get-url", "origin"]);
      if (!APPROVED_ORIGINS.has(origin.stdout.trim())) throw new GitSafetyError();

      await this.#git(["fetch", "origin", "main"]);
      const head = await this.#git(["rev-parse", "HEAD"]);
      const originMain = await this.#git(["rev-parse", "refs/remotes/origin/main"]);
      if (head.stdout.trim() === "" || head.stdout.trim() !== originMain.stdout.trim()) {
        throw new GitSafetyError();
      }
    } catch {
      throw new Error("Repository is not ready for snapshot release");
    }
  }

  async assertOnlySnapshotChanges(): Promise<void> {
    try {
      const status = await this.#git(["status", "--porcelain=v1", "--untracked-files=all"]);
      assertSnapshotPaths(parsePorcelainPaths(status.stdout));
      await this.#git(["add", "-A", "--", SNAPSHOT_PATH]);
      const staged = await this.#git(["diff", "--cached", "--name-only"]);
      assertSnapshotPaths(parseNameOnlyPaths(staged.stdout));
    } catch {
      throw new Error("Snapshot release changes are unsafe");
    }
  }

  async commitSnapshot(sourceRevision: string): Promise<void> {
    try {
      if (!/^[a-f0-9]{64}$/.test(sourceRevision)) throw new GitSafetyError();
      await this.#git([
        "commit",
        "-m",
        `chore: refresh card snapshot ${sourceRevision.slice(0, 12)}`,
      ]);
    } catch {
      throw new Error("Unable to commit card snapshot");
    }
  }

  async pushMain(): Promise<void> {
    try {
      await this.#git(["push", "origin", "HEAD:main"]);
    } catch {
      throw new GitPushError();
    }
  }

  #git(args: readonly string[]): Promise<ProcessResult> {
    return this.#runner("git", args, { cwd: this.#repositoryRoot });
  }
}

export const runBoundedProcess: ArgumentArrayRunner = async (
  command,
  args,
  options,
) => new Promise<ProcessResult>((resolveResult, rejectResult) => {
  const timeoutMs = positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = positiveLimit(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let failure: Error | undefined;
  let settled = false;

  const stop = (error: Error): void => {
    failure ??= error;
    child.kill();
  };
  const timeout = setTimeout(
    () => stop(new Error("Child process timed out")),
    timeoutMs,
  );
  timeout.unref();

  const capture = (chunks: Buffer[], chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > maxOutputBytes) {
      stop(new Error("Child process output limit exceeded"));
      return;
    }
    chunks.push(chunk);
  };

  child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
  child.once("error", () => {
    failure ??= new Error("Child process could not be started");
  });
  child.once("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (failure || code !== 0 || signal !== null) {
      rejectResult(failure ?? new Error("Child process failed"));
      return;
    }
    resolveResult({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
  });
});

function parsePorcelainPaths(output: string): string[] {
  if (output === "") return [];
  return splitOutputLines(output).flatMap((line) => {
    if (line.length < 4 || line[2] !== " ") throw new GitSafetyError();
    const path = line.slice(3);
    if (path.startsWith("\"") || path.endsWith("\"")) throw new GitSafetyError();
    const renameSeparator = " -> ";
    const renameAt = path.indexOf(renameSeparator);
    return renameAt < 0
      ? [path]
      : [path.slice(0, renameAt), path.slice(renameAt + renameSeparator.length)];
  });
}

function parseNameOnlyPaths(output: string): string[] {
  return output === "" ? [] : splitOutputLines(output);
}

function splitOutputLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.length > 0);
}

function assertSnapshotPaths(paths: readonly string[]): void {
  for (const path of paths) {
    const normalized = path.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (
      segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
      (normalized !== SNAPSHOT_PATH && !normalized.startsWith(`${SNAPSHOT_PATH}/`))
    ) {
      throw new GitSafetyError();
    }
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error("Invalid child process limit");
  return selected;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}
