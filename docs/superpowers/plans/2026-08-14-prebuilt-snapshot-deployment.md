# Prebuilt Snapshot Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate the production card snapshot locally, commit it to GitHub, and make Render serve that immutable snapshot without synchronizing cards or launching Chromium.

**Architecture:** A synchronization-only module owns Spire Codex access, sprite packing, and the existing Mad Science fallback renderer. A release layer builds into an isolated temporary data directory, validates and publishes one active snapshot under `deploy/snapshot-data`, then uses guarded Git operations to commit and push only that directory. Render starts with synchronization disabled, validates the bundled snapshot, and serves it from the image while clients continue loading framed accepted-answer images directly from official Spire Codex URLs.

**Tech Stack:** Node.js 24, TypeScript, Fastify, Sharp, Playwright (local release only), Vitest, Docker, Render Blueprint, Git/SSH.

## Global Constraints

- Support Node.js `>=22.12`; execute final verification with the bundled Node 24 runtime.
- Keep `main` as the only pushed GitHub branch; do not create a pull request.
- Never add `Co-Authored-By` commit trailers.
- Render must not call the Spire Codex API, download artwork, pack sprites, or import/launch Playwright during serve-only startup.
- The local release must retain the renderer for every card version missing an official framed-card URL; the current stable data requires base and upgraded Mad Science fallbacks.
- Browser clients continue fetching official remote full-card URLs directly; only generated missing-image fallbacks are bundled.
- Only `https://spire-codex.com` and `https://cdn.spire-codex.com` are trusted image origins.
- A failed generation, validation, or publication must preserve the previously committed snapshot.
- Automatic Git commits may contain only `deploy/snapshot-data`; dirty or diverged repositories fail before mutation.
- Expected CLI errors and logs must not expose payloads, credentials, absolute local paths, card IDs, source URLs, or generated ownership tokens.
- Render remains a single `starter` Docker web service bound to `0.0.0.0:10000` with `/health`; it has no persistent disk.

---

## File Structure

### New production/release files

- `src/server/sync/production-sync.ts` — constructs network, renderer, and builder dependencies only when synchronization is requested.
- `src/server/release/deployment-bundle.ts` — reads, stages, validates, publishes, and restores immutable deployment bundles; has no Git or network behavior.
- `src/server/release/git-client.ts` — runs argument-safe Git commands and enforces clean/current/path-scoped release rules.
- `src/server/release/release-snapshot.ts` — orchestrates revision comparison, checks, isolated generation, publication, commit, and push through injected interfaces.
- `src/server/release/cli.ts` — creates real dependencies and reports fixed success/failure messages.
- `src/server/release/build-cli.ts` — generates a validated bundle at an explicit output path without any Git operation; used for the initial snapshot and controlled maintenance.

### New test files

- `tests/server/production-sync-boundary.test.ts` — proves serve-only startup never loads synchronization code.
- `tests/server/deployment-bundle.test.ts` — proves exact bundle layout, validation, containment, replacement, and rollback.
- `tests/server/git-client.test.ts` — proves exact Git command/path behavior and sanitized failures.
- `tests/server/release-snapshot.test.ts` — proves orchestration order, no-op revisions, force mode, and failure boundaries.
- `tests/deployment/committed-snapshot.test.ts` — validates the real committed snapshot and its one-build invariant.

### Modified files

- `src/server/main.ts` — dynamically loads production synchronization only on the non-skip path.
- `package.json`, `package-lock.json` — add release scripts and move `playwright` to development-only dependencies.
- `Dockerfile` — remove Chromium installation and serve the bundled snapshot.
- `.dockerignore` — retain `deploy/snapshot-data` while excluding local renderer sources/assets that the serving image does not need.
- `render.yaml` — switch to immutable serve-only data and remove the disk/synchronization tuning.
- `tests/server/app.test.ts` — retain lifecycle guarantees while asserting the lazy synchronization loader boundary.
- `tests/deployment/render-config.test.ts` — enforce the new Docker and Blueprint contract.
- `README.md` — document local snapshot release and stateless Render deployment.
- `deploy/snapshot-data/**` — the first real validated production snapshot.

