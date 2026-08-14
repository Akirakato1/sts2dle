# Prototype subtitle design

## Goal

Make the deployed site clearly identify itself as a prototype while gameplay mechanics are still being evaluated.

## Change

Replace the hero subtitle `A daily card deduction.` with the exact text `Prototype`.

No styling, layout, accessibility, navigation, game behavior, snapshot data, or deployment behavior changes are included.

## Verification

Update the existing application UI regression to require `Prototype` and reject the former subtitle. Run the focused client test, typecheck, and production build before pushing `main`. Verify the deployed page shows the new subtitle after Render finishes.
