# Help icon and keyword layout design

## Goal

Replace the text-heavy “How to play” trigger with a recognizable Slay the Spire map question-mark button and repair the overlapping Keyword Icons reference inside the help dialog. This is a presentation-only change: modal behavior, game rules, persistence, card data, orb behavior, and answer selection remain unchanged.

## Help trigger

The visible trigger contains no “How to play” text at any viewport width. It is a 48×48 pixel circular map-node-style button using the exact local Slay the Spire map question-mark artwork from:

`C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\images\map_icons\map_unknown.png`

The approved source asset is copied into the repository under the client assets so the deployed site does not depend on a local machine path. Its file bytes are preserved exactly and its provenance is recorded in the implementation report.

The PNG is used as a CSS mask, allowing the artwork silhouette to inherit the STS-dle gold/amber palette without destructive bitmap editing. The surrounding circular button supplies the map-node frame:

- 48×48 outer size, never below the existing 44×44 accessible-target minimum;
- circular border and dark brown radial/linear surface consistent with the site palette;
- muted gold question mark and border at rest;
- brighter gold plus a restrained glow on hover and keyboard focus;
- existing focus-visible outline retained or strengthened;
- no text or fallback “?” character rendered visually.

The button retains `aria-label="How to play"`, so its accessible name and all current role-based interactions remain stable. Clicking it continues to open the same dialog; Close, true-backdrop click, Escape handling, focus trapping, focus return, and selected-orb preservation are unchanged.

## Keyword Icons reference

The Keyword Icons section contains exactly four aligned two-column rows:

| Icon cell | Label |
| --- | --- |
| X icon | Absent |
| Check icon | Present |
| X icon → Check icon | Gained on upgrade |
| Check icon → X icon | Lost on upgrade |

The icon cell has one fixed width sized for the longest transition sequence. Every single-state icon is centered within that same cell. The label occupies a separate flexible column, begins at the same horizontal coordinate in all four rows, and never overlaps the icon sequence.

The existing `KeywordStateIcons` component remains the source of the X, check, and transition-arrow visuals, preserving the symbols used in the guess grid. The help-specific layout widens only the Keyword Icons list's first grid column; it does not globally widen the Basics, Orbs, Name Hints, or Modes icon columns.

All four icon groups remain decorative (`aria-hidden`) because their adjacent text provides the meaning. The section heading and the four approved labels remain unchanged.

## Responsive behavior

At 390×844, 768×1024, and 1440×900:

- the circular trigger stays fully within the top-right of the app shell;
- its center artwork remains aligned with the circular frame;
- its accessible target remains at least 44×44 pixels;
- the help dialog remains internally scrollable and viewport-contained;
- each Keyword Icons label shares one aligned starting edge; and
- no icon or arrow intersects its label or another row.

## Verification

Test-first coverage will establish:

1. The current trigger still renders visible text and therefore fails the icon-only contract.
2. The current Keyword Icons first column is too narrow for transition sequences and therefore fails the fixed-width/alignment contract.
3. The copied asset has the same SHA-256 hash as the approved local source.
4. The final trigger has the stable accessible name, contains the masked asset element, contains no visible text/fallback glyph, and retains modal keyboard/focus behavior.
5. All four keyword rows contain the exact expected icon sequence and label.
6. Browser measurements at all three viewports prove trigger/artwork centering, target size, dialog containment, common label alignment, and non-overlap.

The final project typecheck, unit suite, production build, complete browser suite, and diff checks must pass before commit and push.

