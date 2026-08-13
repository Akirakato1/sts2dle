# Task 3 report: guarded local snapshot release command

## Status

Implemented and committed Task 3 on the shared current branch.

- Commit: `18c269c feat: add local snapshot release command`
- Base observed before work: `828a1523f12df847a1f64b2fa634ff51b07ea8b1`
- Node runtime used for verification: `C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe` (Node 24 bundle)

## Files

- `src/server/release/git-client.ts`
- `src/server/release/release-snapshot.ts`
- `src/server/release/cli.ts`
- `src/server/release/build-cli.ts`
- `tests/server/git-client.test.ts`
- `tests/server/release-snapshot.test.ts`
- `package.json`

## TDD evidence

### RED: Git safety client

Command:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' '.\node_modules\vitest\vitest.mjs' run tests/server/git-client.test.ts
```

Observed: exit 1; Vitest failed because `../../src/server/release/git-client.js` did not exist.

### GREEN: Git safety client

Same command after implementation: exit 0; 1 file and 15 tests passed. A later index-only commit regression first failed with `Unable to commit card snapshot`, then passed after removing the commit pathspec; final focused Git result was 16/16.

### RED: release orchestration

Command:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' '.\node_modules\vitest\vitest.mjs' run tests/server/release-snapshot.test.ts
```

Observed: exit 1; Vitest failed because `../../src/server/release/release-snapshot.js` did not exist.

### GREEN: release orchestration

Same command after the first implementation: exit 0; 1 file and 14 tests passed.

### RED/GREEN: CLI and cleanup hardening

- CLI tests failed because `../../src/server/release/cli.js` did not exist; after implementation the combined suite passed 21/21.
- The build-only rollback-cleanup regression failed because rollback failure escaped as `Card snapshot release failed` and skipped the intended fixed build failure; after settlement was made non-short-circuiting, the suite passed 23/23.

## Verification evidence

Focused integration command:

```powershell
npm exec vitest run tests/server/git-client.test.ts tests/server/release-snapshot.test.ts tests/server/deployment-bundle.test.ts tests/server/fallback-renderer.test.ts
```

Observed: exit 0; 4 files, 81 tests passed.

Fresh final commands:

```powershell
npm run typecheck
npm test
git diff --check
```

Observed:

- `npm run typecheck`: exit 0.
- `npm test`: exit 0; 43 files, 613 tests passed.
- `git diff --check`: exit 0; only Git's CRLF conversion notice for `package.json` was printed.

## Security self-review

- Child processes use `spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })` through one bounded runner.
- Runner uses finite timeouts and bounded combined stdout/stderr buffers; failure paths await child close and expose fixed public errors only.
- Git readiness validates the exact repository root, empty tracked/untracked status, one of the two exact SSH origins, fetches exactly `origin main`, and requires `HEAD === refs/remotes/origin/main` before mutation.
- Snapshot scope is checked before staging and again in the index after exact `git add -A -- deploy/snapshot-data`; commit consumes only that verified index.
- Release fetches cards exactly once and injects the fetched response through the cached builder client.
- Identical revision returns before project checks/build/publication unless `--force` is set.
- Temporary generation uses an owned `mkdtemp` root; cleanup is awaited for success and failure. Existing batch rendering awaits page/context/browser cleanup.
- Publication happens only after temporary validation. Every pre-commit failure rolls back; finalize occurs only after commit. Push failure retains the local commit and is mapped to the fixed retry command.
- CLI output never prints caught errors. Fixed errors omit causes, payloads, absolute roots, and credentials across the error chain.
- Build CLI rejects missing, absolute, repository-root, and escaping output paths, and has no Git dependency injection or construction path.
- No branch, push, pull request, or co-author trailer was created.

## Concerns

- The real release and build CLIs were not run end-to-end because they intentionally perform network-intensive snapshot generation and, for release, Git mutation/push. Their behavior is covered through injected integration tests plus the existing real deployment publication and renderer suites.
- Git emitted expected LF-to-CRLF conversion notices on this Windows checkout; `git diff --check` remained clean.

## Fix Round 1

### Findings addressed

