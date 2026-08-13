import { describe, expect, it, vi } from "vitest";
import type { FetchedCards } from "../../src/server/spire-codex/client.js";
import type { ActiveSnapshot } from "../../src/server/sync/snapshot-store.js";
import type { PublishedBundle } from "../../src/server/release/deployment-bundle.js";
import {
  buildSnapshotBundle,
  releaseSnapshot,
  SnapshotPushError,
  type ReleaseSnapshotDependencies,
  type SnapshotBuildDependencies,
  type TemporarySnapshotBundle,
} from "../../src/server/release/release-snapshot.js";
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
});

interface HarnessOptions {
  committedRevision?: string | null;
  failAt?: string;
  failure?: Error;
}

function createReleaseHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const fetched = fetchedCards();
  let destination = "head-snapshot";
  let publicationRestored = false;
  let rollbackSettled = false;
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
    destination = "head-snapshot";
    rollbackSettled = true;
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
    cleanup,
    get destination() { return destination; },
    get publicationRestored() { return publicationRestored; },
    get rollbackSettled() { return rollbackSettled; },
    get cleanupSettled() { return cleanupSettled; },
    get commitCreated() { return commitCreated; },
    get finalizedBeforePush() { return finalizedBeforePush; },
    get fetchedByBuilder() { return fetchedByBuilder; },
  };
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
