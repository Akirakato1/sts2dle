# Compact Help and Game-Control Layout Design

## Goal

Make the game instructions faster to find and scan while cleaning up the alignment of the orb inventory, name hint, and candidate-visibility controls. This is a presentation-only change: game rules, persistence, answer selection, assistance behavior, and sharing semantics do not change.

## Header Help Entry

- Move **How to play** out of the game panel and into the top-right of the site header.
- Render it as an accessible button with at least a 44 by 44 pixel target.
- The button opens a centered modal dialog over a dark backdrop.
- The modal closes through its visible **Close** button, Escape, or a pointer activation on the backdrop.
- Opening the modal moves focus into it. Closing it returns focus to the button that opened it.
- Keyboard focus remains inside the modal while it is open.
- The dialog scrolls internally when its contents exceed the viewport. On narrow screens it becomes nearly full-width without causing document overflow.

## Compact, Sectioned Help Content

The modal uses short icon-led rows grouped into six always-expanded sections. It does not use nested accordions or multi-page navigation.

### Basics

- Guess a base card name.
- The guessed base and upgraded versions are compared with the answer's corresponding versions.
- Cards with an identical complete paired feature set are accepted as equivalent answers.

### Result Colors

- Green swatch: both base and upgraded values match.
- Yellow swatch: exactly one version matches.
- Red swatch: neither version matches.

This legend appears only in the help modal, not on the active game screen.

### Keyword Icons

- X icon: absent.
- Check icon: present.
- X to check: gained on upgrade.
- Check to X: lost on upgrade.

The existing accessible absent/present labels remain available to assistive technology.

### Orbs and Candidate Filtering

- Reveal Orb: use once on a feature header to reveal the answer's paired value.
- Filter Orb: use once on a green result to mark matching candidates green.
- Negation Orb: use once on a red result to mark impossible candidates red.
- Red exclusion continues to take priority over green inclusion.
- Candidate visibility controls hide or show Neutral, Green, and Red list rows without changing which answers are accepted.
- Orbs support drag and drop, click or tap selection, and keyboard activation.

### Name Hints

- After five wrong guesses, continuous word-length lines appear.
- After seven wrong guesses, word initials begin revealing.
- Later wrong guesses reveal additional characters until none remain.

### Modes

- Daily restores locally and produces a share result after a win.
- Hardcore Daily has a separate answer and no orbs or name hints.
- Practice provides repeatable rounds, local restoration, a pre-round Hardcore setting, and an End game action.

Low-level implementation details such as storage envelope validation, Unicode terminology, and empty-list focus handling remain enforced behavior and tests but are omitted from the visible quick-reference copy.

## Game-Control Layout

### Name Hint

- Render the name hint immediately before the **Guess a card** label and input in both DOM and visual order.
- Center the complete hint and its word groups within the search region.
- Preserve the continuous line-per-word representation and all current accessible hint text.

### Candidate Visibility

- Center the Neutral, Green, and Red checkbox labels as one wrapping group.
- Preserve 44 pixel interactive targets, checkbox semantics, and the existing search-focus behavior.

### Orb Tray

- Give each orb well, interactive button, and SVG visual one shared centered geometry.
- Remove any mismatched internal sizing or positioning that makes an orb appear diagonally displaced.
- Keep the slightly oversized orb artwork, selection border, drag avatar, used remnants, labels, and visual effects.
- Keep all three slots and labels centered and evenly spaced at desktop and mobile widths.

## Component Boundaries

- `GameGuide` becomes the top-right help trigger plus modal dialog and owns only its open/closed presentation state.
- `App` places `GameGuide` in the header area and no longer renders it inside `GameShell`.
- `CardSearch` changes slot ordering so `nameHintSlot` precedes the search label/input; the orb tray and candidate controls remain associated with the search area.
- Existing orb, hint, and game-state modules retain their current APIs and behavior unless a small presentational prop is needed for accessible composition.

## Error and Interaction Boundaries

- Modal state is local and is never persisted.
- Loading or mode-initialization errors do not prevent the help dialog from being opened.
- Closing the modal does not reset search text, game progress, selected mode, selected orb, or assistance state.
- Backdrop clicks close only when the backdrop itself is the event target; clicks inside the dialog do not close it.

## Verification

Use test-driven development for every behavior change.

- Component tests cover dialog role and label, initial closure, all three close methods, focus entry/return, focus trapping, and compact section/icon content.
- App tests prove the help trigger is in the header, the color legend is absent from the game board, and help remains available during loading and mode errors.
- Card-search tests prove the hint precedes the label/input in DOM order and existing search behavior is unchanged.
- Orb-tray tests preserve accessible inventory behavior and assert shared centering hooks.
- Browser tests measure the help button, modal containment, centered hint/toggles, and matching orb/well centers at 390, 768, and 1440 pixel viewports.
- Existing drag, keyboard orb, candidate search, persistence, Daily, Hardcore, Practice, and sharing tests remain green.

