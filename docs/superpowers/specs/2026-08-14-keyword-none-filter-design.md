# Keyword `None` Filter Design

## Goal

Add `None` as a selectable value in the Practice Manual Filter's Keywords group so players can require a card form with no keyword flags.

## Behavior

- `None` is always displayed last in the Keywords checklist, matching the existing Mana ordering.
- `None` matches a base or upgraded form only when all six filterable keyword flags are false: Eternal, Ethereal, Exhaust, Innate, Retain, and Sly.
- `None` is mutually exclusive with the six real keywords:
  - selecting `None` clears every selected keyword;
  - selecting any real keyword clears `None`;
  - deselecting a value does not select another value automatically.
- Base and upgraded forms continue to be evaluated independently. A card may therefore be classified as `Base only`, `Upgrade only`, `both`, or neither when `None` is selected.
- Existing group behavior remains unchanged: a disabled Keywords group accepts anything, while an enabled group with no selected values matches no cards.

## Data and Compatibility

- Extend the serializable keyword-filter value domain with a `none` sentinel.
- Include `none` last in the snapshot-derived Keywords option list regardless of whether the current snapshot contains a keyword-free form.
- Existing Practice saves remain valid. No localStorage key, envelope version, or Practice ruleset bump is required.
- Stored `none` values receive the same strict canonical validation as other keyword filter values.

## UI and Help

- Render the sentinel as `None`, last in the Keywords checklist.
- Preserve the existing checklist styling, Disable behavior, accessibility, persistence, responsive layout, and 44-pixel target sizes.
- Update Filter Help and the README with one concise statement that `None` means no keywords and is exclusive with keyword selections.

## Verification

- Domain tests cover option ordering, mutual exclusion, keyword-free form matching, and separate base/upgraded classification.
- Storage tests cover persisted `none`, strict validation, and compatibility with existing saves.
- Component tests cover the visible last-position `None` option and callback behavior.
- Offline browser acceptance covers selecting `None`, candidate filtering/badges, persistence, and restoration without live Spire Codex requests.
