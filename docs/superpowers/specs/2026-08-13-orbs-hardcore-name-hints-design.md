# Orb Assistance, Hardcore Daily, and Progressive Name Hints

## Goal

Add optional, tactile deduction aids to normal STS-dle rounds while introducing a genuinely hintless and orbless Hardcore Daily. The assistance system must survive refreshes entirely in browser storage, remain accessible without drag or color perception, preserve existing multiple-answer semantics, and never remove or disable a candidate merely because an orb classified it.

## Modes and Round Identity

The mode bar has three top-level entries:

- `Daily`
- `Hardcore Daily`
- `Practice`

Normal Daily and Hardcore Daily use separate deterministic seed namespaces. They therefore select different answers for the same UTC date and source revision. Each mode has its own current-round persistence, share title, and streak accounting. Existing normal Daily streak history remains the normal streak history; Hardcore uses a new independent streak key.

Normal Daily and normal Practice include all three orbs and progressive name hints. Hardcore Daily and Hardcore Practice include neither orbs nor automatic name hints.

Practice has a `Hardcore` toggle and an `End game` button next to one another. A Practice round is unstarted while it has no submitted guess and no consumed orb. Its Hardcore toggle is freely editable during that state. The first accepted guess submission or valid orb use locks the toggle. `End game` changes the current Practice round to `forfeited`, reveals the selected answer, consumes no additional resources, and prevents further guesses or orb use. After a win or forfeit, the toggle is editable while the player is waiting to activate `New Practice Round`; the new round uses the selected setting.

Switching top-level modes resumes that mode's current persisted round. Pending pointer drags, click-selected orbs, reveal animations, and transient announcements are UI state keyed to the round identity and are discarded on mode switch, UTC rollover, new Practice round, win, forfeit, or unmount.

## Reducer-Owned Assistance State

Assistance is part of the round model rather than independent component state. The persisted round owns:

- mode and Practice difficulty;
- answer identity, stable round identity, and deterministic hint seed;
- chronological guesses and terminal status;
- the availability/consumption state of Reveal, Filter, and Negation orbs;
- the consumed target of each orb;
- candidate visibility booleans for neutral, green, and red categories.

Click selection, pointer coordinates, drag avatars, hover targets, active poof particles, and live announcements are ephemeral presentation state. They never determine deduction semantics and are never persisted.

An orb target stores stable identifiers rather than copied display text:

- Reveal stores a `FeatureName`.
- Filter and Negation store the source guessed card ID, the feature name, and enough chronological identity to badge the intended submitted tile.

The target's base/upgraded values are derived from the current validated snapshot. A snapshot revision mismatch invalidates the saved round instead of applying old targets to new card data.

## Local Browser Persistence

No account, database, server session, or server-side user state is introduced. All round progress is stored in `localStorage`.

Normal Daily, Hardcore Daily, and Practice each have one fixed current-round key. The payload includes a strict schema version, source revision, ruleset identity, mode, and applicable UTC date. A new UTC Daily overwrites that mode's prior current round rather than accumulating one key per historical date. Normal and Hardcore current rounds never overwrite one another.

The persistence schema advances for this feature. Old incompatible payloads and exact legacy STS-dle current-round keys are removed before restoration. Cleanup is restricted to application-owned keys; unrelated origin storage is preserved. Invalid answers, card references, targets, visibility shapes, orb counts, results, status, or post-win/post-forfeit actions fail closed and delete only the invalid owned round.

Practice persists its current answer, setting, guesses, orb state, filters, visibility choices, hint seed, and won/forfeited status across refresh. `New Practice Round` replaces that saved round. Normal and Hardcore Daily states are replaced independently at UTC rollover.

## Orb Inventory and Visual Design

The orb tray appears directly below the search field. It is an icy recessed inventory box with three labeled slots. Each normal round begins with exactly one orb of each kind and there is no way to earn a replacement:

- Reveal Orb: violet/blue, sparkling-eye motif.
- Filter Orb: emerald, funnel/check or scanning motif.
- Negation Orb: crimson, barred-X motif.

