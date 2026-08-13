import { describe, expect, it, vi } from "vitest";
import type { FetchedCards } from "../../src/server/spire-codex/client.js";
import type { ActiveSnapshot } from "../../src/server/sync/snapshot-store.js";
import type { PublishedBundle } from "../../src/server/release/deployment-bundle.js";
import {
  buildSnapshotBundle,
  createReleaseSnapshotDependencies,
  releaseSnapshot,
  SnapshotPushError,
  type ReleaseSnapshotDependencies,
  type SnapshotBuildDependencies,
  type TemporarySnapshotBundle,
} from "../../src/server/release/release-snapshot.js";
import type { ServerConfig } from "../../src/server/config.js";
import { resolveNpmCliPath } from "../../src/server/release/git-client.js";
import { GitClient, runBoundedProcess } from "../../src/server/release/git-client.js";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  parseReleaseOptions,
  runReleaseCli,
} from "../../src/server/release/cli.js";
import {
  resolveBuildOutput,
  runBuildCli,
} from "../../src/server/release/build-cli.js";

const CURRENT_REVISION = "a".repeat(64);
const NEXT_REVISION = "b".repeat(64);
const TEMP_ACTIVE: ActiveSnapshot = {
  buildId: `snapshot-${NEXT_REVISION}`,
  path: "C:\\temporary\\snapshot-data\\snapshots\\new-build",
};
const PUBLISHED_ACTIVE: ActiveSnapshot = {
  buildId: TEMP_ACTIVE.buildId,
  path: "C:\\repository\\deploy\\snapshot-data\\snapshots\\new-build",
};
const execFileAsync = promisify(execFile);

