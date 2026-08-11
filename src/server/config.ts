import { parseAllowedImageOrigins } from "./images/url-policy.js";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  spireCodexBaseUrl: string;
  requestTimeoutMs: number;
  artworkConcurrency: number;
  artworkAllowedOrigins: string[];
  fullCardAllowedOrigins: string[];
  skipSync: boolean;
}

type Environment = Record<string, string | undefined>;

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env: Environment): ServerConfig {
  const artworkConcurrency = positiveInteger(
    env.STSDLE_ARTWORK_CONCURRENCY,
    4,
    "artwork concurrency",
  );
  if (artworkConcurrency > 4) {
    throw new Error("artwork concurrency must not exceed 4");
  }

  const [spireCodexBaseUrl] = parseAllowedImageOrigins(
    [env.SPIRE_CODEX_BASE_URL ?? "https://spire-codex.com"],
    "Spire Codex",
  );
  const artworkAllowedOrigins = parseAllowedImageOrigins(
    splitOrigins(env.STSDLE_ARTWORK_ALLOWED_ORIGINS, spireCodexBaseUrl!),
    "Artwork",
  );
  const fullCardAllowedOrigins = parseAllowedImageOrigins(
    splitOrigins(env.STSDLE_FULL_CARD_ALLOWED_ORIGINS, spireCodexBaseUrl!),
    "Full-card",
  );

  return {
    host: env.STSDLE_HOST ?? "127.0.0.1",
    port: positiveInteger(env.STSDLE_PORT, 3000, "port"),
    dataDir: env.STSDLE_DATA_DIR ?? "./var",
    spireCodexBaseUrl: spireCodexBaseUrl!,
    requestTimeoutMs: positiveInteger(
      env.STSDLE_REQUEST_TIMEOUT_MS,
      30_000,
      "request timeout",
    ),
    artworkConcurrency,
    artworkAllowedOrigins,
    fullCardAllowedOrigins,
    skipSync: env.STSDLE_SKIP_SYNC === "1",
  };
}

function splitOrigins(value: string | undefined, fallback: string): string[] {
  if (value === undefined) return [fallback];
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}
