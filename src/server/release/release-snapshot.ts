import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, type ServerConfig } from "../config.js";
import type { FetchedCards } from "../spire-codex/client.js";
import { buildSnapshot } from "../sync/build-snapshot.js";
import { createProductionDependencies } from "../sync/production-sync.js";
import { SnapshotStore, type ActiveSnapshot } from "../sync/snapshot-store.js";
import { validateSnapshot } from "../sync/validate-snapshot.js";
import {
  beginDeploymentBundlePublish,
  readDeploymentRevision,
  stageDeploymentBundle,
  type PublishedBundle,
} from "./deployment-bundle.js";
import {
  GitClient,
  GitPostCommitCleanupError,
  resolveNpmCliPath,
  runBoundedProcess,
  runNpmCheck,
  type ArgumentArrayRunner,
} from "./git-client.js";

const BUILD_TEMP_PREFIX = "stsdle-snapshot-release-";
export interface TemporarySnapshotBundle {
  active: ActiveSnapshot;
  dataDir: string;
  cleanup(): Promise<void>;
}

export interface SnapshotBuildDependencies {
  fetchCards(): Promise<FetchedCards>;
  buildTemporarySnapshot(fetched: FetchedCards): Promise<TemporarySnapshotBundle>;
  validateTemporarySnapshot(active: ActiveSnapshot): Promise<void>;
  publishTemporarySnapshot(
    temporary: TemporarySnapshotBundle,
    outputDir: string,
  ): Promise<PublishedBundle>;
  validatePublishedSnapshot(active: ActiveSnapshot): Promise<void>;
}

export interface ReleaseSnapshotDependencies extends SnapshotBuildDependencies {
  gitClient: Pick<GitClient, "assertReady" | "assertOnlySnapshotChanges" | "rollbackSnapshotIndex" | "commitSnapshot" | "cleanupPrivateIndex" | "completeSnapshotRecovery" | "recoverSnapshot" | "pushMain">;
  readCommittedRevision(): Promise<string | null>;
  runChecks(): Promise<void>;
  outputDir?: string;
}

export interface ReleaseSnapshotOptions {
  force?: boolean;
  recover?: boolean;
}

export interface BuildSnapshotBundleOptions {
  outputDir: string;
  config?: ServerConfig;
  dependencies?: SnapshotBuildDependencies;
}

export interface DefaultReleaseDependenciesOptions {
  repositoryRoot: string;
  outputDir?: string;
  config?: ServerConfig;
  runner?: ArgumentArrayRunner;
  npmCliPath?: string;
}

export class SnapshotPushError extends Error {
  constructor() {
    super("Card snapshot was committed but could not be pushed");
    this.name = "SnapshotPushError";
  }
}

export class SnapshotPostCommitCleanupError extends Error {
  readonly committed = true;

  constructor() {
    super("Snapshot committed but local cleanup failed");
    this.name = "SnapshotPostCommitCleanupError";
  }
}

class SnapshotReleaseError extends Error {
  constructor() {
    super("Card snapshot release failed");
    this.name = "SnapshotReleaseError";
  }
}

class SnapshotBuildError extends Error {
  constructor() {
    super("Card snapshot build failed");
    this.name = "SnapshotBuildError";
  }
}

export async function releaseSnapshot(
  options: ReleaseSnapshotOptions,
  dependencies: ReleaseSnapshotDependencies,
): Promise<{ status: "unchanged" | "released"; sourceRevision: string }> {
  let temporary: TemporarySnapshotBundle | undefined;
  let result: { status: "unchanged" | "released"; sourceRevision: string } | undefined;
  let failure: unknown;

  try {
    await dependencies.gitClient.assertReady();
    const committedRevision = await dependencies.readCommittedRevision();
    const fetched = await dependencies.fetchCards();
    if (!options.force && fetched.sourceRevision === committedRevision) {
      result = { status: "unchanged", sourceRevision: fetched.sourceRevision };
    } else {
      await dependencies.runChecks();
      temporary = await dependencies.buildTemporarySnapshot(fetched);
      await dependencies.validateTemporarySnapshot(temporary.active);
      const outputDir = dependencies.outputDir ?? "deploy/snapshot-data";
      const published = await dependencies.publishTemporarySnapshot(
        temporary,
        outputDir,
      );
      const publicationRecoveryArtifact = published.recoveryArtifact?.() ?? null;

      let committed = false;
      let privateCleanupFailed = false;
      try {
        await dependencies.validatePublishedSnapshot(published.active);
        await dependencies.gitClient.assertOnlySnapshotChanges();
        try {
          await dependencies.gitClient.commitSnapshot(fetched.sourceRevision, {
            publicationBackupName: publicationRecoveryArtifact,
            outputDir,
          });
          committed = true;
        } catch (error: unknown) {
          if (!(error instanceof GitPostCommitCleanupError)) throw error;
          committed = true;
          try {
            await dependencies.gitClient.cleanupPrivateIndex();
          } catch {
            privateCleanupFailed = true;
          }
        }
      } catch {
        if (!committed) await rollbackPreCommitIgnoringPayload(published, dependencies.gitClient);
        throw new SnapshotReleaseError();
      }

      if (!committed) throw new SnapshotReleaseError();
      let finalizeFailed = false;
      try {
        await published.finalize();
      } catch {
        finalizeFailed = true;
      }
      if (privateCleanupFailed || finalizeFailed) {
        throw new SnapshotPostCommitCleanupError();
      }
      try {
        await dependencies.gitClient.completeSnapshotRecovery(
          publicationRecoveryArtifact,
          outputDir,
        );
      } catch {
        throw new SnapshotPostCommitCleanupError();
      }
      try {
        await dependencies.gitClient.pushMain();
      } catch {
        throw new SnapshotPushError();
      }
      result = { status: "released", sourceRevision: fetched.sourceRevision };
    }
  } catch (error: unknown) {
    failure = error instanceof SnapshotPushError || error instanceof SnapshotPostCommitCleanupError
      ? error
      : new SnapshotReleaseError();
  }

  if (temporary) {
    try {
      await temporary.cleanup();
    } catch {
      failure ??= new SnapshotReleaseError();
    }
  }

  if (failure) throw failure;
  return result!;
}