1. **Windows npm launch:** replaced direct `npm.cmd` execution with a validated absolute `npm-cli.js` path launched by `process.execPath`, preserving `shell: false` and argument arrays. The npm CLI can be explicitly injected and the default resolver accepts only a real absolute `npm-cli.js` file.
2. **Process-tree cancellation:** the bounded runner now creates a detached POSIX process group or uses the exact validated System32 `taskkill.exe /PID <pid> /T /F` on Windows. It verifies a positive child PID, bounds primary and fallback termination, destroys inherited pipes on the secondary fallback, clears every timer, removes data/close/error listeners, and returns only `Child process failed`.
3. **Rollback index:** added `GitClient.rollbackSnapshotIndex()`. Pre-commit failure cleanup independently awaits both publication rollback and snapshot-index restoration, so failure of one cannot skip the other. Modern Git uses `restore --staged --source=HEAD -- deploy/snapshot-data`; the installed Git 2.8 compatibility path uses the argument-safe equivalent `reset HEAD -- deploy/snapshot-data`.
4. **Exact commit tree:** snapshot staging now uses a private `GIT_INDEX_FILE` inside an owned temporary directory under the repository Git directory. `write-tree`, `commit-tree`, and compare-and-swap `update-ref HEAD <new> <old>` construct the commit without hooks and without trusting a concurrently mutable shared index. The shared index is restored only for the snapshot path; unrelated concurrent staging is preserved and excluded from the commit.
5. **Default construction boundary:** dependency/config/path construction for `buildSnapshotBundle` and both CLIs is now inside fixed-error/output boundaries. Raw configuration, credential, token, and absolute-path causes are discarded.

### RED evidence

Command used for the first Git/runner RED cycle:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' '.\node_modules\vitest\vitest.mjs' run tests/server/git-client.test.ts
```

Observed: exit 1; 5 failures. Missing npm resolver, timeout and overflow exposed internal error messages, and the real temporary repositories failed because isolated commit/index rollback did not exist.

Command used for the orchestration/construction RED cycle:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' '.\node_modules\vitest\vitest.mjs' run tests/server/release-snapshot.test.ts
```

Observed: exit 1; 6 failures. Index rollback was not invoked, checks still launched `npm.cmd`, and default build dependency construction leaked the injected secret.

A further real-repository test failed because the private index was outside the repository Git directory; it passed after the index was moved under the resolved Git directory.

### GREEN and final verification

Focused Git/release result:

- `tests/server/git-client.test.ts tests/server/release-snapshot.test.ts`: 2 files, 49 tests passed.

Prescribed focused result:

```powershell
npm exec vitest run tests/server/git-client.test.ts tests/server/release-snapshot.test.ts tests/server/deployment-bundle.test.ts tests/server/fallback-renderer.test.ts
```

- Exit 0; 4 files, 92 tests passed.

Fresh final gates:

- `npm run typecheck`: exit 0.
- `npm test`: exit 0; 43 files, 623 tests passed.
- `git diff --check`: exit 0; only expected LF-to-CRLF notices.

### Real-boundary coverage

- Node 24 launches a harmless temporary-project `npm run check` through `node.exe npm-cli.js` and settles.
- Timeout and output-overflow fixtures spawn a grandchild holding inherited pipes; both tests prove the bounded promise settles, the grandchild PID exits, and timeout resources return to baseline.
- A real temporary Git repository proves publication plus index rollback leaves both the snapshot worktree and index identical to `HEAD` after commit failure.
- A real malicious pre-commit hook and concurrently staged unrelated file are excluded from the created commit; the unrelated shared-index entry remains untouched.
- Default build and CLI construction failures containing fake SSH credentials, absolute paths, and tokens expose only fixed public messages.

### Fix Round 1 concerns

- The local Git is 2.8.1 and rejects `status --porcelain=v1` and lacks `git restore`; exact modern commands remain the first attempt, with narrow argument-safe compatibility fallbacks for this supported checkout.
- The process-tree tests exercise the actual Windows Node 24 and `taskkill` path. The POSIX detached-process-group branch is typechecked and follows the standard negative-PID group kill, but was not executed on this Windows host.

## Fix Round 2

### Findings addressed

