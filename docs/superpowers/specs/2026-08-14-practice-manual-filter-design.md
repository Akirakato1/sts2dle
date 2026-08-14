# Practice Manual Filter Design

## Goal

Replace Hardcore Practice with an optional, persisted Manual Filter Mode that lets players narrow the Practice candidate list by card features without changing answer acceptance. Daily and Hardcore Daily behavior remain unchanged.

## Scope

- Manual Filter Mode exists only in Practice.
- Hardcore Practice is removed completely.
- Hardcore Daily remains a separate mode and continues to omit orbs and name hints.
- Manual filtering changes only which unguessed candidates appear in the search list.
- Manual filtering never changes the selected answer, accepted equivalent answers, guesses, comparison results, or win conditions.
- The previously considered synthetic card preview is explicitly out of scope.

## Practice State and Migration

Every Practice round owns a `ManualFilterState` with:

- an `enabled` flag;
- Class, Type, Mana, Rarity, and Keywords groups;
- a `disabled` flag for each group; and
- the selected values for each group.

The default state has Manual Filter Mode off, every group disabled, and no selected values. Turning Filter Mode off preserves all selections for the current round. Turning it back on restores them. A new Practice round resets Filter Mode and all selections to their defaults.

The Practice persistence ruleset and stored round contract will advance. Existing saved Practice rounds, including legacy Hardcore Practice rounds, are discarded once and replaced with a new standard Practice round. Daily and Hardcore Daily rounds and statistics are not invalidated.

Practice rounds are always non-Hardcore after this migration. Remove the pending Practice Hardcore choice, Hardcore Practice reducer action, persisted choice, toggle, lock state, and related instructional copy.

Filter Help dismissal uses a separate fixed browser-local key. Dismissal persists across rounds and reloads. Storage access is best-effort; if unavailable, the help dialog may open automatically again.

## Filter Options

Options are derived from all base and upgraded card feature vectors in the active snapshot.

- Class contains only class values present in the snapshot.
- Type contains only type values present in the snapshot.
- Mana contains only numeric values, `X`, and `None` that occur in the snapshot. Missing numeric gaps are not synthesized.
- Rarity contains only rarity values present in the snapshot.
- Keywords contains the keyword features that occur as `true` in at least one base or upgraded vector.

Every group is a visible checklist, not a select/dropdown. `Disable` appears first in every group. When `Disable` is checked, that group imposes no constraint; its value labels and checkboxes remain visible but are muted and non-editable. Previously selected values remain stored while the group is disabled.

When a group's `Disable` checkbox is unchecked and zero values are selected, that group matches no cards. The panel shows a concise inline warning for that group.

## Matching Semantics

The complete active filter is evaluated separately against each candidate's base vector and upgraded vector.

Within a single form:

- selected Class values use OR;
- selected Type values use OR;
- selected Mana values use OR;
- selected Rarity values use OR;
- selected Keywords use AND; and
- the five enabled groups combine with AND.

A disabled group always passes. An enabled group with no selections always fails.

Candidate form classification is:

- base passes and upgraded fails: show the candidate with a `Base only` badge;
- upgraded passes and base fails: show the candidate with an `Upgrade only` badge;
- both pass: show the candidate with no form badge; and
- neither passes: omit the candidate completely.

This deliberately rejects a cross-form mixture where some filters match only the base form and other filters match only the upgraded form but neither complete form satisfies every active group.

The existing guessed-card exclusion remains first-class: already guessed cards never reappear. The existing case-insensitive live name-prefix search continues to narrow the manually filtered list, including while the input is focused and empty.

## Interaction With Orbs and Candidate Categories

When Manual Filter Mode is off, the current orb classification and Neutral/Green/Red visibility behavior is unchanged.

When Manual Filter Mode is on:

- the Neutral/Green/Red controls stay visible but are disabled and visually muted;
- the orb tray stays visible but is non-interactive and visually muted;
- candidates do not receive orb-derived red or green styling or screen-reader descriptions;
- candidate inclusion is governed only by Manual Filter Mode, guessed-card exclusion, and the live name prefix; and
- previously consumed orbs and category checkbox values stay unchanged in round state.