describe("releaseSnapshot", () => {
  it("runs the guarded release workflow in the required order", async () => {
    const harness = createReleaseHarness();

    const result = await releaseSnapshot({}, harness.dependencies);

    expect(result).toEqual({ status: "released", sourceRevision: NEXT_REVISION });
    expect(harness.events).toEqual([
      "git-ready", "fetch", "checks", "build-temp", "validate-temp",
      "publish", "validate-published", "scope-check", "commit", "push",
    ]);
    expect(harness.finalize).toHaveBeenCalledOnce();
    expect(harness.rollback).not.toHaveBeenCalled();
    expect(harness.cleanup).toHaveBeenCalledOnce();
  });

  it("returns unchanged immediately after readiness and the single fetch", async () => {
    const harness = createReleaseHarness({ committedRevision: NEXT_REVISION });

    const result = await releaseSnapshot({}, harness.dependencies);

    expect(result).toEqual({ status: "unchanged", sourceRevision: NEXT_REVISION });
    expect(harness.events).toEqual(["git-ready", "fetch"]);
    expect(harness.fetchCards).toHaveBeenCalledOnce();
  });

  it("force rebuilds an identical source revision", async () => {
    const harness = createReleaseHarness({ committedRevision: NEXT_REVISION });

    await expect(releaseSnapshot({ force: true }, harness.dependencies)).resolves.toEqual({
      status: "released",
      sourceRevision: NEXT_REVISION,
    });
    expect(harness.events).toContain("build-temp");
  });

  it("stops before generation when project checks fail", async () => {
    const harness = createReleaseHarness({ failAt: "checks" });

    await expect(releaseSnapshot({}, harness.dependencies)).rejects.toThrow("Card snapshot release failed");
    expect(harness.events).toEqual(["git-ready", "fetch", "checks"]);
  });

  it.each(["build-temp", "validate-temp"] as const)(
    "stops before publication when %s fails and awaits temporary cleanup when allocated",
    async (failAt) => {
      const harness = createReleaseHarness({ failAt });

      await expect(releaseSnapshot({}, harness.dependencies)).rejects.toThrow("Card snapshot release failed");

      expect(harness.events).not.toContain("publish");
      expect(harness.cleanupSettled).toBe(failAt === "validate-temp");
    },
  );

  it("awaits a failed publication's restoration and never commits", async () => {
    const harness = createReleaseHarness({ failAt: "publish" });

    await expect(releaseSnapshot({}, harness.dependencies)).rejects.toThrow("Card snapshot release failed");

    expect(harness.destination).toBe("head-snapshot");
    expect(harness.events).not.toContain("commit");
    expect(harness.publicationRestored).toBe(true);
    expect(harness.cleanupSettled).toBe(true);
  });

  it.each(["scope-check", "stage", "commit"] as const)(
    "rolls publication back and leaves the destination identical to HEAD when %s fails",
    async (failAt) => {
      const harness = createReleaseHarness({ failAt });

      await expect(releaseSnapshot({}, harness.dependencies)).rejects.toThrow("Card snapshot release failed");

      expect(harness.rollback).toHaveBeenCalledOnce();
      expect(harness.rollbackSettled).toBe(true);
      expect(harness.indexRollback).toHaveBeenCalledOnce();
      expect(harness.indexRollbackSettled).toBe(true);
      expect(harness.destination).toBe("head-snapshot");
      expect(harness.events).not.toContain("push");
    },
  );

  it("finalizes only after the verified commit and retains it when push fails", async () => {
    const harness = createReleaseHarness({ failAt: "push" });

    const error = await captureError(releaseSnapshot({}, harness.dependencies));

    expect(error).toBeInstanceOf(SnapshotPushError);
    expect(error).toMatchObject({ message: "Card snapshot was committed but could not be pushed" });
    expect(harness.commitCreated).toBe(true);
    expect(harness.finalize).toHaveBeenCalledOnce();
    expect(harness.finalizedBeforePush).toBe(true);
    expect(harness.rollback).not.toHaveBeenCalled();
    expect(harness.destination).toBe("new-snapshot");
    expect(harness.cleanupSettled).toBe(true);
  });

  it("passes the one fetched response to the builder instead of fetching cards again", async () => {
    const harness = createReleaseHarness();

    await releaseSnapshot({}, harness.dependencies);

    expect(harness.fetchCards).toHaveBeenCalledOnce();
    expect(harness.fetchedByBuilder).toBe(harness.fetched);
  });

  it("removes payloads, credentials, and absolute paths from the entire error chain", async () => {
    const secret = "ssh://fake-user:fake-password@github.com/private/repository.git";
    const fakeRoot = "C:\\private\\repository-root";
    const harness = createReleaseHarness({
      failAt: "validate-temp",
      failure: new AggregateError([new Error(secret), new Error(fakeRoot)], "raw payload failure"),
    });

    const error = await captureError(releaseSnapshot({}, harness.dependencies));
    const chain = stringifyErrorChain(error);

    expect(chain).toBe("Card snapshot release failed");
    expect(chain).not.toContain(secret);
    expect(chain).not.toContain(fakeRoot);
  });

  it("awaits index restoration even when publication rollback fails", async () => {
    const harness = createReleaseHarness({ failAt: "scope-check", failRollback: true });

    const error = await captureError(releaseSnapshot({}, harness.dependencies));

    expect(stringifyErrorChain(error)).toBe("Card snapshot release failed");
    expect(harness.indexRollback).toHaveBeenCalledOnce();
    expect(harness.indexRollbackSettled).toBe(true);
  });

  it("launches checks as Node plus the explicit npm CLI JavaScript path", async () => {
    const calls: Array<[string, readonly string[]]> = [];
    const npmCliPath = resolveNpmCliPath(process.env);
    const dependencies = createReleaseSnapshotDependencies({
      repositoryRoot: "C:\\repository",
      config: validConfig(),
      npmCliPath,
      runner: async (command, args) => {
        calls.push([command, args]);
        return { stdout: "", stderr: "" };
      },
    });

    await dependencies.runChecks();

    expect(calls).toEqual([[process.execPath, [npmCliPath, "run", "check"]]]);
  });

  it("restores a real repository publication and index together after commit failure", async () => {
    const repository = await createRealGitRepository();
    try {
      const realGit = new GitClient(repository, runBoundedProcess);
      const snapshot = join(repository, "deploy", "snapshot-data", "active.json");
      const dependencies: ReleaseSnapshotDependencies = {
        gitClient: {
          assertReady: async () => undefined,
          assertOnlySnapshotChanges: () => realGit.assertOnlySnapshotChanges(),
          rollbackSnapshotIndex: () => realGit.rollbackSnapshotIndex(),
          commitSnapshot: async () => { throw new Error("private commit failure"); },
          pushMain: () => realGit.pushMain(),
        },
        readCommittedRevision: async () => CURRENT_REVISION,
        fetchCards: async () => fetchedCards(),
        runChecks: async () => undefined,
        buildTemporarySnapshot: async () => ({
          active: TEMP_ACTIVE,
          dataDir: "temporary",
          cleanup: async () => undefined,
        }),
        validateTemporarySnapshot: async () => undefined,
        publishTemporarySnapshot: async () => {
          await writeFile(snapshot, "published snapshot\n");
          return {
            active: PUBLISHED_ACTIVE,
            finalize: async () => undefined,
            rollback: async () => { await writeFile(snapshot, "old snapshot\n"); },
          };
        },
        validatePublishedSnapshot: async () => undefined,
        outputDir: join(repository, "deploy", "snapshot-data"),
      };

      await expect(releaseSnapshot({}, dependencies)).rejects.toThrow("Card snapshot release failed");

      expect((await realGitCommand(repository, ["diff", "--cached", "--name-only"])).trim()).toBe("");
      expect((await realGitCommand(repository, ["diff", "--", "deploy/snapshot-data"])).trim()).toBe("");
      expect(await readFile(snapshot, "utf8")).toBe("old snapshot\n");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });
});

describe("buildSnapshotBundle", () => {
  it("builds, validates, publishes, finalizes, and cleans up without Git dependencies", async () => {
    const events: string[] = [];
    const finalize = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);
    const fetched = fetchedCards();
    const dependencies: SnapshotBuildDependencies = {
      fetchCards: async () => { events.push("fetch"); return fetched; },
      buildTemporarySnapshot: async (received) => {
        expect(received).toBe(fetched);
        events.push("build-temp");
        return { active: TEMP_ACTIVE, dataDir: "C:\\temporary\\snapshot-data", cleanup };
      },
      validateTemporarySnapshot: async () => { events.push("validate-temp"); },
      publishTemporarySnapshot: async (_temporary, outputDir) => {
        expect(outputDir).toBe("C:\\repository\\deploy\\snapshot-data");
        events.push("publish");
        return { active: PUBLISHED_ACTIVE, finalize, rollback };
      },
      validatePublishedSnapshot: async () => { events.push("validate-published"); },
    };

    const active = await buildSnapshotBundle({
      outputDir: "C:\\repository\\deploy\\snapshot-data",
      dependencies,
    });

    expect(active).toBe(PUBLISHED_ACTIVE);
    expect(events).toEqual(["fetch", "build-temp", "validate-temp", "publish", "validate-published"]);
    expect(finalize).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rolls a published build back and awaits cleanup when final validation fails", async () => {
    let destination = "head-snapshot";
    let cleanupSettled = false;
    const dependencies: SnapshotBuildDependencies = {
      fetchCards: async () => fetchedCards(),
      buildTemporarySnapshot: async () => ({
        active: TEMP_ACTIVE,
        dataDir: "C:\\temporary\\snapshot-data",
        cleanup: async () => { await Promise.resolve(); cleanupSettled = true; },
      }),
      validateTemporarySnapshot: async () => undefined,
      publishTemporarySnapshot: async () => {
        destination = "new-snapshot";
        return {
          active: PUBLISHED_ACTIVE,
          finalize: async () => undefined,
          rollback: async () => { await Promise.resolve(); destination = "head-snapshot"; },
        };
      },
      validatePublishedSnapshot: async () => { throw new Error("raw validation payload"); },
    };

    await expect(buildSnapshotBundle({ outputDir: "C:\\repository\\deploy\\snapshot-data", dependencies }))
      .rejects.toThrow("Card snapshot build failed");

    expect(destination).toBe("head-snapshot");
    expect(cleanupSettled).toBe(true);
  });

  it("still awaits temporary cleanup when rollback itself fails", async () => {
    let cleanupSettled = false;
    const dependencies: SnapshotBuildDependencies = {
      fetchCards: async () => fetchedCards(),
      buildTemporarySnapshot: async () => ({
        active: TEMP_ACTIVE,
        dataDir: "C:\\temporary\\snapshot-data",
        cleanup: async () => { await Promise.resolve(); cleanupSettled = true; },
      }),
      validateTemporarySnapshot: async () => undefined,
      publishTemporarySnapshot: async () => ({
        active: PUBLISHED_ACTIVE,
        finalize: async () => undefined,
        rollback: async () => { throw new Error("private rollback payload"); },
      }),
      validatePublishedSnapshot: async () => { throw new Error("private validation payload"); },
    };

    const error = await captureError(buildSnapshotBundle({
      outputDir: "C:\\repository\\deploy\\snapshot-data",
      dependencies,
    }));

    expect(stringifyErrorChain(error)).toBe("Card snapshot build failed");
    expect(cleanupSettled).toBe(true);
  });

  it("sanitizes failures while constructing default dependencies", async () => {
    const secret = "ssh://fake-user:fake-password@example.invalid/C:\\private\\token";
    const config = validConfig();
    Object.defineProperty(config, "spireCodexBaseUrl", {
      get() { throw new Error(secret); },
    });

    const error = await captureError(buildSnapshotBundle({
      outputDir: "C:\\repository\\deploy\\snapshot-data",
      config,
    }));

    expect(stringifyErrorChain(error)).toBe("Card snapshot build failed");
    expect(stringifyErrorChain(error)).not.toContain(secret);
  });
});

