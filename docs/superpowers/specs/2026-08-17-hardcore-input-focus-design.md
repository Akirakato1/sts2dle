# Hardcore Input Focus Restoration Design

## Goal

After an accepted Hardcore guess, return keyboard focus to the cleared guess input as soon as the reveal lock ends so the player can immediately enter another remembered card name.

## Scope

- Apply to Hardcore Daily and Hardcore Practice because both use `CardSearch` in `hardcore-name` mode.
- Preserve the existing reveal lock: the input remains disabled while the submitted row is revealing.
- Preserve current invalid-name behavior, candidate-mode behavior, query clearing, animations, and submission rules.

## Component Behavior

`CardSearch` will own an input ref and a pending Hardcore focus-restoration marker.

1. A successful `submitExactName` call clears the query and marks focus for restoration.
2. When the input becomes disabled for the reveal, the component records that the expected lock occurred.
3. When the same input becomes enabled again, the component focuses it and clears the pending marker.
4. A `roundKey` change clears every pending/lock marker before focus can be restored, preventing stale focus jumps after round or mode changes.
5. Invalid submissions do not enter this lifecycle because they never trigger the reveal lock and already retain focus.

## Accessibility

The input will not bypass its disabled state or accept extra submissions during the reveal. Focus returns only when interaction is valid again. No announcement or visible copy changes are required.

## Verification

- Unit coverage will prove successful Hardcore submission followed by disabled-to-enabled restoration focuses the cleared input.
- Unit coverage will prove a round change cancels pending restoration.
- Existing invalid-submission coverage must continue proving the input stays focused.
- Browser acceptance will prove real focus returns after an accepted Hardcore guess completes its reveal.
- Typecheck, full unit tests, production build, and browser acceptance must pass before pushing direct `main`.
