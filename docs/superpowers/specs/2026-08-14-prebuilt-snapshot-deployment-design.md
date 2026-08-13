# Prebuilt snapshot deployment design

## Goal

Deploy STS-dle on Render's 512 MiB Starter service without synchronizing card data, packing sprite atlases, or launching Chromium in the deployed container. Card updates will instead be generated and validated on the maintainer's computer, committed to the repository, and deployed automatically by pushing that commit to `main`.

This design supersedes the runtime-synchronization and persistent-disk portions of `2026-08-13-render-deployment-design.md`. The existing Docker/Fastify deployment model, health check, trusted Spire Codex origins, and fail-closed snapshot validation remain.

## Chosen approach

Store one complete active production snapshot at a fixed repository path and copy it into the Docker image. Render starts with synchronization disabled, validates the bundled snapshot, and serves it.

This is preferred over two alternatives:

- Downloading a release artifact during startup would add another network dependency and could still prevent the service from listening.
- Running a separate high-memory Render synchronization job would require a second paid compute workflow and coordination with persistent storage.

The committed snapshot is only a few megabytes per card patch, so the simpler repository-backed release artifact is appropriate. Binary history growth can be revisited if patch frequency or atlas size grows materially.

## Snapshot contents and data flow

The fixed deployment directory will contain the same validated structure already consumed by `SnapshotStore`:

```text
deploy/snapshot-data/
  active.json
  snapshots/<build-id>/
    manifest.json
    cards.json
    base-groups.json
    pair-groups.json
    candidate.webp
    guess.webp
    sprite-map.json
    fallback/... (only when required)
```

Only the active snapshot is kept in the working tree. Replacing it removes the prior build directory from the new tree, while Git history remains the rollback mechanism.

During a local refresh, the Spire Codex card API supplies normalized card data, artwork URLs, and base/upgraded full-card URLs. Artwork is downloaded locally to create the two sprite atlases. Full-size accepted-answer cards are not bundled when an official full-card URL exists: the deployed client loads those URLs directly from the Spire Codex CDN. This consumes the player's browser memory and Spire Codex bandwidth, not Render server memory or bandwidth. If an eligible full-card URL is absent, the local renderer creates the existing validated fallback image and includes it in the committed snapshot.

## Local release command

The maintainer-facing command will be:

```powershell
npm run release:snapshot
```

It will perform this ordered workflow:

1. Confirm the command is running in the repository, the working tree is clean, and no unrelated changes could be committed.
2. Fetch `origin/main` and require the local `HEAD` to equal it. The command will not merge, rebase, pull, create a branch, or open a pull request.
3. Fetch the stable English Spire Codex response once. If its source revision matches the committed snapshot, exit successfully without generating, committing, or pushing. A deliberate `--force` option permits regeneration after generator changes.
4. Run the normal project verification against the clean source revision.
5. Generate the new snapshot in a fresh temporary directory outside the committed deployment directory, using the existing production normalizer, grouping, sprite builder, URL policy, and fallback renderer.
6. Fully validate schema strictness, hashes, feature groups, sprite bounds and decoding, fallback files, and allowed full-card/artwork origins before touching the committed snapshot.
7. Publish the validated snapshot to a repository-local staging path, replace `deploy/snapshot-data` as one controlled operation, and validate the published copy again. If publication or the second validation fails, restore the former committed snapshot.
8. Require every resulting tracked change to be under `deploy/snapshot-data`, stage that path only, and create a commit whose message identifies the snapshot refresh and short source revision.
9. Push exactly `HEAD:main` to `origin` using the computer's configured SSH authentication.

The Git operations will use argument-safe child processes rather than interpolated shell commands. Expected failures will use fixed, payload-free messages. A generation or validation failure leaves the previously committed snapshot unchanged. A push failure leaves the verified local commit intact and reports that only the push must be retried.

The lower-level generator and validator will remain independently callable by tests without executing Git mutations or network pushes.

## Server and container behavior

Render will use:

- `STSDLE_SKIP_SYNC=1`.
- `STSDLE_DATA_DIR=/app/deploy/snapshot-data` (or the equivalent immutable image path established by the Dockerfile).
- The existing `0.0.0.0:10000` bind and `/health` check.
- The two exact official Spire Codex origins for snapshot URL validation.
- No persistent disk, because game progress lives in browser local storage and the card snapshot lives in the image.

The Starter plan and automatic deployment from `main` remain. Artwork concurrency and request-timeout settings are removed from the Render Blueprint because deployed startup no longer performs card or artwork requests.

The Docker image will copy the committed deployment snapshot and will not install a Chromium binary. Playwright becomes a local/build-time development dependency rather than a production-serving dependency. Synchronization-only modules, especially the fallback renderer, must not be imported on the serve-only startup path; otherwise pruning Playwright would make module loading fail even though synchronization is skipped. Local synchronization remains available through the dedicated release command.

At startup, the server loads `active.json`, performs the existing strict snapshot validation, acquires its normal snapshot lifetime lease if applicable, and begins listening. A missing, corrupt, unhashed, out-of-bounds, or untrusted snapshot fails closed rather than silently synchronizing or serving partial data.

## Failure and recovery behavior

- API, artwork, rendering, generation, or validation failure: abort the local release and preserve the committed snapshot.
- Project verification failure: abort before snapshot publication.
- Git divergence or dirty worktree: abort without changing files.
- Push failure: retain the local snapshot commit and provide a safe push-retry instruction.
- Render image missing a valid snapshot: fail closed and keep the previous successful Render deployment active.
- Spire Codex full-card image temporarily unavailable to a player: use the existing client image error/retry behavior; this does not affect server health.
- Bad published snapshot discovered later: revert the snapshot commit on `main`; Render automatically redeploys the prior repository state.

No credentials, API payloads, absolute local paths, or card-answer secrets are written to release logs or committed metadata.

## Documentation and verification

Automated coverage will verify:

- The committed production snapshot validates completely and contains exactly one active build.
- The release command rejects dirty/diverged repositories, does not commit unrelated files, exits unchanged for an identical revision, restores on publication failure, and pushes only after successful validation and commit.
- The Render Blueprint uses serve-only mode, the immutable snapshot path, no disk, and only official image origins.
- The Docker image does not install Chromium and retains every runtime dependency needed for validation and serving.
- Serve-only startup does not call the Spire Codex API, artwork fetcher, sprite builder, or fallback renderer.
- `/health`, runtime JSON, both sprite atlases, SPA routes, and remote full-card URLs work from the bundled snapshot.
- A production-style serve-only process remains comfortably below the Starter service's 512 MiB memory limit.

The README will document the single refresh command, prerequisites (supported Node/npm, dependencies, Playwright Chromium for local fallback rendering, Git SSH access), unchanged-revision behavior, push/retry behavior, and Render's automatic redeploy. Final acceptance will generate a fresh real snapshot locally, push it to `main`, observe Render build and startup logs, and verify the public `/health` and card-data endpoints without any production synchronization.
