# Compact Feature Grid Design

## Goal

Make the classic STS-dle comparison grid fit comfortably on desktop without discarding any cards. The public comparison model will have ten features instead of eleven, and comparison tiles will communicate primarily through their red/yellow/green state.

## Decisions

- Keep all cards eligible as guesses and answers, including all 26 cards currently marked `Unplayable`.
- Remove `Unplayable` from the public feature vector, comparison grid, share output, and accepted-answer grouping keys.
- Retain true X-cost semantics: numeric zero displays as `0`, other numeric costs display numerically, variable costs display as `X`, and a missing/nonexistent mana cost displays as `None`.
- Remove visible result marks and mana direction hints. Tile color remains the comparison signal.
- Keep keyword state useful: a present keyword displays its positive value, while an absent keyword has no visible `-` placeholder. Base-to-upgrade changes remain visible without inventing a negative glyph.

## Data and Feature Groups

`FEATURE_ORDER` becomes, in order:

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

`FeatureVector` and its runtime validator will contain exactly those ten fields. `Unplayable` is not retained as a hidden grouping field.

Both grouping modes must be rebuilt from the ten-field vector:

- Base groups use the ten base-card values.
- Pair groups use the ten base values paired with the ten effective upgraded values.

Cards that previously differed only by `Unplayable` will therefore merge into the same feature set and share the same accepted-answer pool. Daily answer selection remains uniform over the newly recomputed base feature sets, followed by uniform card selection within the selected set.

All 577 current source cards remain in `cards.json`, search candidates, sprite atlases, and possible answer pools. The exact count may naturally change on later Spiral Codex patches.

The local fallback renderer still needs to print the Unplayable rules keyword on a rendered card. It will derive the effective renderer-only flag from the raw Spiral Codex keyword list and upgrade add/remove fields instead of reading it from the public `FeatureVector`.

## Mana Representation

The canonical comparison value will distinguish four cases:

- `0` for a real zero-cost card.
- A positive integer for other fixed costs.
- `X` for true variable-cost cards.
- `None` for a card with no mana cost at all, such as an unplayable Curse or Status.

The obsolete dash sentinel will not be accepted by newly built snapshots. This makes grouping, persistence, display, and accessibility labels agree on the same meaning.

## Comparison and Presentation

Comparison retains the existing paired base/upgrade color rules:

- Green when both base and upgraded values match.
- Yellow when exactly one of the base or upgraded values matches.
- Red when neither matches.

`FeatureResult` no longer contains a mana-direction hint. Tiles will not render check marks, crosses, approximate marks, up/down arrows, or dash hints. Daily share rows will contain exactly ten colored squares with no appended mana symbols.

Class, type, mana, and rarity tiles continue to display the guessed value. Keyword tiles display the positive state when present and an empty visible value when absent. A base/upgrade keyword change remains expressible with the existing base-to-upgrade transition, omitting the absent side rather than displaying `-`.

The visual simplification does not remove accessibility information. Each tile retains an `aria-label` naming the feature, the guessed base/effective-upgrade state, and the red/yellow/green result. A visually blank keyword tile will therefore still be understandable to screen-reader users.

## Layout

Desktop layout will allocate more width to the game while making each result row more compact:

- Increase the application shell maximum width from 980px to approximately 1280px.
- Change the sticky artwork column from 96px to approximately 76px.
- Change the grid from eleven to ten feature tracks, with an approximately 72px minimum per track.
- Reduce the grid gap from 0.3rem to approximately 0.15rem.
- Reduce artwork and flip-tile row height from 80px to approximately 68px.
- Reduce the grid minimum width from 1120px to approximately 830px.

At normal desktop widths the ten columns should fit without page-level overflow. The grid keeps its own horizontal scrolling region on narrower tablet and phone viewports, and the sticky card artwork/name column remains visible while scrolling.

## Persistence and Compatibility

Existing saved Daily rounds contain eleven results and mana hints, so they must not be restored under the ten-feature rules. Increment the stored-game format version and validate exact feature order/shape. Incompatible local data is discarded safely before any streak calculation.

The snapshot validator will reject the old eleven-field vectors and dash mana sentinel. A new startup snapshot must be built before serving the changed client. The source revision may remain the same because this is a local rules/schema change; the generated snapshot build ID and strict validation distinguish the new artifact.

## Verification

Implementation will be test-driven and cover:

- Exact ten-field feature order and schema rejection of `Unplayable` or dash mana values.
- Normalization of `0`, fixed numbers, `X`, and `None`.
- Two otherwise identical cards with different raw Unplayable state merging into one base group and one pair group.
- Retention of Unplayable cards in runtime cards, sprites, search, and answer selection.
- Renderer-only Unplayable keyword behavior for base and upgraded fallback cards.
- Ten comparison results with no hint field and ten-symbol share rows.
- Blank absent-keyword presentation, no result-mark or mana-hint elements, and complete accessible labels.
- Correct grid column count and compact dimensions.
- Desktop no-overflow and mobile contained-horizontal-scroll browser checks.
- Rejection of stale eleven-column saved Daily data.
