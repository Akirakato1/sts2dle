import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SnapshotStore,
  type ActiveSnapshot,
} from "../../src/server/sync/snapshot-store.js";

const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

async function createTemporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-snapshot-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function activateEmptySnapshot(
  store: SnapshotStore,
  revision: string,
): Promise<ActiveSnapshot> {
  const staging = await store.createStaging(revision);
  const path = await staging.activate();
  return { buildId: staging.buildId, path };
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await waitForChildClose(child).catch(() => undefined);
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function waitForOutput(child: ChildProcess, marker: string): Promise<void> {
  const stdout = child.stdout;
  if (!stdout) throw new Error("Snapshot lock worker stdout is unavailable");
  await new Promise<void>((resolveOutput, reject) => {
    let output = "";
    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      child.off("close", onClose);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(marker)) {
        cleanup();
        resolveOutput();
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Snapshot lock worker closed before expected output"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for snapshot lock worker"));
    }, 10_000);
    stdout.on("data", onData);
    child.once("close", onClose);
  });
}

function observeOutput(child: ChildProcess): (marker: string) => Promise<void> {
  const stdout = child.stdout;
  if (!stdout) throw new Error("Snapshot lock worker stdout is unavailable");
  let output = "";
  let closed = false;
  const waiters = new Set<{
    marker: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    for (const waiter of waiters) {
      if (!output.includes(waiter.marker)) continue;
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.resolve();
    }
  });
  child.once("close", () => {
    closed = true;
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Snapshot lock worker closed before expected output"));
    }
    waiters.clear();
  });
  return async (marker: string) => {
    if (output.includes(marker)) return;
    if (closed) throw new Error("Snapshot lock worker closed before expected output");
    await new Promise<void>((resolveOutput, rejectOutput) => {
      const waiter = {
        marker,
        resolve: resolveOutput,
        reject: rejectOutput,
        timeout: setTimeout(() => {
          waiters.delete(waiter);
          rejectOutput(new Error("Timed out waiting for snapshot lock worker"));
        }, 10_000),
      };
      waiters.add(waiter);
    });
  };
}

async function waitForChildClose(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveClose, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for child close")), 10_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolveClose();
    });
  });
}