export async function buildSnapshotBundle(
  options: BuildSnapshotBundleOptions,
): Promise<ActiveSnapshot> {
  let dependencies: SnapshotBuildDependencies | undefined;
  let temporary: TemporarySnapshotBundle | undefined;
  let published: PublishedBundle | undefined;
  let finalized = false;
  let active: ActiveSnapshot | undefined;
  let failure: unknown;

  try {
    dependencies = options.dependencies ?? createDefaultSnapshotBuildDependencies(
      options.config ?? loadConfig(process.env),
    );
    const fetched = await dependencies.fetchCards();
    temporary = await dependencies.buildTemporarySnapshot(fetched);
    await dependencies.validateTemporarySnapshot(temporary.active);
    published = await dependencies.publishTemporarySnapshot(temporary, options.outputDir);
    await dependencies.validatePublishedSnapshot(published.active);
    await published.finalize();
    finalized = true;
    active = published.active;
  } catch {
    if (published && !finalized) {
      try {
        await published.rollback();
      } catch {
        // Keep settling the owned temporary directory before returning the fixed build error.
      }
    }
    failure = new SnapshotBuildError();
  }

  if (temporary) {
    try {
      await temporary.cleanup();
    } catch {
      failure ??= new SnapshotBuildError();
    }
  }

  if (failure) throw failure;
  return active!;
}

export function createReleaseSnapshotDependencies(
  options: DefaultReleaseDependenciesOptions,
): ReleaseSnapshotDependencies {
  const config = options.config ?? loadConfig(process.env);
  const outputDir = options.outputDir ?? join(options.repositoryRoot, "deploy", "snapshot-data");
  const runner = options.runner ?? runBoundedProcess;
  const npmCliPath = options.npmCliPath ?? resolveNpmCliPath(process.env);
  const buildDependencies = createDefaultSnapshotBuildDependencies(config);
  return {
    ...buildDependencies,
    gitClient: new GitClient(options.repositoryRoot, runner),
    outputDir,
    readCommittedRevision: () => readDeploymentRevision(outputDir),
    runChecks: async () => {
      await runNpmCheck(options.repositoryRoot, npmCliPath, runner);
    },
  };
}

function createDefaultSnapshotBuildDependencies(config: ServerConfig): SnapshotBuildDependencies {
  const unallocatedStore = new SnapshotStore(join(tmpdir(), `${BUILD_TEMP_PREFIX}unallocated`));
  const productionDependencies = createProductionDependencies(config, unallocatedStore);
  const validationOptions = {
    allowedArtworkOrigins: config.artworkAllowedOrigins,
    allowedFullCardOrigins: config.fullCardAllowedOrigins,
  };
  return {
    fetchCards: () => productionDependencies.client.fetchCards(),
    buildTemporarySnapshot: async (fetched) => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), BUILD_TEMP_PREFIX));
      const dataDir = join(temporaryRoot, "data");
      let cleanupStarted: Promise<void> | undefined;
      const cleanup = (): Promise<void> => {
        cleanupStarted ??= rm(temporaryRoot, { recursive: true, force: true });
        return cleanupStarted;
      };
      try {
        const active = await buildSnapshot({
          ...productionDependencies,
          client: { fetchCards: async () => fetched },
          store: new SnapshotStore(dataDir),
        });
        return { active, dataDir, cleanup };
      } catch {
        await cleanup().catch(() => undefined);
        throw new SnapshotBuildError();
      }
    },
    validateTemporarySnapshot: async (active) => {
      await validateSnapshot(active.path, validationOptions);
    },
    publishTemporarySnapshot: async (temporary, outputDir) => {
      const stagingDir = join(
        dirname(outputDir),
        `.${basename(outputDir)}.staging-${randomUUID()}`,
      );
      let staged = false;
      try {
        await stageDeploymentBundle(temporary.dataDir, stagingDir, validationOptions);
        staged = true;
        return await beginDeploymentBundlePublish(stagingDir, outputDir, validationOptions);
      } catch {
        if (staged) await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        throw new SnapshotBuildError();
      }
    },
    validatePublishedSnapshot: async (active) => {
      await validateSnapshot(active.path, validationOptions);
    },
  };
}

async function rollbackPreCommitIgnoringPayload(
  published: PublishedBundle,
  gitClient: Pick<GitClient, "rollbackSnapshotIndex">,
): Promise<void> {
  let failed = false;
  try { await published.rollback(); } catch { failed = true; }
  try { await gitClient.rollbackSnapshotIndex(); } catch { failed = true; }
  if (failed) throw new SnapshotReleaseError();
}