The orbs are original inline SVG/CSS visuals; no icon dependency or remote asset is added. Each nominal 48-pixel slot holds a 52-pixel orb visual, giving a two-pixel oversize on each edge while remaining within the tray's safe layout area.

Each orb has type-specific motion:

- Reveal idles with star twinkles and drags with glitter.
- Filter idles with a faint scan pulse and drags with emerald rings/motes.
- Negation idles with an ember pulse and drags with crimson sparks/smoke.
- Valid consumption creates a short color-matched poof at the target.

`prefers-reduced-motion: reduce` replaces idle loops and trails with static glows and replaces poof movement with an immediate opacity fade. Meaning never depends on animation.

## Orb Input and Tactility

Pointer dragging and select-then-target activation coexist.

For pointer input, pressing and moving an orb starts a custom Pointer Events drag with pointer capture. The orb visibly leaves its tray slot and a drag avatar follows the pointer. Target detection uses explicit target metadata and pointer hit testing. Pointer cancellation, Escape, loss of capture, invalid release, or release over empty space returns the orb unconsumed.

For click, touch activation without dragging, and keyboard input, each orb is a button. Activating it selects the orb and adds a visible border; `aria-pressed` exposes the state. Activating it again cancels. While selected, valid targets expose keyboard-operable target controls. A valid target consumes the orb once; an invalid target announces the rejection and keeps the orb selected/available.

The tray and targets are disabled while a guess row is actively revealing and after win or forfeit. All consumption actions are idempotent so duplicate pointer/click events cannot spend an orb twice.

An `aria-live` region announces selection, cancellation, invalid targets, consumption, the revealed answer value, and activated Filter/Negation rules. Orb buttons have labels that include type and availability. Persistent target badges and candidate labels ensure state remains understandable without color or motion.

## Reveal Orb

Reveal accepts only one of the ten feature column headers. The Card/artwork header, feature tiles, empty space, and other UI are invalid.

On consumption it leaves a persistent hint bubble visually associated with the selected header. The bubble shows the selected answer's full base/upgraded feature value using the same canonical formatter as guess tiles:

- equal base/upgraded values display once;
- changed values display `base → upgraded`;
- keyword values use the same X/checkmark state icons and accessible absent/present wording.

Because every accepted equivalent answer has the same complete paired feature vector, the revealed feature is valid for every accepted answer even though it is derived from `selectedCardId`.

## Filter Orb

Filter accepts only a fully revealed green feature tile from a submitted guess. Yellow, red, hidden, or animating tiles and artwork cells are invalid.

On consumption it leaves a small persistent emerald orb badge on that tile. A candidate is a Filter match only when its base and upgraded values for the target feature exactly equal the target guessed card's base and upgraded values. Display-string similarity is not used; comparison uses typed canonical values.

Filter matches receive the green candidate classification. Nonmatches remain neutral unless Negation classifies them red.

## Negation Orb

Negation accepts only a fully revealed red feature tile from a submitted guess. Yellow, green, hidden, or animating tiles and artwork cells are invalid.

On consumption it leaves a small persistent crimson orb badge on that tile. A candidate receives red classification when its exact base/upgraded pair for the target feature equals the incorrect guessed card's target pair. This encodes that every card sharing that known-wrong paired trait cannot be the answer.

When a candidate matches both orb rules, red overrides green.

## Candidate Classification and Search

Orb classification is advisory. It never removes a card from the underlying candidate set, changes answer selection, disables a candidate, or prevents the player from intentionally guessing it.

Every unguessed candidate is derived into exactly one display category:

1. Red if it matches the Negation rule.
2. Otherwise green if it matches the Filter rule.
3. Otherwise neutral/unhighlighted.

Candidate order remains the existing deterministic alphabetical name/ID order. Red rows receive a red border and hue, green rows receive a green border and hue, and neutral rows retain the normal treatment. Each row also exposes `excluded by Negation Orb`, `matches Filter Orb`, or `unhighlighted candidate` in accessible text; color is never the only signal.

Normal rounds show three labeled checked visibility controls:

- Neutral
- Green
- Red

All default to checked. They persist with the current round and reset to checked on every new round. Unchecking a category hides only that category from the list. If all are unchecked or the query has no visible result, the list shows a non-option empty-state message. Hardcore rounds omit these orb-related controls.

Focusing the search input opens the candidate list even for an empty query. The empty focused query contains all checked, unguessed categories in stable alphabetical order. Typing performs the existing live case-insensitive prefix narrowing over that visible set. Guessed cards remain excluded. Blur/Escape and keyboard list navigation retain the established combobox behavior.

## Progressive Name Hints

Only wrong, accepted guess submissions advance the automatic name hint. Duplicate guesses, invalid actions, orb use, visibility changes, mode switches, and a winning guess do not advance it.

The hint describes the round's deterministically selected card name. Other cards with an identical accepted paired feature vector remain valid easter-egg answers even when their names do not match the hint.

The progression is:

- Wrong guess 5: render one continuous underline per word.
- Wrong guess 6: no additional reveal.
- Wrong guess 7: reveal the first character position of word one.
- Each subsequent wrong guess reveals the first character position of the next word.
- After every word's first position is visible, each subsequent wrong guess reveals exactly one deterministic random unrevealed character position.
- Once no hidden position remains, no further hint is added.

Only spaces divide words. Every non-space character counts as one hidden position, including letters, numbers, apostrophes, hyphens, and periods. Punctuation is not initially visible and is revealed like any other position. `F.T.L.` is therefore one six-position word. Selecting one position reveals only that position even when the same character occurs elsewhere.

Each word is a single box whose width is proportional to its full character count and whose bottom border is one continuous underline, not separate per-letter underscores. Revealed characters occupy their positions above that line; hidden positions remain blank.

The post-initial reveal order is produced by a stable seeded shuffle derived from the round identity and selected answer. Daily derives the seed from its UTC/mode/source identity. Practice persists a generated stable round identity. Refreshing, leaving, or returning to a mode cannot reroll the order. The visible mask is a pure derivation from wrong-guess count and seed, so separately persisted reveal masks cannot drift.

Hardcore rounds render no name-hint structure at any failure count.

## Practice Terminal Flow

`End game` is available only for the current nonterminal Practice round and is disabled during an active tile reveal/drag. Confirming the action is not required because Practice has no streak/share consequence; activation immediately forfeits and reveals the answer.

Won and forfeited Practice rounds show the existing answer stack plus `New Practice Round`. The Hardcore toggle is available in this terminal setup state. Changing it does not mutate the completed round; it selects the setting used when the player starts the next round.

Daily modes do not expose `End game` or a difficulty toggle.

## Sharing

Normal Daily retains chronological guess-symbol rows and adds one fixed-position orb row before the site URL:

`Orbs: 🟣 🟢 🔴`

Positions are always Reveal, Filter, Negation. A colored symbol means unused; a consumed orb is represented by `⚫` in that position. The line discloses only usage status, never the feature or guessed-card target.

Hardcore Daily uses a title beginning `STS-dle Hardcore`, retains chronological guess rows, and omits the orb line entirely. Normal and Hardcore results have independent deterministic answers and progress. Practice produces no clipboard summary.

## Rules and Layout

`How to play` is extended to cover:

- one of each orb per normal round and permanent consumption;
- pointer drag and click/tap/keyboard select-then-target interaction;
- Reveal header targets and full paired bubbles;
- Filter green-tile exact-pair matching;
- Negation red-tile exact-pair exclusion and red priority;
- advisory candidate colors, category visibility controls, and empty-focus search;
- the automatic name-hint schedule and selected-answer behavior;
- separate hintless/orbless Hardcore Daily;
- Practice Hardcore locking, persistence, forfeit, and new-round behavior.

The search field remains first in the assistance area. The orb tray is immediately below it, followed by category visibility controls and the name-hint panel. The candidate list is anchored beneath this composed search/assistance control and retains a bounded scroll area. These additions do not widen the 1280-pixel shell or the existing grid; the grid continues to own horizontal overflow.

