import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import fixture from "../fixtures/spire-cards.json";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";
import { buildSnapshot, type ActivatedSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";
import { validateSnapshot } from "../../src/server/sync/validate-snapshot.js";
import {
  withE2eFixtureDataLock,
  type FixtureDataLockOperations,
} from "../e2e/fixtures/fixture-data-lock.js";
import { pruneSupersededFixtureSnapshots } from "../e2e/fixtures/prune-test-snapshots.js";

const temporaryDirectories: string[] = [];
interface TrackedChild {
  process: ChildProcess;
  closed: boolean;
  closeResult: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const childProcesses: TrackedChild[] = [];
const VALIDATION_OPTIONS = {
  allowedArtworkOrigins: ["https://spire-codex.test"],
  allowedFullCardOrigins: ["https://cdn.test"],
} as const;

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (!child.closed && child.process.exitCode === null && child.process.signalCode === null) {
      child.process.kill();
    }
    await waitForChildClose(child, 5_000);
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

async function temporaryDirectory(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), name));
  temporaryDirectories.push(directory);
  return directory;
}

async function snapshot(root: string, buildId: string): Promise<string> {
  const directory = join(root, "snapshots", buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    sourceRevision: buildId.split("-")[0],
  }));
  return directory;
}

async function validSnapshot(dataDir: string, sourceRevision: string): Promise<ActivatedSnapshot> {
  const artwork = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "orange" },
  }).webp().toBuffer();
  const fallback = await sharp({
    create: { width: 400, height: 520, channels: 3, background: "orange" },
  }).webp().toBuffer();

  return buildSnapshot({
    client: {
      async fetchCards() {
        return {
          cards: fixture as RawSpireCard[],
          rawBody: JSON.stringify(fixture),
          sourceRevision,
          lastModified: null,
          fetchedAt: "2026-08-12T00:00:00.000Z",
        };
      },
    },
    store: new SnapshotStore(dataDir),
    baseUrl: "https://spire-codex.test",
    fetchImpl: async () => new Response(new Uint8Array(artwork)),
    fallbackRenderer: {
      async render(_raw, _upgraded, destination) {
        await writeFile(destination, fallback);
      },
    },
    artworkConcurrency: 2,
    ...VALIDATION_OPTIONS,
    now: () => new Date("2026-08-12T00:00:01.000Z"),
  });
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function owner(token: string): string {
  return `${JSON.stringify({ token, processId: 999, acquiredAt: "2026-08-12T00:00:00.000Z" })}\n`;
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function recursivelyDisplayedText(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || seen.has(value)) return "";
  seen.add(value);
  return Object.getOwnPropertyNames(value)
    .map((key) => recursivelyDisplayedText((value as Record<string, unknown>)[key], seen))
    .join("\n");
}

async function expectSanitizedFailure(
  promise: Promise<unknown>,
  secretPath: string,
  secretToken: string,
): Promise<void> {
  const error = await rejected(promise);
  const displayed = recursivelyDisplayedText(error);
  expect(displayed).not.toContain(secretPath);
  expect(displayed).not.toContain(secretToken);
  expect(displayed).not.toContain("injected filesystem secret");
}

async function waitForChildSignal(
  child: ChildProcess,
  signal: string,
  timeoutMs = 10_000,
): Promise<void> {
  let output = "";
  const stdout = child.stdout;
  if (!stdout) throw new Error("Lock worker stdout is unavailable");
  await new Promise<void>((complete, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const succeed = () => {
      cleanup();
      complete();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(signal)) succeed();
    };
    const onError = () => fail(new Error("Lock worker process failed before signal"));
    const onClose = (code: number | null) => {
      fail(new Error(`Lock worker closed before signal (${code})`));
    };
    const timeout = setTimeout(() => {
      fail(new Error("Timed out waiting for lock worker signal"));
    }, timeoutMs);
    stdout.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function trackChild(child: ChildProcess): TrackedChild {
  const tracked = {
    process: child,
    closed: false,
    closeResult: undefined as unknown as TrackedChild["closeResult"],
  };
  const onError = () => undefined;
  child.once("error", onError);
  tracked.closeResult = new Promise((complete) => {
    child.once("close", (code, signal) => {
      tracked.closed = true;
      child.off("error", onError);
      complete({ code, signal });
    });
  });
  childProcesses.push(tracked);
  return tracked;
}

async function waitForChildClose(
  child: TrackedChild,
  timeoutMs = 10_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((complete, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for child close"));
    }, timeoutMs);
    void child.closeResult.then((result) => {
      clearTimeout(timeout);
      complete(result);
    });
  });
}