1. **Live Windows supervisor:** Windows commands now run below a dedicated Node supervisor whose only argv value is its fixed module path. The actual executable, exact argument array, cwd, and environment travel over IPC and are spawned with `shell: false` and `windowsHide: true`. The supervisor forwards stdout/stderr and remains alive while inherited pipes remain open. Before `taskkill`, the controller obtains a termination-ready acknowledgement that locks the supervisor open, preventing dead/reused-PID termination. `taskkill.exe /PID <supervisor> /T /F` must exit successfully; transient failures retry only while that acknowledged supervisor remains live. The controller never destroys pipes or reports settlement before the owned process resources close.
2. **Retryable private-index cleanup:** the private-index handle is cleared only after removal succeeds. EPERM/EBUSY removals retry against a bounded monotonic deadline; a persistent failure retains the exact owned handle for `cleanupPrivateIndex()` to retry. A post-`update-ref` cleanup failure has its own fixed `GitPostCommitCleanupError`, does not roll back the installed commit/ref, and release orchestration retries cleanup before finalize or push.

### RED evidence

Windows supervisor RED:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' .\node_modules\vitest\vitest.mjs run tests/server/git-client.test.ts -t "live supervisor"
```

Observed before implementation: exit 1; 2/2 new tests failed because the old runner resolved when the immediate command parent exited, before timeout/overflow and descendant cleanup.

Private-index cleanup RED:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' .\node_modules\vitest\vitest.mjs run tests/server/git-client.test.ts -t "private-index"
```

Observed before implementation: exit 1; 2/2 new tests failed. The injected remover was never used and the cleanup handle could not be retried.

The first full-suite run exposed two existing 5-second test budgets that were too short for the deliberate supervisor/taskkill boundary under parallel Windows load. The second full run exposed a scheduling race in the fixture. The real fixture now waits for a descendant IPC-ready signal before its command parent naturally exits; no production timeout or safety boundary was relaxed.

### GREEN and final verification

- Windows parent-exits-first supervisor tests: 2 passed. They prove fixed errors for timeout/overflow, descendant and supervisor PIDs exit, an unrelated sentinel remains live, and Timeout/PipeWrap/ProcessWrap resources return to baseline.
- Private-index tests: 2 passed. A fail-once EPERM is retried in one operation; a persistent EBUSY produces only the fixed post-commit cleanup error, preserves the installed ref and unrelated shared index, retains one owned directory, then removes every `stsdle-snapshot-index-*` directory on retry.
- Focused Git/release suite: 2 files, 54 tests passed.
- Full suite with Node 24: 43 files, 628 tests passed.
- Typecheck with Node 24: exit 0.
- Client/server build with Node 24 first on PATH: exit 0; the compiled release-only supervisor exists at `dist/server/release/process-supervisor.js`.
- `git diff --check`: exit 0; only expected Windows LF-to-CRLF notices.
- Temporary-directory inspection found no remaining `stsdle-snapshot-index-*` directory.

### Files changed

- `src/server/release/git-client.ts`
- `src/server/release/process-supervisor.ts`
- `src/server/release/release-snapshot.ts`
- `tests/server/fixtures/process-tree-child.mjs`
- `tests/server/git-client.test.ts`
- `tests/server/release-snapshot.test.ts`
- `.superpowers/sdd/2026-08-14-prebuilt-snapshot-deployment/task-3-report.md` (ignored report)

### Security self-review

- No command payload, credentials, environment entry, cwd, or temp path is placed in supervisor argv or a public error/cause chain.
- Every command and OS termination uses fixed executable/argument arrays with `shell: false`; the supervisor accepts one validated launch message and never interpolates data into a command string.
- The acknowledged supervisor PID is a live owned process held open until `taskkill` completes, so retries cannot target a recycled PID. The sentinel-process tests exercise this boundary on real Windows Node 24.
- Output remains jointly bounded; after overflow, further chunks are discarded while owned processes and streams are still awaited. Timers and listeners are removed on settlement, without unreferenced production timers.
- Post-commit cleanup failure is explicit state: the commit remains installed, the shared index remains uncorrupted, publication is not rolled back as though the commit had failed, and cleanup is retried before finalize/push.
- The cleanup handle survives all failed removals and is cleared only after the owned directory is actually removed. Injected secret/path errors are discarded.
- No branch, push, pull request, or co-author trailer was created.

### Commit

`30b1e2c` (`fix: supervise Windows release processes`)

### Fix Round 2 concerns

- The real Windows supervisor/taskkill boundary intentionally adds process-launch overhead to each guarded release Git/npm command; release commands are infrequent and safety takes precedence over throughput.
- The POSIX detached-process-group path was unchanged and typechecked, but this Windows host cannot execute that branch.