## Components and Data Flow

The implementation should keep the following boundaries:

- reducer/state module: durable round transitions, status, orb use, visibility, and Practice lock semantics;
- persistence module: strict owned-key load/save/migration for three current modes and two Daily stats domains;
- candidate-classification module: pure typed exact-pair classification and visibility predicate;
- name-hint module: pure word segmentation, deterministic reveal order, and display mask;
- OrbTray: accessible inventory buttons, pointer drag avatar, VFX, poof, and transient selection;
- NameHint: proportional continuous word lines and position rendering;
- CardSearch: focused-empty search plus classification/visibility presentation;
- GuessGrid/FeatureTile/header: explicit orb-target metadata, badges, hint bubble, and target activation callbacks.

Presentation components dispatch semantic actions such as `consume-reveal`, `consume-filter`, `consume-negation`, `set-candidate-visibility`, `forfeit-practice`, and `set-practice-hardcore`. They do not independently compute or persist answer constraints.

## Error Handling

- Invalid and stale stored state is removed only from the exact owned mode key and starts a fresh round.
- Browser storage exceptions do not crash or block play; persistence remains best-effort as in the existing application.
- Missing target cards/features after validation reject the action without consuming an orb.
- Duplicate pointer, click, transition, or cancellation events settle once.
- Invalid drops return the orb and announce why it was not used.
- Round replacement clears transient selected/drag state before the next round can receive input.
- Share validation continues to require exactly one result for each of the ten features.

## Testing and Acceptance

Unit tests must cover:

- all reducer actions, one-use enforcement, valid/invalid target colors, terminal-state rejection, and Practice toggle locking;
- strict localStorage round parsing, exact-key cleanup, UTC replacement, separate Daily identities/streaks, Practice refresh restoration, and unrelated-key preservation;
- exact typed pair matching, red priority, stable categories, and visibility combinations;
- empty-focus alphabetical search, typed prefix narrowing, guessed-card exclusion, selectable red rows, zero-category empty state, and accessible classification labels;
- the 5/6/7 thresholds, multiword first-character progression, punctuation-as-position, repeated characters, deterministic random positions, refresh stability, selected-answer hints, exhaustion, and Hardcore suppression;
- drag removal/return, click selection border, keyboard targets, invalid drops, single consumption, persistent badges/bubble, poof state, aria-live output, and reduced-motion behavior;
- normal orb share positions/status, Hardcore title/no-orb line, and chronological guess symbols.

Offline browser tests must cover normal Daily orb use via drag and select-then-target, refresh restoration, candidate category toggles, empty focused search, both Filter and Negation classifications with red priority, automatic hint milestones, separate Hardcore Daily answer/progress/share, Practice toggle locking/forfeit/new round, keyboard accessibility, reduced motion, and 390/768/1440 overflow ownership. Official Spire Codex origins remain blocked with zero ordinary browser requests.

The final supported-Node gate remains typecheck, unit tests, build, offline E2E, aggregate check, and diff check. A fresh production snapshot is required only if production snapshot/data code changes; otherwise the already validated snapshot may be reused after strict runtime validation. Final local smoke must verify both normal and Hardcore paths, persistence, orb/share output, hint progression, endpoint health, process ownership, and empty stderr.

## Git Publication

The GitHub remote is `git@github.com:Akirakato1/sts2dle.git`. The current verified pre-feature baseline has already been pushed from local `master` to remote `main`. After the complete implementation, verification, and review finish, push the final local `master` directly to remote `main` over SSH. Do not create a feature branch or pull request.

## Out of Scope

- Earning or purchasing replacement orbs.
- More than one orb of a type in a round.
- Using either constraint orb on yellow tiles.
- Removing or disabling candidates based on orb classifications.
- Multiple simultaneous Filter or Negation rules.
- Server-side accounts, user databases, cloud saves, or cross-device synchronization.
- Historical Daily round browsing.
- Sharing orb targets or automatic revealed letters.
- Changing the ten feature columns, paired comparison colors, accepted-answer equivalence, or answer-group sampling.