---

### Task 1: Isolate synchronization-only dependencies from server startup

**Files:**
- Create: `src/server/sync/production-sync.ts`
- Modify: `src/server/main.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/server/production-sync-boundary.test.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Produces: `buildProductionSnapshot(config: ServerConfig, store: SnapshotStore): Promise<ActivatedSnapshot>`.
- Produces: injectable `loadProductionSync?: () => Promise<ProductionSync>` in `MainDependencies`, where `type ProductionSync = (config: ServerConfig, store: SnapshotStore) => Promise<ActivatedSnapshot>`.
- Consumes: existing `createProductionDependencies`, `buildSnapshot`, `SpireCodexClient`, and `FallbackRenderer` behavior without changing snapshot output.

- [ ] **Step 1: Write failing serve-only boundary tests**

Add tests that pass `STSDLE_SKIP_SYNC: "1"`, a valid active snapshot, and a rejecting loader spy:

```ts
const loadProductionSync = vi.fn(async () => {
  throw new Error("synchronization module loaded");
});
await main({
  env: { STSDLE_SKIP_SYNC: "1" },
  store,
  loadProductionSync,
  loadActivatedSnapshot: vi.fn(async () => activated),
  createApp,
});
expect(loadProductionSync).not.toHaveBeenCalled();
```

Add the complementary non-skip assertion that the loader is called once and its returned synchronizer is called once before `createApp` and `listen`.

- [ ] **Step 2: Run the boundary tests to verify RED**

Run:

```powershell
npm exec vitest run tests/server/production-sync-boundary.test.ts tests/server/app.test.ts
```

Expected: TypeScript/test failure because `loadProductionSync` and `production-sync.ts` do not exist and `main.ts` still imports renderer/network code eagerly.

- [ ] **Step 3: Move production synchronization construction behind a dynamic import**

Create `production-sync.ts` with the renderer/client imports currently in `main.ts`:

```ts
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
```

Change `main.ts` so the default loader is evaluated only inside the non-skip branch:

```ts
const loadSync = dependencies.loadProductionSync ?? async () =>
  (await import("./sync/production-sync.js")).buildProductionSnapshot;

if (config.skipSync) {
  // Existing prior-snapshot validation path.
} else {
  if (dependencies.sync) active = await dependencies.sync(config, store);
  else {
    if (!(store instanceof SnapshotStore)) {
      throw new Error("Default synchronization requires SnapshotStore");
    }
    active = await (await loadSync())(config, store);
  }
}
```

Retain the existing prior-snapshot recovery, lease, logging, and cleanup semantics.

- [ ] **Step 4: Move Playwright out of serving dependencies**

Move the exact locked `playwright` requirement from `dependencies` to `devDependencies` with npm so `package-lock.json` remains authoritative:

```powershell
npm install --save-dev playwright@1.62.1
```

Verify `npm ls --omit=dev playwright` reports no production Playwright package while `npm ls playwright` resolves the local renderer dependency.

- [ ] **Step 5: Run focused tests and typecheck to verify GREEN**

Run:

```powershell
npm exec vitest run tests/server/production-sync-boundary.test.ts tests/server/app.test.ts tests/server/fallback-renderer.test.ts
npm run typecheck
```

Expected: all focused tests pass; serve-only loader count is zero; non-skip loader and synchronizer counts are one; renderer tests still pass locally.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/server/main.ts src/server/sync/production-sync.ts package.json package-lock.json tests/server/production-sync-boundary.test.ts tests/server/app.test.ts
git commit -m "refactor: isolate snapshot synchronization"
```

---

### Task 2: Build and atomically publish immutable deployment bundles

**Files:**
- Create: `src/server/release/deployment-bundle.ts`
- Create: `tests/server/deployment-bundle.test.ts`

