# Render Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-defined Docker and Render Blueprint deployment that runs the production STS-dle server with Chromium and persistent snapshot storage.

**Architecture:** A single Docker image installs the lockfile dependencies, installs matching Chromium/system libraries through Playwright, builds both application targets, prunes development dependencies, and starts Fastify. `render.yaml` creates one paid Docker web service with a 1 GB `/var/data` disk, production sync, a `/health` check, and GitHub auto-deploys.

**Tech Stack:** Node.js 24, npm, Playwright Chromium, Docker, Render Blueprint YAML, Fastify.

## Global Constraints

- The service must bind `0.0.0.0:10000`.
- `STSDLE_DATA_DIR` must be `/var/data` on a 1 GB persistent disk.
- Production must use `STSDLE_SKIP_SYNC=0`.
- Artwork concurrency must remain at or below four.
- Only `https://spire-codex.com` and `https://cdn.spire-codex.com` are trusted image origins.
- The browser installation must match the repository's locked Playwright dependency.
- Do not add secrets, branches, pull requests, or `Co-Authored-By` trailers.

---

### Task 1: Docker and Blueprint contract

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `render.yaml`
- Create: `tests/deployment/render-config.test.ts`

**Interfaces:**
- Consumes: existing `package.json` scripts `build` and `start`; server environment variables from `.env.example`.
- Produces: a Docker build context and Render Blueprint consumable directly from the repository root.

- [ ] **Step 1: Write the failing deployment-contract test**

Create a Vitest suite that reads all three root files and asserts these exact behaviors:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readRoot = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm exec vitest run tests/deployment/render-config.test.ts`

Expected: FAIL because `Dockerfile`, `.dockerignore`, and `render.yaml` do not exist.

- [ ] **Step 3: Add the minimal Dockerfile**

Use the supported Node image, install the locked npm graph before Playwright's matching browser, and build in one deterministic image:

```dockerfile
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "dist/server/main.js"]
```

- [ ] **Step 4: Add the minimal Docker ignore file**

Exclude local artifacts without excluding `vendor/card-renderer`:

```text
.git
.github
.tmp
.superpowers
node_modules
dist
var
test-results
playwright-report
coverage
*.log
```

- [ ] **Step 5: Add the Render Blueprint**

Define a single starter Docker service, exact environment values, and one disk:

```yaml
services:
  - type: web
    name: sts2dle
    runtime: docker
    plan: starter
    dockerfilePath: ./Dockerfile
    dockerContext: .
    healthCheckPath: /health
    autoDeployTrigger: commit
    envVars:
      - key: STSDLE_HOST
        value: 0.0.0.0
      - key: STSDLE_PORT
        value: 10000
      - key: STSDLE_DATA_DIR
        value: /var/data
      - key: STSDLE_SKIP_SYNC
        value: "0"
      - key: STSDLE_ARTWORK_CONCURRENCY
        value: "4"
      - key: STSDLE_ARTWORK_ALLOWED_ORIGINS
        value: https://spire-codex.com,https://cdn.spire-codex.com
      - key: STSDLE_FULL_CARD_ALLOWED_ORIGINS
        value: https://spire-codex.com,https://cdn.spire-codex.com
    disk:
      name: sts2dle-data
      mountPath: /var/data
      sizeGB: 1
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `npm exec vitest run tests/deployment/render-config.test.ts`

Expected: all deployment-contract tests PASS.

- [ ] **Step 7: Commit the deployable configuration**

```powershell
git add Dockerfile .dockerignore render.yaml tests/deployment/render-config.test.ts
git commit -m "feat: add Render deployment configuration"
```

### Task 2: Deployment documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `tests/deployment/render-config.test.ts`

**Interfaces:**
- Consumes: the root Dockerfile and Blueprint produced by Task 1.
- Produces: operator instructions for first deployment, health checks, persistent storage, and automatic redeployment.

- [ ] **Step 1: Add a failing README contract assertion**

Extend the focused test:

```ts
test("documents the one-click Blueprint deployment and persistent-disk requirement", async () => {
  const readme = await readRoot("README.md");
  for (const required of [
    "Deploy to Render", "New → Blueprint", "Akirakato1/sts2dle",
    "persistent disk", "/health", "STSDLE_SKIP_SYNC=0", "main",
  ]) expect(readme).toContain(required);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm exec vitest run tests/deployment/render-config.test.ts`

Expected: FAIL because the README lacks the Render deployment section.

- [ ] **Step 3: Add concise Render instructions to README**

Document these exact operator steps:

1. Sign in to Render and choose **New → Blueprint**.
2. Connect GitHub and choose `Akirakato1/sts2dle` on `main`.
3. Confirm the paid starter service and 1 GB persistent disk.
4. Deploy and wait for the first synchronization before `/health` becomes ready.
5. Use the generated HTTPS URL; later pushes to `main` deploy automatically.
6. Keep `STSDLE_SKIP_SYNC=0`; describe snapshot recovery and disk sizing.

- [ ] **Step 4: Run focused and project verification**

Run in order under Node 24:

```powershell
npm exec vitest run tests/deployment/render-config.test.ts
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Build and smoke-test Docker when available**

First run `docker version`. If Docker is available:

```powershell
docker build -t sts2dle-render .
```

Then run the image with a new temporary named volume, bind port 10000, wait for `/health`, verify the card count, and stop only that container. If Docker is unavailable, record that limitation and do not claim a container smoke test.

- [ ] **Step 6: Commit documentation**

```powershell
git add README.md tests/deployment/render-config.test.ts
git commit -m "docs: explain Render deployment"
```

