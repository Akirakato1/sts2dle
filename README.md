# STS-dle

STS-dle is an unofficial Slay the Spire 2 card-deduction game. Its four tabs are Daily, Hardcore Daily, Practice, and Search. Game rounds compare the base and upgraded forms of every card across seven features: Class, Type, Mana, Rarity, Target, Powers, and Keywords. For Powers and Keywords, exact sets are green, any corresponding overlap is yellow, and no overlap is red.

## Gameplay

Daily offers the shared UTC-date puzzle with three one-use assistance orbs and progressive card-name hints. Hardcore Daily is a separate UTC-date puzzle with no candidates, orbs, or progressive name hints: enter a complete remembered card name, with punctuation, case, and spacing ignored.

Practice provides unlimited assisted rounds; use **End game** to forfeit the current round and reveal its accepted answers. Before playing, **Hardcore Practice** can instead be selected for the same assistance-free memory entry used by Hardcore Daily. The choice persists across reloads and new Practice rounds, and locks after the first guess or orb use.

Search is a utility workspace, not a game round. It filters every card in the active validated snapshot: scalar choices use OR, Powers and Keywords use AND, enabled groups combine with AND, and base and upgraded forms are checked separately. A fresh Search enables every group with nothing selected, so it starts with no results until choices are checked or groups are disabled. **Disable** accepts any value for its group, and **Reset** restores the empty enabled state. Filter selections and the collapsed/expanded panel preference persist locally across reloads; the name query, result scroll, and open preview do not. Opening a result compares its Base and Upgraded card faces using only that card's snapshot-backed `baseCardUrl` and `upgradedCardUrl`. The running application has no card-data API or runtime card renderer.

The hero countdown shows the time remaining until the shared UTC-midnight rollover for Daily and Hardcore Daily puzzles.

Round progress and Daily statistics are persisted only in the local browser. STS-dle has no account or database for player progress, and Practice results are not shareable.

## Prerequisites and installation

Install Node.js 22.12 or newer and the npm version bundled with it. From the repository root:

```powershell
npm install
npx playwright install chromium
```

Chromium is required for browser acceptance tests. It is also needed locally only when a snapshot release must render a missing framed card such as Mad Science; the Render image does not install Chromium.

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

The server defaults are documented in `.env.example`. `STSDLE_DATA_DIR` selects the validated snapshot that the server reads. For a local generated snapshot, set it to the directory produced by the release tooling; only use trusted HTTPS image hosts in the origin allowlists.

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

## Snapshot releases

Render serves the repository archive `deploy/snapshot-data.tar.gz` and performs no startup synchronization. The Docker build extracts it into `/app/deploy/snapshot-data` and removes the compressed copy before the server starts. Before releasing, start with a clean local checkout of `main` that matches `origin/main`, with the approved GitHub SSH remote and push authentication available. Run:

```powershell
npm run release:snapshot
```

The command fetches the current stable English card data, compares its source revision with the committed archive, runs the full checks when the revision changed, builds and validates the replacement archive, commits only `deploy/snapshot-data.tar.gz`, and pushes that commit to `main`. An unchanged revision creates no commit. Use this command after generator-only changes to rebuild the same source revision:

```powershell
npm run release:snapshot -- --force
```

If the commit succeeds but the push fails, retry it with:

```powershell
git push origin HEAD:main
```

The snapshot contains candidate and guess artwork, preview URL references, and exceptional framed fallback cards. Full accepted-answer and Search preview cards normally load directly from the official CDN in each player's browser; the server does not proxy or render them at runtime. The unchanged release-time fallback renderer remains available only to generate a missing framed card, such as Mad Science, while building a snapshot; install local Playwright Chromium when that fallback is needed.

Daily selection uses the UTC date and the active content revision. A restart with the same revision preserves that UTC day's answer and stored progress. If the stable source changes during the same UTC day, the revision changes and the browser starts the new revision-scoped Daily instead of mixing old guesses with new card data. Practice rounds are random and never write Daily round storage or expose sharing.

## Deploy to Render

1. Sign in to Render and select **New → Blueprint**.
2. Connect GitHub, then choose `Akirakato1/sts2dle` on the `main` branch.
3. Confirm the single Starter web service. It serves the immutable repository snapshot, has no startup synchronization, and requires no persistent disk.
4. Wait for `/health` to become ready, then use the generated HTTPS URL.
5. Later pushes to `main` deploy automatically.

## Attribution

Card data and hosted image references come from [Spire Codex](https://spire-codex.com); its [API terms](https://github.com/ptrlrd/spire-codex/blob/main/API_TERMS.md) apply. Slay the Spire 2 and its game data/artwork belong to [Mega Crit](https://www.megacrit.com/) and their respective rights holders. The exceptional-card renderer is derived from the MIT-licensed [Slay the Spire 2 Card Maker](https://github.com/WanderZil/Slay-the-Spire-2-Card-Maker). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the complete renderer, asset, font, and fan-project notices.
