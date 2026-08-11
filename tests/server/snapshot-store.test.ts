import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotStore } from "../../src/server/sync/snapshot-store.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-snapshot-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("SnapshotStore", () => {
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
});
