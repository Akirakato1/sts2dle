# Search Filter Controls and Daily Countdown Design

## Goal

Make the Search filter panel quicker to manage and make the next Daily rollover visible from every tab.

This change adds three filter-panel controls and replaces the hero subtitle with a UTC countdown:

- a persistent collapse/expand control;
- a reset control that is visible only while filters are expanded;
- a new empty, enabled filter default;
- a `NEXT DAILY HH:MM:SS` countdown to the next UTC midnight.

## Search filter state

The Search browser-storage envelope advances from version 1 to version 2 and contains only the persistent Search filter state and the filter panel's collapsed preference:

```ts
interface SearchStorageEnvelopeV2 {
  version: 2;
  filter: CardFilterState;
  collapsed: boolean;
}
```

Version 1 is not migrated. Loading a missing, stale, malformed, or invalid envelope removes it and returns the version 2 defaults. This deliberately clears the old all-disabled default for existing players once.

The version 2 default has every group enabled and every value unchecked:

```ts
{
  cardClass: { disabled: false, selected: [] },
  cardType: { disabled: false, selected: [] },
  mana: { disabled: false, selected: [] },
  rarity: { disabled: false, selected: [] },
  target: { disabled: false, selected: [] },
  powers: { disabled: false, selected: [] },
  keywords: { disabled: false, selected: [] },
}
```

Under the existing filter semantics, an enabled group with no selected values matches no cards. A fresh or reset Search therefore shows no results until the player selects values or disables groups.

The query, result scroll position, and open preview remain transient and are never stored.

## Filter header and interaction

The Search filter header contains:

- a 44 by 44 pixel collapse/expand button at the top left;
- the `Filters` heading in the remaining header space;
- an icon-only Reset button immediately left of Help while expanded;
- the existing Help button at the top right.

The collapse control uses a simple chevron. It points right while collapsed and rotates downward while expanded. It exposes `aria-expanded` and references the collapsible group container with `aria-controls`.

Collapsing hides the filter group container without modifying selections. The collapsed preference is saved immediately, so it survives Search tab switches and full page reloads. The panel returns to its stored state when Search remounts.

The Reset button:

- is present only while the panel is expanded;
- has the accessible name `Reset filters`;
- restores the complete filter to the empty, enabled version 2 default;
- saves that filter immediately;
- does not modify the collapsed preference, query, result scroll position, or preview state.

Help remains available in either collapsed state. Existing Help dialog behavior, focus return, keyboard trap, backdrop handling, and dismissal preference remain unchanged.

## Daily countdown

The hero's `Prototype` subtitle is replaced by a digital countdown:

```text
NEXT DAILY HH:MM:SS
```

The target is the next UTC midnight, matching the existing Daily and Hardcore Daily rollover boundary. The countdown updates once per second and derives each value from the current clock rather than decrementing accumulated state, preventing drift after throttling, sleep, or background-tab suspension.

Hours are zero-padded and range from `00` through `23`. Minutes and seconds range from `00` through `59`. At UTC midnight, the target advances to the following UTC midnight and the display begins the next 24-hour cycle while the existing game lifecycle replaces both Daily rounds.

The digits use tabular numerals to prevent layout movement. The timer is not an assertive or polite live region, so assistive technology is not interrupted every second. It retains a concise accessible label describing that it is the time remaining until the next Daily puzzle.

## Components and boundaries

- `card-filter` owns the canonical empty/enabled default.
- `search-storage` owns strict version 2 parsing, invalidation, and serialization of `{ filter, collapsed }`.
- `SearchWorkspace` owns updates that save either filter changes or the collapsed preference without overwriting the other.
- `SearchFilterPanel` renders the header controls and collapsible group region. It receives explicit reset and collapsed-state callbacks and does not access Search storage directly.
- A small hero countdown component owns UTC duration formatting and the one-second timer. It is independent from game selection and persistence.

No server, snapshot, card-selection, Daily seed, renderer, or deployment format changes are required.

## Failure handling

- Storage access remains best-effort. A throwing or unavailable browser-storage API falls back to defaults without crashing the application.
- Invalid version 2 envelopes are removed rather than partially recovered.
- The countdown uses the local system clock, which is already the clock source for the existing UTC rollover. A materially incorrect device clock can make both boundaries inaccurate; no network time service is introduced.
- Cleanup cancels the countdown timer on unmount.

## Verification

Unit and integration coverage will prove:

- the canonical filter default is enabled with no checked values;
- version 1 and malformed storage are invalidated;
- version 2 round-trips the filter and collapsed preference without extra fields;
- collapsing preserves selections and hides only the group container;
- collapse/expand state survives Search remounts and reload-equivalent storage reloads;
- Reset is visible only while expanded, restores the canonical filter, and preserves the collapsed preference;
- controls have accessible names, relationships, focus behavior, and at least 44 by 44 pixel targets;
- UTC countdown formatting is correct before midnight, at rollover, and after delayed timer execution;
- the hero no longer renders `Prototype`;
- mobile, tablet, and desktop layouts contain all filter-header controls without horizontal page overflow.

The browser acceptance flow will also verify a fresh version 2 Search begins with zero results, selecting or disabling values restores matching results, Reset returns to zero results, and the collapsed preference survives a real reload.
