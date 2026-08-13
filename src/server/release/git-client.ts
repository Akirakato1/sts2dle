import { spawn, type ChildProcessByStdio } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { mkdtemp as mkdtempAsync, rm as rmAsync } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Readable } from "node:stream";

const SNAPSHOT_PATH = "deploy/snapshot-data";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATION_TIMEOUT_MS = 5_000;
const FALLBACK_CLOSE_TIMEOUT_MS = 1_000;
const PRIVATE_INDEX_PREFIX = "stsdle-snapshot-index-";
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
  env?: NodeJS.ProcessEnv;
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
class BoundedProcessError extends Error {
  constructor() {
    super("Child process failed");
    this.name = "BoundedProcessError";
  }
}

interface PrivateIndex {
  root: string;
  path: string;
}
type SpawnedProcess = ChildProcessByStdio<null, Readable, Readable>;

export class GitClient {
  readonly #repositoryRoot: string;
  readonly #runner: ArgumentArrayRunner;
  #privateIndex: PrivateIndex | undefined;

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
      await this.#discardPrivateIndex();
      const repository = await this.#git(["rev-parse", "--show-toplevel"]);
      if (!samePath(resolve(repository.stdout.trim()), this.#repositoryRoot)) throw new GitSafetyError();
      const status = await this.#statusPorcelain();
      if (status.stdout !== "") throw new GitSafetyError();
      const origin = await this.#git(["remote", "get-url", "origin"]);
      if (!APPROVED_ORIGINS.has(origin.stdout.trim())) throw new GitSafetyError();
      await this.#git(["fetch", "origin", "main"]);
      const head = await this.#git(["rev-parse", "HEAD"]);
      const originMain = await this.#git(["rev-parse", "refs/remotes/origin/main"]);
      if (head.stdout.trim() === "" || head.stdout.trim() !== originMain.stdout.trim()) throw new GitSafetyError();
    } catch {
      throw new Error("Repository is not ready for snapshot release");
    }
  }

