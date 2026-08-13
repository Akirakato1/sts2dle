import type { ServerConfig } from "../config.js";
import { FallbackRenderer } from "../images/fallback-renderer.js";
import { SpireCodexClient } from "../spire-codex/client.js";
import {
  buildSnapshot,
  type ActivatedSnapshot,
  type BuildSnapshotDependencies,
} from "./build-snapshot.js";
import { SnapshotStore } from "./snapshot-store.js";

export async function buildProductionSnapshot(
  config: ServerConfig,
  store: SnapshotStore,
): Promise<ActivatedSnapshot> {
  return buildSnapshot(createProductionDependencies(config, store));
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
      requestTimeoutMs: config.requestTimeoutMs,
    }),
    requestTimeoutMs: config.requestTimeoutMs,
    artworkConcurrency: config.artworkConcurrency,
    allowedArtworkOrigins: config.artworkAllowedOrigins,
    allowedFullCardOrigins: config.fullCardAllowedOrigins,
  };
}