describe("pruneSupersededFixtureSnapshots", () => {
  it("keeps only the active validated E2E snapshot while preserving unrelated paths", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-prune-");
    const unrelatedRoot = await temporaryDirectory("stsdle-e2e-unrelated-");
    const obsoleteOne = await validSnapshot(dataDir, "obsoleteone");
    const obsoleteTwo = await validSnapshot(dataDir, "obsoletetwo");
    const hashMismatch = await validSnapshot(dataDir, "hashmismatch");
    await writeFile(join(hashMismatch.path, "cards.json"), "[]\n");
    const active = await validSnapshot(dataDir, "activefixture");
    await mkdir(join(dataDir, "snapshots", "notes"));
    await snapshot(dataDir, "notasnapshot-400");
    await mkdir(join(dataDir, "snapshots", "corruptsnap1-500"));
    await writeFile(join(dataDir, "snapshots", "corruptsnap1-500", "manifest.json"), "{");
    await writeFile(join(unrelatedRoot, "keep.txt"), "keep");

    await pruneSupersededFixtureSnapshots(dataDir, active, VALIDATION_OPTIONS);

    expect((await readdir(join(dataDir, "snapshots"))).sort()).toEqual([
      active.buildId,
      hashMismatch.buildId,
      "corruptsnap1-500",
      "notasnapshot-400",
      "notes",
    ].sort());
    expect(obsoleteOne.buildId).not.toBe(obsoleteTwo.buildId);
    expect(await readFile(join(unrelatedRoot, "keep.txt"), "utf8")).toBe("keep");
  });

  it("rejects an active path outside the configured snapshots directory before deleting anything", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-escape-");
    const unrelatedRoot = await temporaryDirectory("stsdle-e2e-outside-");
    const supersededPath = await snapshot(dataDir, "fixtureabc12-100");
    await writeFile(join(unrelatedRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      sourceRevision: "outside",
    }));

    await expect(pruneSupersededFixtureSnapshots(dataDir, {
      buildId: "outsidebuild-300",
      path: unrelatedRoot,
    }, VALIDATION_OPTIONS)).rejects.toThrow(/escapes the configured E2E snapshots directory/i);

    expect(await readdir(supersededPath)).toContain("manifest.json");
    expect(await readdir(unrelatedRoot)).toContain("manifest.json");
  });
});

