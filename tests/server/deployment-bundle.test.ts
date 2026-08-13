import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fixture from "../fixtures/spire-cards.json";
import { buildSnapshot } from "../../src/server/sync/build-snapshot.js";
import { SnapshotStore, type ActiveSnapshot } from "../../src/server/sync/snapshot-store.js";
import { loadActivatedSnapshot } from "../../src/server/sync/validate-snapshot.js";
import type { RawSpireCard } from "../../src/server/spire-codex/schema.js";
import {
  beginDeploymentBundlePublish,
  readDeploymentRevision,
  stageDeploymentBundle,
} from "../../src/server/release/deployment-bundle.js";

const temporaryDirectories: string[] = [];
const validationOptions = {
  allowedArtworkOrigins: ["https://spire-codex.test"],
  allowedFullCardOrigins: ["https://cdn.test"],
} as const;
let artwork: Buffer;
let fallbackImage: Buffer;

beforeAll(async () => {
  artwork = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "orange" },
  }).webp().toBuffer();
  fallbackImage = await sharp({
    create: { width: 400, height: 520, channels: 3, background: "orange" },
  }).webp().toBuffer();
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("deployment bundle staging", () => {
  it("returns null when no deployment is active", async () => {
    const root = await createTemporaryDirectory();

    await expect(readDeploymentRevision(join(root, "missing"))).resolves.toBeNull();
    await expect(readDeploymentRevision(root)).resolves.toBeNull();
  });

  it("returns only a valid lowercase SHA-256 source revision", async () => {
    const sourceRevision = "ab".repeat(32);
    const source = await createValidSource(sourceRevision);

    await expect(readDeploymentRevision(source.dataDir)).resolves.toBe(sourceRevision);

    const manifestPath = join(source.active.path, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.sourceRevision = "AB".repeat(32);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    await expect(readDeploymentRevision(source.dataDir)).rejects.toThrow("Unable to read deployment revision");
  });

  it("stages exactly the validated active build and excludes recovery artifacts", async () => {
    const source = await createValidSource("12".repeat(32));
    const root = await createTemporaryDirectory();
    const staging = join(root, "snapshot-data.staging");
    const priorBuildId = "prior-1700000000000";
    await cp(source.active.path, join(source.dataDir, "snapshots", priorBuildId), { recursive: true });
    await mkdir(join(source.dataDir, "snapshots", "abandoned-1700000000001.staging"));
    await mkdir(join(source.dataDir, ".stsdle-sync.lock"));
    await mkdir(join(source.dataDir, ".stsdle-snapshot-leases"), { recursive: true });
    await writeFile(join(source.dataDir, "active.json.tmp"), "do not copy", "utf8");

    await expect(stageDeploymentBundle(source.dataDir, staging, validationOptions)).resolves.toMatchObject({
      buildId: source.active.buildId,
    });
    expect((await readdir(staging)).sort()).toEqual(["active.json", "snapshots"]);
    expect(await readdir(join(staging, "snapshots"))).toEqual([source.active.buildId]);
    await expect(loadActivatedSnapshot(
      join(staging, "snapshots", source.active.buildId),
      validationOptions,
    )).resolves.toBeDefined();
  });

  it("rejects malformed active pointers and corrupt active snapshot hashes", async () => {
    const malformed = await createValidSource("23".repeat(32));
    const corrupt = await createValidSource("34".repeat(32));
    const root = await createTemporaryDirectory();
    await writeFile(join(malformed.dataDir, "active.json"), "{not-json", "utf8");
    await writeFile(join(corrupt.active.path, "cards.json"), "[]\n", "utf8");

    await expect(stageDeploymentBundle(
      malformed.dataDir,
      join(root, "malformed.staging"),
      validationOptions,
    )).rejects.toThrow("Unable to stage deployment bundle");
    await expect(stageDeploymentBundle(
      corrupt.dataDir,
      join(root, "corrupt.staging"),
      validationOptions,
    )).rejects.toThrow("Unable to stage deployment bundle");
  });

  it("rejects source snapshot and staging junction escapes before copying", async () => {
    const escapedSnapshotsSource = await createValidSource("45".repeat(32));
    const linkedChildSource = await createValidSource("56".repeat(32));
    const root = await createTemporaryDirectory();
    const externalSnapshots = join(root, "external-snapshots");
    const sourceSnapshots = join(escapedSnapshotsSource.dataDir, "snapshots");
    await rename(sourceSnapshots, externalSnapshots);
    await symlink(externalSnapshots, sourceSnapshots, "junction");

    const externalChild = join(root, "external-child");
    await mkdir(externalChild);
    await writeFile(join(externalChild, "sentinel.txt"), "outside", "utf8");
    await symlink(externalChild, join(linkedChildSource.active.path, "linked"), "junction");

    const escapedStagingTarget = join(root, "escaped-staging-target");
    const escapedStaging = join(root, "escaped.staging");
    await mkdir(escapedStagingTarget);
    await symlink(escapedStagingTarget, escapedStaging, "junction");

    await expect(stageDeploymentBundle(
      escapedSnapshotsSource.dataDir,
      join(root, "source-escape.staging"),
      validationOptions,
    )).rejects.toThrow("Unable to stage deployment bundle");
    await expect(stageDeploymentBundle(
      linkedChildSource.dataDir,
      join(root, "child-link.staging"),
      validationOptions,
    )).rejects.toThrow("Unable to stage deployment bundle");
    await expect(stageDeploymentBundle(
      linkedChildSource.dataDir,
      escapedStaging,
      validationOptions,
    )).rejects.toThrow("Unable to stage deployment bundle");
    expect(await readdir(escapedStagingTarget)).toEqual([]);
    expect(await readFile(join(externalChild, "sentinel.txt"), "utf8")).toBe("outside");
  });

  it("revalidates the staging parent after the absence check and before mkdir", async () => {
    const source = await createValidSource("5a".repeat(32));
    const root = await createTemporaryDirectory();
    const ownedParent = join(root, "owned-parent");
    const displacedParent = join(root, "displaced-parent");
    const external = join(root, "external-parent");
    await mkdir(ownedParent);
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    const staging = join(ownedParent, "release.staging");
    let absenceCheckCompleted = false;
    let mkdirCalls = 0;
    await expect(stageDeploymentBundle(
      source.dataDir,
      staging,
      validationOptions,
      {
        afterPathMissing: async () => {
          absenceCheckCompleted = true;
        },
        beforeMutation: async () => {
          if (!absenceCheckCompleted) return;
          await rename(ownedParent, displacedParent);
          await symlink(external, ownedParent, "junction");
        },
        createDirectory: async (path: string) => {
          mkdirCalls += 1;
          await mkdir(path);
        },
      },
    )).rejects.toThrow("Unable to stage deployment bundle");

    expect(absenceCheckCompleted).toBe(true);
    expect(mkdirCalls).toBe(0);
    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
    await expect(pathExists(join(external, "release.staging"))).resolves.toBe(false);
    await expect(pathExists(join(displacedParent, "release.staging"))).resolves.toBe(false);
  });
});

describe("transactional deployment bundle publication", () => {
  it("retains the old bundle until finalize and removes owned artifacts idempotently", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("67".repeat(32));
    const newSource = await createValidSource("78".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);

    const published = await beginDeploymentBundlePublish(staging, destination, validationOptions);

    expect(published.active.buildId).toBe(newSource.active.buildId);
    expect(await artifactNames(root, destination)).toHaveLength(1);
    await published.finalize();
    await published.finalize();
    await published.rollback();
    expect(await readDeploymentRevision(destination)).toBe("78".repeat(32));
    expect(await artifactNames(root, destination)).toEqual([]);
    await expect(pathExists(staging)).resolves.toBe(false);
  });

  it("rolls back idempotently to the byte-identical original bundle", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("89".repeat(32));
    const newSource = await createValidSource("9a".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);

    const published = await beginDeploymentBundlePublish(staging, destination, validationOptions);
    await published.rollback();
    await published.rollback();
    await published.finalize();

    expect(await fingerprintTree(destination)).toEqual(before);
    expect(await artifactNames(root, destination)).toEqual([]);
  });

  it("restores the byte-identical original when injected post-swap validation fails", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("ab".repeat(32));
    const newSource = await createValidSource("bc".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);

    const failure = new Error(`injected validation leak ${destination}`);
    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      validatePublishedBundle: async () => { throw failure; },
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Published deployment bundle failed validation");
      expect(reachableErrorText(error)).not.toContain(destination);
      expect(reachableErrorText(error)).not.toContain("injected validation leak");
      return true;
    });

    expect(await fingerprintTree(destination)).toEqual(before);
    expect(await artifactNames(root, destination)).toEqual([]);
    await expect(pathExists(staging)).resolves.toBe(false);
  });

  it("cannot bypass strict published validation with an injected callback", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("bd".repeat(32));
    const newSource = await createValidSource("ce".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let renameCalls = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      renameDirectory: async (from, to) => {
        renameCalls += 1;
        await rename(from, to);
        if (renameCalls === 2) await writeFile(join(to, "snapshots", newSource.active.buildId, "cards.json"), "[]\n");
      },
      validatePublishedBundle: async () => ({
        buildId: newSource.active.buildId,
        path: join(destination, "snapshots", newSource.active.buildId),
      }),
    })).rejects.toThrow("Published deployment bundle failed validation");

    expect(await fingerprintTree(destination)).toEqual(before);
    expect(await artifactNames(root, destination)).toEqual([]);
  });

  it("rejects corruption introduced by the post-validation callback", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("cf".repeat(32));
    const newSource = await createValidSource("d1".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      validatePublishedBundle: async () => {
        await writeFile(
          join(destination, "snapshots", newSource.active.buildId, "cards.json"),
          "[]\n",
        );
      },
    })).rejects.toThrow("Published deployment bundle failed validation");

    expect(await fingerprintTree(destination)).toEqual(before);
    expect(await artifactNames(root, destination)).toEqual([]);
  });

  it("rejects a destination junction escape without moving staging or external data", async () => {
    const root = await createTemporaryDirectory();
    const source = await createValidSource("cd".repeat(32));
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(source.dataDir, staging, validationOptions);
    const external = join(root, "external");
    const destination = join(root, "snapshot-data");
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    await symlink(external, destination, "junction");

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions))
      .rejects.toThrow("Unable to publish deployment bundle");

    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
    await expect(pathExists(staging)).resolves.toBe(true);
  });

  it("retries only EPERM and EBUSY rename failures before publishing", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("de".repeat(32));
    const newSource = await createValidSource("ef".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let attempts = 0;
    let now = 100;
    const waits: number[] = [];

    const published = await beginDeploymentBundlePublish(staging, destination, validationOptions, {
      monotonicNow: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
      renameDirectory: async (from, to) => {
        attempts += 1;
        if (attempts <= 2) throw nodeError(attempts === 1 ? "EPERM" : "EBUSY", "transient secret");
        await rename(from, to);
      },
    });
    await published.finalize();

    expect(attempts).toBe(4);
    expect(waits).toEqual([50, 50]);
    expect(await readDeploymentRevision(destination)).toBe("ef".repeat(32));
  });

  it("revalidates the destination parent before a rename retry", async () => {
    const root = await createTemporaryDirectory();
    const ownedParent = join(root, "owned-parent");
    const displacedParent = join(root, "displaced-parent");
    const external = join(root, "external-parent");
    await mkdir(ownedParent);
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    const destination = join(ownedParent, "snapshot-data");
    const oldSource = await createValidSource("d0".repeat(32));
    const newSource = await createValidSource("e1".repeat(32));
    await installDestination(oldSource.dataDir, destination, ownedParent, "initial.staging");
    const staging = join(ownedParent, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let mutationCalls = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      beforeMutation: async () => {
        mutationCalls += 1;
        if (mutationCalls !== 1) return;
        await rename(ownedParent, displacedParent);
        await symlink(external, ownedParent, "junction");
      },
    })).rejects.toThrow("Unable to publish deployment bundle");

    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
    expect(await readDeploymentRevision(join(displacedParent, "snapshot-data"))).toBe("d0".repeat(32));
    await expect(pathExists(join(displacedParent, "release.staging"))).resolves.toBe(true);
  });

  it("revalidates the destination parent after EPERM before retrying rename", async () => {
    const root = await createTemporaryDirectory();
    const ownedParent = join(root, "owned-parent");
    const displacedParent = join(root, "displaced-parent");
    const external = join(root, "external-parent");
    await mkdir(ownedParent);
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    const destination = join(ownedParent, "snapshot-data");
    const oldSource = await createValidSource("e2".repeat(32));
    const newSource = await createValidSource("f3".repeat(32));
    await installDestination(oldSource.dataDir, destination, ownedParent, "initial.staging");
    const staging = join(ownedParent, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let renameCalls = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      renameDirectory: async () => {
        renameCalls += 1;
        throw nodeError("EPERM", "retry-token");
      },
      wait: async () => {
        await rename(ownedParent, displacedParent);
        await symlink(external, ownedParent, "junction");
      },
    })).rejects.toSatisfy((error: unknown) => {
      expect(reachableErrorText(error)).not.toContain("retry-token");
      expect(reachableErrorText(error)).not.toContain(destination);
      return true;
    });

    expect(renameCalls).toBe(1);
    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
    expect(await readDeploymentRevision(join(displacedParent, "snapshot-data"))).toBe("e2".repeat(32));
    await expect(pathExists(join(displacedParent, "release.staging"))).resolves.toBe(true);
  });

  it("revalidates the destination parent before rollback mutations", async () => {
    const root = await createTemporaryDirectory();
    const ownedParent = join(root, "owned-parent");
    const displacedParent = join(root, "displaced-parent");
    const external = join(root, "external-parent");
    await mkdir(ownedParent);
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    const destination = join(ownedParent, "snapshot-data");
    const oldSource = await createValidSource("f2".repeat(32));
    const newSource = await createValidSource("03".repeat(32));
    await installDestination(oldSource.dataDir, destination, ownedParent, "initial.staging");
    const staging = join(ownedParent, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let armed = false;
    const published = await beginDeploymentBundlePublish(staging, destination, validationOptions, {
      beforeMutation: async () => {
        if (!armed) return;
        armed = false;
        await rename(ownedParent, displacedParent);
        await symlink(external, ownedParent, "junction");
      },
    });
    armed = true;

    await expect(published.rollback()).rejects.toThrow("Unable to roll back deployment bundle");

    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
    expect(await readDeploymentRevision(join(displacedParent, "snapshot-data"))).toBe("03".repeat(32));
    expect(await artifactNames(displacedParent, destination)).toHaveLength(1);
  });

  it("does not retry non-transient rename errors or expose their payloads", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("f0".repeat(32));
    const newSource = await createValidSource("01".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    const raw = nodeError("EACCES", `secret ${destination}`);
    let attempts = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      renameDirectory: async () => {
        attempts += 1;
        throw raw;
      },
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Unable to publish deployment bundle");
      expect(reachableErrorText(error)).not.toContain(destination);
      expect(reachableErrorText(error)).not.toContain("secret");
      return true;
    });
    expect(attempts).toBe(1);
    expect(await fingerprintTree(destination)).toEqual(before);
    await expect(pathExists(staging)).resolves.toBe(true);
  });

  it("bounds transient retries by one fresh monotonic publication deadline", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("12".repeat(32));
    const newSource = await createValidSource("23".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let attempts = 0;
    let now = 7_000;
    const raw = nodeError("EBUSY", "transient secret");

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      monotonicNow: () => now,
      wait: async () => { now += 3_000; },
      renameDirectory: async () => {
        attempts += 1;
        throw raw;
      },
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Unable to publish deployment bundle");
      expect(reachableErrorText(error)).not.toContain("transient secret");
      return true;
    });
    expect(attempts).toBe(2);
    expect(await fingerprintTree(destination)).toEqual(before);
  });

  it("shares the first publication deadline with the second rename", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("24".repeat(32));
    const newSource = await createValidSource("35".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let now = 1_000;
    let renameCalls = 0;
    let stagingAttempts = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      monotonicNow: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
      renameDirectory: async (from, to) => {
        renameCalls += 1;
        if (renameCalls === 1) {
          await rename(from, to);
          now += 4_990;
          return;
        }
        if (basename(from) === "release.staging") {
          stagingAttempts += 1;
          throw nodeError("EBUSY", "deadline payload");
        }
        await rename(from, to);
      },
    })).rejects.toThrow("Unable to publish deployment bundle");

    expect(stagingAttempts).toBe(1);
    expect(renameCalls).toBe(3);
    expect(await fingerprintTree(destination)).toEqual(before);
  });

  it("recovers when a rename moves the directory before throwing", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const external = join(root, "external");
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    const oldSource = await createValidSource("46".repeat(32));
    const newSource = await createValidSource("57".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let renameCalls = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      renameDirectory: async (from, to) => {
        renameCalls += 1;
        await rename(from, to);
        if (renameCalls === 2) throw nodeError("EPERM", "moved payload");
      },
      validatePublishedBundle: async () => { throw new Error("reject publication"); },
    })).rejects.toThrow("Published deployment bundle failed validation");

    expect(await fingerprintTree(destination)).toEqual(before);
    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
    expect(await artifactNames(root, destination)).toEqual([]);
  });

  it("retries finalize after a transient owned-backup removal failure", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("68".repeat(32));
    const newSource = await createValidSource("79".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let removeCalls = 0;
    const published = await beginDeploymentBundlePublish(staging, destination, validationOptions, {
      removeDirectory: async (path: string) => {
        removeCalls += 1;
        if (removeCalls === 1) throw nodeError("EBUSY", `secret-token ${path}`);
        await rm(path, { recursive: true, force: false });
      },
    });

    await expect(published.finalize()).rejects.toSatisfy((error: unknown) => {
      expect(reachableErrorText(error)).not.toContain("secret-token");
      expect(reachableErrorText(error)).not.toContain(destination);
      return true;
    });
    expect(await artifactNames(root, destination)).toHaveLength(1);
    const destinationBeforeOpposite = await fingerprintTree(destination);
    const artifactsBeforeOpposite = await fingerprintArtifacts(root, destination);
    await expect(published.rollback()).rejects.toSatisfy((error: unknown) => {
      expect((error as Error).message).toBe("Deployment bundle settlement action is locked");
      expect(reachableErrorText(error)).not.toContain(destination);
      expect(reachableErrorText(error)).not.toContain("secret-token");
      return true;
    });
    expect(await fingerprintTree(destination)).toEqual(destinationBeforeOpposite);
    expect(await fingerprintArtifacts(root, destination)).toEqual(artifactsBeforeOpposite);
    await expect(published.finalize()).resolves.toBeUndefined();
    await expect(published.finalize()).resolves.toBeUndefined();
    expect(removeCalls).toBe(2);
    expect(await artifactNames(root, destination)).toEqual([]);
  });

  it("resumes rollback after a partial backup-restore failure", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("8a".repeat(32));
    const newSource = await createValidSource("9b".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const before = await fingerprintTree(destination);
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    let renameCalls = 0;
    let now = 0;
    let failRestore = true;
    const published = await beginDeploymentBundlePublish(staging, destination, validationOptions, {
      monotonicNow: () => now,
      wait: async () => { now += 5_000; },
      renameDirectory: async (from, to) => {
        renameCalls += 1;
        if (renameCalls >= 4 && failRestore) throw nodeError("EBUSY", `rollback-token ${destination}`);
        await rename(from, to);
      },
    });

    await expect(published.rollback()).rejects.toSatisfy((error: unknown) => {
      expect(reachableErrorText(error)).not.toContain("rollback-token");
      expect(reachableErrorText(error)).not.toContain(destination);
      return true;
    });
    await expect(pathExists(destination)).resolves.toBe(false);
    expect(await artifactNames(root, destination)).toHaveLength(2);
    const artifactsBeforeOpposite = await fingerprintArtifacts(root, destination);
    await expect(published.finalize()).rejects.toSatisfy((error: unknown) => {
      expect((error as Error).message).toBe("Deployment bundle settlement action is locked");
      expect(reachableErrorText(error)).not.toContain(destination);
      expect(reachableErrorText(error)).not.toContain("rollback-token");
      return true;
    });
    await expect(pathExists(destination)).resolves.toBe(false);
    expect(await fingerprintArtifacts(root, destination)).toEqual(artifactsBeforeOpposite);
    failRestore = false;
    await expect(published.rollback()).resolves.toBeUndefined();
    await expect(published.rollback()).resolves.toBeUndefined();
    expect(await fingerprintTree(destination)).toEqual(before);
    expect(await artifactNames(root, destination)).toEqual([]);
  });

  it("revalidates source ownership before a transient rename retry", async () => {
    const root = await createTemporaryDirectory();
    const destination = join(root, "snapshot-data");
    const oldSource = await createValidSource("34".repeat(32));
    const newSource = await createValidSource("45".repeat(32));
    await installDestination(oldSource.dataDir, destination, root, "initial.staging");
    const staging = join(root, "release.staging");
    await stageDeploymentBundle(newSource.dataDir, staging, validationOptions);
    const external = join(root, "external");
    const displaced = join(root, "displaced");
    await mkdir(external);
    await writeFile(join(external, "sentinel.txt"), "outside", "utf8");
    let attempts = 0;

    await expect(beginDeploymentBundlePublish(staging, destination, validationOptions, {
      monotonicNow: () => 0,
      wait: async () => undefined,
      renameDirectory: async (from) => {
        attempts += 1;
        await rename(from, displaced);
        await symlink(external, from, "junction");
        throw nodeError("EPERM", "transient secret");
      },
    })).rejects.toThrow("Unable to publish deployment bundle");

    expect(attempts).toBe(1);
    expect(await readFile(join(external, "sentinel.txt"), "utf8")).toBe("outside");
  });
});