describe("snapshot release CLI", () => {
  it("accepts only zero arguments or one --force argument", () => {
    expect(parseReleaseOptions([])).toEqual({ force: false });
    expect(parseReleaseOptions(["--force"])).toEqual({ force: true });
    expect(() => parseReleaseOptions(["--force", "--force"]))
      .toThrow("Unknown snapshot release option");
    expect(() => parseReleaseOptions(["--output", "anything"]))
      .toThrow("Unknown snapshot release option");
  });

  it.each([
    ["unchanged", "Card snapshot is already current"],
    ["released", "Card snapshot committed and pushed to main"],
  ] as const)("prints the fixed %s success message", async (status, message) => {
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runReleaseCli([], {
      createDependencies: () => createReleaseHarness().dependencies,
      release: async () => ({ status, sourceRevision: NEXT_REVISION }),
      writeOutput: (line) => output.push(line),
      writeError: (line) => errors.push(line),
      repositoryRoot: "C:\\repository",
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([message]);
    expect(errors).toEqual([]);
  });

  it("prints only fixed failure and retry instructions after a committed push failure", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const secret = "ssh://fake-user:fake-password@github.com/private/repository.git";

    const exitCode = await runReleaseCli([], {
      createDependencies: () => createReleaseHarness().dependencies,
      release: async () => { throw new SnapshotPushError(); },
      writeOutput: (line) => output.push(line),
      writeError: (line) => errors.push(line),
      repositoryRoot: `C:\\private\\${secret}`,
    });

    expect(exitCode).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toEqual([
      "Card snapshot release failed",
      "Retry: git push origin HEAD:main",
    ]);
    expect(errors.join("\n")).not.toContain(secret);
  });

  it("rejects unknown arguments before constructing release dependencies", async () => {
    const createDependencies = vi.fn(() => createReleaseHarness().dependencies);
    const errors: string[] = [];

    const exitCode = await runReleaseCli(["--unknown"], {
      createDependencies,
      release: releaseSnapshot,
      writeOutput: () => undefined,
      writeError: (line) => errors.push(line),
      repositoryRoot: "C:\\repository",
    });

    expect(exitCode).toBe(1);
    expect(createDependencies).not.toHaveBeenCalled();
    expect(errors).toEqual(["Unknown snapshot release option", "Card snapshot release failed"]);
  });

  it("prints fixed output when default release CLI construction throws a secret", async () => {
    const secret = "ssh://fake-user:fake-password@example.invalid/C:\\private\\token";
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => { throw new Error(secret); });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await runReleaseCli([])).toBe(1);
      expect(stderr.mock.calls.flat().join("\n")).not.toContain(secret);
    } finally {
      cwd.mockRestore();
      stderr.mockRestore();
    }
  });
});

