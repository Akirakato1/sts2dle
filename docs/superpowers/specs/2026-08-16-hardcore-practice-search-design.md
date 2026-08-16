# Hardcore Practice and Search Workspace Design

**Date:** 2026-08-16

**Status:** Approved design

## Goal

Restore an optional Hardcore ruleset for Practice and move manual card filtering into a dedicated fourth top-level tab named **Search**. Search is a card-browsing utility, not a game round. It provides the existing filter semantics, a permanently visible matching-card list, and an accessible full-card preview modal.

## Navigation and ownership

The top navigation contains four tabs in this order:

1. Daily
2. Hardcore Daily
3. Practice
4. Search

Daily, Hardcore Daily, and Practice remain the only game modes. Search is shell-level UI state and must not be added to `PlayMode`, round selection, game statistics, sharing, answer state, or round persistence.

Switching to Search preserves every active game round unchanged. Returning to a game tab resumes the exact round and UI state that existed before opening Search. The active Search tab itself does not need to persist across a page reload.

## Hardcore Practice

Practice regains a checkbox labeled **Hardcore Practice**.

### Rules

- The checkbox is editable only while the current Practice round has no guesses and no orb has been consumed.
- Submitting the first guess locks the setting.
- Consuming any Reveal, Filter, or Negation Orb locks the setting, even if no guess has been submitted.
- Enabling Hardcore before the lock sets the round's assistance state to `null`.
- Disabling Hardcore before the lock restores a fresh, unused set of all three orbs.
- The active choice persists with the current Practice round across refreshes.
- A new Practice round inherits the latest selected Hardcore choice.
- A forfeited or completed Practice round retains the difficulty under which it was played.

### Hardcore presentation

When Hardcore Practice is enabled, Practice uses the same assistance-free presentation and input contract as Hardcore Daily:

- no candidate list or candidate artwork;
- no neutral, green, or red candidate-visibility checkboxes;
- no orb tray or orb interaction targets;
- no progressive card-name hint;
- no manual filter controls;
- full card name must be entered from memory and submitted with Enter;
- name matching applies Unicode NFKC normalization, English lowercase conversion, and removal of punctuation, separators, and whitespace while preserving letter and number order;
- invalid names preserve the query and focus, announce a generic error, and replay the quick red flash and shake feedback;
- reduced-motion users receive the red feedback without shake.

Daily and normal Practice candidate behavior must remain unchanged.

## Removal of Practice Filter Mode

Practice no longer exposes Filter Mode or any filter checklist. Filter state is removed from Practice round state and the Practice storage envelope.

The Practice storage ruleset/version is advanced. Existing Practice saves using the prior filter-bearing schema are discarded safely. No filter selections are migrated from Practice into Search.

The existing candidate highlighting provided by Filter and Negation Orbs remains part of normal Daily and normal Practice gameplay. Moving manual filters does not alter orb semantics.

## Search workspace

Search is a utility panel backed by the already validated client snapshot. It contains, in order:

1. a text search box;
2. the manual filter checklists and filter-help control;
3. a scrollable matching-card list that is visible even when the text query is empty.

Search results include all matching snapshot cards. There is no guessed-card exclusion because Search has no game round.

Typing narrows the filter-matched cards live by name. The query resets on reload and is not persisted.

### Filter groups and semantics

The Search workspace retains the existing groups:

- Class
- Type
- Mana
- Rarity
- Target
- Powers
- Keywords

Each group is a multi-select checklist with a **Disable** option.

- A disabled group accepts any value.
- An enabled group with no checked values matches no cards.
- Class, Type, Mana, Rarity, and Target use OR within their group.
- Powers and Keywords use AND within their group.
- Different enabled groups combine with AND.
- Base and upgraded forms are evaluated independently.
- A card is excluded only when neither form matches.
- A card matching only its base form receives a **Base only** badge.
- A card matching only its upgraded form receives an **Upgrade only** badge.
- A card whose base and upgraded forms both match receives no form badge.
- The existing `None` behavior for Powers and Keywords remains mutually exclusive with concrete values and matches an empty set for that form.

The filter-help dialog remains available from the Search filter panel and explains Disable, empty-enabled groups, scalar OR behavior, set AND behavior, cross-group AND behavior, per-form matching, and `None`.

### Search storage

Search owns one strict, versioned browser-storage envelope independent from every game save. It stores only:

- schema version;
- each filter group's disabled state;
- each filter group's selected values.

The filter-help dismissed flag remains a separate browser preference.

The following are never stored by Search:

- text query;
- selected preview card;
- modal state;
- result scroll position;
- snapshot card data;
- image bytes.

Saved values are validated against both a strict schema and the options derived from the current snapshot. Malformed, unknown, or obsolete values cause a safe reset to the default all-disabled filter. No raw error details are shown to the user.