async function createValidSource(sourceRevision: string): Promise<{
  dataDir: string;
  active: ActiveSnapshot;
}> {
  const dataDir = await createTemporaryDirectory();
  const active = await buildSnapshot({
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
        await writeFile(destination, fallbackImage);
      },
    },
    artworkConcurrency: 2,
    allowedArtworkOrigins: ["https://spire-codex.test"],
    allowedFullCardOrigins: ["https://cdn.test"],
    now: () => new Date("2026-08-12T00:00:01.000Z"),
  });
  return { dataDir, active: { buildId: active.buildId, path: active.path } };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stsdle-deploy-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function installDestination(
  sourceDataDir: string,
  destination: string,
  parent: string,
  stagingName: string,
): Promise<void> {
  const staging = join(parent, stagingName);
  await stageDeploymentBundle(sourceDataDir, staging, validationOptions);
  await rename(staging, destination);
}

async function artifactNames(parent: string, destination: string): Promise<string[]> {
  const prefix = `.${basename(destination)}.`;
  return (await readdir(parent)).filter((entry) => entry.startsWith(prefix)).sort();
}

async function fingerprintTree(root: string, relativePath = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const directory = relativePath ? join(root, ...relativePath.split("/")) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativeName = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await fingerprintTree(root, relativeName));
    else result[relativeName] = createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex");
  }
  return result;
}

async function fingerprintArtifacts(parent: string, destination: string): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  for (const name of await artifactNames(parent, destination)) {
    result[name] = await fingerprintTree(join(parent, name));
  }
  return result;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch (error: unknown) {
    return !isNodeError(error, "ENOENT") ? Promise.reject(error) : false;
  }
}

function nodeError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function reachableErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (seen.has(error)) return "";
  seen.add(error);
  if (!(error instanceof Error)) return String(error);
  const nested = [
    "cause" in error ? error.cause : undefined,
    error instanceof AggregateError ? error.errors : undefined,
  ].flatMap((value) => Array.isArray(value) ? value : [value]);
  return [error.name, error.message, ...nested.map((value) => reachableErrorText(value, seen))].join("\n");
}