## Fix Round 3

### Findings addressed

1. **Bounded Windows termination:** supervisor readiness, injected/default taskkill, supervisor close, and fallback self-termination are each raced against monotonic deadlines. A timed-out taskkill removes listeners/timers, receives best-effort termination, and returns failure even if it never emits close/error. When controller taskkill fails or stalls, an authenticated supervisor message (and IPC disconnect fallback) makes the still-owned supervisor invoke exact `taskkill.exe /PID <self> /T /F`; the controller returns only the fixed child-process error after bounded cleanup grace.
2. **Durable post-commit recovery:** private-index cleanup and publication finalization are attempted independently after the commit is durable. Exhaustion produces `SnapshotPostCommitCleanupError` with only the fixed message and `committed=true`, writes `.git/stsdle-snapshot-recovery.json`, and never pushes. The marker contains only the commit plus direct-child artifact basenames and dev/ino/birthtime identities—no absolute paths or payloads. `--recover` requires a clean repository, exact origin, marker HEAD, and `HEAD^ === origin/main`; it verifies artifact identity, cleans private index and publication backup independently, pushes `HEAD:main`, then removes the marker. Normal readiness rejects while recovery is pending.
3. **Authenticated supervisor protocol:** a random IPC-only token binds launch/result/termination messages to the spawned supervisor. Success requires exactly one valid `{ type: "result", token, code, signal }` message before close. Missing, malformed, duplicate, or token-mismatched messages request fixed failure. Supervisor exit 0 without a result is explicitly rejected.

### RED evidence