## Search result list

The result list uses the existing candidate sprite atlas for immediate, compact artwork. It is a dedicated, independently scrollable list rather than the game candidate popover.

Each result exposes:

- card name;
- candidate artwork;
- optional Base only or Upgrade only badge;
- button semantics for pointer and keyboard activation.

At an empty query and with every group disabled, the list contains every snapshot card. An empty result set displays a concise, accessible status message.

On narrow layouts, filters appear above results. On wide layouts, filters and results may appear side by side. Neither layout may introduce document-level horizontal overflow.

## Card preview modal

Activating a Search result opens an accessible modal patterned after the existing How to Play dialog.

### Interaction and accessibility

- The modal has a stable accessible name containing the card name.
- Focus moves to the Close button on open.
- Tab and Shift+Tab are trapped within the modal.
- Escape closes the modal.
- Clicking the true backdrop closes the modal.
- Clicking inside the dialog does not close it.
- Closing returns focus to the result that opened it when that result still exists.
- Background content is not interactive while the modal is open.

### Card faces

- Cards with an upgrade show labeled Base and Upgraded full-card images side by side.
- Cards without an upgrade show one centered Base image.
- Image containers reserve their dimensions immediately to avoid layout shift.
- Each face has descriptive alternative text.

The preview reads `baseCardUrl` and `upgradedCardUrl` directly from the validated snapshot. These URLs already point either to official full-card images or to pre-rendered local fallback files created during snapshot generation for cards missing an official framed image. No runtime client renderer or additional card-data API is introduced.

Hovering or focusing a result starts best-effort preloading of that card's available preview URLs. Activation opens the modal immediately. If an image is still loading, the reserved face displays a themed loading state. If loading fails, only that face shows a concise error and Retry control.

The client must not preload all full-card images at startup. Candidate sprites retain the existing eager atlas preload; full-card preview images are loaded only for cards the user approaches or selects.

## Component and domain boundaries

The Practice-specific filter implementation becomes a reusable Search filter domain with no game dependency:

- a pure card-filter module owns state creation, option collection, updates, validation helpers, and per-form classification;
- a Search storage module owns strict serialization and restoration;
- a Search workspace owns transient query and selected-card state;
- a generalized filter panel renders the checklists and help entry point;
- a Search result list renders matching cards and form badges;
- a card preview modal owns preview focus, image readiness, and retry state.

Practice continues to use `RoundState.hardcore`, but Practice is again permitted to set it. Round construction enforces these invariants:

- Hardcore Daily is always hardcore;
- Daily is never hardcore;
- Practice may be either;
- every hardcore round has `assistance === null`;
- every non-hardcore playing round has a valid assistance state.

The shell owns an active tab that may be a game mode or Search. `useGame` continues to own only game modes and their persisted rounds.

## Error handling

- Invalid Search storage resets without breaking snapshot loading or game modes.
- A failed preview face does not close the modal or affect the other face.
- Preview Retry reloads only the failed URL.
- Missing or invalid preview URLs fail closed with an accessible unavailable-image message.
- Search filtering is pure and cannot mutate card identities, snapshot data, or round state.
- Switching tabs cannot cancel, replace, or recreate an already active round.

## Verification

### Pure and storage tests

- all filter group semantics and form badges;
- Search storage round-trip, version rejection, unknown-value rejection, and safe reset;
- old Practice filter-bearing storage rejection with no migration;
- Practice Hardcore invariants and assistance restoration before lock;
- lock after any guess or orb;
- current-round persistence and next-round inheritance.

### Component and integration tests

- four tabs with Search outside `PlayMode`;
- switching Search/game tabs preserves current rounds;
- Hardcore Practice suppresses every assistance element and uses memory entry;
- normal Practice retains candidates and orbs;
- Search always-visible results, live query, empty state, and badges;
- preview modal focus trap, close paths, focus return, loading, failure, and retry;
- side-by-side and single-card face layouts;
- no Practice Filter Mode remains in the game UI or Practice help.

### Browser acceptance

- Practice Hardcore toggle before play, lock after guess, lock after orb, reload persistence, and next-round inheritance;
- candidate secrecy and normalized full-name submission in Hardcore Practice;
- Search filter OR/AND/per-form behavior on real fixture cards;
- filter persistence across reload while query/modal reset;
- pointer and keyboard preview activation;
- full-card image loading from snapshot URLs with no unexpected network origins;
- responsive Search layout at 390, 768, and 1440 pixels;
- unchanged Daily, Hardcore Daily, and normal Practice flows;
- zero console warnings or errors.

The complete supported Node gate, production build, offline browser suite, independent review, direct-main push, exact-SHA Render deployment, endpoint checks, and live browser smoke remain mandatory before completion.
