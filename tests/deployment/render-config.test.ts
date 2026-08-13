import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readRoot = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const environmentValues = (blueprint: string, key: string) => {
  const lines = blueprint.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    if (line !== `      - key: ${key}`) return [];
    const valueLine = lines[index + 1];
    if (!valueLine?.startsWith("        value: ")) return [];
    return [valueLine.slice("        value: ".length).replace(/^"|"$/g, "")];
  });
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
    const blueprint = await readRoot("render.yaml");
    const serviceTypes = blueprint.split(/\r?\n/)
      .flatMap((line) => /^  - type: (.+)$/.exec(line)?.[1] ?? []);
    expect(serviceTypes).toEqual(["web"]);
    expect(blueprint).toContain("    plan: starter");
    expect(environmentValues(blueprint, "STSDLE_ARTWORK_CONCURRENCY")).toEqual(["4"]);
    for (const originsKey of [
      "STSDLE_ARTWORK_ALLOWED_ORIGINS",
      "STSDLE_FULL_CARD_ALLOWED_ORIGINS",
    ]) {
      expect(environmentValues(blueprint, originsKey)).toEqual([
        "https://spire-codex.com,https://cdn.spire-codex.com",
      ]);
    }
    for (const required of [
      "type: web", "runtime: docker", "healthCheckPath: /health",
      "mountPath: /var/data", "sizeGB: 1", "key: STSDLE_HOST", "value: 0.0.0.0",
      "key: STSDLE_PORT", "value: 10000", "key: STSDLE_DATA_DIR", "value: /var/data",
      "key: STSDLE_SKIP_SYNC", 'value: "0"',
    ]) expect(blueprint).toContain(required);
  });

  test("excludes local state but retains vendored renderer assets", async () => {
    const ignore = await readRoot(".dockerignore");
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("var");
    expect(ignore).not.toContain("vendor");
  });
});