Turning Manual Filter Mode off restores the exact prior orb consumption, candidate classification, category visibility settings, and red/green presentation.

## Practice UI

Practice controls contain a `Filter Mode` toggle beside the current `End game` or `New Practice Round` button. There is no Hardcore Practice toggle or lock-help text.

When enabled, the filter panel appears directly below Practice controls and above the existing candidate-visibility controls and orb tray. The panel uses a light-yellow background hue and border. Its controls use the site's existing fonts, compact borders, hover states, and accessible focus rings.

The five checklist groups appear in feature order: Class, Type, Mana, Rarity, Keywords. Desktop layouts use compact columns. Narrow layouts wrap or stack without document overflow. Values remain readable and operable at the established 390, 768, and 1440 pixel viewports.

Candidate form badges are compact bordered labels aligned to the right side of their candidate rows. Their visible and accessible text is exactly `Base only` or `Upgrade only`.

## Filter Help

A question-mark button at the top-right of the filter panel opens Filter Help. The dialog opens automatically the first time Manual Filter Mode is enabled on a browser unless the dismissal key is present.

The dialog explains:

- `Disable` makes a group accept any value;
- an enabled group with nothing selected matches no candidates;
- selected Class, Type, Mana, and Rarity values use OR within their group;
- selected Keywords use AND;
- enabled groups combine with AND; and
- base and upgraded forms are evaluated separately.

The dialog has a top-right close button, closes on Escape and true-backdrop clicks, traps keyboard focus, and returns focus to its trigger when closed. Closing it records the dismissal preference. The question-mark button can always reopen it.

## Component Boundaries

- `practice-filter.ts` owns default state creation, snapshot-derived option collection, per-form matching, and `Base only` / `Upgrade only` classification.
- `PracticeFilterPanel.tsx` owns the Practice filter controls, warnings, visual disabled states, and Filter Help dialog.
- `CardSearch.tsx` composes guessed-card exclusion, manual filtering or orb classification, and live name-prefix filtering.
- The Practice reducer, hook, and storage layer own round actions, persistence, migration, and reset behavior.
- `PracticeControls.tsx` owns only Filter Mode activation and Practice round-ending controls.
- `GameGuide.tsx` removes Hardcore Practice instructions and adds a concise Manual Filter explanation.

The manual filter state remains separate from `AssistanceState`. Daily orb assistance therefore does not acquire Practice-only fields or validation rules.

## Resilience

- Invalid, legacy, or snapshot-incompatible Practice filter state invalidates only the saved Practice round.
- Daily and Hardcore Daily local data remain intact.
- Local-storage read or write failures do not prevent gameplay.
- Stored selections must use values present in the active snapshot; unknown or malformed values are rejected.
- Manual filter actions are ignored outside Practice or after a round is terminal.
- While a reveal animation or another existing interaction lock is active, Filter Mode controls follow the same disabled safety boundary as other Practice controls.

## Testing and Acceptance

Unit tests will cover:

- snapshot-derived options and deterministic ordering;
- exact Mana option behavior with no synthesized gaps;
- OR behavior for Class, Type, Mana, and Rarity;
- AND behavior for Keywords and across groups;
- disabled and enabled-empty group semantics;
- independent base/upgraded evaluation and all four candidate outcomes;
- reducer updates, round reset, and action rejection outside active Practice;
- strict persistence, corruption rejection, and the one-time Practice migration;
- preservation of Daily and Hardcore Daily data;
- suppression and restoration of orb category filtering and coloring;
- focused-empty and typed-prefix candidate search behavior;
- Filter Help auto-open, dismissal, reopening, Escape/backdrop closing, focus trap, and focus return; and
- removal of every Hardcore Practice control and instructional reference.

Browser tests will cover:

- the complete Practice flow with Manual Filter Mode;
- disabled/dimmed orb and category controls;
- candidate omission and `Base only` / `Upgrade only` badges;
- help dialog first-use behavior and persistence;
- responsive checklist containment at 390, 768, and 1440 pixels; and
- no page-level horizontal overflow.

Before publication, the implementation must pass supported-runtime typecheck, the complete unit suite, production client/server build, the full offline browser suite, and diff checks. The final push goes directly to `main` with no branch, pull request, or `Co-Authored-By` trailer.
