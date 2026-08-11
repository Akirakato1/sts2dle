# STS-dle Design Specification

**Status:** Approved

**Date:** 2026-08-12

**Game:** Slay the Spire 2 card guessing game inspired by LoLdle Classic

## 1. Purpose

STS-dle is a daily and practice guessing game for Slay the Spire 2 cards. Players guess base card names. Every guess is evaluated twice: the guessed card's base features against the answer's base features, and the guessed card's upgraded features against the answer's upgraded features. The two comparisons are combined into one green, yellow, or red result per displayed feature.

The application must:

- Synchronize stable English card data from Spire Codex once when the web server starts.
- Build a validated, versioned data snapshot before accepting traffic.
- Generate two small locally hosted artwork sprite atlases at server startup.
- Load full base and upgraded card images directly from the Spire Codex CDN for the answer reveal.
- Offer one Daily game and an unlimited Practice mode.
- Select answers without overweighting crowded base feature sets.
- Accept every card whose base-and-upgraded feature pair exactly matches the selected answer pair.
- Preserve Daily progress and streaks locally without requiring a database or account.

## 2. Scope and non-goals

The first release includes:

- Stable/main Spire Codex data in English.
- One paired-card ruleset; there are no separate Base and Mixed game modes.
- Daily and Practice play.
- Desktop, tablet, and mobile layouts.
- Keyboard, mouse, and touch input.
- Shareable Daily results that do not disclose card names.

The first release does not include:

- User accounts, server-side player history, leaderboards, or multiplayer.
- Localization.
- Strong anti-cheat protection. Full answer image URLs are intentionally preloaded in the browser and can be inspected by a determined player.
- Per-request synchronization or runtime card rendering for ordinary gameplay.
- Beta-channel cards.

## 3. Source data, images, and licensing

### 3.1 Spire Codex

Spire Codex is the canonical synchronization source. At server startup, STS-dle fetches the complete stable English card dataset and its HTTP response metadata from the hosted API. The snapshot's authoritative source revision is the SHA-256 hash of the exact card-response body; `Last-Modified` and any future explicit game-version header are recorded as informational metadata. This remains deterministic when the current `/api/versions` response does not expose a stable game version.

For each card, STS-dle retains:

- Stable card ID and display name.
- Character/color, card type, rarity, mana cost, and formal keywords.
- Upgrade data needed to derive the upgraded variant.
- Raw artwork URL for sprite generation.
- Full base-card and upgraded-card CDN URLs for answer reveal.

The deployed site must include clear Spire Codex attribution and comply with the hosted API's community-use terms. Game data and artwork remain the property of Mega Crit and their respective rights holders.

### 3.2 Local dashboard renderer

The existing JavaScript card renderer is located at:

`C:\Users\zhuyl\OneDrive\Desktop\sts2_stats\Release Version\scripts\render\renderer.js`

Its associated card-render assets are located at:

`C:\Users\zhuyl\OneDrive\Desktop\sts2_stats\Release Version\card render assets`

The renderer is not part of the ordinary image path. It is copied with its required MIT attribution and used only to generate a full-card fallback when Spire Codex has no full-card CDN image for a supported card. STS-dle must not copy the dashboard's Spire Codex parser implementation or other PolyForm Noncommercial parser code. A small original adapter maps the public hosted API schema into STS-dle's internal schema.

## 4. Application architecture

STS-dle is one Node.js/TypeScript application with:

- **Fastify server:** owns startup synchronization, snapshot activation, and static hosting.
- **React + Vite client:** owns search, gameplay, animations, persistence, and sharing.
- **Sharp image pipeline:** downloads raw art and creates deterministic WebP sprite atlases.
- **Shared TypeScript package:** defines snapshot schemas, canonical feature keys, selection, comparison, and share-result types used by both server and client.

The server does not begin listening until a complete valid snapshot is available. If synchronization fails and a prior validated snapshot exists, the server logs the failure and serves the prior snapshot. If no valid snapshot exists on the first startup, startup fails clearly rather than serving a partial game.

After the client loads the active snapshot, ordinary gameplay is client-side. No database or per-guess server request is required.

## 5. Startup synchronization and atomic activation

Each server start runs these steps exactly once:

