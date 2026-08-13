# Render deployment design

## Goal

Make `Akirakato1/sts2dle` deployable from GitHub through Render with no manual container configuration beyond connecting the repository and approving the Blueprint. The deployed service must run the existing Node server, perform the normal Spire Codex synchronization on startup, render the rare fallback card through Chromium, and preserve validated snapshots across deploys and restarts.

## Chosen approach

Use one Render Docker web service described by a repository-root `render.yaml`.

- A static host is unsuitable because STS-dle requires its Fastify server, startup synchronization, snapshot validation, and sprite generation.
- Render's native Node runtime could run the app, but installing Chromium and its Linux system dependencies there is less deterministic.
- A Docker service gives the repository an explicit Node and Chromium runtime and is therefore the recommended approach.

## Container

The repository-root `Dockerfile` will:

1. Start from the official Node 24 Debian image, matching the supported project runtime.
2. Install dependencies from `package-lock.json` with `npm ci`.
3. Install Chromium and its system dependencies using the repository's locked Playwright package, preventing browser/package version drift.
4. Build both `dist/client` and `dist/server`.
5. Remove development-only npm dependencies after the build.
6. Start `dist/server/main.js` as the single foreground process.

`PLAYWRIGHT_BROWSERS_PATH` will use a stable container path so the runtime server can launch the installed browser. A `.dockerignore` will exclude local dependencies, build output, snapshots, logs, Git metadata, tests, and scratch files from the Docker build context. Vendored renderer assets remain included because fallback generation needs them.

## Render Blueprint

`render.yaml` will define one paid starter web service because persistent disks are not available on Render's free web-service tier.

- Runtime: Docker, built from the root `Dockerfile`.
- Health check: `/health`.
- Host: `0.0.0.0`.
- Port: `10000`, matching Render's default public web-service port.
- Data directory: `/var/data`.
- Persistent disk: 1 GB mounted at `/var/data`.
- Normal synchronization: enabled; `STSDLE_SKIP_SYNC=0`.
- Trusted image origins: the official Spire Codex application and CDN origins.
- Artwork concurrency: four, retaining the application's enforced upper bound.
- Auto-deploy: enabled for commits pushed to the connected `main` branch.

No API keys or secrets are required. The disk limits the service to one instance, which matches the application's snapshot workflow.

## Startup and failure behavior

On its first deployment, the service starts with an empty disk, fetches the stable English card response, builds sprites and any fallback cards, validates the complete snapshot, activates it atomically, and then listens. Later deploys reuse the disk and retain recovery snapshots according to the existing production lifecycle.

If synchronization fails and a previously activated snapshot validates, the server serves that snapshot. If no validated snapshot exists, startup fails closed and Render's health check does not route traffic to the failed deployment.

## Documentation and verification

The README will explain the Blueprint flow, the paid-disk requirement, first-start timing, health endpoint, auto-deploy behavior, and the fact that `STSDLE_SKIP_SYNC` must remain disabled in production.

Automated deployment-contract tests will inspect the Dockerfile and Blueprint for the required runtime, build, browser installation, bind address, port, disk, sync, health check, and official-origin settings. The normal typecheck, unit suite, production build, and diff checks must remain green. If Docker is installed locally, the image will also be built and smoke-tested; otherwise the exact missing local capability will be reported without claiming a container smoke test.

