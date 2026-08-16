import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const readRoot = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

type RenderService = {
  type?: unknown;
  runtime?: unknown;
  plan?: unknown;
  healthCheckPath?: unknown;
  envVars?: Array<{ key?: unknown; value?: unknown }>;
  disk?: unknown;
};

const requiredEnvironmentKeys = [
  "STSDLE_HOST",
  "STSDLE_PORT",
  "STSDLE_DATA_DIR",
  "STSDLE_SKIP_SYNC",
  "STSDLE_ARTWORK_ALLOWED_ORIGINS",
  "STSDLE_FULL_CARD_ALLOWED_ORIGINS",
];

const environmentEntries = (service: RenderService, key: string) =>
  service.envVars?.filter((entry) => entry.key === key) ?? [];

const expectEnvironmentValue = (service: RenderService, key: string, value: string) => {
  const entries = environmentEntries(service, key);
  expect(entries).toHaveLength(1);
  expect(String(entries[0]?.value)).toBe(value);
};

describe("Render deployment configuration", () => {
  test("builds the bundled snapshot server without Playwright Chromium", async () => {
    const dockerfile = await readRoot("Dockerfile");
    expect(dockerfile).toContain("FROM node:24-bookworm-slim");
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("npm prune --omit=dev");
    expect(dockerfile).toContain("tar -xzf /app/deploy/snapshot-data.tar.gz -C /app/deploy/snapshot-data");
    expect(dockerfile).toContain("rm /app/deploy/snapshot-data.tar.gz");
    expect(dockerfile).toContain('CMD ["node", "dist/server/main.js"]');
    expect(dockerfile).not.toContain("playwright install");
    expect(dockerfile).not.toContain("PLAYWRIGHT_BROWSERS_PATH");
  });

  test("uses one stateless Starter web service for the immutable bundled snapshot", async () => {
    const blueprint = parse(await readRoot("render.yaml")) as { services?: RenderService[] };
    expect(blueprint.services).toHaveLength(1);
    const service: RenderService = blueprint.services?.[0] ?? {};
    expect(service).toMatchObject({
      type: "web",
      runtime: "docker",
      plan: "starter",
      healthCheckPath: "/health",
    });
    expect(service).not.toHaveProperty("disk");
    expect(service.envVars).toHaveLength(requiredEnvironmentKeys.length);
    expect(service.envVars?.map((entry) => entry.key).sort()).toEqual([...requiredEnvironmentKeys].sort());
    expectEnvironmentValue(service, "STSDLE_HOST", "0.0.0.0");
    expectEnvironmentValue(service, "STSDLE_PORT", "10000");
    expectEnvironmentValue(service, "STSDLE_DATA_DIR", "/app/deploy/snapshot-data");
    expectEnvironmentValue(service, "STSDLE_SKIP_SYNC", "1");
    for (const originsKey of ["STSDLE_ARTWORK_ALLOWED_ORIGINS", "STSDLE_FULL_CARD_ALLOWED_ORIGINS"]) {
      expectEnvironmentValue(service, originsKey, "https://spire-codex.com,https://cdn.spire-codex.com");
    }
    for (const omittedKey of [
      "STSDLE_ARTWORK_CONCURRENCY",
      "STSDLE_REQUEST_TIMEOUT_MS",
      "STSDLE_SPIRE_CODEX_BASE_URL",
    ]) expect(environmentEntries(service, omittedKey)).toHaveLength(0);
  });

  test("excludes local state and renderer vendor files while retaining the deployment snapshot", async () => {
    const ignore = await readRoot(".dockerignore");
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("var");
    expect(ignore.split(/\r?\n/)).toContain("tests");
    expect(ignore).toContain(".tmp");
    expect(ignore).toContain("vendor/card-renderer");
    expect(ignore.split(/\r?\n/)).not.toContain("deploy");
    expect(ignore.split(/\r?\n/)).not.toContain("deploy/snapshot-data.tar.gz");
  });

});