**Interfaces:**
- Produces: `readDeploymentRevision(dataDir: string): Promise<string | null>`.
- Produces: `stageDeploymentBundle(sourceDataDir: string, stagingDir: string, options: SnapshotValidationOptions): Promise<ActiveSnapshot>`.
- Produces: `beginDeploymentBundlePublish(stagingDir: string, destinationDir: string, options: SnapshotValidationOptions, operations?: PublishOperations): Promise<PublishedBundle>`, where `PublishedBundle` exposes `active`, idempotent `finalize()`, and idempotent `rollback()`.
- Consumes: `SnapshotStore.loadActive`, `loadActivatedSnapshot`, filesystem containment helpers, and the existing strict validator.

- [ ] **Step 1: Write failing bundle tests with real valid snapshots**

Use `mkdtemp(join(tmpdir(), "stsdle-deploy-bundle-"))` and the existing deterministic fixture builder pattern. Cover:

```ts
await expect(readDeploymentRevision(missingDir)).resolves.toBeNull();
await expect(stageDeploymentBundle(source, staging, validationOptions)).resolves.toMatchObject({ buildId });
expect(await readdir(join(staging, "snapshots"))).toEqual([buildId]);
await expect(loadActivatedSnapshot(join(staging, "snapshots", buildId), validationOptions)).resolves.toBeDefined();
```

Add tests that:

- reject source or destination symlink/junction escapes before copying;
- exclude prior recovery snapshots and staging/lease/lock artifacts;
- reject malformed `active.json` and corrupt hashes;
- restore the original destination when an injected post-swap validation fails;
- retry only transient `EPERM`/`EBUSY` rename failures within a fresh monotonic publication deadline, then either succeed or fail sanitized;
- leave no backup/staging artifact after success;
- return only the 64-lowercase-hex source revision from the active manifest.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```powershell
npm exec vitest run tests/server/deployment-bundle.test.ts
```

Expected: FAIL because the deployment-bundle module does not exist.

- [ ] **Step 3: Implement staging with exact one-build structure**

Implement the core staging sequence:

```ts
const sourceStore = new SnapshotStore(sourceDataDir);
const active = await sourceStore.loadActive();
if (!active) throw new Error("Source snapshot is unavailable");
await loadActivatedSnapshot(active.path, options);
await mkdir(join(stagingDir, "snapshots"), { recursive: true });
await cp(active.path, join(stagingDir, "snapshots", active.buildId), {
  recursive: true,
  errorOnExist: true,
  force: false,
});
await writeFile(
  join(stagingDir, "active.json"),
  `${JSON.stringify({ buildId: active.buildId })}\n`,
  { encoding: "utf8", flag: "wx" },
);
```

Resolve and containment-check source, staging, active snapshot, destination parent, backup, and quarantine paths before recursive copying, renaming, or removal. Do not follow symbolic links inside the bundle.

- [ ] **Step 4: Implement replacement and rollback**

Use a sibling backup path under the resolved destination parent. Validate staging before the first rename; rename the current destination to backup; rename staging to destination; validate the published active snapshot. On validation failure, quarantine the invalid destination and restore the backup. Return a transaction object that retains the verified backup until `finalize()` and restores it on `rollback()`, allowing later Git failures to leave the worktree unchanged. Remove only ownership-verified sibling paths created by this call. Retry only Windows transient `EPERM`/`EBUSY` rename failures with a monotonic bounded deadline and ownership revalidation before every retry. Return fixed error messages and preserve raw filesystem errors only as `cause`.

- [ ] **Step 5: Run focused tests and typecheck to verify GREEN**

```powershell
npm exec vitest run tests/server/deployment-bundle.test.ts tests/server/validate-snapshot.test.ts tests/server/snapshot-store.test.ts
npm run typecheck
git diff --check
```

Expected: all tests pass, including rollback and containment mutations.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/server/release/deployment-bundle.ts tests/server/deployment-bundle.test.ts
git commit -m "feat: publish immutable card snapshots"
```

---

### Task 3: Add the guarded local snapshot release command

**Files:**
- Create: `src/server/release/git-client.ts`
- Create: `src/server/release/release-snapshot.ts`
- Create: `src/server/release/cli.ts`
- Create: `src/server/release/build-cli.ts`
- Create: `tests/server/git-client.test.ts`
- Create: `tests/server/release-snapshot.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `GitClient.assertReady(): Promise<void>`, `GitClient.assertOnlySnapshotChanges(): Promise<void>`, `GitClient.commitSnapshot(sourceRevision: string): Promise<void>`, and `GitClient.pushMain(): Promise<void>`.
- Produces: `releaseSnapshot(options: ReleaseSnapshotOptions, dependencies: ReleaseSnapshotDependencies): Promise<{ status: "unchanged" | "released"; sourceRevision: string }>`.
- Produces: `buildSnapshotBundle(options: BuildSnapshotBundleOptions): Promise<ActiveSnapshot>` for the first repository snapshot and tests, without Git mutation.
- Consumes: Task 1 `createProductionDependencies`; Task 2 revision/staging/publication functions.

