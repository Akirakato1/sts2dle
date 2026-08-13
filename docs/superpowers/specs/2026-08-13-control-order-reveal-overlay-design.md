# Control order and Reveal overlay design

## Goal

Polish the assisted-game controls and feature grid without changing game state, orb behavior, filtering semantics, persistence, or answer selection.

## Assisted control order

For a normal assisted round, `CardSearch` will render its direct children in this visual and DOM order:

1. Neutral, Green, and Red candidate-visibility checkboxes.
2. The three-slot orb tray.
3. The progressive card-name hint, when the hint is active.
4. The “Guess a card” label and search input.
5. The candidate list or empty state, when the focused search is open.

The name hint remains immediately above the search label/input and centered. Hardcore rounds continue to omit visibility controls, orbs, and name hints. Reordering must not change checkbox focus handling, the focused-empty search behavior, keyboard navigation, candidate classification, or the input-anchored candidate list.

## Feature-header alignment

The guess grid will no longer reserve a three-rem-high blank strip above every column heading. Its normal compact padding will apply on all four sides, so the Card and feature headers share a visually aligned outer row.

After the Reveal Orb is consumed, its persistent answer bubble will be absolutely centered over the selected feature header. The bubble will sit above header labels and orb targets through stacking order, may visually overlap adjacent or underlying interface content, and will not contribute to the grid's measured height or spacing. Its arrow pointer is unnecessary in the centered-overlay treatment and will be removed if it implies an offset that no longer exists.

The bubble retains its accessible `role="note"`, complete paired answer value, keyword icons, and persistence/restoration behavior.

## Responsive behavior

At 390, 768, and 1440 pixel viewport widths:

- controls remain inside the game panel;
- visibility controls and the name hint remain centered;
- the orb wells and artwork remain precisely aligned;
- the input remains full-width within the search panel;
- the feature header row has no reveal-reserved blank band; and
- the grid remains the sole horizontal scrolling owner when its columns do not fit.

## Verification

Unit tests will assert direct-child order and Reveal bubble accessibility/content. Browser tests will measure the control order and header-row geometry at all three established viewports, exercise Reveal use, and verify that displaying the bubble does not change the grid/header vertical geometry. Existing orb drag, candidate filtering, focused-empty search, and responsive containment flows must remain green.