describe("snapshot build CLI", () => {
  it("requires one repository-relative --output path", () => {
    const root = "C:\\repository";

    expect(resolveBuildOutput(root, ["--output", "deploy/snapshot-data"]))
      .toBe("C:\\repository\\deploy\\snapshot-data");
    expect(() => resolveBuildOutput(root, [])).toThrow("Invalid snapshot build output");
    expect(() => resolveBuildOutput(root, ["--output", "C:\\outside"]))
      .toThrow("Invalid snapshot build output");
    expect(() => resolveBuildOutput(root, ["--output", "../outside"]))
      .toThrow("Invalid snapshot build output");
    expect(() => resolveBuildOutput(root, ["--output", "."]))
      .toThrow("Invalid snapshot build output");
  });

  it("invokes the build-only operation without accepting or constructing a Git dependency", async () => {
    const build = vi.fn(async () => PUBLISHED_ACTIVE);
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runBuildCli(["--output", "deploy/snapshot-data"], {
      build,
      repositoryRoot: "C:\\repository",
      writeOutput: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    });

    expect(exitCode).toBe(0);
    expect(build).toHaveBeenCalledWith({ outputDir: "C:\\repository\\deploy\\snapshot-data" });
    expect(output).toEqual(["Card snapshot bundle built"]);
    expect(errors).toEqual([]);
  });

  it("prints fixed output when default build CLI construction throws a secret", async () => {
    const secret = "ssh://fake-user:fake-password@example.invalid/C:\\private\\token";
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => { throw new Error(secret); });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await runBuildCli(["--output", "deploy/snapshot-data"])).toBe(1);
      expect(stderr.mock.calls.flat().join("\n")).not.toContain(secret);
    } finally {
      cwd.mockRestore();
      stderr.mockRestore();
    }
  });
});