Process/protocol RED:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' .\node_modules\vitest\vitest.mjs run tests/server/git-client.test.ts -t "supervisor|stubborn taskkill"
```

Observed before implementation: exit 1; both new tests failed because `createBoundedProcessRunner` and its bounded supervisor/taskkill seams did not exist. The existing runner could await readiness/taskkill/close forever and accepted supervisor close as completion.

Post-commit/CLI RED:

```powershell
& 'C:\Users\zhuyl\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe' .\node_modules\vitest\vitest.mjs run tests/server/release-snapshot.test.ts -t "independently after commit|recovery instructions|deterministic recovery|accepts only"
```

Observed before implementation: exit 1; 4/4 tests failed. The distinct committed cleanup error was absent, `--recover` was rejected, cleanup failure prevented finalize, and the CLI printed only the generic failure.

### GREEN and final verification

- Focused Git/release/deployment/renderer: 4 files, 103 tests passed.
- Full Node 24 unit suite: 43 files, 634 tests passed.
- Node 24 typecheck: exit 0.
- Node 24 client/server build: exit 0.
- `git diff --check`: exit 0; only expected Windows LF-to-CRLF notices.
- Real Windows stubborn-taskkill test rejects in under two seconds, then proves descendant/supervisor exit, sentinel survival, and process/timer resource baseline.
- Real Windows no-result supervisor fixture exits 0 without an IPC result and is rejected with exactly `Child process failed`.
- Real temporary Git repository records fixed recovery metadata, rejects normal readiness while marked, verifies `HEAD`/parent/origin and owned artifact identities, removes private-index and publication-backup artifacts, pushes, and removes the marker.

### Files changed

- `src/server/release/cli.ts`
- `src/server/release/deployment-bundle.ts`
- `src/server/release/git-client.ts`
- `src/server/release/process-supervisor.ts`
- `src/server/release/release-snapshot.ts`
- `tests/server/fixtures/supervisor-exit-no-result.mjs`
- `tests/server/git-client.test.ts`
- `tests/server/release-snapshot.test.ts`
- `.superpowers/sdd/2026-08-14-prebuilt-snapshot-deployment/task-3-report.md` (ignored report)

### Security self-review

- Command/env/cwd values remain IPC data, never supervisor argv or shell text; every spawn uses argument arrays, `shell: false`, and `windowsHide: true`.
- Supervisor control messages require the random per-run token. Duplicate/malformed messages cannot create success.
- Controller taskkill targets only a positive acknowledged live supervisor PID. Fallback taskkill is initiated by that supervisor against its own PID, so a recycled/unrelated PID is never selected.
- Every controller termination await is deadline-bounded. Timeout paths return a fixed error and do not expose executable, args, environment, PID, path, or underlying causes.
- Recovery accepts only the fixed marker schema, exact artifact basename patterns, exact direct-child paths, and matching filesystem identity. Artifact replacement or path escape is rejected.
- Recovery requires the marker commit at HEAD with exactly origin/main as its parent and retains the marker until the cleanup and push both succeed.
- Post-commit errors never masquerade as pre-commit rollback and never push before local cleanup/finalization succeeds.
- No branch, push, PR, or co-author trailer was created.

### Commit

`ee42fb8` (`fix: add bounded snapshot recovery`)

### Fix Round 3 concerns

- The Windows denial-of-termination case can only make best-effort OS requests; the API now settles with a fixed failure instead of claiming cleanup succeeded. Real test paths prove the supervisor-owned fallback removes the whole tree.
- POSIX process-group termination was unchanged and typechecked but cannot be runtime-tested on this Windows host.

## Fix Round 4

### Findings addressed

1. **Pre-ref durable recovery transaction:** `commitSnapshot` now records strict version-2 recovery metadata before `update-ref`. Publication uses an exclusive sibling temporary file, fixed schema, file `fsync`, atomic rename, and parent-directory `fsync` where supported. Marker publication and artifact ownership are verified before the ref compare-and-swap; an existing marker is never overwritten.
2. **Cleanup and push ordering:** the publication backup identity is captured before finalization and passed into the commit transaction. Successful local cleanup durably records both artifacts clean and removes the marker before the normal push. Recovery accepts both `origin/main == oldCommit` and `origin/main == newCommit`, so a successful recovery push followed by marker-unlink failure retries without pushing twice.
3. **Remote drift and idempotence:** recovery validates the local marker commit independently, cleans marker-owned local artifacts first, records each cleanup atomically, and only then classifies the remote as old, already pushed, or unrelated. Unrelated advancement returns the fixed recovery error while retaining a clean marker for a safe retry.
4. **TOCTOU-resistant artifact cleanup:** recovery renames each identity-checked direct child to its pre-recorded contained quarantine name, revalidates parent and source immediately before rename, verifies the quarantined dev/ino/birthtime, and recursively removes only that quarantine. A replacement injected immediately before quarantine is rejected without moving or deleting it; an external junction sentinel remains unchanged.
5. **Exact Windows termination startup:** the default runner resolves and validates the exact `%SystemRoot%\\System32\\taskkill.exe` at construction, rejects startup with only `Child process failed` when unavailable, and retains the supervisor's independently resolved self-termination path for primary termination failure.

### TDD evidence

- Durable marker RED: two real-repository tests failed because no marker existed at `update-ref` and an existing marker did not stop the ref move; both passed after the pre-ref atomic transaction.
- Orchestration RED: backup ownership was not passed into commit and marker-removal failure did not suppress push; both passed after the cleanup-before-push state transition.
- Recovery RED: push-success/unlink-failure resolved instead of retaining state, remote drift left artifacts, and a pre-quarantine replacement was not observed; all three real filesystem tests passed after quarantine-based idempotent recovery.
- Taskkill RED: runner construction accepted a missing fake System32 terminator; it passed after exact startup validation with a fixed error.
- Final self-review RED: the live publication transaction returned `null` after finalize; the focused test now proves the pre-finalize backup identity is retained through recovery completion.

### Verification

- `tests/server/git-client.test.ts tests/server/release-snapshot.test.ts`: exit 0; 2 files, 68 tests passed.
- `npm run typecheck` with the Node 24 bundle first on PATH: exit 0.
- `git diff --check`: exit 0; only expected Windows LF-to-CRLF notices.
- Targeted post-review orchestration regression: exit 0.

### Files changed

- `src/server/release/git-client.ts`
- `src/server/release/release-snapshot.ts`
- `tests/server/git-client.test.ts`
- `tests/server/release-snapshot.test.ts`
- `.superpowers/sdd/2026-08-14-prebuilt-snapshot-deployment/task-3-report.md` (ignored report)

### Fix Round 4 concerns

- The parent-requested timebox ended after focused tests, typecheck, and diff validation. The full unit suite and client/server build were not rerun in this round; the preceding round's full-suite/build evidence remains in this report.
- POSIX process-group termination was unchanged and cannot be runtime-tested on this Windows host.
