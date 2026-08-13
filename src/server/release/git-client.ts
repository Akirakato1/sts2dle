import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import {
  lstat as lstatAsync,
  mkdtemp as mkdtempAsync,
  readFile as readFileAsync,
  rm as rmAsync,
  unlink as unlinkAsync,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const SNAPSHOT_PATH = "deploy/snapshot-data";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATION_TIMEOUT_MS = 5_000;
const FALLBACK_CLOSE_TIMEOUT_MS = 1_000;
const PRIVATE_INDEX_CLEANUP_TIMEOUT_MS = 5_000;
const PRIVATE_INDEX_CLEANUP_RETRY_MS = 50;
const PRIVATE_INDEX_PREFIX = "stsdle-snapshot-index-";
const RECOVERY_MARKER = "stsdle-snapshot-recovery.json";
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

export interface BoundedProcessDependencies {
  supervisorPath?: string;
  taskkill?: (pid: number) => Promise<boolean>;
  terminationTimeoutMs?: number;
}

export class GitPushError extends Error {
  constructor() {
    super("Unable to push card snapshot");
    this.name = "GitPushError";
  }
}

export class GitPostCommitCleanupError extends Error {
  constructor() {
    super("Card snapshot committed but private index cleanup failed");
    this.name = "GitPostCommitCleanupError";
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
  name: string;
}
interface PrivateIndexOperations {
  removeDirectory(path: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  monotonicNow(): number;
}
type SpawnedProcess = ChildProcessByStdio<null, Readable, Readable>;
type SupervisedProcess = ChildProcess & { stdout: Readable; stderr: Readable };

export class GitClient {
  readonly #repositoryRoot: string;
  readonly #runner: ArgumentArrayRunner;
  readonly #privateIndexOperations: PrivateIndexOperations;
  #privateIndex: PrivateIndex | undefined;

  constructor(repositoryRoot: string, runner?: ArgumentArrayRunner);
  constructor(options: {
    repositoryRoot: string;
    runner?: ArgumentArrayRunner;
    privateIndexOperations?: PrivateIndexOperations;
  });
  constructor(
    repositoryRootOrOptions: string | {
      repositoryRoot: string;
      runner?: ArgumentArrayRunner;
      privateIndexOperations?: PrivateIndexOperations;
    },
    runner: ArgumentArrayRunner = runBoundedProcess,
  ) {
    if (typeof repositoryRootOrOptions === "string") {
      this.#repositoryRoot = resolve(repositoryRootOrOptions);
      this.#runner = runner;
      this.#privateIndexOperations = defaultPrivateIndexOperations;
    } else {
      this.#repositoryRoot = resolve(repositoryRootOrOptions.repositoryRoot);
      this.#runner = repositoryRootOrOptions.runner ?? runBoundedProcess;
      this.#privateIndexOperations = repositoryRootOrOptions.privateIndexOperations ?? defaultPrivateIndexOperations;
    }
  }

  async assertReady(): Promise<void> {
    try {
      await this.#assertNoRecoveryMarker();
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
      try {
        await this.#discardPrivateIndex();
      } catch {
        throw new GitPostCommitCleanupError();
      }
    } catch (error: unknown) {
      if (error instanceof GitPostCommitCleanupError) throw error;
      if (updatedRef) {
        await this.#git(["update-ref", "HEAD", oldHead, newCommit]).catch(() => undefined);
        await this.#restoreSnapshotIndex().catch(() => undefined);
      }
      await this.#discardPrivateIndex().catch(() => undefined);
      throw new Error("Unable to commit card snapshot");
    }
  }

  async cleanupPrivateIndex(): Promise<void> {
    try {
      await this.#discardPrivateIndex();
    } catch {
      throw new Error("Unable to clean private index");
    }
  }

  async writeRecoveryMarker(
    publicationBackupName?: string | null,
    outputDir = join(this.#repositoryRoot, SNAPSHOT_PATH),
  ): Promise<void> {
    try {
      if (publicationBackupName != null && !/^\.snapshot-data\.backup-[0-9a-f-]{36}$/.test(publicationBackupName)) {
        throw new GitSafetyError();
      }
      const gitDirectory = await this.#resolvedGitDirectory();
      const commit = (await this.#git(["rev-parse", "HEAD"])).stdout.trim();
      assertObjectId(commit);
      const marker = {
        version: 1,
        commit,
        privateIndex: this.#privateIndex
          ? await describeRecoveryArtifact(this.#privateIndex.name, this.#privateIndex.root)
          : null,
        publicationBackup: publicationBackupName
          ? await describeRecoveryArtifact(
            publicationBackupName,
            join(resolve(dirname(outputDir)), publicationBackupName),
          )
          : null,
      };
      await writeFileAsync(join(gitDirectory, RECOVERY_MARKER), `${JSON.stringify(marker)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch {
      throw new Error("Unable to record snapshot recovery");
    }
  }

  async recoverSnapshot(outputDir = join(this.#repositoryRoot, SNAPSHOT_PATH)): Promise<void> {
    try {
      const repository = await this.#git(["rev-parse", "--show-toplevel"]);
      if (!samePath(resolve(repository.stdout.trim()), this.#repositoryRoot)) throw new GitSafetyError();
      const gitDirectory = await this.#resolvedGitDirectory();
      const markerPath = join(gitDirectory, RECOVERY_MARKER);
      const marker = parseRecoveryMarker(await readFileAsync(markerPath, "utf8"));
      const status = await this.#statusPorcelain();
      if (status.stdout !== "") throw new GitSafetyError();
      const origin = await this.#git(["remote", "get-url", "origin"]);
      if (!APPROVED_ORIGINS.has(origin.stdout.trim())) throw new GitSafetyError();
      await this.#git(["fetch", "origin", "main"]);
      const head = (await this.#git(["rev-parse", "HEAD"])).stdout.trim();
      const parent = (await this.#git(["rev-parse", "HEAD^"])).stdout.trim();
      const originMain = (await this.#git(["rev-parse", "refs/remotes/origin/main"])).stdout.trim();
      if (head !== marker.commit || parent !== originMain) throw new GitSafetyError();

      let cleanupFailed = false;
      if (marker.privateIndex) {
        try {
          const privatePath = join(gitDirectory, marker.privateIndex.name);
          assertExactChild(privatePath, gitDirectory, marker.privateIndex.name);
          const stat = await lstatIfPresent(privatePath);
          if (stat) {
            assertRecoveryIdentity(stat, marker.privateIndex);
            await this.#privateIndexOperations.removeDirectory(privatePath);
          }
          if (this.#privateIndex?.name === marker.privateIndex.name) this.#privateIndex = undefined;
        } catch {
          cleanupFailed = true;
        }
      }
      if (marker.publicationBackup) {
        try {
          const outputParent = resolve(dirname(outputDir));
          const backupPath = join(outputParent, marker.publicationBackup.name);
          assertExactChild(backupPath, outputParent, marker.publicationBackup.name);
          const stat = await lstatIfPresent(backupPath);
          if (stat) {
            assertRecoveryIdentity(stat, marker.publicationBackup);
            await rmAsync(backupPath, { recursive: true, force: false });
          }
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) throw new GitSafetyError();
      await this.pushMain();
      await unlinkAsync(markerPath);
    } catch {
      throw new Error("Unable to recover card snapshot");
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
    if (!privateIndex) return;
    const deadline = this.#privateIndexOperations.monotonicNow() + PRIVATE_INDEX_CLEANUP_TIMEOUT_MS;
    for (;;) {
      try {
        await this.#privateIndexOperations.removeDirectory(privateIndex.root);
        if (this.#privateIndex === privateIndex) this.#privateIndex = undefined;
        return;
      } catch (error: unknown) {
        if (!isTransientRemovalFailure(error) || this.#privateIndexOperations.monotonicNow() >= deadline) {
          throw new GitSafetyError();
        }
        await this.#privateIndexOperations.wait(PRIVATE_INDEX_CLEANUP_RETRY_MS);
      }
    }
  }

  async #resolvedGitDirectory(): Promise<string> {
    const configured = (await this.#git(["rev-parse", "--git-dir"])).stdout.trim();
    if (configured === "") throw new GitSafetyError();
    const resolved = realpathSync(resolve(this.#repositoryRoot, configured));
    if (!lstatSync(resolved).isDirectory()) throw new GitSafetyError();
    return resolved;
  }

  async #assertNoRecoveryMarker(): Promise<void> {
    const gitDirectory = await this.#resolvedGitDirectory();
    try {
      await lstatAsync(join(gitDirectory, RECOVERY_MARKER));
      throw new GitSafetyError();
    } catch (error: unknown) {
      if (error instanceof GitSafetyError) throw error;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
      throw new GitSafetyError();
    }
  }
}

const defaultPrivateIndexOperations: PrivateIndexOperations = {
  removeDirectory: async (path) => rmAsync(path, { recursive: true, force: true }),
  wait: async (milliseconds) => new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  }),
  monotonicNow: () => performance.now(),
};

function isTransientRemovalFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "EPERM" || error.code === "EBUSY";
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

export function createBoundedProcessRunner(
  dependencies: BoundedProcessDependencies = {},
): ArgumentArrayRunner {
  const terminationTimeoutMs = positiveLimit(
    dependencies.terminationTimeoutMs,
    TERMINATION_TIMEOUT_MS,
  );
  const taskkill = dependencies.taskkill ?? ((pid: number) => runTaskkill(pid, terminationTimeoutMs));
  return async (command, args, options) => {
  const timeoutMs = positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = positiveLimit(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  let child: SpawnedProcess | SupervisedProcess;
  const supervised = process.platform === "win32";
  const environment = options.env ? { ...process.env, ...options.env } : { ...process.env };
  try {
    child = supervised
      ? spawnWindowsSupervisor(options.cwd, dependencies.supervisorPath)
      : spawn(command, [...args], {
        cwd: options.cwd,
        detached: true,
        env: environment,
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
    if (failureTriggered) return;
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
  const protocolToken = randomUUID();
  let resultResolve!: (result: { code: number | null; signal: string | null }) => void;
  const resultReported = new Promise<{ code: number | null; signal: string | null }>((resolveResult) => {
    resultResolve = resolveResult;
  });
  let terminationReadyResolve!: () => void;
  const terminationReady = new Promise<void>((resolveReady) => { terminationReadyResolve = resolveReady; });
  let resultObserved = false;
  let terminationConfirmed = false;
  const messageListener = (message: unknown): void => {
    if (typeof message !== "object" || message === null || !("type" in message)) return;
    if (message.type === "termination-ready" && "token" in message && message.token === protocolToken) {
      if (terminationConfirmed) {
        fail();
        return;
      }
      terminationConfirmed = true;
      terminationReadyResolve();
    } else if (
      message.type === "result" &&
      "token" in message && message.token === protocolToken &&
      "code" in message && (message.code === null || (
        Number.isInteger(message.code) && typeof message.code === "number" && message.code >= 0
      )) &&
      "signal" in message && (message.signal === null || typeof message.signal === "string")
    ) {
      if (resultObserved) {
        fail();
        return;
      }
      resultObserved = true;
      resultResolve({ code: message.code as number | null, signal: message.signal });
    } else fail();
  };
  if (supervised) child.on("message", messageListener);
  if (supervised) {
    try {
      child.send({
        type: "launch",
        token: protocolToken,
        command,
        args: [...args],
        cwd: options.cwd,
        env: environment,
      }, (error) => { if (error) fail(); });
    } catch {
      fail();
    }
  }
  const timeout = setTimeout(fail, timeoutMs);

  const first = await Promise.race([
    (supervised
      ? Promise.race([
        resultReported.then((result) => ({ ...result, spawnError: false })),
        closed.then(() => ({ code: null, signal: null, spawnError: true })),
      ])
      : closed).then((result) => ({ kind: "closed" as const, result })),
    failureRequested.then(() => ({ kind: "failure" as const })),
  ]);
  if (supervised) {
    const terminated = await terminateWindowsSupervisor(
      child as SupervisedProcess,
      closed,
      () => closeObserved,
      () => terminationConfirmed,
      terminationReady,
      protocolToken,
      taskkill,
      terminationTimeoutMs,
    );
    if (!terminated) fail();
  } else if (first.kind === "failure" || failureTriggered) {
    await terminatePosixProcessTree(child as SpawnedProcess, closed);
  }

  clearTimeout(timeout);
  child.stdout.removeListener("data", stdoutListener);
  child.stderr.removeListener("data", stderrListener);
  child.removeListener("close", closeListener);
  child.removeListener("error", errorListener);
  if (supervised) child.removeListener("message", messageListener);

  if (first.kind === "failure" || failureTriggered) throw new BoundedProcessError();
  const { code, signal, spawnError } = first.result;
  if (spawnError || code !== 0 || signal !== null) throw new BoundedProcessError();
  return {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
  };
}

export const runBoundedProcess: ArgumentArrayRunner = createBoundedProcessRunner();

async function terminatePosixProcessTree(
  child: SpawnedProcess,
  closed: Promise<unknown>,
): Promise<void> {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid! <= 0) {
    child.kill("SIGKILL");
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

function spawnWindowsSupervisor(cwd: string, injectedPath?: string): SupervisedProcess {
  const currentExtension = extname(fileURLToPath(import.meta.url));
  const supervisorExtension = currentExtension === ".ts" ? ".ts" : ".js";
  const supervisorPath = injectedPath ?? fileURLToPath(
    new URL(`./process-supervisor${supervisorExtension}`, import.meta.url),
  );
  if (!isAbsolute(supervisorPath) || !lstatSync(realpathSync(supervisorPath)).isFile()) {
    throw new BoundedProcessError();
  }
  const child = spawn(process.execPath, [supervisorPath], {
    cwd,
    env: process.env,
    serialization: "json",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  if (!child.stdout || !child.stderr) throw new BoundedProcessError();
  return child as SupervisedProcess;
}

async function terminateWindowsSupervisor(
  child: SupervisedProcess,
  closed: Promise<unknown>,
  closeObserved: () => boolean,
  terminationConfirmed: () => boolean,
  terminationReady: Promise<void>,
  token: string,
  taskkill: (pid: number) => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  if (closeObserved()) return true;
  const deadline = performance.now() + timeoutMs;
  try {
    child.send({ type: "prepare-termination", token });
  } catch {
    return closeObserved();
  }
  const prepared = await settlesBeforeDeadline(terminationReady, closed, deadline);
  if (closeObserved()) return true;
  if (prepared !== "primary" || !terminationConfirmed()) {
    return requestSupervisorSelfTermination(child, closed, closeObserved, token, deadline, false);
  }
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid! <= 0) {
    return requestSupervisorSelfTermination(child, closed, closeObserved, token, deadline, false);
  }

  while (!closeObserved() && terminationConfirmed() && performance.now() < deadline) {
    const attempt = await resolvesBeforeDeadline(taskkill(pid!), deadline);
    if (closeObserved()) return attempt === true;
    if (attempt === true && await settlesWithin(closed, remainingMilliseconds(deadline))) return true;
    if (remainingMilliseconds(deadline) > 0) await settlesWithin(closed, Math.min(50, remainingMilliseconds(deadline)));
  }
  if (closeObserved()) return true;
  return requestSupervisorSelfTermination(child, closed, closeObserved, token, deadline, false);
}

async function requestSupervisorSelfTermination(
  child: SupervisedProcess,
  closed: Promise<unknown>,
  closeObserved: () => boolean,
  token: string,
  originalDeadline: number,
  externalSucceeded: boolean,
): Promise<boolean> {
  const cleanupDeadline = Math.max(originalDeadline, performance.now() + FALLBACK_CLOSE_TIMEOUT_MS);
  try { child.send({ type: "terminate-self", token }); } catch { /* The close race below remains authoritative. */ }
  if (!closeObserved()) child.disconnect?.();
  await settlesWithin(closed, remainingMilliseconds(cleanupDeadline));
  if (!closeObserved()) child.kill("SIGKILL");
  await settlesWithin(closed, Math.min(FALLBACK_CLOSE_TIMEOUT_MS, remainingMilliseconds(cleanupDeadline)));
  return externalSucceeded && closeObserved();
}

async function runTaskkill(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolveTaskkill) => {
    let taskkill;
    try {
      taskkill = spawn(resolveTaskkillExecutable(), ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolveTaskkill(false);
      return;
    }
    let settled = false;
    const settle = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      taskkill.removeAllListeners();
      resolveTaskkill(succeeded);
    };
    taskkill.once("close", (code, signal) => settle(code === 0 && signal === null));
    taskkill.once("error", () => settle(false));
    const timer = setTimeout(() => {
      taskkill.kill("SIGKILL");
      settle(false);
    }, timeoutMs);
  });
}

async function settlesBeforeDeadline(
  primary: Promise<unknown>,
  closed: Promise<unknown>,
  deadline: number,
): Promise<"primary" | "closed" | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      primary.then(() => "primary" as const),
      closed.then(() => "closed" as const),
      new Promise<"timeout">((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout("timeout"), remainingMilliseconds(deadline));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolvesBeforeDeadline(
  promise: Promise<boolean>,
  deadline: number,
): Promise<boolean | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(undefined), remainingMilliseconds(deadline));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function remainingMilliseconds(deadline: number): number {
  return Math.max(0, Math.ceil(deadline - performance.now()));
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
  return { root, path: join(root, "index"), name: basename(root) };
}

interface RecoveryMarker {
  version: 1;
  commit: string;
  privateIndex: RecoveryArtifact | null;
  publicationBackup: RecoveryArtifact | null;
}

interface RecoveryArtifact {
  name: string;
  dev: string;
  ino: string;
  birthtimeMs: string;
}

function parseRecoveryMarker(raw: string): RecoveryMarker {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) throw new GitSafetyError();
  const marker = value as Partial<RecoveryMarker>;
  if (
    marker.version !== 1 || typeof marker.commit !== "string" || !/^[a-f0-9]{40,64}$/.test(marker.commit) ||
    !isRecoveryArtifact(marker.privateIndex, /^stsdle-snapshot-index-[A-Za-z0-9_-]+$/) ||
    !isRecoveryArtifact(marker.publicationBackup, /^\.snapshot-data\.backup-[0-9a-f-]{36}$/)
  ) throw new GitSafetyError();
  return marker as RecoveryMarker;
}

function isRecoveryArtifact(value: unknown, namePattern: RegExp): value is RecoveryArtifact | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null) return false;
  const artifact = value as Partial<RecoveryArtifact>;
  return typeof artifact.name === "string" && namePattern.test(artifact.name) &&
    typeof artifact.dev === "string" && /^\d+$/.test(artifact.dev) &&
    typeof artifact.ino === "string" && /^\d+$/.test(artifact.ino) &&
    typeof artifact.birthtimeMs === "string" && /^\d+(?:\.\d+)?$/.test(artifact.birthtimeMs);
}

async function describeRecoveryArtifact(name: string, path: string): Promise<RecoveryArtifact> {
  const stat = await lstatAsync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new GitSafetyError();
  return {
    name,
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: String(stat.birthtimeMs),
  };
}

function assertRecoveryIdentity(
  stat: Awaited<ReturnType<typeof lstatAsync>>,
  artifact: RecoveryArtifact,
): void {
  if (
    !stat.isDirectory() || stat.isSymbolicLink() ||
    String(stat.dev) !== artifact.dev || String(stat.ino) !== artifact.ino ||
    String(stat.birthtimeMs) !== artifact.birthtimeMs
  ) throw new GitSafetyError();
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstatAsync>> | undefined> {
  try {
    return await lstatAsync(path);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertExactChild(path: string, parent: string, name: string): void {
  if (resolve(path) !== resolve(parent, name) || dirname(resolve(path)) !== resolve(parent)) throw new GitSafetyError();
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