interface HarnessOptions {
  committedRevision?: string | null;
  failAt?: string;
  failure?: Error;
  failRollback?: boolean;
}

function createReleaseHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const fetched = fetchedCards();
  let destination = "head-snapshot";
  let publicationRestored = false;
  let rollbackSettled = false;
  let indexRollbackSettled = false;
  let cleanupSettled = false;
  let commitCreated = false;
  let finalized = false;
  let finalizedBeforePush = false;
  let fetchedByBuilder: FetchedCards | undefined;
  const failure = options.failure ?? new Error(`private failure at C:\\secret\\${options.failAt}`);
  const fail = (point: string): void => {
    if (options.failAt === point) throw failure;
  };
  const cleanup = vi.fn(async () => {
    await Promise.resolve();
    cleanupSettled = true;
  });
  const rollback = vi.fn(async () => {
    await Promise.resolve();
    if (options.failRollback) throw failure;
    destination = "head-snapshot";
    rollbackSettled = true;
  });
  const indexRollback = vi.fn(async () => {
    await Promise.resolve();
    indexRollbackSettled = true;
  });
  const finalize = vi.fn(async () => {
    await Promise.resolve();
    finalized = true;
  });
  const fetchCards = vi.fn(async () => {
    events.push("fetch");
    return fetched;
  });
  const dependencies: ReleaseSnapshotDependencies = {
    gitClient: {
      assertReady: async () => { events.push("git-ready"); fail("git-ready"); },
      assertOnlySnapshotChanges: async () => {
        events.push("scope-check");
        if (options.failAt === "stage") throw failure;
        fail("scope-check");
      },
      commitSnapshot: async () => {
        events.push("commit");
        fail("commit");
        commitCreated = true;
      },
      rollbackSnapshotIndex: indexRollback,
      pushMain: async () => {
        events.push("push");
        finalizedBeforePush = finalized;
        fail("push");
      },
    },
    readCommittedRevision: async () => options.committedRevision ?? CURRENT_REVISION,
    fetchCards,
    runChecks: async () => { events.push("checks"); fail("checks"); },
    buildTemporarySnapshot: async (received) => {
      events.push("build-temp");
      fetchedByBuilder = received;
      fail("build-temp");
      return { active: TEMP_ACTIVE, dataDir: "C:\\temporary\\snapshot-data", cleanup };
    },
    validateTemporarySnapshot: async () => { events.push("validate-temp"); fail("validate-temp"); },
    publishTemporarySnapshot: async (): Promise<PublishedBundle> => {
      events.push("publish");
      destination = "new-snapshot";
      if (options.failAt === "publish") {
        await Promise.resolve();
        destination = "head-snapshot";
        publicationRestored = true;
        throw failure;
      }
      return { active: PUBLISHED_ACTIVE, finalize, rollback };
    },
    validatePublishedSnapshot: async () => {
      events.push("validate-published");
      fail("validate-published");
    },
  };

  return {
    dependencies,
    events,
    fetched,
    fetchCards,
    finalize,
    rollback,
    indexRollback,
    cleanup,
    get destination() { return destination; },
    get publicationRestored() { return publicationRestored; },
    get rollbackSettled() { return rollbackSettled; },
    get indexRollbackSettled() { return indexRollbackSettled; },
    get cleanupSettled() { return cleanupSettled; },
    get commitCreated() { return commitCreated; },
    get finalizedBeforePush() { return finalizedBeforePush; },
    get fetchedByBuilder() { return fetchedByBuilder; },
  };
}

function validConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    dataDir: "./var",
    spireCodexBaseUrl: "https://spire-codex.com",
    requestTimeoutMs: 30_000,
    artworkConcurrency: 1,
    artworkAllowedOrigins: ["https://spire-codex.com"],
    fullCardAllowedOrigins: ["https://spire-codex.com"],
    skipSync: false,
  };
}

async function createRealGitRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stsdle-release-orchestration-"));
  await realGitCommand(root, ["init"]);
  await realGitCommand(root, ["config", "user.name", "Snapshot Test"]);
  await realGitCommand(root, ["config", "user.email", "snapshot@example.invalid"]);
  await mkdir(join(root, "deploy", "snapshot-data"), { recursive: true });
  await writeFile(join(root, "deploy", "snapshot-data", "active.json"), "old snapshot\n");
  await realGitCommand(root, ["add", "-A"]);
  await realGitCommand(root, ["commit", "-m", "initial"]);
  return root;
}

async function realGitCommand(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd, windowsHide: true });
  return result.stdout;
}

function fetchedCards(): FetchedCards {
  return {
    cards: [],
    rawBody: "[]",
    sourceRevision: NEXT_REVISION,
    lastModified: null,
    fetchedAt: "2026-08-14T00:00:00.000Z",
  };
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
