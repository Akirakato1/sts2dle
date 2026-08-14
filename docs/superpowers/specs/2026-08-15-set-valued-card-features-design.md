# Set-Valued Card Features Design

**Date:** 2026-08-15
**Status:** Approved

## Goal

Replace the six individual keyword columns with three more informative features while preserving a compact grid:

1. Target
2. Powers
3. Keywords

Powers and Keywords are set-valued. Target is scalar. All features retain base and upgraded values so a future Codex change can be displayed without another snapshot schema redesign.

## Feature Contract

The ordered feature domain is:

1. Class
2. Type
3. Mana
4. Rarity
5. Target
6. Powers
7. Keywords

Each card contains strict `base` and `upgraded` vectors with exactly these seven values. Powers and Keywords are sorted, duplicate-free arrays. An empty array represents `None` in the UI.

### Target

Target is validated directly from Spire Codex. The accepted source values and display labels are:

| Source value | Display label |
|---|---|
| `Self` | Self |
| `AnyEnemy` | Single Enemy |
| `AllEnemies` | All Enemies |
| `RandomEnemy` | Random Enemy |
| `AnyAlly` | Single Ally |
| `AllAllies` | All Allies |
| `None` | None |

Hand, Draw Pile, Discard Pile, and Exhaust Pile interactions are not Target values. They remain card-description mechanics and are not inferred.

Spire Codex currently supplies one Target per card, so the builder initially copies it to both forms. The domain nevertheless stores Target in both forms. If source data later provides a real upgraded Target, the ordinary `base → upgraded` presentation applies.

### Powers

The builder validates `powers_applied` and counts each distinct `power_key` by the number of distinct cards containing it. Repeated duplicate entries on one card count once.

- A power present on exactly one card becomes `Unique Buff`.
- A power present on more than one card retains its Codex display name.
- Direction is intentionally omitted. For example, Resonance displays `Strength`, not separate Strength Buff and Strength Debuff values.
- A card may contain multiple power values.
- If several singleton powers ever occur on one card, the normalized set still contains one deduplicated `Unique Buff` value and the release audit must report that card.

At design time the official 577-card response contains 466 cards with no powers, 100 with one power, and 11 with two powers. It contains 50 singleton power keys and 11 recurring keys. No current card contains multiple singleton powers.

Spire Codex currently supplies one Powers list per card, so the builder initially copies the normalized set to both forms. The paired representation remains ready for a future explicit upgraded power set.

### Keywords

Keywords are no longer individual boolean features. The builder preserves the complete official keyword set, including `Unplayable`:

- Eternal
- Ethereal
- Exhaust
- Innate
- Retain
- Sly
- Unplayable

The base set comes from `keywords_key`. The upgraded set applies validated `add_*` and `remove_*` upgrade fields. Values are canonicalized to stable display names, sorted in a fixed domain order, and deduplicated.

## Snapshot Generation

Snapshot generation uses two passes over the validated raw response:

1. Validate identifiers, Target, Powers entries, keyword values, and existing card fields; count distinct-card occurrences for every power key.
2. Normalize every card using the completed frequency table, build strict base/upgraded vectors, rebuild feature groups, and generate sprites and the manifest.

The public snapshot stores only the normalized values needed by the game. It does not expose descriptions or the full raw Codex payload.

The snapshot schema version is incremented. Strict validation rejects:

- unknown or absent Target values;
- malformed Powers entries;
- unsorted or duplicate Powers/Keywords arrays;
- unknown keyword values;
- missing or extra feature keys;
- non-upgradable cards whose effective forms differ;
- groups that do not exactly reconstruct from the normalized cards.

Feature keys serialize arrays canonically so equal sets always produce equal base and pair group keys.

## Comparison Rules

### Scalar features

Class, Type, Mana, Rarity, and Target retain paired scalar comparison:

- Green when base and upgraded values both match.
- Yellow when exactly one corresponding form matches.
- Red when neither corresponding form matches.

### Set features

