# STS-dle

STS-dle is an unofficial Slay the Spire 2 card-deduction game. Daily and Practice rounds compare the base and upgraded forms of every card across eleven traits.

## Prerequisites and installation

Install Node.js 22.12 or newer and the npm version bundled with it. From the repository root:

```powershell
npm install
npx playwright install chromium
```

Chromium is required for browser acceptance tests and for the production fallback renderer used when a card has no full-card CDN image.

## Development

Create a writable data directory, then start the server and Vite client in separate PowerShell terminals:

```powershell
New-Item -ItemType Directory -Force .\var
$env:STSDLE_DATA_DIR = ".\var"
$env:STSDLE_ARTWORK_ALLOWED_ORIGINS = "https://spire-codex.com,https://cdn.spire-codex.com"
$env:STSDLE_FULL_CARD_ALLOWED_ORIGINS = "https://spire-codex.com,https://cdn.spire-codex.com"
npm run dev:server
```

```powershell
npm run dev:client
```

Open `http://127.0.0.1:5173`. The development client proxies runtime data and health requests to the server on port 3000. `npm run dev` starts both processes together.

The server defaults are documented in `.env.example`. `STSDLE_DATA_DIR` must point to a directory the server can create files, rename files, and read on every restart. Production startup synchronizes against `https://spire-codex.com/api/cards?lang=eng`; keep `STSDLE_ARTWORK_CONCURRENCY` at four or lower and adjust origin allowlists only for trusted HTTPS image hosts.

## Tests and offline fixture

Unit and integration tests use local fixtures and make no live Spire Codex request:

```powershell
npm test
```

To build and serve only the deterministic browser fixture:

```powershell
$env:STSDLE_DATA_DIR = ".tmp/e2e-var"
$env:STSDLE_SKIP_SYNC = "1"
npm run fixture:snapshot
npm run dev:server
```

`STSDLE_SKIP_SYNC=1` never creates or trusts an unvalidated snapshot. Startup fails unless the selected data directory already contains an active snapshot that passes schema, group, sprite, fallback-image, and file-hash validation.

Run the complete static/unit/build check and full browser acceptance suite with:

```powershell
npm run check
npm run test:e2e
```

The E2E command builds the application, creates its local snapshot, starts an offline server on `127.0.0.1:3000`, and launches Chromium. It does not use production synchronization.

## Production

Build once, set a persistent writable data directory, and start the server:

```powershell
npm run build
New-Item -ItemType Directory -Force .\var
$env:STSDLE_DATA_DIR = ".\var"
$env:STSDLE_ARTWORK_ALLOWED_ORIGINS = "https://spire-codex.com,https://cdn.spire-codex.com"
$env:STSDLE_FULL_CARD_ALLOWED_ORIGINS = "https://spire-codex.com,https://cdn.spire-codex.com"
npm start
```

On every normal restart, the server fetches the current stable English card response once, builds sprites and any required fallback cards in a staging snapshot, validates all files and hashes, atomically activates the snapshot, logs a payload-free startup acceptance record, and only then begins listening. A source patch changes the content revision even when no explicit game-version header is available. Artwork and fallback-portrait requests use `STSDLE_REQUEST_TIMEOUT_MS` for both response headers and body reads and retry only bounded transient failures (HTTP 408/429/5xx or network/timeout failures); URL-policy, redirect, credential, IP, and other HTTP 4xx failures are never retried.

If refresh fails, the server revalidates the previous active snapshot before serving it and logs only a fixed error category. If no valid previous snapshot exists, startup fails closed. Never use `STSDLE_SKIP_SYNC=1` as a production refresh bypass.

Production synchronization is serialized per resolved `STSDLE_DATA_DIR`, including across server processes. Before listening, each server acquires a containment-checked lifetime lease for the exact snapshot it serves; graceful close and failed listen release it, while retention reclaims only confirmed-dead owners. After a validated activation, the store keeps the active snapshot, the most recent validated prior recovery snapshot, and every snapshot leased by a live or ambiguous owner; it prunes only older unleased validated snapshots. Invalid, unknown, unrelated, linked, junction, or escaped paths are preserved. A lock with ambiguous ownership fails closed; a confirmed dead-process lock can be recovered. Recognizably owned `.staging` directories from crashed builds are removed only while the exclusive synchronization lock is held. Normally size the writable data volume for two complete snapshots plus one temporary in-progress staging snapshot during startup, and allow one additional complete snapshot for each concurrently live server still serving an older activation.

The server stores and serves the candidate/guess artwork atlases plus exceptional 400 x 520 fallback full cards. Ordinary base and upgraded full-card images remain the responsibility of the trusted CDN and are loaded directly by the browser; the server does not proxy or persist them.

Daily selection uses the UTC date and the active content revision. A restart with the same revision preserves that UTC day's answer and stored progress. If the stable source changes during the same UTC day, the revision changes and the browser starts the new revision-scoped Daily instead of mixing old guesses with new card data. Practice rounds are random and never write Daily round storage or expose sharing.

## Attribution

Card data and hosted image references come from [Spire Codex](https://spire-codex.com); its [API terms](https://github.com/ptrlrd/spire-codex/blob/main/API_TERMS.md) apply. Slay the Spire 2 and its game data/artwork belong to [Mega Crit](https://www.megacrit.com/) and their respective rights holders. The exceptional-card renderer is derived from the MIT-licensed [Slay the Spire 2 Card Maker](https://github.com/WanderZil/Slay-the-Spire-2-Card-Maker). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the complete renderer, asset, font, and fan-project notices.