- [ ] **Step 1: Write failing Git safety tests**

Use an injected argument-array runner and assert these exact command shapes:

```ts
expect(runner.calls).toContainEqual(["git", ["fetch", "origin", "main"]]);
expect(runner.calls).toContainEqual(["git", ["push", "origin", "HEAD:main"]]);
expect(runner.calls).toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data"]]);
```

Cover dirty tracked files, untracked files, `HEAD !== refs/remotes/origin/main`, non-SSH origin, wrong repository path, extra changed paths, extra staged paths, commit failure, and push failure. Assert errors contain neither fake absolute roots nor fake SSH credentials. The expected origin forms are exactly `git@github.com:Akirakato1/sts2dle.git` and `ssh://git@github.com/Akirakato1/sts2dle.git`.

- [ ] **Step 2: Run Git tests to verify RED**

```powershell
npm exec vitest run tests/server/git-client.test.ts
```

Expected: FAIL because `GitClient` does not exist.

- [ ] **Step 3: Implement argument-safe Git operations**

Use `spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })`, bounded output buffers, and fixed public errors. `assertReady` must:

1. check `git rev-parse --show-toplevel`;
2. check `git status --porcelain=v1 --untracked-files=all` is empty;
3. check the exact SSH origin;
4. run `git fetch origin main`;
5. compare `git rev-parse HEAD` with `git rev-parse refs/remotes/origin/main`.

`assertOnlySnapshotChanges` must parse porcelain entries and require every path to equal `deploy/snapshot-data` or start with `deploy/snapshot-data/`. Repeat the same containment check on `git diff --cached --name-only` after staging.

- [ ] **Step 4: Write failing orchestration tests**

Use injected fakes to prove this order:

```ts
expect(events).toEqual([
  "git-ready", "fetch", "checks", "build-temp", "validate-temp",
  "publish", "validate-published", "scope-check", "commit", "push",
]);
```

Add cases for:

- identical revision returns `unchanged` immediately after `git-ready` and `fetch`;
- `force: true` rebuilds an identical revision;
- checks fail before generation;
- generation/validation fails before publication;
- publication failure restores the destination and never commits;
- scope, stage, or commit failure calls the publication transaction's `rollback()` and leaves the snapshot path identical to `HEAD`;
- extra changes prevent staging/commit;
- push failure occurs only after the verified commit and returns the fixed retry command;
- fetched data is reused by the builder so `/api/cards` is called once;
- temporary directories and renderer/browser resources settle on every path.

- [ ] **Step 5: Run orchestration tests to verify RED**

```powershell
npm exec vitest run tests/server/release-snapshot.test.ts
```

Expected: FAIL because `releaseSnapshot` and `buildSnapshotBundle` do not exist.

- [ ] **Step 6: Implement the release orchestrator and CLI**

Construct one `SpireCodexClient`, fetch once, and pass a cached client into `buildSnapshot`:

```ts
const fetched = await client.fetchCards();
if (!options.force && fetched.sourceRevision === committedRevision) {
  return { status: "unchanged", sourceRevision: fetched.sourceRevision };
}
await dependencies.runChecks();
const cachedClient = { fetchCards: async () => fetched };
```

Create the build data directory with `mkdtemp(join(tmpdir(), "stsdle-snapshot-release-"))`. Always await renderer cleanup through the existing batch renderer and remove the owned temporary root in `finally`. Call Task 2 publication only after the temporary active snapshot validates. Call `PublishedBundle.finalize()` after a successful Git commit; call `rollback()` for every pre-commit failure. A push failure occurs after finalization and deliberately keeps the local commit.

