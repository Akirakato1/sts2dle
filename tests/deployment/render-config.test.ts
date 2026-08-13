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
  disk?: { mountPath?: unknown; sizeGB?: unknown };
};

const requiredEnvironmentKeys = [
  "STSDLE_HOST",
  "STSDLE_PORT",
  "STSDLE_DATA_DIR",
  "STSDLE_SKIP_SYNC",
  "STSDLE_ARTWORK_CONCURRENCY",
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
  test("builds the app with matching Playwright Chromium and starts the server", async () => {
    const dockerfile = await readRoot("Dockerfile");
    expect(dockerfile).toContain("FROM node:24-bookworm-slim");
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("npx playwright install --with-deps chromium");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain('CMD ["node", "dist/server/main.js"]');
  });

  test("uses one health-checked web service with persistent synchronized data", async () => {
    const blueprint = parse(await readRoot("render.yaml")) as { services?: RenderService[] };
    expect(blueprint.services).toHaveLength(1);
    const service: RenderService = blueprint.services?.[0] ?? {};
    expect(service).toMatchObject({
      type: "web",
      runtime: "docker",
      plan: "starter",
      healthCheckPath: "/health",
      disk: { mountPath: "/var/data", sizeGB: 1 },
    });
    expect(service.envVars).toHaveLength(requiredEnvironmentKeys.length);
    expectEnvironmentValue(service, "STSDLE_HOST", "0.0.0.0");
    expectEnvironmentValue(service, "STSDLE_PORT", "10000");
    expectEnvironmentValue(service, "STSDLE_DATA_DIR", "/var/data");
    expectEnvironmentValue(service, "STSDLE_SKIP_SYNC", "0");
    expectEnvironmentValue(service, "STSDLE_ARTWORK_CONCURRENCY", "4");
    for (const originsKey of ["STSDLE_ARTWORK_ALLOWED_ORIGINS", "STSDLE_FULL_CARD_ALLOWED_ORIGINS"]) {
      expectEnvironmentValue(service, originsKey, "https://spire-codex.com,https://cdn.spire-codex.com");
    }
  });

  test("excludes local state but retains vendored renderer assets", async () => {
    const ignore = await readRoot(".dockerignore");
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("var");
    expect(ignore.split(/\r?\n/)).toContain("tests");
    expect(ignore).not.toContain("vendor");
  });

  test("documents the one-click Blueprint deployment and persistent-disk requirement", async () => {
    const readme = await readRoot("README.md");
    for (const required of [
      "Deploy to Render", "New → Blueprint", "Akirakato1/sts2dle",
      "/health", "STSDLE_SKIP_SYNC=0",
    ]) expect(readme).toContain(required);
    expect(readme).toContain("paid Starter service and its 1 GB persistent disk");
    expect(readme).toContain("Later pushes to `main` deploy automatically.");
  });
});