1. Fetch stable Spire Codex English card data and HTTP response metadata.
2. Validate the remote response and record its SHA-256 source revision, `Last-Modified`, fetch time, and snapshot schema version.
3. Normalize every card into a base feature vector and an effective upgraded feature vector.
4. Build canonical base-feature groups and paired accepted-answer groups.
5. Download raw artwork with bounded concurrency that respects the source's usage terms, then generate the candidate and guess-row sprite atlases.
6. Retain remote full-card URLs and generate local full-card fallbacks only when a required URL is absent.
7. Validate record counts, unique IDs, group membership, image references, atlas bounds, and required files.
8. Write all output into a versioned staging directory.
9. Atomically replace the active-snapshot manifest with the staged snapshot.
10. Begin serving the application.

The active snapshot consists of:

- `manifest.json`: snapshot schema, Spire Codex version, timestamps, file hashes, and counts.
- `cards.json`: normalized card identities, base/effective-upgraded vectors, and reveal URLs.
- `base-groups.json`: stable ordered base-feature groups used by answer selection.
- `pair-groups.json`: paired-vector keys and all accepted card IDs.
- `candidate.webp`: small autocomplete artwork atlas.
- `guess.webp`: larger guess-row artwork atlas.
- `sprite-map.json`: card ID to coordinates in both atlases.
- A small fallback-card directory only when the source lacks a required full-card image.

The server keeps the last valid snapshot during activation so an interrupted write cannot expose a mixed or incomplete version.

## 6. Normalized card and feature model

### 6.1 Guessable identity

A guessable identity is a base card name and stable card ID. Upgraded names are not separate candidates. Each identity contains:

- `base`: features derived from the unupgraded card.
- `upgraded`: features derived from its upgraded card.
- `hasUpgrade`: whether a real upgraded variant exists.

When a card has no upgraded version, `upgraded` is an exact copy of `base`. This is the effective-upgrade fallback used consistently for selection, comparison, grouping, and display.

### 6.2 Displayed features

Artwork is not a feature. Version is not a feature. The eleven feature columns are:

1. Class
2. Type
3. Mana
4. Rarity
5. Eternal
6. Ethereal
7. Exhaust
8. Innate
9. Retain
10. Sly
11. Unplayable

Class values are:

- Ironclad
- Silent
- Defect
- Necrobinder
- Regent
- Neutral
- Event

Colorless, Token, Quest, Status, and Curse source colors use Neutral class. Event source color uses Event class.

Type values are:

- Attack
- Skill
- Power
- Quest
- Status
- Curse

Rarity values are Common, Uncommon, Rare, or None. Source-only categories outside those three draft rarities, including Basic and Ancient, normalize to None for this feature.

Mana is a non-negative integer, `X`, or `–` when the card has no comparable mana value. The API's resolved base and upgraded costs are authoritative. Star cost is retained for card rendering when needed but is not a gameplay feature in the first release.

Each keyword is an independent Boolean feature. The upgraded value applies the source's explicit added and removed keyword changes before comparison.

### 6.3 Canonical keys

Feature keys use a fixed field order and normalized enum values. They never depend on object property order, localized text, API response order, or card display names.

- `baseKey(card)` serializes the eleven base features.
- `pairKey(card)` serializes `baseKey(card)` followed by the eleven effective-upgraded features.

Stable sorting by canonical key and then stable card ID guarantees deterministic grouping and Daily selection across restarts with identical source data.

## 7. Answer selection and accepted answers

Answer selection intentionally does not sample cards or paired vectors globally.

For each round:

1. Uniformly select one unique base feature group from `base-groups.json`.
2. Uniformly select one card from that base group.
3. Read the selected card's effective upgraded vector.
4. Use the selected card's `pairKey` as the answer pair.
5. Accept every card whose `pairKey` equals the selected pair.

If there are `B` base groups and the chosen group has `n` cards, each card in that group has selection probability `1 / (B × n)`. If `m` cards in that base group share the selected pair, the pair's probability within that group is `m / (B × n)`. This preserves equal weight for every base feature group while allowing true paired duplicates to remain multiple accepted answers.

### 7.1 Daily

Daily selection uses a versioned deterministic pseudorandom algorithm seeded by:

- UTC calendar date.
- Active snapshot version.
- A fixed ruleset namespace.

The two selection stages consume separate deterministic draws. Every player using the same snapshot receives the same Daily answer. The Daily rolls over at `00:00 UTC`.

### 7.2 Practice

Practice uses cryptographically strong browser randomness for both selection stages. Completing a Practice round enables a new random round immediately. Practice results do not alter Daily progress, streaks, or sharing.

## 8. Guess comparison

For each of the eleven features, STS-dle performs two comparisons:

