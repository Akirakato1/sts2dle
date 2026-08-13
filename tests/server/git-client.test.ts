import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitClient,
  GitPushError,
  resolveNpmCliPath,
  runBoundedProcess,
  runNpmCheck,
  type ArgumentArrayRunner,
  type ProcessResult,
} from "../../src/server/release/git-client.js";

const REPOSITORY_ROOT = process.cwd();
const EXPECTED_ORIGIN = "git@github.com:Akirakato1/sts2dle.git";
const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class RecordingRunner {
  readonly calls: Array<[string, string[]]> = [];
  readonly #responses = new Map<string, Array<ProcessResult | Error>>();

  constructor() {
    this.respond(["rev-parse", "--show-toplevel"], `${REPOSITORY_ROOT}\n`);
    this.respond(["status", "--porcelain=v1", "--untracked-files=all"], "");
    this.respond(["status", "--porcelain", "--untracked-files=all"], "");
    this.respond(["remote", "get-url", "origin"], `${EXPECTED_ORIGIN}\n`);
    this.respond(["fetch", "origin", "main"], "");
    this.respond(["rev-parse", "HEAD"], "a".repeat(40));
    this.respond(["rev-parse", "refs/remotes/origin/main"], "a".repeat(40));
    this.respond(["add", "-A", "--", "deploy/snapshot-data"], "");
    this.respond(["diff", "--cached", "--name-only"], "deploy/snapshot-data/active.json\n");
    this.respond(["rev-parse", "--git-dir"], `${REPOSITORY_ROOT}\\.git\n`);
    this.respond(["read-tree", "HEAD"], "");
    this.respond(["write-tree"], `${"c".repeat(40)}\n`);
    this.respond(["commit-tree", "c".repeat(40), "-p", "a".repeat(40), "-m", `chore: refresh card snapshot ${"b".repeat(12)}`], `${"d".repeat(40)}\n`);
    this.respond(["update-ref", "HEAD", "d".repeat(40), "a".repeat(40)], "");
    this.respond(["restore", "--staged", "--source=HEAD", "--", "deploy/snapshot-data"], "");
    this.respond(["reset", "HEAD", "--", "deploy/snapshot-data"], "");
    this.respond(["push", "origin", "HEAD:main"], "");
  }

  readonly run: ArgumentArrayRunner = async (command, args) => {
    this.calls.push([command, [...args]]);
    const queue = this.#responses.get(key(args));
    const response = queue?.length === 1 ? queue[0] : queue?.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return response;
  };

  replace(args: readonly string[], ...responses: Array<string | Error>): void {
    this.#responses.set(key(args), responses.map(toResult));
  }

  private respond(args: readonly string[], stdout: string): void {
    this.#responses.set(key(args), [toResult(stdout)]);
  }
}

