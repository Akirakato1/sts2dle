import { execFile, spawn } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitClient,
  GitPushError,
  createBoundedProcessRunner,
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
    this.respond(["add", "-A", "--", "deploy/snapshot-data.tar.gz"], "");
    this.respond(["diff", "--cached", "--name-only"], "deploy/snapshot-data.tar.gz\n");
    this.respond(["rev-parse", "--git-dir"], `${REPOSITORY_ROOT}\\.git\n`);
    this.respond(["read-tree", "HEAD"], "");
    this.respond(["write-tree"], `${"c".repeat(40)}\n`);
    this.respond(["commit-tree", "c".repeat(40), "-p", "a".repeat(40), "-m", `chore: refresh card snapshot ${"b".repeat(12)}`], `${"d".repeat(40)}\n`);
    this.respond(["update-ref", "HEAD", "d".repeat(40), "a".repeat(40)], "");
    this.respond(["restore", "--staged", "--source=HEAD", "--", "deploy/snapshot-data.tar.gz"], "");
    this.respond(["reset", "HEAD", "--", "deploy/snapshot-data.tar.gz"], "");
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
    expect(runner.calls).toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data.tar.gz"]]);
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
    ["working tree", ["status", "--porcelain=v1", "--untracked-files=all"], " M deploy/snapshot-data.tar.gz\n?? README-private.md\n"],
    ["staging area", ["diff", "--cached", "--name-only"], "deploy/snapshot-data.tar.gz\nREADME.md\n"],
    ["working tree descendant", ["status", "--porcelain=v1", "--untracked-files=all"], " M deploy/snapshot-data.tar.gz/payload\n"],
    ["staging area descendant", ["diff", "--cached", "--name-only"], "deploy/snapshot-data.tar.gz/payload\n"],
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
      " M deploy/snapshot-data.tar.gz\n?? another-path.txt\n",
    );

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertOnlySnapshotChanges()).rejects.toThrow();
    expect(runner.calls).not.toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data.tar.gz"]]);
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
    await writeFile(join(repository, "deploy", "snapshot-data.tar.gz"), "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    await writeFile(join(repository, "unrelated.txt"), "concurrent staged content\n");
    await git(repository, ["add", "unrelated.txt"]);
    const hook = join(repository, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho hook-ran > malicious.txt\ngit add malicious.txt\n");
    await chmodExecutable(hook);

    await client.commitSnapshot("b".repeat(64));

    expect((await git(repository, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim())
      .toBe("deploy/snapshot-data.tar.gz");
    expect((await git(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("unrelated.txt");
    await expect(readFile(join(repository, "malicious.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(privateIndexes.length).toBeGreaterThan(0);
    expect(privateIndexes.every((path) => path.startsWith(join(repository, ".git")))).toBe(true);
  }, 15_000);

  it("restores the snapshot index and worktree to HEAD after a pre-commit failure", async () => {
    const repository = await createGitRepository();
    const client = new GitClient(repository, runBoundedProcess);
    const snapshot = join(repository, "deploy", "snapshot-data.tar.gz");
    await writeFile(snapshot, "published snapshot\n");
    await git(repository, ["add", "deploy/snapshot-data.tar.gz"]);
    await client.assertOnlySnapshotChanges();

    await writeFile(snapshot, "old snapshot\n");
    await client.rollbackSnapshotIndex();

    expect((await git(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("");
    expect((await git(repository, ["diff", "--", "deploy/snapshot-data.tar.gz"])).trim()).toBe("");
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
    await writeFile(join(repository, "deploy", "snapshot-data.tar.gz"), "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    await client.commitSnapshot("b".repeat(64));

    expect(removalAttempts).toBe(2);
    expect(await privateIndexDirectories(repository)).toEqual([]);
    expect((await git(repository, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim())
      .toBe("deploy/snapshot-data.tar.gz");
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
    await writeFile(join(repository, "deploy", "snapshot-data.tar.gz"), "new snapshot\n");
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

  it("durably publishes strict recovery metadata before installing the snapshot commit", async () => {
    const repository = await createGitRepository();
    await writeFile(join(repository, ".gitignore"), "deploy/.snapshot-data.tar.gz.backup-*\n");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, ["commit", "-m", "ignore owned recovery artifacts"]);
    const oldHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    const backupName = ".snapshot-data.tar.gz.backup-00000000-0000-4000-8000-000000000000";
    const outputDir = join(repository, "deploy", "snapshot-data.tar.gz");
    await writeFile(join(repository, "deploy", backupName), "backup snapshot\n");
    let markerAtRefUpdate: unknown;
    const observingRunner: ArgumentArrayRunner = async (command, args, options) => {
      if (args[0] === "update-ref") {
        markerAtRefUpdate = JSON.parse(await readFile(
          join(repository, ".git", "stsdle-snapshot-recovery.json"),
          "utf8",
        ));
      }
      return runBoundedProcess(command, args, options);
    };
    const client = new GitClient(repository, observingRunner);
    await writeFile(outputDir, "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    await client.commitSnapshot("b".repeat(64), { publicationBackupName: backupName, outputDir });

    const newHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    expect(markerAtRefUpdate).toMatchObject({
      version: 2,
      oldCommit: oldHead,
      newCommit: newHead,
      privateIndex: {
        name: expect.stringMatching(/^stsdle-snapshot-index-/),
        quarantineName: expect.stringMatching(/^stsdle-snapshot-recovery-quarantine-/),
      },
      publicationBackup: {
        name: backupName,
        quarantineName: expect.stringMatching(/^\.snapshot-data\.tar\.gz\.recovery-quarantine-/),
      },
    });
    expect(JSON.stringify(markerAtRefUpdate)).not.toContain(repository);
    expect(JSON.parse(await readFile(
      join(repository, ".git", "stsdle-snapshot-recovery.json"),
      "utf8",
    ))).toMatchObject({ privateIndex: null, publicationBackup: { name: backupName } });
  }, 20_000);

  it("does not move HEAD or overwrite recovery state when marker publication cannot begin", async () => {
    const repository = await createGitRepository();
    await writeFile(join(repository, ".gitignore"), "deploy/.snapshot-data.tar.gz.backup-*\n");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, ["commit", "-m", "ignore owned recovery artifacts"]);
    const oldHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    const backupName = ".snapshot-data.tar.gz.backup-00000000-0000-4000-8000-000000000000";
    const outputDir = join(repository, "deploy", "snapshot-data.tar.gz");
    await writeFile(join(repository, "deploy", backupName), "backup snapshot\n");
    const markerPath = join(repository, ".git", "stsdle-snapshot-recovery.json");
    const existingMarker = "unrelated recovery owner\n";
    await writeFile(markerPath, existingMarker, { flag: "wx" });
    const client = new GitClient(repository, runBoundedProcess);
    await writeFile(outputDir, "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    const error = await captureError(client.commitSnapshot("b".repeat(64), {
      publicationBackupName: backupName,
      outputDir,
    }));

    expect(stringifyErrorChain(error)).toBe("Unable to commit card snapshot");
    expect((await git(repository, ["rev-parse", "HEAD"])).trim()).toBe(oldHead);
    expect(await readFile(markerPath, "utf8")).toBe(existingMarker);
  }, 20_000);

  it("preserves a concurrent marker winner created after the absence check", async () => {
    const repository = await createGitRepository();
    await writeFile(join(repository, ".gitignore"), "deploy/.snapshot-data.tar.gz.backup-*\n");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, ["commit", "-m", "ignore owned recovery artifacts"]);
    const oldHead = (await git(repository, ["rev-parse", "HEAD"])).trim();
    const outputDir = join(repository, "deploy", "snapshot-data.tar.gz");
    const backupName = ".snapshot-data.tar.gz.backup-00000000-0000-4000-8000-000000000000";
    await writeFile(join(repository, "deploy", backupName), "backup snapshot\n");
    const markerPath = join(repository, ".git", "stsdle-snapshot-recovery.json");
    const winnerBytes = "concurrent recovery owner\n";
    let winnerIdentity: { dev: bigint; ino: bigint; birthtimeMs: number } | undefined;
    const client = new GitClient({
      repositoryRoot: repository,
      runner: runBoundedProcess,
      recoveryOperations: {
        beforeMarkerPublish: async (path) => {
          expect(path).toBe(markerPath);
          await writeFile(path, winnerBytes, { flag: "wx" });
          const stat = await lstat(path, { bigint: true });
          winnerIdentity = { dev: stat.dev, ino: stat.ino, birthtimeMs: Number(stat.birthtimeMs) };
        },
      },
    });
    await writeFile(outputDir, "new snapshot\n");
    await client.assertOnlySnapshotChanges();

    const error = await captureError(client.commitSnapshot("b".repeat(64), {
      publicationBackupName: backupName,
      outputDir,
    }));

    const surviving = await lstat(markerPath, { bigint: true });
    expect(stringifyErrorChain(error)).toBe("Unable to commit card snapshot");
    expect((await git(repository, ["rev-parse", "HEAD"])).trim()).toBe(oldHead);
    expect(await readFile(markerPath, "utf8")).toBe(winnerBytes);
    expect({ dev: surviving.dev, ino: surviving.ino, birthtimeMs: Number(surviving.birthtimeMs) })
      .toEqual(winnerIdentity);
    expect((await readdir(join(repository, ".git")))
      .filter((name) => name.startsWith(".stsdle-snapshot-recovery.json.tmp-"))).toEqual([]);
  }, 20_000);

  it("durably recovers an owned private index and publication backup before pushing", async () => {
    const repository = await createGitRepository();
    await writeFile(join(repository, ".gitignore"), "deploy/.snapshot-data.tar.gz.backup-*\n");
    await git(repository, ["add", ".gitignore"]);
    await git(repository, ["commit", "-m", "ignore owned recovery artifacts"]);
    const originMain = (await git(repository, ["rev-parse", "HEAD"])).trim();
    let removalBlocked = true;
    let clock = 0;
    let pushed = false;
    const runner: ArgumentArrayRunner = async (command, args, options) => {
      if (key(args) === key(["remote", "get-url", "origin"])) {
        return { stdout: `${EXPECTED_ORIGIN}\n`, stderr: "" };
      }
      if (key(args) === key(["fetch", "origin", "main"])) return { stdout: "", stderr: "" };
      if (key(args) === key(["rev-parse", "refs/remotes/origin/main"])) {
        return { stdout: `${originMain}\n`, stderr: "" };
      }
      if (key(args) === key(["push", "origin", "HEAD:main"])) {
        pushed = true;
        return { stdout: "", stderr: "" };
      }
      return runBoundedProcess(command, args, options);
    };
    const client = new GitClient({
      repositoryRoot: repository,
      runner,
      privateIndexOperations: {
        removeDirectory: async (path: string) => {
          if (removalBlocked) throw Object.assign(new Error(`secret ${path}`), { code: "EBUSY" });
          await rm(path, { recursive: true, force: true });
        },
        wait: async () => { clock += 100; },
        monotonicNow: () => clock,
      },
    });
    const backupName = ".snapshot-data.tar.gz.backup-00000000-0000-4000-8000-000000000000";
    const backupPath = join(repository, "deploy", backupName);
    await writeFile(backupPath, "backup snapshot\n");
    const outputDir = join(repository, "deploy", "snapshot-data.tar.gz");
    await writeFile(outputDir, "recovery snapshot\n");
    await client.assertOnlySnapshotChanges();
    await expect(client.commitSnapshot("b".repeat(64), { publicationBackupName: backupName, outputDir }))
      .rejects.toThrow("Card snapshot committed but private index cleanup failed");

    const markerPath = join(repository, ".git", "stsdle-snapshot-recovery.json");
    const marker = await readFile(markerPath, "utf8");
    expect(marker).not.toContain(repository);
    await expect(client.assertReady()).rejects.toThrow("Repository is not ready for snapshot release");

    removalBlocked = false;
    await client.recoverSnapshot(join(repository, "deploy", "snapshot-data.tar.gz"));

    expect(await privateIndexDirectories(repository)).toEqual([]);
    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(backupPath, "anything"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(pushed).toBe(true);
  }, 20_000);

  it("retries idempotently when push succeeds but recovery-marker unlink fails", async () => {
    const repository = await createGitRepository();
    const backupName = ".snapshot-data.tar.gz.backup-10000000-0000-4000-8000-000000000000";
    let originMain = await prepareRecoveryCommit(repository, backupName);
    let privateCleanupBlocked = true;
    let markerUnlinkBlocked = true;
    let pushes = 0;
    let clock = 0;
    const client = new GitClient({
      repositoryRoot: repository,
      runner: recoveryRunner(repository, () => originMain, async () => {
        pushes += 1;
        originMain = (await git(repository, ["rev-parse", "HEAD"])).trim();
      }),
      privateIndexOperations: {
        removeDirectory: async (path) => {
          if (privateCleanupBlocked) throw Object.assign(new Error("blocked"), { code: "EBUSY" });
          await rm(path, { recursive: true, force: true });
        },
        wait: async () => { clock += 100; },
        monotonicNow: () => clock,
      },
      recoveryOperations: {
        unlinkMarker: async (path) => {
          if (markerUnlinkBlocked) {
            markerUnlinkBlocked = false;
            throw Object.assign(new Error("blocked"), { code: "EBUSY" });
          }
          await unlink(path);
        },
      },
    });
    await stageRecoveryCommit(client, repository, backupName);
    privateCleanupBlocked = false;

    await expect(client.recoverSnapshot()).rejects.toThrow("Unable to recover card snapshot");

    const markerPath = join(repository, ".git", "stsdle-snapshot-recovery.json");
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toMatchObject({
      privateIndex: null,
      publicationBackup: null,
    });
    expect(pushes).toBe(1);
    await client.recoverSnapshot();
    expect(pushes).toBe(1);
    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("cleans all owned local artifacts before reporting unrelated remote advancement", async () => {
    const repository = await createGitRepository();
    const backupName = ".snapshot-data.tar.gz.backup-20000000-0000-4000-8000-000000000000";
    await prepareRecoveryCommit(repository, backupName);
    let privateCleanupBlocked = true;
    let clock = 0;
    let pushed = false;
    const client = new GitClient({
      repositoryRoot: repository,
      runner: recoveryRunner(repository, () => "e".repeat(40), async () => { pushed = true; }),
      privateIndexOperations: {
        removeDirectory: async (path) => {
          if (privateCleanupBlocked) throw Object.assign(new Error("blocked"), { code: "EBUSY" });
          await rm(path, { recursive: true, force: true });
        },
        wait: async () => { clock += 100; },
        monotonicNow: () => clock,
      },
    });
    await stageRecoveryCommit(client, repository, backupName);
    privateCleanupBlocked = false;

    await expect(client.recoverSnapshot()).rejects.toThrow("Unable to recover card snapshot");

    expect(await privateIndexDirectories(repository)).toEqual([]);
    await expect(readFile(join(repository, "deploy", backupName, "sentinel"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(
      join(repository, ".git", "stsdle-snapshot-recovery.json"),
      "utf8",
    ))).toMatchObject({ privateIndex: null, publicationBackup: null });
    expect(pushed).toBe(false);
  }, 30_000);

  it("fails closed without moving a replacement that appears before quarantine", async () => {
    const repository = await createGitRepository();
    const backupName = ".snapshot-data.tar.gz.backup-30000000-0000-4000-8000-000000000000";
    const originMain = await prepareRecoveryCommit(repository, backupName);
    const external = await makeTemporaryRoot();
    const externalSentinel = join(external, "external-sentinel.txt");
    await writeFile(externalSentinel, "external data\n");
    const backupPath = join(repository, "deploy", backupName);
    const preservedPath = `${backupPath}-preserved`;
    let replaced = false;
    const client = new GitClient({
      repositoryRoot: repository,
      runner: recoveryRunner(repository, () => originMain, async () => undefined),
      recoveryOperations: {
        beforeQuarantine: async (path) => {
          if (replaced || path !== backupPath) return;
          replaced = true;
          await rename(backupPath, preservedPath);
          await symlink(externalSentinel, backupPath, "file");
        },
      },
    });
    await stageRecoveryCommit(client, repository, backupName, false);

    await expect(client.recoverSnapshot()).rejects.toThrow("Unable to recover card snapshot");

    expect(await readFile(externalSentinel, "utf8")).toBe("external data\n");
    expect(await readFile(preservedPath, "utf8")).toBe("backup snapshot\n");
    expect(await readFile(backupPath, "utf8")).toBe("external data\n");
  }, 30_000);

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
  it.runIf(process.platform === "win32")(
    "refuses to launch when the exact System32 taskkill executable is unavailable",
    async () => {
      const fakeWindowsRoot = await makeTemporaryRoot();
      const originalSystemRoot = process.env.SystemRoot;
      process.env.SystemRoot = fakeWindowsRoot;
      try {
        expect(() => createBoundedProcessRunner()).toThrow("Child process failed");
      } finally {
        if (originalSystemRoot === undefined) delete process.env.SystemRoot;
        else process.env.SystemRoot = originalSystemRoot;
      }
    },
  );

  it("rejects a supervisor that exits successfully without an authenticated result", async () => {
    const root = await makeTemporaryRoot();
    const supervisorPath = join(
      process.cwd(),
      "tests", "server", "fixtures", "supervisor-exit-no-result.mjs",
    );
    const runner = createBoundedProcessRunner({ supervisorPath });

    const error = await captureError(runner(process.execPath, ["-e", "process.exit(0)"], {
      cwd: root,
      timeoutMs: 500,
    }));

    expect(stringifyErrorChain(error)).toBe("Child process failed");
  }, 5_000);

  it("bounds a stubborn taskkill dependency and lets the supervisor terminate its owned tree", async () => {
    const root = await makeTemporaryRoot();
    const pidFile = join(root, "stubborn-taskkill-grandchild.pid");
    const fixture = join(process.cwd(), "tests", "server", "fixtures", "process-tree-child.mjs");
    const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const beforeResources = countProcessResources();
    const runner = createBoundedProcessRunner({
      terminationTimeoutMs: 300,
      taskkill: async () => new Promise<boolean>(() => undefined),
    });
    try {
      const started = performance.now();
      const error = await captureError(runner(process.execPath, [fixture, "timeout", pidFile], {
        cwd: root,
        timeoutMs: 100,
      }));
      const elapsed = performance.now() - started;
      const descendantPid = Number((await readFile(pidFile, "utf8")).trim());
      const supervisorPid = Number((await readFile(`${pidFile}.supervisor`, "utf8")).trim());

      expect(stringifyErrorChain(error)).toBe("Child process failed");
      expect(elapsed).toBeLessThan(2_000);
      await expectProcessToExit(descendantPid);
      await expectProcessToExit(supervisorPid);
      expectProcessAlive(sentinel.pid!);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expectProcessResourcesNotIncreased(beforeResources);
    } finally {
      sentinel.kill("SIGKILL");
      await new Promise<void>((resolveClose) => sentinel.once("close", () => resolveClose()));
    }
  }, 5_000);

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
  await mkdir(join(root, "deploy"), { recursive: true });
  await writeFile(join(root, "deploy", "snapshot-data.tar.gz"), "old snapshot\n");
  await writeFile(join(root, "unrelated.txt"), "old unrelated\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

async function prepareRecoveryCommit(repository: string, backupName: string): Promise<string> {
  void backupName;
  await writeFile(join(repository, ".gitignore"), "deploy/.snapshot-data.tar.gz.backup-*\n");
  await git(repository, ["add", ".gitignore"]);
  await git(repository, ["commit", "-m", "ignore owned recovery artifacts"]);
  return (await git(repository, ["rev-parse", "HEAD"])).trim();
}

async function stageRecoveryCommit(
  client: GitClient,
  repository: string,
  backupName: string,
  expectPrivateCleanupFailure = true,
): Promise<void> {
  const outputDir = join(repository, "deploy", "snapshot-data.tar.gz");
  const backupPath = join(repository, "deploy", backupName);
  await writeFile(backupPath, "backup snapshot\n");
  await writeFile(outputDir, "recovery snapshot\n");
  await client.assertOnlySnapshotChanges();
  const commit = client.commitSnapshot("b".repeat(64), { publicationBackupName: backupName, outputDir });
  if (expectPrivateCleanupFailure) {
    await expect(commit).rejects.toThrow("Card snapshot committed but private index cleanup failed");
  } else {
    await commit;
  }
}

function recoveryRunner(
  repository: string,
  originMain: () => string,
  push: () => Promise<void>,
): ArgumentArrayRunner {
  return async (command, args, options) => {
    if (key(args) === key(["remote", "get-url", "origin"])) {
      return { stdout: `${EXPECTED_ORIGIN}\n`, stderr: "" };
    }
    if (key(args) === key(["fetch", "origin", "main"])) return { stdout: "", stderr: "" };
    if (key(args) === key(["rev-parse", "refs/remotes/origin/main"])) {
      return { stdout: `${originMain()}\n`, stderr: "" };
    }
    if (key(args) === key(["push", "origin", "HEAD:main"])) {
      await push();
      return { stdout: "", stderr: "" };
    }
    return runBoundedProcess(command, args, { ...options, cwd: repository });
  };
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