- `baseMatch`: guessed base value equals answer base value.
- `upgradeMatch`: guessed effective-upgraded value equals answer effective-upgraded value.

The tile color is:

- **Green:** `baseMatch && upgradeMatch`.
- **Yellow:** exactly one of `baseMatch` and `upgradeMatch` is true.
- **Red:** neither comparison is true.

Each tile displays the guessed value. If the guessed base and effective-upgraded values differ, the tile displays them as `Base → Upgraded`. If they are identical, it displays one value. A card without an upgrade displays one value because its effective upgraded value equals base.

### 8.1 Mana hints

Each non-matching numeric comparison produces a direction toward the answer:

- `↑` when the guessed value is lower than the answer.
- `↓` when the guessed value is higher than the answer.
- `–` when either side is `X` or has no comparable numeric value.

Mana tile color still follows the same two-comparison green/yellow/red rule. Its hint is:

- Green: no hint.
- Yellow: the hint from the single mismatching comparison.
- Red with identical hints: one `↑`, `↓`, or `–`.
- Red with opposing numeric hints: `↑↓`.
- Red with a numeric hint and a non-comparable hint: show both compactly, such as `↑ –`.

All hints on an incorrect tile use the tile's red or yellow result color; up and down arrows are never green.

## 9. Game interface

The visual structure follows LoLdle Classic while using Slay the Spire 2 styling rather than copying LoLdle assets.

### 9.1 Navigation

The game has two play choices:

- Daily
- Practice

There are no Base, Mixed, or version selectors. The page explains that every guess compares both the base card and its upgrade.

Daily and Practice both allow unlimited guesses until the player submits an accepted answer.

### 9.2 Autocomplete

The centered card-name input:

- Searches only base card names.
- Uses case-insensitive prefix matching rather than fuzzy or substring matching.
- Sorts matches alphabetically from the beginning of the name.
- Shows a small artwork sprite to the left of each name.
- Shows a subtle class label when duplicate display names require disambiguation.
- Supports arrow keys, Enter, mouse, and touch.
- Uses a fixed-height scrolling menu for long result lists.
- Prevents submitting the same card twice in one round.

### 9.3 Guess grid

Submitting a card immediately inserts its artwork and name on the left. The eleven feature tiles then flip from left to right with a short stagger. Each tile reveals the guessed value and its green, yellow, or red comparison state.

The seven keywords remain seven independent columns. The initial implementation keeps all eleven columns because the final density cannot be judged accurately until tested with real data and responsive layouts.

On narrow screens, the result grid scrolls horizontally. The artwork/name column remains sticky on the left. The layout also supports touch scrolling without triggering a guess. Users who prefer reduced motion receive immediate reveals without 3D flips.

## 10. Artwork sprites and full-card reveal

### 10.1 Local sprites

The server builds two deterministic grid atlases from Spire Codex raw artwork:

- Candidate cells: 64 × 64 source pixels, displayed at 32 × 32 CSS pixels.
- Guess-row cells: 160 × 160 source pixels, displayed at 80 × 80 CSS pixels.

Raw art is center-cropped with `cover` behavior into square cells. Cards are packed by stable card ID into bounded two-dimensional grids rather than a single long strip. Base and upgraded variants share the same artwork cell because candidates are base identities and card artwork does not need duplication.

The sprite map records atlas coordinates and source dimensions. Validation ensures every guessable card has valid coordinates inside both files.

### 10.2 Preloading

After a round is selected, the browser begins preloading every accepted answer's full base-card image and, when present, upgraded-card image from the Spire Codex CDN. These images remain hidden during guessing. The server does not proxy or permanently host ordinary full-card images.

### 10.3 Interactive answer stacks

After a correct guess, every accepted answer appears as an interactive card stack:

- The base card begins in front at full opacity.
- The upgraded card is underneath, offset diagonally, and covered by a translucent gray mask.
- Clicking, tapping, or keyboard-activating the stack animates the upgraded card forward and moves the mask to the base card.
- Activating it again swaps the cards back.
- A card with no upgrade shows one base card and has no swap interaction.

Card width is responsive using approximately `clamp(190px, 24vw, 280px)` at the full-card 400:520 aspect ratio. Multiple accepted answers use a wrapping grid on wide screens and a horizontal snap carousel on narrow screens.

If a remote full-card URL is missing, the startup pipeline provides the locally generated fallback. If a remote image fails after activation, the reveal shows a retry action and preserves the card name rather than leaving a blank box.

