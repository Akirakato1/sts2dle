import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type CreateAppOptions } from "./app.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { FallbackRenderer } from "./images/fallback-renderer.js";
import { SpireCodexClient } from "./spire-codex/client.js";
import {
  buildSnapshot,
  type ActivatedSnapshot,
  type BuildSnapshotDependencies,
} from "./sync/build-snapshot.js";
import { SnapshotStore, type ActiveSnapshot } from "./sync/snapshot-store.js";
import { loadActivatedSnapshot } from "./sync/validate-snapshot.js";
import type { SnapshotValidationOptions } from "./sync/validate-snapshot.js";

type Environment = Record<string, string | undefined>;

export interface ActiveSnapshotStore {
  loadActive(): Promise<ActiveSnapshot | null>;
}

export interface MainApp {
  listen(options: { host: string; port: number }): Promise<unknown>;
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
  loadActivatedSnapshot?: (
    snapshotPath: string,
    options: SnapshotValidationOptions,
  ) => Promise<ActivatedSnapshot>;
  createApp?: (options: CreateAppOptions) => Promise<MainApp>;
}

export async function main(dependencies: MainDependencies = {}): Promise<MainApp> {
  const config = loadConfig(dependencies.env ?? process.env);
  const store = dependencies.store ?? new SnapshotStore(config.dataDir);
  const sync = dependencies.sync ?? (async (activeConfig) => buildSnapshot(
    createProductionDependencies(activeConfig, store as SnapshotStore),
  ));
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
      active = await sync(config, store);
    } catch (refreshError: unknown) {
      refreshErrorName = refreshError instanceof Error ? refreshError.name : "UnknownError";
      const prior = await store.loadActive();
      if (!prior) throw refreshError;
      active = await loadPrior(prior.path, validationOptions(config));
    }
  }

  const appOptions: CreateAppOptions = { config, snapshotRoot: active.path };
  if (dependencies.clientRoot !== undefined) appOptions.clientRoot = dependencies.clientRoot;
  const app = await makeApp(appOptions);
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
}

function validationOptions(config: ServerConfig): SnapshotValidationOptions {
  return {
    allowedArtworkOrigins: config.artworkAllowedOrigins,
    allowedFullCardOrigins: config.fullCardAllowedOrigins,
  };
}

export function createProductionDependencies(
  config: ServerConfig,
  store: SnapshotStore,
): BuildSnapshotDependencies {
  const client = new SpireCodexClient({
    baseUrl: config.spireCodexBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  return {
    client,
    store,
    baseUrl: config.spireCodexBaseUrl,
    fetchImpl: globalThis.fetch,
    fallbackRenderer: new FallbackRenderer({
      portraitBaseUrl: config.spireCodexBaseUrl,
      allowedPortraitOrigins: config.artworkAllowedOrigins,
    }),
    artworkConcurrency: config.artworkConcurrency,
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