describe("withE2eFixtureDataLock", () => {
  it("serializes two complete fixture build sequences without deleting the active snapshot", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-concurrent-");
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];

    const first = withE2eFixtureDataLock(dataDir, async (lockedDataDir) => {
      order.push("first:start");
      const active = await validSnapshot(lockedDataDir, "firstfixture");
      firstEntered.resolve();
      await releaseFirst.promise;
      await pruneSupersededFixtureSnapshots(lockedDataDir, active, VALIDATION_OPTIONS);
      order.push("first:end");
      return active;
    });
    await firstEntered.promise;

    const second = withE2eFixtureDataLock(dataDir, async (lockedDataDir) => {
      order.push("second:start");
      const active = await validSnapshot(lockedDataDir, "secondfixtur");
      await pruneSupersededFixtureSnapshots(lockedDataDir, active, VALIDATION_OPTIONS);
      order.push("second:end");
      return active;
    });
    await delay(30);
    expect(order).toEqual(["first:start"]);
    releaseFirst.resolve();

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(firstSnapshot.buildId).not.toBe(secondSnapshot.buildId);

    const pointer = JSON.parse(await readFile(join(dataDir, "active.json"), "utf8")) as { buildId: string };
    const snapshotDirectories = await readdir(join(dataDir, "snapshots"));
    expect(pointer.buildId).toBe(secondSnapshot.buildId);
    expect(snapshotDirectories).toEqual([secondSnapshot.buildId]);
    await expect(validateSnapshot(secondSnapshot.path, VALIDATION_OPTIONS)).resolves.toMatchObject({
      cardCount: 6,
    });
  });

  it("releases lock ownership when the critical section throws", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-error-");

    await expect(withE2eFixtureDataLock(dataDir, async () => {
      throw new Error("fixture build failed");
    })).rejects.toThrow("fixture build failed");

    let entered = false;
    await withE2eFixtureDataLock(dataDir, async () => { entered = true; });
    expect(entered).toBe(true);
    expect(await readdir(dataDir)).not.toContain(".stsdle-e2e-fixture.lock");
  });

  it("times out without entering or reclaiming a held critical section", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-timeout-");
    const holderEntered = deferred();
    const releaseHolder = deferred();
    const holder = withE2eFixtureDataLock(dataDir, async () => {
      holderEntered.resolve();
      await releaseHolder.promise;
    });
    await holderEntered.promise;

    let contenderEntered = false;
    await expect(withE2eFixtureDataLock(dataDir, async () => {
      contenderEntered = true;
    }, { retryDelayMs: 5, timeoutMs: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for E2E fixture data lock",
    );
    expect(contenderEntered).toBe(false);
    expect(await readdir(dataDir)).toContain(".stsdle-e2e-fixture.lock");

    releaseHolder.resolve();
    await holder;
    expect(await readdir(dataDir)).not.toContain(".stsdle-e2e-fixture.lock");
  });

  it("does not acquire after a monotonic deadline when the holder releases before the next attempt", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-boundary-");
    const lockPath = join(dataDir, ".stsdle-e2e-fixture.lock");
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), owner("holder-token"));
    let monotonicTime = 0;
    let entered = false;
    let waitCalls = 0;

    await expect(withE2eFixtureDataLock(dataDir, async () => {
      entered = true;
    }, {
      retryDelayMs: 30,
      timeoutMs: 30,
      operations: {
        monotonicNow: () => monotonicTime,
        wait: async () => {
          waitCalls += 1;
          monotonicTime = 31;
          await rm(lockPath, { force: true, recursive: true });
        },
      },
    })).rejects.toThrow("Timed out after 30ms waiting for E2E fixture data lock");

    expect(waitCalls).toBe(1);
    expect(entered).toBe(false);
    expect(await readdir(dataDir)).not.toContain(".stsdle-e2e-fixture.lock");
  });

  it("releases a slow successful acquisition without entering after its monotonic deadline", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-slow-acquire-");
    let monotonicTime = 0;
    let entered = false;

    await expect(withE2eFixtureDataLock(dataDir, async () => {
      entered = true;
    }, {
      timeoutMs: 30,
      operations: {
        monotonicNow: () => monotonicTime,
        acquireDirectory: async (path) => {
          await mkdir(path);
          monotonicTime = 31;
        },
      },
    })).rejects.toThrow("Timed out after 30ms waiting for E2E fixture data lock");

    expect(entered).toBe(false);
    expect(await readdir(dataDir)).not.toContain(".stsdle-e2e-fixture.lock");
  });

  it("preserves a foreign replacement when initialization fails", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-init-foreign-");
    const lockPath = join(dataDir, ".stsdle-e2e-fixture.lock");
    const secretToken = "secret-owner-token";
    const foreignToken = "foreign-owner-token";

    await expectSanitizedFailure(withE2eFixtureDataLock(dataDir, async () => undefined, {
      operations: {
        createToken: () => secretToken,
        writeOwner: async () => {
          await rm(lockPath, { force: true, recursive: true });
          await mkdir(lockPath);
          await writeFile(join(lockPath, "owner.json"), owner(foreignToken));
          throw new Error(`injected filesystem secret ${dataDir} ${secretToken}`);
        },
      },
    }), dataDir, secretToken);

    expect(await readFile(join(lockPath, "owner.json"), "utf8")).toBe(owner(foreignToken));
  });

  it("preserves a mismatched quarantine and creates an unowned no-clobber sentinel", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-owner-mismatch-");
    const lockPath = join(dataDir, ".stsdle-e2e-fixture.lock");
    const secretToken = "secret-owner-token";
    const foreignToken = "foreign-owner-token";

    await expectSanitizedFailure(withE2eFixtureDataLock(dataDir, async () => {
      await rm(lockPath, { force: true, recursive: true });
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner.json"), owner(foreignToken));
    }, { operations: { createToken: () => secretToken } }), dataDir, secretToken);

    const artifacts = await readdir(dataDir);
    const quarantines = artifacts.filter((name) => name.startsWith(".stsdle-e2e-fixture.release-"));
    expect(quarantines).toHaveLength(1);
    expect(await readdir(lockPath)).toEqual([]);
    expect(await readFile(join(dataDir, quarantines[0]!, "owner.json"), "utf8")).toBe(
      owner(foreignToken),
    );
    await rm(lockPath, { force: true, recursive: true });
    let laterEntered = false;
    await expect(withE2eFixtureDataLock(dataDir, async () => {
      laterEntered = true;
    }, { retryDelayMs: 5, timeoutMs: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for E2E fixture data lock",
    );
    expect(laterEntered).toBe(false);
  });

  it("never rename-clobbers a successor while preserving a mismatched quarantine", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-posix-successor-");
    const lockPath = join(dataDir, ".stsdle-e2e-fixture.lock");
    const secretToken = "secret-owner-token";
    const foreignToken = "foreign-owner-token";
    const successorToken = "successor-owner-token";
    let successorCreated = false;
    let renameCalls = 0;
    let preserveMkdirCalls = 0;

    await expectSanitizedFailure(withE2eFixtureDataLock(dataDir, async () => {
      await rm(lockPath, { force: true, recursive: true });
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner.json"), owner(foreignToken));
    }, {
      operations: {
        createToken: () => secretToken,
        renamePath: async (from, to) => {
          renameCalls += 1;
          if (renameCalls > 1) {
            // Model POSIX rename semantics: an empty destination directory can be replaced.
            expect(await readdir(to)).toEqual([]);
            await rm(to, { force: true, recursive: true });
          }
          await rename(from, to);
        },
        readOwner: async (path) => {
          const body = await readFile(path, "utf8");
          if (!successorCreated) {
            successorCreated = true;
            await mkdir(lockPath);
          }
          return body;
        },
        createUnownedDirectory: async (path) => {
          preserveMkdirCalls += 1;
          expect(await readdir(path)).toEqual([]);
          await writeFile(join(path, "owner.json"), owner(successorToken));
          const alreadyExists = new Error("successor already exists") as NodeJS.ErrnoException;
          alreadyExists.code = "EEXIST";
          throw alreadyExists;
        },
      },
    }), dataDir, secretToken);

    const quarantines = (await readdir(dataDir)).filter((name) => (
      name.startsWith(".stsdle-e2e-fixture.release-")
    ));
    expect(renameCalls).toBe(1);
    expect(preserveMkdirCalls).toBe(1);
    expect(await readFile(join(lockPath, "owner.json"), "utf8")).toBe(owner(successorToken));
    expect(quarantines).toHaveLength(1);
    expect(await readFile(join(dataDir, quarantines[0]!, "owner.json"), "utf8")).toBe(
      owner(foreignToken),
    );
    const successorRelease = join(
      dataDir,
      ".stsdle-e2e-fixture.release-successor-completion",
    );
    await rename(lockPath, successorRelease);
    expect(await readFile(join(successorRelease, "owner.json"), "utf8")).toBe(
      owner(successorToken),
    );
    await rm(successorRelease, { force: true, recursive: true });
    let laterEntered = false;
    await expect(withE2eFixtureDataLock(dataDir, async () => {
      laterEntered = true;
    }, { retryDelayMs: 5, timeoutMs: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for E2E fixture data lock",
    );
    expect(laterEntered).toBe(false);
  });

  it("never deletes a successor that acquires after quarantine rename", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-successor-");
    const lockPath = join(dataDir, ".stsdle-e2e-fixture.lock");
    const successorToken = "successor-owner-token";
    let replacementCreated = false;

    await withE2eFixtureDataLock(dataDir, async () => undefined, {
      operations: {
        readOwner: async (path) => {
          const body = await readFile(path, "utf8");
          if (!replacementCreated) {
            replacementCreated = true;
            await rm(lockPath, { force: true, recursive: true });
            await mkdir(lockPath);
            await writeFile(join(lockPath, "owner.json"), owner(successorToken));
          }
          return body;
        },
      },
    });

    expect(await readFile(join(lockPath, "owner.json"), "utf8")).toBe(owner(successorToken));
  });

  it("sanitizes unexpected failures from every filesystem operation class", async () => {
    const secretToken = "secret-owner-token";
    const injected = (dataDir: string) => new Error(
      `injected filesystem secret ${dataDir} ${secretToken}`,
    );
    const cases: Array<{
      name: string;
      prepare?(dataDir: string): Promise<void>;
      operations(dataDir: string): Partial<FixtureDataLockOperations>;
    }> = [
      { name: "mkdir", operations: (path) => ({ ensureDirectory: async () => { throw injected(path); } }) },
      { name: "realpath", operations: (path) => ({ resolvePath: async () => { throw injected(path); } }) },
      { name: "acquire", operations: (path) => ({ acquireDirectory: async () => { throw injected(path); } }) },
      { name: "write", operations: (path) => ({ writeOwner: async () => { throw injected(path); } }) },
      { name: "read", operations: (path) => ({ readOwner: async () => { throw injected(path); } }) },
      { name: "inspect", operations: (path) => ({ listDirectory: async () => { throw injected(path); } }) },
      { name: "rename", operations: (path) => ({ renamePath: async () => { throw injected(path); } }) },
      { name: "remove", operations: (path) => ({ removeOwnedDirectory: async () => { throw injected(path); } }) },
      {
        name: "wait",
        prepare: async (path) => { await mkdir(join(path, ".stsdle-e2e-fixture.lock")); },
        operations: (path) => ({ wait: async () => { throw injected(path); } }),
      },
    ];

    for (const failureCase of cases) {
      const dataDir = await temporaryDirectory(`stsdle-e2e-lock-${failureCase.name}-`);
      await failureCase.prepare?.(dataDir);
      await expectSanitizedFailure(withE2eFixtureDataLock(dataDir, async () => undefined, {
        operations: {
          createToken: () => secretToken,
          ...failureCase.operations(dataDir),
        },
        timeoutMs: 30,
      }), dataDir, secretToken);
    }
  });

  it("sanitizes no-clobber sentinel mkdir failure while retaining quarantine", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-preserve-error-");
    const lockPath = join(dataDir, ".stsdle-e2e-fixture.lock");
    const secretToken = "secret-owner-token";
    const foreignToken = "foreign-owner-token";

    await expectSanitizedFailure(withE2eFixtureDataLock(dataDir, async () => {
      await rm(lockPath, { force: true, recursive: true });
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner.json"), owner(foreignToken));
    }, {
      operations: {
        createToken: () => secretToken,
        createUnownedDirectory: async () => {
          throw new Error(`injected filesystem secret ${dataDir} ${secretToken}`);
        },
      },
    }), dataDir, secretToken);

    const quarantines = (await readdir(dataDir)).filter((name) => (
      name.startsWith(".stsdle-e2e-fixture.release-")
    ));
    expect(quarantines).toHaveLength(1);
    expect(await readFile(join(dataDir, quarantines[0]!, "owner.json"), "utf8")).toBe(
      owner(foreignToken),
    );
  });

  it("coordinates with a real child-process lock holder", async () => {
    const dataDir = await temporaryDirectory("stsdle-e2e-lock-child-");
    const releaseSignal = join(await temporaryDirectory("stsdle-e2e-lock-control-"), "release");
    const workerPath = resolve("tests/e2e/fixtures/fixture-lock-worker.ts");
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, dataDir, releaseSignal], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const tracked = trackChild(child);
    await waitForChildSignal(child, "LOCK_ACQUIRED\n");

    let contenderEntered = false;
    await expect(withE2eFixtureDataLock(dataDir, async () => {
      contenderEntered = true;
    }, { retryDelayMs: 5, timeoutMs: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for E2E fixture data lock",
    );
    expect(contenderEntered).toBe(false);

    await writeFile(releaseSignal, "release");
    const closeResult = await waitForChildClose(tracked);
    expect(closeResult).toEqual({ code: 0, signal: null });
    expect(child.stdout?.listenerCount("data")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("close")).toBe(0);
    let nextEntered = false;
    await withE2eFixtureDataLock(dataDir, async () => { nextEntered = true; });
    expect(nextEntered).toBe(true);
  });

  it("keeps build-script stderr fixed when lock setup fails", async () => {
    const root = await temporaryDirectory("stsdle-e2e-build-stderr-");
    const secretDataPath = join(root, "secret-data-file");
    await writeFile(secretDataPath, "not a directory");
    const scriptPath = resolve("tests/e2e/fixtures/build-test-snapshot.ts");
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, STSDLE_DATA_DIR: secretDataPath },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const tracked = trackChild(child);
    let stderr = "";
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString("utf8"); };
    child.stderr?.on("data", onStderr);
    const closeResult = await waitForChildClose(tracked);
    child.stderr?.off("data", onStderr);

    expect(closeResult).toEqual({ code: 1, signal: null });
    expect(stderr).toBe("E2E fixture snapshot build failed\n");
    expect(stderr).not.toContain(secretDataPath);
    expect(child.stderr?.listenerCount("data")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("close")).toBe(0);
  });

  it("cleans signal-wait listeners on timeout and fully closes a killed child", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const tracked = trackChild(child);
    const baseline = {
      data: child.stdout?.listenerCount("data"),
      error: child.listenerCount("error"),
      exit: child.listenerCount("exit"),
      close: child.listenerCount("close"),
    };

    await expect(waitForChildSignal(child, "NEVER", 30)).rejects.toThrow(
      "Timed out waiting for lock worker signal",
    );
    expect(child.stdout?.listenerCount("data")).toBe(baseline.data);
    expect(child.listenerCount("error")).toBe(baseline.error);
    expect(child.listenerCount("exit")).toBe(baseline.exit);
    expect(child.listenerCount("close")).toBe(baseline.close);

    child.kill();
    await waitForChildClose(tracked);
    expect(child.stdout?.listenerCount("data")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("close")).toBe(0);
  });
});