describe("GitClient", () => {
  it("uses fixed argument arrays for readiness, snapshot staging, and pushing", async () => {
    const runner = new RecordingRunner();
    const client = new GitClient(REPOSITORY_ROOT, runner.run);

    await client.assertReady();
    await client.assertOnlySnapshotChanges();
    await client.pushMain();

    expect(runner.calls).toContainEqual(["git", ["fetch", "origin", "main"]]);
    expect(runner.calls).toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data"]]);
    expect(runner.calls).toContainEqual(["git", ["push", "origin", "HEAD:main"]]);
    await client.rollbackSnapshotIndex();
  });

  it.each([
    ["dirty tracked files", " M src/server/main.ts\n"],
    ["untracked files", "?? local-secrets.txt\n"],
  ])("rejects %s before fetching", async (_label, status) => {
    const runner = new RecordingRunner();
    runner.replace(["status", "--porcelain=v1", "--untracked-files=all"], status);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertReady())
      .rejects.toThrow("Repository is not ready for snapshot release");
    expect(runner.calls).not.toContainEqual(["git", ["fetch", "origin", "main"]]);
  });

  it("rejects a repository root other than the configured root without disclosing either path", async () => {
    const runner = new RecordingRunner();
    const otherRoot = "C:\\private\\different-repository";
    runner.replace(["rev-parse", "--show-toplevel"], `${otherRoot}\n`);

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).assertReady());

    expect(stringifyErrorChain(error)).toBe("Repository is not ready for snapshot release");
    expect(stringifyErrorChain(error)).not.toContain(REPOSITORY_ROOT);
    expect(stringifyErrorChain(error)).not.toContain(otherRoot);
  });

  it.each([
    "https://github.com/Akirakato1/sts2dle.git",
    "git@github.com:Akirakato1/other.git",
    "ssh://fake-user:fake-password@github.com/Akirakato1/sts2dle.git",
  ])("rejects non-approved origin %s without disclosing it", async (origin) => {
    const runner = new RecordingRunner();
    runner.replace(["remote", "get-url", "origin"], `${origin}\n`);

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).assertReady());

    expect(stringifyErrorChain(error)).toBe("Repository is not ready for snapshot release");
    expect(stringifyErrorChain(error)).not.toContain(origin);
    expect(runner.calls).not.toContainEqual(["git", ["fetch", "origin", "main"]]);
  });

  it.each([
    "git@github.com:Akirakato1/sts2dle.git",
    "ssh://git@github.com/Akirakato1/sts2dle.git",
  ])("accepts the exact SSH origin %s", async (origin) => {
    const runner = new RecordingRunner();
    runner.replace(["remote", "get-url", "origin"], `${origin}\n`);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertReady()).resolves.toBeUndefined();
  });

  it("rejects HEAD that differs from fetched origin/main", async () => {
    const runner = new RecordingRunner();
    runner.replace(["rev-parse", "refs/remotes/origin/main"], `${"c".repeat(40)}\n`);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertReady())
      .rejects.toThrow("Repository is not ready for snapshot release");
  });

  it.each([
    ["working tree", ["status", "--porcelain=v1", "--untracked-files=all"], " M deploy/snapshot-data/active.json\n?? README-private.md\n"],
    ["staging area", ["diff", "--cached", "--name-only"], "deploy/snapshot-data/active.json\nREADME.md\n"],
  ] as const)("rejects extra paths in the %s", async (_label, command, response) => {
    const runner = new RecordingRunner();
    runner.replace(command, response);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertOnlySnapshotChanges())
      .rejects.toThrow("Snapshot release changes are unsafe");
  });

  it("does not stage when a changed path is outside the snapshot directory", async () => {
    const runner = new RecordingRunner();
    runner.replace(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      " M deploy/snapshot-data/active.json\n?? another-path.txt\n",
    );

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertOnlySnapshotChanges()).rejects.toThrow();
    expect(runner.calls).not.toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data"]]);
  });

  it("uses a source-revision commit message and hides commit failures", async () => {
    const runner = new RecordingRunner();
    const secret = "fake-ssh-private-key";
    const client = new GitClient(REPOSITORY_ROOT, runner.run);
    await client.assertOnlySnapshotChanges();
    runner.replace(
      ["commit-tree", "c".repeat(40), "-p", "a".repeat(40), "-m", `chore: refresh card snapshot ${"b".repeat(12)}`],
      new Error(`${secret} at ${REPOSITORY_ROOT}`),
    );

    const error = await captureError(client.commitSnapshot("b".repeat(64)));

    expect(stringifyErrorChain(error)).toBe("Unable to commit card snapshot");
    expect(stringifyErrorChain(error)).not.toContain(secret);
    expect(stringifyErrorChain(error)).not.toContain(REPOSITORY_ROOT);
  });

  it("commits only the isolated verified snapshot tree despite hooks and concurrent staging", async () => {
    const repository = await createGitRepository();
    const privateIndexes: string[] = [];
    const observingRunner: ArgumentArrayRunner = async (command, args, options) => {
      if (options.env?.GIT_INDEX_FILE) privateIndexes.push(options.env.GIT_INDEX_FILE);
      return runBoundedProcess(command, args, options);
    };
    const client = new GitClient(repository, observingRunner);
    await writeFile(join(repository, "deploy", "snapshot-data", "active.json"), "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    await writeFile(join(repository, "unrelated.txt"), "concurrent staged content\n");
    await git(repository, ["add", "unrelated.txt"]);
    const hook = join(repository, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho hook-ran > malicious.txt\ngit add malicious.txt\n");
    await chmodExecutable(hook);

    await client.commitSnapshot("b".repeat(64));

    expect((await git(repository, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim())
      .toBe("deploy/snapshot-data/active.json");
    expect((await git(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("unrelated.txt");
    await expect(readFile(join(repository, "malicious.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(privateIndexes.length).toBeGreaterThan(0);
    expect(privateIndexes.every((path) => path.startsWith(join(repository, ".git")))).toBe(true);
  }, 15_000);

  it("restores the snapshot index and worktree to HEAD after a pre-commit failure", async () => {
    const repository = await createGitRepository();
    const client = new GitClient(repository, runBoundedProcess);
    const snapshot = join(repository, "deploy", "snapshot-data", "active.json");
    await writeFile(snapshot, "published snapshot\n");
    await git(repository, ["add", "deploy/snapshot-data"]);
    await client.assertOnlySnapshotChanges();

    await writeFile(snapshot, "old snapshot\n");
    await client.rollbackSnapshotIndex();

    expect((await git(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("");
    expect((await git(repository, ["diff", "--", "deploy/snapshot-data"])).trim()).toBe("");
  }, 15_000);

  it("retries a transient private-index removal without losing its cleanup handle", async () => {
    const repository = await createGitRepository();
    let removalAttempts = 0;
    const client = new GitClient({
      repositoryRoot: repository,
      runner: runBoundedProcess,
      privateIndexOperations: {
        removeDirectory: async (path: string) => {
          removalAttempts += 1;
          if (removalAttempts === 1) throw Object.assign(new Error("private path"), { code: "EPERM" });
          await rm(path, { recursive: true, force: true });
        },
        wait: async () => undefined,
        monotonicNow: () => removalAttempts * 100,
      },
    });
    await writeFile(join(repository, "deploy", "snapshot-data", "active.json"), "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    await client.commitSnapshot("b".repeat(64));

    expect(removalAttempts).toBe(2);
    expect(await privateIndexDirectories(repository)).toEqual([]);
    expect((await git(repository, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim())
      .toBe("deploy/snapshot-data/active.json");
  }, 15_000);

  it("retains a private-index cleanup handle after persistent failure and succeeds on retry", async () => {
    const repository = await createGitRepository();
    let removalBlocked = true;
    let clock = 0;
    const client = new GitClient({
      repositoryRoot: repository,
      runner: runBoundedProcess,
      privateIndexOperations: {
        removeDirectory: async (path: string) => {
          if (removalBlocked) throw Object.assign(new Error(`secret ${path}`), { code: "EBUSY" });
          await rm(path, { recursive: true, force: true });
        },
        wait: async () => { clock += 100; },
        monotonicNow: () => clock,
      },
    });
    const oldHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    await writeFile(join(repository, "deploy", "snapshot-data", "active.json"), "new snapshot\n");
    await client.assertOnlySnapshotChanges();
    await writeFile(join(repository, "unrelated.txt"), "staged unrelated\n");
    await git(repository, ["add", "unrelated.txt"]);

    const error = await captureError(client.commitSnapshot("b".repeat(64)));

    expect(stringifyErrorChain(error)).toBe("Card snapshot committed but private index cleanup failed");
    expect((await git(repository, ["rev-parse", "HEAD"])).trim()).not.toBe(oldHead);
    expect((await git(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("unrelated.txt");
    expect(await privateIndexDirectories(repository)).toHaveLength(1);

    removalBlocked = false;
    await client.cleanupPrivateIndex();

    expect(await privateIndexDirectories(repository)).toEqual([]);
    expect((await git(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("unrelated.txt");
  }, 15_000);

  it("returns a fixed typed push error without preserving credential-bearing causes", async () => {
    const runner = new RecordingRunner();
    const secret = "ssh://fake-user:fake-password@github.com/private/repository.git";
    runner.replace(["push", "origin", "HEAD:main"], new Error(`${secret} ${REPOSITORY_ROOT}`));

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).pushMain());

    expect(error).toBeInstanceOf(GitPushError);
    expect(stringifyErrorChain(error)).toBe("Unable to push card snapshot");
    expect(stringifyErrorChain(error)).not.toContain(secret);
    expect(stringifyErrorChain(error)).not.toContain(REPOSITORY_ROOT);
  });
});

describe("runBoundedProcess", () => {
  it.each(["timeout", "overflow"] as const)(
    "terminates the real child process tree and settles with a fixed error on %s",
    async (mode) => {
      const root = await makeTemporaryRoot();
      const pidFile = join(root, "grandchild.pid");
      const fixture = join(process.cwd(), "tests", "server", "fixtures", "process-tree-child.mjs");
      const beforeResources = countTimeoutResources();

      const error = await captureError(runBoundedProcess(process.execPath, [fixture, mode, pidFile], {
        cwd: root,
        timeoutMs: mode === "timeout" ? 300 : 5_000,
        maxOutputBytes: mode === "overflow" ? 1_024 : 1024 * 1024,
      }));
      const descendantPid = Number((await readFile(pidFile, "utf8")).trim());

      expect(stringifyErrorChain(error)).toBe("Child process failed");
      await expectProcessToExit(descendantPid);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(countTimeoutResources()).toBeLessThanOrEqual(beforeResources);
    },
    15_000,
  );

  it.each(["timeout", "overflow"] as const)(
    "terminates descendants through a live supervisor after the command parent exits on %s",
    async (mode) => {
      const root = await makeTemporaryRoot();
      const pidFile = join(root, "orphan-grandchild.pid");
      const fixture = join(process.cwd(), "tests", "server", "fixtures", "process-tree-child.mjs");
      const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      expect(Number.isInteger(sentinel.pid) && sentinel.pid! > 0).toBe(true);
      const beforeResources = countTimeoutResources();
      const beforeProcessResources = countProcessResources();
      try {
        const error = await captureError(runBoundedProcess(
          process.execPath,
          [fixture, `parent-exit-${mode}`, pidFile],
          {
            cwd: root,
            timeoutMs: mode === "timeout" ? 300 : 5_000,
            maxOutputBytes: mode === "overflow" ? 1_024 : 1024 * 1024,
          },
        ));
        const descendantPid = Number((await readFile(pidFile, "utf8")).trim());
        const supervisorPid = Number((await readFile(`${pidFile}.supervisor`, "utf8")).trim());

        expect(stringifyErrorChain(error)).toBe("Child process failed");
        await expectProcessToExit(descendantPid);
        await expectProcessToExit(supervisorPid);
        expectProcessAlive(sentinel.pid!);
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(countTimeoutResources()).toBeLessThanOrEqual(beforeResources);
        expectProcessResourcesNotIncreased(beforeProcessResources);
      } finally {
        sentinel.kill("SIGKILL");
        await new Promise<void>((resolveClose) => sentinel.once("close", () => resolveClose()));
      }
    },
    15_000,
  );

  it("launches a harmless npm check script through Node 24 without a shell", async () => {
    const root = await makeTemporaryRoot();
    await writeFile(join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { check: "node -e \"process.stdout.write('npm-check-ok')\"" },
    }));
    const npmCliPath = resolveNpmCliPath(process.env);

    const result = await runNpmCheck(root, npmCliPath, runBoundedProcess);

    expect(result.stdout).toContain("npm-check-ok");
  }, 15_000);
});

function key(args: readonly string[]): string {
  return args.join("\u0000");
}

function toResult(value: string | Error): ProcessResult | Error {
  return value instanceof Error ? value : { stdout: value, stderr: "" };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function stringifyErrorChain(error: unknown): string {
  const messages: string[] = [];
  const visit = (value: unknown): void => {
    if (!(value instanceof Error)) return;
    messages.push(value.message);
    if (value instanceof AggregateError) value.errors.forEach(visit);
    visit(value.cause);
  };
  visit(error);
  return messages.join("\n");
}

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stsdle-release-test-"));
  temporaryRoots.push(root);
  return root;
}

async function createGitRepository(): Promise<string> {
  const root = await makeTemporaryRoot();
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Snapshot Test"]);
  await git(root, ["config", "user.email", "snapshot@example.invalid"]);
  await mkdir(join(root, "deploy", "snapshot-data"), { recursive: true });
  await writeFile(join(root, "deploy", "snapshot-data", "active.json"), "old snapshot\n");
  await writeFile(join(root, "unrelated.txt"), "old unrelated\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

async function privateIndexDirectories(repository: string): Promise<string[]> {
  return (await readdir(join(repository, ".git")))
    .filter((entry) => entry.startsWith("stsdle-snapshot-index-"));
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd, windowsHide: true });
  return result.stdout;
}

async function chmodExecutable(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const { chmod } = await import("node:fs/promises");
  await chmod(path, 0o755);
}

async function expectProcessToExit(pid: number): Promise<void> {
  expect(Number.isInteger(pid) && pid > 0).toBe(true);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Descendant process remained alive");
}

function countTimeoutResources(): number {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

function countProcessResources(): Record<string, number> {
  const tracked = new Set(["PipeWrap", "ProcessWrap", "Timeout"]);
  return process.getActiveResourcesInfo().reduce<Record<string, number>>((counts, name) => {
    if (tracked.has(name)) counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function expectProcessResourcesNotIncreased(before: Record<string, number>): void {
  const after = countProcessResources();
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    expect(after[name] ?? 0, `${name} resources`).toBeLessThanOrEqual(before[name] ?? 0);
  }
}

function expectProcessAlive(pid: number): void {
  expect(() => process.kill(pid, 0)).not.toThrow();
}