Invoke npm without a shell using `process.platform === "win32" ? "npm.cmd" : "npm"`; run `npm run check` through the same bounded child-process abstraction used for Git.

The release CLI accepts only optional `--force`; every other argument fails with `Unknown snapshot release option`. On success print either `Card snapshot is already current` or `Card snapshot committed and pushed to main`. On failure print `Card snapshot release failed`; when the commit exists but push failed, additionally print exactly `Retry: git push origin HEAD:main`. Set a nonzero exit code without printing the raw error.

The separate build CLI requires exactly `--output <repository-relative-path>`, rejects absolute/escaping paths, runs the same isolated build, validation, and publication code, and never constructs `GitClient`.

Add scripts:

```json
"snapshot:build": "tsx src/server/release/build-cli.ts",
"release:snapshot": "tsx src/server/release/cli.ts"
```

Keep `snapshot:build` as the lower-level generation command for tests and initial repository setup; `release:snapshot` remains the normal maintainer command.

- [ ] **Step 7: Run focused and full unit verification**

```powershell
npm exec vitest run tests/server/git-client.test.ts tests/server/release-snapshot.test.ts tests/server/deployment-bundle.test.ts tests/server/fallback-renderer.test.ts
npm run typecheck
npm test
git diff --check
```

Expected: focused and full suites pass; no spawned process, browser, temp directory, or listener remains.

- [ ] **Step 8: Commit Task 3**

```powershell
git add src/server/release/git-client.ts src/server/release/release-snapshot.ts src/server/release/cli.ts src/server/release/build-cli.ts tests/server/git-client.test.ts tests/server/release-snapshot.test.ts package.json
git commit -m "feat: add local snapshot release command"
```

---

### Task 4: Convert Docker and Render to stateless serve-only deployment

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `render.yaml`
- Modify: `tests/deployment/render-config.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: bundled `deploy/snapshot-data` and Task 1 lazy synchronization boundary.
- Produces: one stateless Render Starter web service that validates and serves the image-bundled snapshot.

- [ ] **Step 1: Rewrite deployment contract tests first**

Require the Dockerfile to contain:

```ts
expect(dockerfile).toContain("FROM node:24-bookworm-slim");
expect(dockerfile).toContain("npm ci");
expect(dockerfile).toContain("npm run build");
expect(dockerfile).toContain("npm prune --omit=dev");
expect(dockerfile).toContain('CMD ["node", "dist/server/main.js"]');
expect(dockerfile).not.toContain("playwright install");
expect(dockerfile).not.toContain("PLAYWRIGHT_BROWSERS_PATH");
```

Parse `render.yaml` as YAML and require exactly one service with no `disk`, exactly six environment entries (`STSDLE_HOST`, `STSDLE_PORT`, `STSDLE_DATA_DIR`, `STSDLE_SKIP_SYNC`, and both origin lists), `STSDLE_DATA_DIR=/app/deploy/snapshot-data`, and `STSDLE_SKIP_SYNC=1`. Assert artwork concurrency, request timeout, and Spire Codex base URL are absent.

Require `.dockerignore` to exclude `tests`, `.tmp`, `var`, and `vendor/card-renderer`, while not excluding `deploy` or `deploy/snapshot-data`.

- [ ] **Step 2: Run deployment tests to verify RED**

```powershell
npm exec vitest run tests/deployment/render-config.test.ts
```

Expected: FAIL on Chromium installation, disk, `/var/data`, synchronization enabled, and missing immutable snapshot documentation.

- [ ] **Step 3: Update Dockerfile and Blueprint**

Use this Docker shape:

```dockerfile
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "dist/server/main.js"]
```

Change the Blueprint service to:

```yaml
envVars:
  - key: STSDLE_HOST
    value: 0.0.0.0
  - key: STSDLE_PORT
    value: 10000
  - key: STSDLE_DATA_DIR
    value: /app/deploy/snapshot-data
  - key: STSDLE_SKIP_SYNC
    value: "1"
  - key: STSDLE_ARTWORK_ALLOWED_ORIGINS
    value: https://spire-codex.com,https://cdn.spire-codex.com
  - key: STSDLE_FULL_CARD_ALLOWED_ORIGINS
    value: https://spire-codex.com,https://cdn.spire-codex.com