## 11. Local persistence and UTC rollover

Daily state is stored in `localStorage` under a versioned key containing:

- Snapshot version.
- UTC date.
- Ruleset version.

Stored state includes guesses, revealed comparison results, completion, guess count, and streak metadata. Refreshing or reopening the page restores the exact Daily state without replaying animations.

At `00:00 UTC`, the client offers the new Daily and initializes the new date key. A source patch activated during the same UTC day creates a different snapshot key and therefore a new Daily for that snapshot; stale progress is retained but not applied to the new data.

Practice state may retain only the current unfinished round for refresh recovery. Completed Practice rounds are not added to Daily history.

## 12. Daily sharing

The result panel provides a clipboard-copy action only for a completed Daily.

The shared text contains:

- STS-dle title and UTC date identifier.
- Number of guesses.
- One result line per guess.
- Eleven color symbols per line in the fixed feature-column order.
- Compact mana hints beside the mana symbol when applicable.
- A site link when deployment provides one.

Green, yellow, and red results use distinct square symbols. The output does not contain guessed card names, accepted-answer names, raw feature values, or full-card URLs. Practice has no share action.

## 13. Error handling and observability

Startup logs identify the synchronization stage, source version, card counts, group counts, sprite dimensions, fallback-image count, validation result, and active snapshot. Errors include enough context to identify a malformed card without logging entire API responses.

Network requests use bounded timeouts and limited retries. Exhausted retries never activate partial output. Temporary staging files are isolated from the active snapshot and may be cleaned on the next successful startup.

Client failures are recoverable:

- Snapshot load failure offers retry.
- Missing sprite coordinates fall back to a text-only candidate or guess rather than blocking play.
- CDN reveal-image failure keeps the accepted answer name visible and offers retry.
- Corrupt local state is discarded for only the affected date/ruleset key.

## 14. Verification strategy

### 14.1 Unit tests

- API-to-domain normalization for every enum and cost representation.
- Upgrade keyword additions/removals and cost changes.
- Effective-upgrade fallback for cards without upgrades.
- Canonical base and pair keys.
- Green, yellow, and red paired comparisons for all feature types.
- Mana equality, up, down, X/non-comparable, opposing, and mixed hints.
- Deterministic Daily selection and two-stage probability invariants.
- Practice selection bounds.
- Accepted-answer grouping.
- UTC date and rollover calculations.
- Share-output secrecy and fixed column ordering.

### 14.2 Pipeline tests

- Snapshot schema and source-version validation.
- Duplicate/missing card IDs.
- Feature-group membership and stable ordering.
- Sprite coverage, dimensions, coordinates, and file hashes.
- Atomic activation and fallback to the previous snapshot.
- Missing full-card URL fallback generation.

### 14.3 Component and end-to-end tests

- Prefix-only alphabetical autocomplete.
- Keyboard, mouse, and touch selection.
- Duplicate-guess prevention.
- Sequential tile flips and reduced-motion behavior.
- Sticky artwork column and horizontal scrolling.
- Daily restoration after refresh.
- Practice replay without Daily side effects.
- Winning with any accepted answer.
- Base/upgraded answer-stack swapping.
- Daily share clipboard output.
- Responsive layouts at phone, tablet, and desktop widths.

### 14.4 Data acceptance report

Every startup produces a concise report containing:

- Total base card identities.
- Cards with and without upgrades.
- Unique base feature groups and their size distribution.
- Unique paired answer groups and their accepted-answer size distribution.
- Cards missing raw artwork or full-card URLs.
- Sprite atlas dimensions and encoded sizes.

Any missing guessable card, invalid feature, missing sprite cell, or unhandled enum fails validation.

## 15. Acceptance criteria

The first release is complete when:

1. A clean server start creates and activates a validated stable snapshot before serving traffic.
2. Every supported card can be found by base name and guessed.
3. Every guess displays all eleven base/upgraded comparison results correctly.
4. Answer selection follows the approved two-stage base-group/card algorithm.
5. Every card sharing the selected pair is accepted and shown after victory.
6. Daily selection is stable for a UTC date and snapshot; Practice generates fresh rounds.
7. The two sprite atlases eliminate per-candidate and per-guess artwork requests.
8. Full reveal cards preload from the API/CDN and swap interactively between base and upgraded versions.
9. Daily state survives refresh and produces a non-spoiling share summary.
10. Automated tests and the startup data acceptance report pass.