Powers and Keywords compare corresponding sets, never base against upgraded:

- `baseExact`: guessed base set equals answer base set.
- `upgradeExact`: guessed upgraded set equals answer upgraded set.
- `baseOverlap`: the corresponding base sets share at least one value.
- `upgradeOverlap`: the corresponding upgraded sets share at least one value.
- Green when `baseExact && upgradeExact`.
- Yellow when not green and at least one exact match or overlap is true.
- Red otherwise.

Two empty sets are exactly equal. An exact empty-form match can therefore contribute to Yellow when the other form does not match.

## Display and Accessibility

Set values use their canonical order and a compact separator. Empty sets display `None`. Identical base/upgraded values display once; changed values display `base → upgraded`.

Powers and Keywords tiles receive a smaller responsive font and wrapping rules that keep long values inside the tile without altering comparison semantics. The Class tile applies the smallest necessary font adjustment to keep `Necrobinder` on one line.

Accessible labels announce the full visible set, any upgrade transition, and the comparison color. The How to Play dialog replaces the obsolete individual keyword-icon explanation with concise rules for exact set matches, partial overlap, no overlap, and upgrade arrows.

The share string contains seven color symbols in canonical feature order.

## Practice Manual Filter

Practice Manual Filter contains seven groups matching the feature domain:

- Class
- Type
- Mana
- Rarity
- Target
- Powers
- Keywords

Class, Type, Mana, Rarity, and Target use OR within their group. Powers and Keywords use AND within their group. All enabled groups combine with AND.

Each card form is evaluated independently. A candidate remains visible when at least one complete form satisfies all enabled groups. Existing `Base only` and `Upgrade only` badges remain.

Powers and Keywords each include a mutually exclusive `None` choice at the bottom. It matches only an empty set and clears other selections in that group. `Unique Buff` is an ordinary Powers option when present. All choices are derived from the validated snapshot.

The filter state and persisted Practice envelope receive a new schema version. Incompatible saved filter state resets instead of being guessed or partially migrated.

## Orbs and Game State

Reveal Orb displays the complete formatted answer value for any of the seven features.

Filter and Negation Orbs continue to accept only green and red result tiles respectively. For Powers and Keywords, orb matching uses exact canonical paired-set equality. For Target and other scalar features, it uses ordinary paired equality. Manual Filter Mode continues to suppress orb/category highlighting while enabled and restores it when disabled.

Daily, Hardcore Daily, and Practice all use the seven-feature domain. Manual Filter remains Practice-only.

The browser round-storage schema is incremented because old guesses contain ten obsolete feature results and old Practice filters use a different shape. Incompatible active rounds reset cleanly. Other unrelated local preferences, such as dismissed help state, remain untouched.

## Testing

Automated coverage must include:

- strict raw Target and Powers validation;
- distinct-card frequency counting and singleton collapse;
- zero-, one-, and two-power cards;
- an audit that reports any future card with multiple singleton powers;
- all seven Target values;
- all seven keywords, including `Unplayable`;
- keyword add/remove upgrade transitions;
- exact, partial, disjoint, and empty set comparisons;
- canonical set serialization and exact rebuilt groups;
- seven-symbol share output;
- Reveal, Filter, and Negation Orb behavior for set features;
- Practice OR/AND/None behavior, form badges, persistence, and reset;
- long set values, one-line `Necrobinder`, responsive viewports, and accessible labels;
- updated How to Play content;
- full unit, typecheck, production build, and offline browser suites.

## Release and Deployment

After implementation passes all gates, the snapshot release command fetches current official Codex data, builds and strictly validates the new snapshot, and atomically replaces `deploy/snapshot-data.tar.gz`. The release audit records source revision, counts, Target domain, power-frequency summary, any multiple-singleton cards, keyword domain, group counts, image invariants, and archive hash.

The committed archive is pushed to `main`. Render remains serve-only: Docker extracts the committed archive during image construction and startup uses `STSDLE_SKIP_SYNC=1`. Startup network synchronization is not reintroduced.