```

Remove the `disk` mapping entirely.

- [ ] **Step 4: Rewrite deployment and update documentation**

Document:

- Render serves a repository snapshot and performs no startup synchronization;
- no persistent disk is required;
- `npm run release:snapshot` prerequisites and exact behavior;
- `--force` for generator-only changes;
- unchanged revisions create no commit;
- push failure retry command;
- local Playwright Chromium is needed only when a missing framed card such as Mad Science must be rendered;
- full accepted-answer cards normally load directly from the official CDN in each player's browser;
- later pushes to `main` deploy automatically.

Remove statements requiring `STSDLE_SKIP_SYNC=0`, first-deploy synchronization waits, runtime recovery snapshots, and a paid persistent disk.

- [ ] **Step 5: Run focused tests and build**

```powershell
npm exec vitest run tests/deployment/render-config.test.ts tests/server/production-sync-boundary.test.ts tests/server/app.test.ts
npm run typecheck
npm run build
git diff --check
```

Expected: all pass; the built server starts in injected serve-only tests without importing Playwright.

- [ ] **Step 6: Commit Task 4**

```powershell
git add Dockerfile .dockerignore render.yaml README.md tests/deployment/render-config.test.ts
git commit -m "deploy: serve bundled card snapshot"
```

---

### Task 5: Generate and commit the first real production snapshot

**Files:**
- Create: `deploy/snapshot-data/active.json`
- Create: `deploy/snapshot-data/snapshots/<generated-build-id>/**`
- Create: `tests/deployment/committed-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 3 build-only snapshot path and existing strict validator.
- Produces: one Git-tracked active snapshot containing current stable English data, both atlases, official remote card URLs, and Mad Science fallback WebPs.

- [ ] **Step 1: Write a failing committed-snapshot contract test**

```ts
const root = fileURLToPath(new URL("../../deploy/snapshot-data", import.meta.url));
const store = new SnapshotStore(root);
const active = await store.loadActive();
expect(active).not.toBeNull();
expect(await readdir(join(root, "snapshots"))).toEqual([active!.buildId]);
const loaded = await loadActivatedSnapshot(active!.path, OFFICIAL_VALIDATION_OPTIONS);
expect(loaded.report.cardCount).toBeGreaterThan(500);
expect(loaded.report.fallbackCardIds).toContain("MAD_SCIENCE");
```

Also assert every non-fallback full-card URL has one of the two official origins and every card has both candidate and guess sprite rectangles.

- [ ] **Step 2: Run the contract test to verify RED**

```powershell
npm exec vitest run tests/deployment/committed-snapshot.test.ts
```

Expected: FAIL because `deploy/snapshot-data/active.json` does not exist.

- [ ] **Step 3: Install the matching local Chromium and generate into a fresh output**

With bundled Node 24 first on `PATH`, run:

```powershell
npx playwright install chromium
npm run snapshot:build -- --output deploy/snapshot-data
```

The build-only command must generate outside the destination, validate, publish, and exit without staging, committing, fetching, or pushing Git.

- [ ] **Step 4: Audit the generated snapshot**

Verify and record:

- source revision and Last-Modified;
- card, upgrade, base-group, and pair-group counts;
- exactly one active build and zero staging/lock/lease artifacts;
- manifest hashes for every emitted file;
- decoded candidate and guess atlas dimensions/bounds;
- exact fallback card IDs and files;
- `MAD_SCIENCE` base/upgraded URLs point to two bundled fallback WebPs;
- every other remote full-card URL uses an official origin;
- no raw API payload or absolute local path is committed.

- [ ] **Step 5: Run the committed-snapshot test to verify GREEN**

```powershell
npm exec vitest run tests/deployment/committed-snapshot.test.ts tests/server/validate-snapshot.test.ts
npm run typecheck
git diff --check
```

Expected: snapshot validation passes and the fallback report identifies Mad Science.

- [ ] **Step 6: Commit Task 5**

```powershell
git add tests/deployment/committed-snapshot.test.ts deploy/snapshot-data
git commit -m "data: bundle current card snapshot"
```

---

### Task 6: Full verification, memory proof, GitHub push, and Render acceptance

**Files:**
- Modify only if a verified acceptance defect requires a TDD fix.
- Append verification evidence to the implementation report under `.superpowers/sdd/2026-08-14-prebuilt-snapshot-deployment/` without force-adding the ignored report.

**Interfaces:**
- Consumes: Tasks 1–5 complete repository state.
- Produces: pushed `main`, a healthy Render deployment, and a proven future no-op/update workflow.

- [ ] **Step 1: Run the exact supported-runtime gate**

Run in order with bundled Node 24 first on `PATH`:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: all commands exit 0; E2E makes zero browser requests to either official Codex origin except the explicit blocked guard probes.

- [ ] **Step 2: Prove production dependency and container contracts**

Run:

```powershell
npm ls --omit=dev playwright
npm exec vitest run tests/deployment/render-config.test.ts tests/deployment/committed-snapshot.test.ts
```

Expected: production dependency listing contains no Playwright; deployment and committed-snapshot tests pass. If Docker is available, build the image, run it with no network synchronization allowance, and verify `/health`, `/runtime/cards.json`, `/runtime/candidate.webp`, and `/runtime/guess.webp` return 200. If Docker is unavailable, record that exact limitation without claiming a Docker smoke test.

- [ ] **Step 3: Measure serve-only startup memory**

Start the built server with:

```powershell
$env:STSDLE_SKIP_SYNC = "1"
$env:STSDLE_DATA_DIR = "deploy/snapshot-data"
$env:STSDLE_PORT = "3113"
node dist/server/main.js
```

Sample the complete owned process tree through validation and steady serving. Require peak working set below 400 MiB, leaving at least 112 MiB headroom under Render Starter's 512 MiB limit. Confirm no Chromium child and no requests to `/api/cards` or artwork endpoints. Stop only the verified owned process and prove port 3113 is free.

- [ ] **Step 4: Verify the future release command no-op before pushing**

Because local commits are ahead of `origin/main`, exercise the orchestration with an injected/current-reference test rather than weakening its guard. Re-run `tests/server/release-snapshot.test.ts` and confirm the identical-revision path performs no build/commit/push. Do not bypass `assertReady` against the real repository.

- [ ] **Step 5: Push the complete implementation directly to GitHub main**

Confirm the worktree is clean, review commit trailers, then run:

```powershell
git push origin HEAD:main
```

Expected: push succeeds through the configured SSH key and `git status --short --branch` reports local `master` aligned with `origin/main`.

- [ ] **Step 6: Run the real unchanged-revision release command**

Now that local HEAD equals `origin/main`, run:

```powershell
npm run release:snapshot
```

Expected: it fetches the current card response once, reports `Card snapshot is already current`, leaves `git status` clean, and creates no commit or push.

- [ ] **Step 7: Observe Render deployment and verify public service**

Use the authenticated Render service page to confirm:

- the deploy uses the pushed commit;
- no persistent disk is attached or required by the Blueprint;
- logs show snapshot startup acceptance before listen;
- logs contain no synchronization, sprite packing, fallback rendering, Chromium, OOM, or no-open-port failure;
- `/health` returns the committed source revision and counts;
- `/runtime/cards.json` and both atlases return 200;
- the public SPA loads and accepted-answer remote/fallback images render.

If the existing disk cannot be detached automatically by the Blueprint, detach only the known empty/failed-deployment disk after confirming the bundled snapshot serves correctly; do not delete any unrelated Render resource.

- [ ] **Step 8: Final review and handoff**

Run:

```powershell
git status --short --branch
git log --format=full -8
git diff origin/main...HEAD --check
```

Expected: clean aligned repository, no `Co-Authored-By`, no unpushed commit, and healthy Render deployment. Report the public URL, source revision/counts, peak serve-only memory, Mad Science fallback count, and the future command `npm run release:snapshot`.
