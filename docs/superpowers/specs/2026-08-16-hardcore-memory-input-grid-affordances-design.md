# Hardcore Memory Input and Guess-Grid Affordances

Date: 2026-08-16

## Goal

Make Hardcore Daily require card-name recall instead of candidate browsing, improve invalid-guess feedback, prevent accidental selection of guess-tile text, make horizontal guess-grid overflow obvious, and move Practice Filter Mode instructions into their own help section.

Daily and Practice candidate search, filtering, assistance, persistence, answer selection, and comparison semantics remain unchanged.

## Hardcore name entry

`CardSearch` will receive an explicit Hardcore name-entry mode. In that mode it renders the labeled input but no candidate list, candidate artwork, empty-results message, active option, or listbox relationship. Normal Daily and Practice retain the existing combobox behavior.

Pressing Enter is the only Hardcore submission action. The input is normalized with Unicode NFKC normalization, English lowercase conversion, and removal of Unicode punctuation, separators, and whitespace. The remaining letters and numbers must match an entire card name in the same order. Thus capitalization, punctuation, and spacing are lax, while prefixes, reordered words, missing letters, and misspellings fail.

Name resolution is pure and deterministic:

1. Reject an empty normalized input.
2. Find unguessed cards whose complete normalized names equal the input.
3. Treat all cards with the same normalized name as one shared name. A name already represented by an earlier guess cannot be submitted again.
4. If any matching identity is one of the round's accepted answers, submit that identity. This makes the five Strike cards and five Defend cards shared answer names across classes.
5. Otherwise submit the first matching identity under the existing stable name/id ordering so the comparison row is deterministic and does not depend on the secret answer.

The resolution helper receives only the data required for this decision and returns a card ID or no match. It does not expose answer IDs, candidate names, or match details in the DOM, logs, status copy, or share output.

## Invalid-entry feedback

An invalid Enter submits nothing and leaves the input focused. It triggers one short feedback cycle, approximately 220-260 ms:

- the border and background fade into a restrained red hue and back out;
- the input shakes horizontally by only a few pixels in a fast buzzer-like motion;
- a screen-reader status announces that no matching unguessed card name was found.

Every invalid Enter restarts the feedback, including consecutive attempts with unchanged text. The effect must not clear the player's input. Under `prefers-reduced-motion: reduce`, horizontal movement is removed while the brief red color feedback and accessible status remain.

## Non-selectable guess tiles

Guess artwork, card-name overlays, feature values, badges, and other decorative tile text will not be text-selectable or natively draggable. Textual/decorative descendants will ignore pointer events so browser selection cannot produce the current black selection background.

The outer feature tile and header targets remain pointer- and keyboard-interactive for Reveal, Filter, and Negation Orbs. The change must not block orb drag/drop, click/tap, keyboard activation, scrolling, or reveal animation events.

## Horizontal overflow affordance

`GuessGrid` will place the existing horizontal scroller inside a non-scrolling frame. It will measure actual overflow and scroll position using the scroller's `scrollWidth`, `clientWidth`, and `scrollLeft`, updating on scroll, content changes, and resize. No cue appears when all columns fit.

When the grid overflows:

- show a compact `Swipe or scroll for more columns` hint with a right arrow;
- hide that text hint for the current mounted grid after the first real horizontal movement or chevron activation;
- show a subtle directional edge fade and a 44px accessible chevron button wherever more content exists in that direction;
- hide the left cue at the starting edge and the right cue at the ending edge;
- clicking a chevron advances approximately one feature column without changing manual touch, wheel, trackpad, scrollbar, or keyboard scrolling.

Chevron scrolling is smooth normally and immediate under reduced motion. The frame overlays must not obscure Reveal bubbles, sticky card artwork, column headers, or orb targets. Buttons use explicit `Scroll guesses left` and `Scroll guesses right` accessible names.

## Help organization

The main help modal will move the three existing Practice Filter Mode rules out of `Orbs and filtering` into a new `Practice Filter Mode` section. That section retains the exact rules for Disable, empty enabled groups, scalar OR, Powers/Keywords AND, cross-group AND, separate base/upgraded form matching, paused orb/category highlights, and Power/Keyword None.

The Hardcore Daily mode description will state that it has no orbs, name hints, or candidate list and requires entering complete card names from memory. The dedicated Practice filter help popup remains unchanged.

## Accessibility and responsive behavior

- Hardcore's input remains fully labeled and keyboard operable without advertising a nonexistent listbox.
- Invalid feedback is not color- or motion-only.
- Scroll controls meet the existing 44px target convention and expose stable accessible names.
- Directional controls reflect actual scroll availability rather than screen-size assumptions.
- Reduced-motion behavior applies independently to invalid feedback and programmatic grid scrolling.
- Narrow mobile, tablet, and wide desktop layouts remain within the page shell without document-level horizontal overflow.

## Verification

Test-first coverage will include:

- pure normalization and complete-name resolution, including punctuation/case/space tolerance, spelling/order rejection, guessed-name rejection, accepted duplicate selection, and deterministic non-answer Strike/Defend selection;
- Hardcore Enter submission with no candidate/listbox DOM and unchanged Daily/Practice search behavior;
- repeatable invalid feedback, preserved input/focus, accessible status, and reduced-motion behavior;
- non-selectable/non-draggable tile text while orb target interaction remains intact;
- overflow measurement, one-time hint behavior, directional cue state, chevron scrolling, resize/content updates, and no-overflow behavior;
- help-section ownership and updated Hardcore copy;
- browser acceptance for Hardcore memory guesses, invalid feedback, orb regressions, and 390x844, 768x1024, and 1440x900 grid affordances.

Final verification will run the supported Node 24 typecheck, full unit suite, production build, full offline browser suite, and diff checks before a user-authored direct-master commit and push. Render must deploy the exact pushed SHA successfully before completion is reported.