describe("SnapshotStore", () => {
  it("releases a slow successful acquisition without entering after its monotonic deadline", async () => {
    const dataDir = await createTemporaryDataDir();
    let monotonicTime = 0;
    let entered = false;
    const store = new SnapshotStore(dataDir, {
      lockTimeoutMs: 30,
      lockOperations: {
        monotonicNow: () => monotonicTime,
        acquireDirectory: async (path) => {
          await mkdir(path);
          monotonicTime = 31;
        },
      },
    });

    await expect(store.withSyncLock(async () => { entered = true; })).rejects.toThrow(
      "Timed out after 30ms waiting for snapshot sync lock",
    );
    expect(entered).toBe(false);
    await expect(readdir(dataDir)).resolves.not.toContain(".stsdle-sync.lock");
  });

  it("does not attempt acquisition after its monotonic deadline", async () => {
    const dataDir = await createTemporaryDataDir();
    let clockReads = 0;
    let acquisitionAttempts = 0;
    let entered = false;
    const store = new SnapshotStore(dataDir, {
      lockTimeoutMs: 30,
      lockOperations: {
        monotonicNow: () => clockReads++ === 0 ? 0 : 31,
        acquireDirectory: async () => { acquisitionAttempts += 1; },
      },
    });

    await expect(store.withSyncLock(async () => { entered = true; })).rejects.toThrow(
      "Timed out after 30ms waiting for snapshot sync lock",
    );
    expect(acquisitionAttempts).toBe(0);
    expect(entered).toBe(false);
    await expect(readdir(dataDir)).resolves.not.toContain(".stsdle-sync.lock");
  });

  it("does not attempt acquisition when quarantine inspection crosses the monotonic deadline", async () => {
    const dataDir = await createTemporaryDataDir();
    let monotonicTime = 0;
    let acquisitionAttempts = 0;
    let entered = false;
    const lockOperations = {
      monotonicNow: () => monotonicTime,
      inspectQuarantine: async () => {
        monotonicTime = 31;
        return false;
      },
      acquireDirectory: async (path: string) => {
        acquisitionAttempts += 1;
        await mkdir(path);
      },
    };
    const store = new SnapshotStore(dataDir, {
      lockTimeoutMs: 30,
      lockOperations,
    });

    await expect(store.withSyncLock(async () => { entered = true; })).rejects.toThrow(
      "Timed out after 30ms waiting for snapshot sync lock",
    );
    expect(acquisitionAttempts).toBe(0);
    expect(entered).toBe(false);
    await expect(readdir(dataDir)).resolves.not.toContain(".stsdle-sync.lock");
  });

  it("serializes the same data directory with a real child-process lock holder", async () => {
    const dataDir = await createTemporaryDataDir();
    const releaseSignal = join(dataDir, "release.signal");
    const workerPath = resolve("tests/server/fixtures/snapshot-lock-worker.ts");
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, dataDir, releaseSignal], {
      cwd: resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    childProcesses.push(child);
    let childError = "";
    child.stderr?.on("data", (chunk: Buffer) => { childError += chunk.toString("utf8"); });
    const waitForMarker = observeOutput(child);
    await waitForMarker("LOCK_ACQUIRED");
    let entered = false;
    const waiting = new SnapshotStore(dataDir).withSyncLock(async () => { entered = true; });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    expect(entered).toBe(false);

    await writeFile(releaseSignal, "release");
    await waitForMarker("LOCK_RELEASED");
    await waitForChildClose(child);
    await waiting;
    expect(child.exitCode, childError).toBe(0);
    expect(entered).toBe(true);
  });

  it("recovers a confirmed dead child lock and removes its abandoned owned staging directory", async () => {
    const dataDir = await createTemporaryDataDir();
    const releaseSignal = join(dataDir, "never-release.signal");
    const workerPath = resolve("tests/server/fixtures/snapshot-lock-worker.ts");
    const child = spawn(process.execPath, [
      "--import", "tsx", workerPath, dataDir, releaseSignal, "staging",
    ], {
      cwd: resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    childProcesses.push(child);
    await waitForOutput(child, "LOCK_ACQUIRED");
    child.kill();
    await waitForChildClose(child);

    const store = new SnapshotStore(dataDir);
    await store.withSyncLock(async () => store.cleanupAbandonedStaging());

    await expect(readdir(join(dataDir, "snapshots"))).resolves.not.toContain(
      "abcdef123456-1234567890123.staging",
    );
  });

  it("activates a completed staging build through an atomic active pointer", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const staging = await store.createStaging("abc123");
    await writeFile(join(staging.path, "manifest.json"), "{}");

    const activatedPath = await staging.activate();

    expect(JSON.parse(await readFile(join(dataDir, "active.json"), "utf8"))).toEqual({
      buildId: staging.buildId,
    });
    expect(activatedPath).toBe(join(dataDir, "snapshots", staging.buildId));
    await expect(readFile(join(activatedPath, "manifest.json"), "utf8")).resolves.toBe("{}");
    await expect(store.loadActive()).resolves.toEqual({
      buildId: staging.buildId,
      path: activatedPath,
    });
  });

  it("allocates distinct staging directories when two builds start in the same millisecond", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_000);

    try {
      const first = await store.createStaging("same-revision");
      const second = await store.createStaging("same-revision");

      expect(second.buildId).not.toBe(first.buildId);
      await first.abort();
      await second.abort();
    } finally {
      clock.mockRestore();
    }
  });

  it("reclaims a confirmed-dead snapshot lease before pruning its old snapshot", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const first = await activateEmptySnapshot(store, "first");
    const lease = await store.acquireSnapshotLease(first);
    const leaseDirectory = join(dataDir, ".stsdle-snapshot-leases");
    const [leaseFilename] = await readdir(leaseDirectory);
    const leasePath = join(leaseDirectory, leaseFilename!);
    const owner = JSON.parse(await readFile(leasePath, "utf8")) as { processId: number };
    const deadOwner = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    childProcesses.push(deadOwner);
    await waitForChildClose(deadOwner);
    owner.processId = deadOwner.pid!;
    await writeFile(leasePath, `${JSON.stringify(owner)}\n`);
    await activateEmptySnapshot(store, "second");
    const third = await activateEmptySnapshot(store, "third");

    await store.retainValidatedSnapshots(third, async () => true);

    await expect(readdir(join(dataDir, "snapshots"))).resolves.not.toContain(first.buildId);
    await expect(readdir(leaseDirectory)).resolves.toEqual([]);
    await lease.release();
  });

  it("preserves a snapshot leased by a real child process until that process releases it", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const first = await activateEmptySnapshot(store, "first");
    const releaseSignal = join(dataDir, "release-lease.signal");
    const workerPath = resolve("tests/server/fixtures/snapshot-lock-worker.ts");
    const child = spawn(process.execPath, [
      "--import", "tsx", workerPath, dataDir, releaseSignal, "lease", first.buildId, first.path,
    ], {
      cwd: resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    childProcesses.push(child);
    const waitForMarker = observeOutput(child);
    await waitForMarker("LEASE_ACQUIRED");
    await activateEmptySnapshot(store, "second");
    const third = await activateEmptySnapshot(store, "third");

    await store.retainValidatedSnapshots(third, async () => true);
    await expect(readdir(join(dataDir, "snapshots"))).resolves.toContain(first.buildId);

    await writeFile(releaseSignal, "release");
    await waitForMarker("LEASE_RELEASED");
    await waitForChildClose(child);
    expect(child.exitCode).toBe(0);
    const fourth = await activateEmptySnapshot(store, "fourth");
    await store.retainValidatedSnapshots(fourth, async () => true);
    await expect(readdir(join(dataDir, "snapshots"))).resolves.not.toContain(first.buildId);
  });

  it("fails closed without writing through an escaped snapshot-lease junction", async () => {
    const dataDir = await createTemporaryDataDir();
    const outsideDir = await mkdtemp(join(tmpdir(), "stsdle-lease-root-outside-"));
    temporaryDirectories.push(outsideDir);
    const store = new SnapshotStore(dataDir);
    const snapshot = await activateEmptySnapshot(store, "leased");
    await symlink(outsideDir, join(dataDir, ".stsdle-snapshot-leases"), "junction");

    await expect(store.acquireSnapshotLease(snapshot)).rejects.toThrow(
      "Snapshot lease directory escapes the configured data directory",
    );
    await expect(readdir(outsideDir)).resolves.toEqual([]);
  });

  it("fails closed without releasing through a replaced snapshot-lease junction", async () => {
    const dataDir = await createTemporaryDataDir();
    const outsideDir = await mkdtemp(join(tmpdir(), "stsdle-lease-release-outside-"));
    temporaryDirectories.push(outsideDir);
    const store = new SnapshotStore(dataDir);
    const snapshot = await activateEmptySnapshot(store, "leased");
    const lease = await store.acquireSnapshotLease(snapshot);
    const leaseRoot = join(dataDir, ".stsdle-snapshot-leases");
    const heldLeaseRoot = join(dataDir, ".stsdle-snapshot-leases-held");
    await rename(leaseRoot, heldLeaseRoot);
    await symlink(outsideDir, leaseRoot, "junction");

    await expect(lease.release()).rejects.toThrow(
      "Snapshot lease directory escapes the configured data directory",
    );
    await expect(readdir(outsideDir)).resolves.toEqual([]);
    expect((await readdir(heldLeaseRoot)).some((entry) => entry.endsWith(".json"))).toBe(true);
  });

  it("preserves a snapshot named by an ambiguous malformed lease entry", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const first = await activateEmptySnapshot(store, "first");
    await activateEmptySnapshot(store, "second");
    const third = await activateEmptySnapshot(store, "third");
    const leaseRoot = join(dataDir, ".stsdle-snapshot-leases");
    await mkdir(leaseRoot, { recursive: true });
    const ambiguousLease = `${first.buildId}.corrupt-owner.json`;
    await writeFile(join(leaseRoot, ambiguousLease), "not-json");

    await store.retainValidatedSnapshots(third, async () => true);

    await expect(readdir(join(dataDir, "snapshots"))).resolves.toContain(first.buildId);
    await expect(readdir(leaseRoot)).resolves.toContain(ambiguousLease);
  });

  it("keeps an existing active build when a later staging build is aborted", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const first = await store.createStaging("first");
    await first.activate();
    const second = await store.createStaging("second");

    await second.abort();

    expect(JSON.parse(await readFile(join(dataDir, "active.json"), "utf8"))).toEqual({
      buildId: first.buildId,
    });
    await expect(readFile(second.path, "utf8")).rejects.toThrow();
  });

  it("rejects active pointers that escape the snapshots directory", async () => {
    const dataDir = await createTemporaryDataDir();
    await mkdir(join(dataDir, "snapshots"), { recursive: true });
    await writeFile(join(dataDir, "active.json"), JSON.stringify({ buildId: `..${sep}outside` }));
    const store = new SnapshotStore(dataDir);

    await expect(store.loadActive()).rejects.toThrow("Invalid active snapshot build ID");
    expect(resolve(dataDir, "snapshots", `..${sep}outside`)).not.toContain(
      `${resolve(dataDir, "snapshots")}${sep}`,
    );
  });

  it("rejects UNC and nested active build identifiers before resolving them", async () => {
    const dataDir = await createTemporaryDataDir();
    await mkdir(join(dataDir, "snapshots"), { recursive: true });
    const store = new SnapshotStore(dataDir);

    await writeFile(join(dataDir, "active.json"), JSON.stringify({
      buildId: "\\\\server\\share\\outside",
    }));
    await expect(store.loadActive()).rejects.toThrow("Invalid active snapshot build ID");

    await writeFile(join(dataDir, "active.json"), JSON.stringify({ buildId: "nested\\build" }));
    await expect(store.loadActive()).rejects.toThrow("Invalid active snapshot build ID");
  });

  it("rejects a snapshot directory link that resolves outside the store", async () => {
    const dataDir = await createTemporaryDataDir();
    const outsideDir = await mkdtemp(join(tmpdir(), "stsdle-snapshot-outside-"));
    temporaryDirectories.push(outsideDir);
    const snapshotsDir = join(dataDir, "snapshots");
    await mkdir(snapshotsDir, { recursive: true });
    await symlink(outsideDir, join(snapshotsDir, "linked-build"), "junction");
    await writeFile(join(dataDir, "active.json"), JSON.stringify({ buildId: "linked-build" }));

    await expect(new SnapshotStore(dataDir).loadActive()).rejects.toThrow(
      "escapes snapshots directory",
    );
  });

  it("fails closed without cleaning through an escaped snapshots-root junction", async () => {
    const dataDir = await createTemporaryDataDir();
    const outsideDir = await mkdtemp(join(tmpdir(), "stsdle-snapshots-root-outside-"));
    temporaryDirectories.push(outsideDir);
    const abandonedName = "abcdef123456-1234567890123.staging";
    await mkdir(join(outsideDir, abandonedName), { recursive: true });
    await symlink(outsideDir, join(dataDir, "snapshots"), "junction");

    await expect(new SnapshotStore(dataDir).cleanupAbandonedStaging()).rejects.toThrow(
      "escapes the configured data directory",
    );
    await expect(readdir(outsideDir)).resolves.toContain(abandonedName);
  });

  it("can retry pointer publication after a post-rename failure", async () => {
    const dataDir = await createTemporaryDataDir();
    const store = new SnapshotStore(dataDir);
    const staging = await store.createStaging("retry");
    const temporaryPointerPath = join(dataDir, "active.json.tmp");
    await mkdir(temporaryPointerPath, { recursive: true });

    await expect(staging.activate()).rejects.toThrow();
    await rm(temporaryPointerPath, { recursive: true, force: true });

    await expect(staging.activate()).resolves.toBe(join(dataDir, "snapshots", staging.buildId));
    await expect(store.loadActive()).resolves.toEqual({
      buildId: staging.buildId,
      path: join(dataDir, "snapshots", staging.buildId),
    });
  });

  it("rejects a Windows UNC root returned by a junction realpath", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        open: async () => ({
          readFile: async () => JSON.stringify({ buildId: "linked-build" }),
          close: async () => undefined,
        }),
        realpath: async (path: string) => (
          path.endsWith("snapshots") ? "C:\\store\\snapshots" : "\\\\server\\share\\outside"
        ),
        stat: async () => ({ isDirectory: () => true }),
      };
    });

    try {
      const { SnapshotStore: MockedSnapshotStore } = await import(
        "../../src/server/sync/snapshot-store.js"
      );
      await expect(new MockedSnapshotStore("C:\\store").loadActive()).rejects.toThrow(
        "escapes snapshots directory",
      );
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });
});
