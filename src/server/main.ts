import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type CreateAppOptions } from "./app.js";
import { loadConfig, type ServerConfig } from "./config.js";
import type { ActivatedSnapshot } from "./sync/build-snapshot.js";
import {
  SnapshotStore,
  type ActiveSnapshot,
  type SnapshotLease,
} from "./sync/snapshot-store.js";
import { loadActivatedSnapshot } from "./sync/validate-snapshot.js";
import type { SnapshotValidationOptions } from "./sync/validate-snapshot.js";

type Environment = Record<string, string | undefined>;

export type ProductionSync = (
  config: ServerConfig,
  store: SnapshotStore,
) => Promise<ActivatedSnapshot>;

export interface ActiveSnapshotStore {
  loadActive(): Promise<ActiveSnapshot | null>;
  acquireSnapshotLease?(snapshot: ActiveSnapshot): Promise<SnapshotLease>;
}

export interface MainApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
  addHook?(name: "onClose", hook: () => Promise<void>): unknown;
  close?(): Promise<unknown>;
  log?: {
    info(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
  };
}

export interface MainDependencies {
  env?: Environment;
  clientRoot?: string;
  store?: ActiveSnapshotStore;
  sync?: (config: ServerConfig, store: ActiveSnapshotStore) => Promise<ActivatedSnapshot>;
  loadProductionSync?: () => Promise<ProductionSync>;
  loadActivatedSnapshot?: (
    snapshotPath: string,
    options: SnapshotValidationOptions,
  ) => Promise<ActivatedSnapshot>;
  createApp?: (options: CreateAppOptions) => Promise<MainApp>;
}

export async function main(dependencies: MainDependencies = {}): Promise<MainApp> {
  const config = loadConfig(dependencies.env ?? process.env);
  const store = dependencies.store ?? new SnapshotStore(config.dataDir);
  const loadSync = dependencies.loadProductionSync ?? (async () =>
    (await import("./sync/production-sync.js")).buildProductionSnapshot);
  const loadPrior = dependencies.loadActivatedSnapshot ?? loadActivatedSnapshot;
  const makeApp = dependencies.createApp ?? createApp;
  let active: ActivatedSnapshot;
  let refreshErrorName: string | undefined;

  if (config.skipSync) {
    const prior = await store.loadActive();
    if (!prior) throw new Error("STSDLE_SKIP_SYNC requires a validated active snapshot");
    active = await loadPrior(prior.path, validationOptions(config));
  } else {
    try {
      if (dependencies.sync) {
        active = await dependencies.sync(config, store);
      } else {
        if (!(store instanceof SnapshotStore)) {
          throw new Error("Default synchronization requires SnapshotStore");
        }
        active = await (await loadSync())(config, store);
      }
    } catch (refreshError: unknown) {
      refreshErrorName = refreshError instanceof Error ? refreshError.name : "UnknownError";
      const prior = await store.loadActive();
      if (!prior) throw refreshError;
      active = await loadPrior(prior.path, validationOptions(config));
    }
  }

  const lease = await store.acquireSnapshotLease?.({ buildId: active.buildId, path: active.path });
  let app: MainApp | undefined;
  try {
    const appOptions: CreateAppOptions = { config, snapshotRoot: active.path };
    if (dependencies.clientRoot !== undefined) appOptions.clientRoot = dependencies.clientRoot;
    app = await makeApp(appOptions);
    if (lease) {
      if (!app.addHook) throw new Error("Application lifecycle hooks are unavailable");
      app.addHook("onClose", async () => lease.release());
    }
    if (refreshErrorName !== undefined) {
      app.log?.warn(
        { errorName: refreshErrorName },
        "Snapshot refresh failed; serving validated prior snapshot",
      );
    }
    app.log?.info({
      sourceRevision: active.manifest.sourceRevision,
      sourceLastModified: active.manifest.sourceLastModified,
      cardCount: active.report.cardCount,
      upgradeCount: active.report.upgradeCount,
      baseGroupCount: active.report.baseGroupCount,
      pairGroupCount: active.report.pairGroupCount,
      baseGroupHistogram: active.report.baseGroupHistogram,
      pairGroupHistogram: active.report.pairGroupHistogram,
      candidateSpriteBytes: active.report.candidateSprite.bytes,
      guessSpriteBytes: active.report.guessSprite.bytes,
      fallbackCardCount: active.report.fallbackCardIds.length,
    }, "Snapshot startup acceptance passed");
    await app.listen({ host: config.host, port: config.port });
    return app;
  } catch (error: unknown) {
    const cleanupErrors: unknown[] = [];
    try {
      await app?.close?.();
    } catch (closeError: unknown) {
      cleanupErrors.push(closeError);
    } finally {
      try {
        await lease?.release();
      } catch (releaseError: unknown) {
        if (!cleanupErrors.includes(releaseError)) cleanupErrors.push(releaseError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Application startup failed and cleanup also failed",
        { cause: error },
      );
    }
    throw error;
  }
}

function validationOptions(config: ServerConfig): SnapshotValidationOptions {
  return {
    allowedArtworkOrigins: config.artworkAllowedOrigins,
    allowedFullCardOrigins: config.fullCardAllowedOrigins,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

export function logStartupFailure(
  _error: unknown,
  logger: { error(message: string, details: Record<string, string>): void } = console,
): void {
  logger.error("STS-dle server startup failed", { category: "startup_failure" });
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    logStartupFailure(error);
    process.exitCode = 1;
  });
}