  async assertOnlySnapshotChanges(): Promise<void> {
    try {
      await this.#discardPrivateIndex();
      const status = await this.#statusPorcelain();
      assertSnapshotPaths(parsePorcelainPaths(status.stdout));
      const gitDirectory = (await this.#git(["rev-parse", "--git-dir"])).stdout.trim();
      this.#privateIndex = await createPrivateIndex(this.#repositoryRoot, gitDirectory);
      const environment = privateIndexEnvironment(this.#privateIndex);
      await this.#git(["read-tree", "HEAD"], environment);
      await this.#git(["add", "-A", "--", SNAPSHOT_PATH], environment);
      const staged = await this.#git(["diff", "--cached", "--name-only"], environment);
      const stagedPaths = parseNameOnlyPaths(staged.stdout);
      if (stagedPaths.length === 0) throw new GitSafetyError();
      assertSnapshotPaths(stagedPaths);
    } catch {
      await this.#discardPrivateIndex().catch(() => undefined);
      throw new Error("Snapshot release changes are unsafe");
    }
  }

  async rollbackSnapshotIndex(): Promise<void> {
    try {
      await this.#restoreSnapshotIndex();
      await this.#discardPrivateIndex();
    } catch {
      await this.#discardPrivateIndex().catch(() => undefined);
      throw new Error("Unable to restore snapshot index");
    }
  }

  async commitSnapshot(sourceRevision: string): Promise<void> {
    let updatedRef = false;
    let oldHead = "";
    let newCommit = "";
    try {
      if (!/^[a-f0-9]{64}$/.test(sourceRevision) || !this.#privateIndex) throw new GitSafetyError();
      const environment = privateIndexEnvironment(this.#privateIndex);
      oldHead = (await this.#git(["rev-parse", "HEAD"])).stdout.trim();
      assertObjectId(oldHead);
      const tree = (await this.#git(["write-tree"], environment)).stdout.trim();
      assertObjectId(tree);
      newCommit = (await this.#git([
        "commit-tree", tree, "-p", oldHead,
        "-m", `chore: refresh card snapshot ${sourceRevision.slice(0, 12)}`,
      ], environment)).stdout.trim();
      assertObjectId(newCommit);
      await this.#git(["update-ref", "HEAD", newCommit, oldHead]);
      updatedRef = true;
      await this.#restoreSnapshotIndex();
      await this.#discardPrivateIndex();
    } catch {
      if (updatedRef) {
        await this.#git(["update-ref", "HEAD", oldHead, newCommit]).catch(() => undefined);
        await this.#restoreSnapshotIndex().catch(() => undefined);
      }
      await this.#discardPrivateIndex().catch(() => undefined);
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

  #git(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
    return this.#runner("git", args, env
      ? { cwd: this.#repositoryRoot, env }
      : { cwd: this.#repositoryRoot });
  }

  async #statusPorcelain(): Promise<ProcessResult> {
    try {
      return await this.#git(["status", "--porcelain=v1", "--untracked-files=all"]);
    } catch {
      return this.#git(["status", "--porcelain", "--untracked-files=all"]);
    }
  }

  async #restoreSnapshotIndex(): Promise<void> {
    try {
      await this.#git(["restore", "--staged", "--source=HEAD", "--", SNAPSHOT_PATH]);
    } catch {
      await this.#git(["reset", "HEAD", "--", SNAPSHOT_PATH]);
    }
  }

  async #discardPrivateIndex(): Promise<void> {
    const privateIndex = this.#privateIndex;
    this.#privateIndex = undefined;
    if (privateIndex) await rmAsync(privateIndex.root, { recursive: true, force: true });
  }
}

export async function runNpmCheck(
  repositoryRoot: string,
  npmCliPath: string,
  runner: ArgumentArrayRunner = runBoundedProcess,
): Promise<ProcessResult> {
  const resolvedCli = validateNpmCliPath(npmCliPath);
  return runner(process.execPath, [resolvedCli, "run", "check"], {
    cwd: repositoryRoot,
    timeoutMs: 15 * 60 * 1000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
}

export function resolveNpmCliPath(environment: NodeJS.ProcessEnv): string {
  const candidates = [
    environment.npm_execpath,
    ...String(environment.PATH ?? environment.Path ?? "").split(process.platform === "win32" ? ";" : ":")
      .filter(Boolean)
      .map((entry) => join(entry, "node_modules", "npm", "bin", "npm-cli.js")),
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return validateNpmCliPath(candidate);
    } catch {
      // Try the next known installation layout.
    }
  }
  throw new Error("npm CLI is unavailable");
}

export const runBoundedProcess: ArgumentArrayRunner = async (command, args, options) => {
  const timeoutMs = positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = positiveLimit(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  let child: SpawnedProcess;
  try {
    child = spawn(command, [...args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new BoundedProcessError();
  }

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let requestFailure!: () => void;
  const failureRequested = new Promise<void>((resolveFailure) => { requestFailure = resolveFailure; });
  let failureTriggered = false;
  const fail = (): void => {
    if (failureTriggered) return;
    failureTriggered = true;
    requestFailure();
  };
  const capture = (chunks: Buffer[], chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > maxOutputBytes) {
      fail();
      return;
    }
    chunks.push(chunk);
  };
  const stdoutListener = (chunk: Buffer) => capture(stdout, chunk);
  const stderrListener = (chunk: Buffer) => capture(stderr, chunk);
  child.stdout.on("data", stdoutListener);
  child.stderr.on("data", stderrListener);

  let closeResolve!: (result: { code: number | null; signal: NodeJS.Signals | null; spawnError: boolean }) => void;
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnError: boolean }>((resolveClose) => {
    closeResolve = resolveClose;
  });
  let closeObserved = false;
  const observeClose = (result: { code: number | null; signal: NodeJS.Signals | null; spawnError: boolean }): void => {
    if (closeObserved) return;
    closeObserved = true;
    closeResolve(result);
  };
  const closeListener = (code: number | null, signal: NodeJS.Signals | null) => observeClose({ code, signal, spawnError: false });
  const errorListener = () => observeClose({ code: null, signal: null, spawnError: true });
  child.once("close", closeListener);
  child.once("error", errorListener);
  const timeout = setTimeout(fail, timeoutMs);
  timeout.unref();

  const first = await Promise.race([
    closed.then((result) => ({ kind: "closed" as const, result })),
    failureRequested.then(() => ({ kind: "failure" as const })),
  ]);
  if (first.kind === "failure" || failureTriggered) await terminateProcessTree(child, closed);

  clearTimeout(timeout);
  child.stdout.removeListener("data", stdoutListener);
  child.stderr.removeListener("data", stderrListener);
  child.removeListener("close", closeListener);
  child.removeListener("error", errorListener);

  if (first.kind === "failure" || failureTriggered) throw new BoundedProcessError();
  const { code, signal, spawnError } = first.result;
  if (spawnError || code !== 0 || signal !== null) throw new BoundedProcessError();
  return {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
};

async function terminateProcessTree(
  child: SpawnedProcess,
  closed: Promise<unknown>,
): Promise<void> {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid! <= 0) {
    child.kill("SIGKILL");
  } else if (process.platform === "win32") {
    await runTaskkill(pid!);
  } else {
    try {
      process.kill(-pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  if (await settlesWithin(closed, TERMINATION_TIMEOUT_MS)) return;
  child.kill("SIGKILL");
  child.stdout.destroy();
  child.stderr.destroy();
  await settlesWithin(closed, FALLBACK_CLOSE_TIMEOUT_MS);
}

async function runTaskkill(pid: number): Promise<void> {
  await new Promise<void>((resolveTaskkill) => {
    let taskkill;
    try {
      taskkill = spawn(resolveTaskkillExecutable(), ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolveTaskkill();
      return;
    }
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      taskkill.removeAllListeners();
      resolveTaskkill();
    };
    taskkill.once("close", settle);
    taskkill.once("error", settle);
    const timer = setTimeout(() => {
      taskkill.kill("SIGKILL");
      settle();
    }, TERMINATION_TIMEOUT_MS);
    timer.unref();
  });
}

function resolveTaskkillExecutable(): string {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  if (!isAbsolute(windowsRoot)) throw new BoundedProcessError();
  const executable = realpathSync(join(windowsRoot, "System32", "taskkill.exe"));
  if (
    basename(executable).toLocaleLowerCase("en-US") !== "taskkill.exe" ||
    !lstatSync(executable).isFile()
  ) throw new BoundedProcessError();
  return executable;
}

async function settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), milliseconds);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function createPrivateIndex(repositoryRoot: string, gitDirectory: string): Promise<PrivateIndex> {
  if (gitDirectory === "") throw new GitSafetyError();
  const configuredGitDirectory = resolve(repositoryRoot, gitDirectory);
  const resolvedGitDirectory = realpathSync(configuredGitDirectory);
  if (!lstatSync(resolvedGitDirectory).isDirectory()) throw new GitSafetyError();
  const root = await mkdtempAsync(join(resolvedGitDirectory, PRIVATE_INDEX_PREFIX));
  return { root, path: join(root, "index") };
}

function privateIndexEnvironment(index: PrivateIndex): NodeJS.ProcessEnv {
  return { GIT_INDEX_FILE: index.path };
}

function validateNpmCliPath(candidate: string): string {
  if (!isAbsolute(candidate) || basename(candidate).toLocaleLowerCase("en-US") !== "npm-cli.js") {
    throw new Error("npm CLI is unavailable");
  }
  const resolved = realpathSync(candidate);
  if (!lstatSync(resolved).isFile()) throw new Error("npm CLI is unavailable");
  return resolved;
}

function parsePorcelainPaths(output: string): string[] {
  if (output === "") return [];
  return splitOutputLines(output).flatMap((line) => {
    if (line.length < 4 || line[2] !== " ") throw new GitSafetyError();
    const path = line.slice(3);
    if (path.startsWith("\"") || path.endsWith("\"")) throw new GitSafetyError();
    const renameAt = path.indexOf(" -> ");
    return renameAt < 0 ? [path] : [path.slice(0, renameAt), path.slice(renameAt + 4)];
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
    ) throw new GitSafetyError();
  }
}

function assertObjectId(value: string): void {
  if (!/^[a-f0-9]{40,64}$/.test(value)) throw new GitSafetyError();
}

function positiveLimit(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) throw new BoundedProcessError();
  return selected;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}
