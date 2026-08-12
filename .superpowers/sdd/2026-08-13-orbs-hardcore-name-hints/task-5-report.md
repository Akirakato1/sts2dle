# Task 5 Report — Accessible Orb Tray and Transient Interaction Engine

## Outcome

Implemented Task 5 directly on `9d893284bdd5be11f8935214770cec0cad8daa6f`: an accessible three-slot orb tray, original inline SVG orb artwork, click/touch/keyboard selection, custom Pointer Events dragging, opaque target registration, guarded settlement, live announcements, matched poofs, cleanup boundaries, and reduced-motion VFX behavior. Task 6 remains responsible for wiring real headers, tiles, and App semantics.

## RED evidence

- `npm exec vitest run tests/client/OrbTray.test.tsx`
  - Exit 1: the suite failed at import resolution because `OrbInteractionContext` and `OrbTray` did not exist.
- `npm exec vitest run tests/client/OrbInteractionContext.test.tsx`
  - Exit 1: 11 of 15 tests failed for absent target activation, pointer dragging, poof lifecycle, keyboard use, opaque registration, and cleanup behavior.
- Detached-capture regression during GREEN:
  - The interaction suite showed that after promotion removed the captured button from the rendered tray, delegated React pointer-up did not reach the root. The existing test reproduced this consistently; native listeners were added to both the captured element and `document`, with one `settled` guard.
- Registry-boundary regression:
  - `npm exec vitest run tests/client/OrbInteractionContext.test.tsx`
  - Exit 1: 1 of 17 tests failed because disable/re-enable reused the old opaque target ID instead of rebuilding the target registry.

## GREEN evidence

- Tray cycle: 1 file and 5 tests passed.
- Initial interaction cycle: 1 file and 15 tests passed.
- Invalid-release expansion: 2 focused files and 21 tests passed.
- Registry-boundary cycle: 1 file and 17 tests passed.
- Final focused command: 2 files and 22 tests passed.

## Final verification

- `npm exec vitest run tests/client/OrbTray.test.tsx tests/client/OrbInteractionContext.test.tsx`: exit 0; 2 files and 22 tests passed.
- `npm run typecheck`: exit 0.
- `npm test`: exit 0; 37 test files and 491 tests passed.
- `npm run build`: exit 0; client Vite build and server TypeScript build passed.
- `git diff --check`: exit 0 for tracked changes; only the repository's LF-to-CRLF notice appeared for `src/client/main.tsx`.

All Node commands used the bundled Node 24 runtime at `C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`.

## Files

- Created `src/client/components/OrbInteractionContext.tsx`
- Created `src/client/components/OrbVisual.tsx`
- Created `src/client/components/OrbTray.tsx`
- Created `src/client/styles/assistance.css`
- Created `tests/client/OrbInteractionContext.test.tsx`
- Created `tests/client/OrbTray.test.tsx`
- Modified `src/client/main.tsx`

## Self-review

- The provider consumes the existing `OrbKind`, `AssistanceState`, `FeatureName`, and `TileColor` types. Its selected orb, drag coordinates, poof, target registry, and announcement are ephemeral only; it never writes durable assistance state or browser storage.
- The tray renders Reveal, Filter, and Negation exactly once in that order. Each available button has a 48px hit surface around a 52px visual, while consumed orbs become compact grayscale non-button remnants with explicit used labels.
- All three visuals are original inline SVGs with local gradients and explicit eye/star, funnel/check/scan, and barred-X/ember motifs. No `<image>`, `<use>`, external reference, remote URL, icon package, or new dependency is present.
- Drag promotion uses Euclidean distance at the inclusive 6px threshold. Pointer capture is attempted immediately, and native listeners on both the captured element and `document` preserve delivery after the tray removes the dragged button.
- Every pointer exit routes through the guarded settlement function. Empty/invalid release, pointer cancellation, capture loss, and Escape leave durable state untouched and announce a return/cancellation. Duplicate pointer-up is idempotent.
- Hit testing defaults to `document.elementsFromPoint` and only reads opaque `data-orb-target` IDs. Descriptors and valid-orb metadata stay in the provider registry and are never parsed from DOM strings.
- Click/tap without drag is suppressed from double-toggling when its follow-on click arrives. Enter/Space target activation, invalid-target retention, accepted/rejected `onUse` results, visible selected borders, `aria-pressed`, accessible target labels, and `aria-live` announcements are covered.
- Accepted use clears selection, emits one type-colored poof at the activation point, and removes it after 520ms. Reveal glitter, Filter rings/motes, and Negation sparks/smoke are type-specific; idle SVG motifs also animate independently.
- Round changes clear registry and transient UI while re-registering live targets. Disable, unmount, and all settlements remove native/document listeners, release capture when possible, and clear poof/click-suppression timers. Disable/re-enable rebuilds opaque target IDs.
- The reduced-motion block disables orb, trail, and poof-child animation, removes transitions, and makes the poof immediately transparent while retaining static labels, borders, colors, and glow.

## Concerns

- Task 5 intentionally uses only its standalone harness. Real header/tile validity, durable reducer consumption, badges/bubbles, and App placement remain Task 6 work.
- JSDOM does not provide `PointerEvent`; the interaction tests install a small standards-shaped `MouseEvent` subclass so pointer IDs and coordinates exercise the production Pointer Events path.
- No known blocking issue remains.

## Fix Round 1 (2026-08-13)

### Outcome

Resolved both lifecycle findings without changing the public Task 5 interfaces. Drag promotion now leaves the capture-owning button connected while hiding it visually and from the accessibility tree, so a real browser `lostpointercapture` reaches the provider and returns the orb unconsumed. Selection and drag state now carry a render-time interaction epoch covering `roundKey`, `disabled`, and semantic AssistanceState targets; settlement and target activation synchronously reject stale epochs before passive cleanup can run. Presentation-only visibility flags are intentionally excluded from the epoch.

### RED evidence

- Capture-owner component regression: `npm exec vitest run tests/client/OrbInteractionContext.test.tsx`
  - Exit 1; 1 of 17 tests failed because the promoted Filter button was disconnected instead of retained as a hidden capture owner.
- Real Chromium regression: `npm exec playwright test tests/e2e/orb-interaction.spec.ts --workers=1`
  - Exit 1; the captured element reported `isConnected === false` after promotion. This was an actual Chromium pointer sequence, not a manually dispatched JSDOM `lostpointercapture`.
- Commit-phase epoch regressions: `npm exec vitest run tests/client/OrbInteractionContext.test.tsx`
  - Exit 1; 3 of 20 tests failed. A child `useLayoutEffect` could settle a prior-round drag, activate a prior-round selection, or settle across an AssistanceState consumption boundary after the new commit but before passive cleanup; each incorrectly called the new `onUse` once.
- Compatibility-click regression: `npm exec vitest run tests/client/OrbInteractionContext.test.tsx`
  - Exit 1; 1 of 21 tests failed because the compatibility click following a synchronously rejected old pointer-up selected the orb in the new round.

### GREEN evidence

- The available orb button remains the same connected DOM node during promotion. While dragging it has `visibility: hidden`, `aria-hidden=true`, and `tabIndex=-1`; an absolutely centered inert empty-slot marker supplies the tray appearance and no duplicate accessible button exists.
- Chromium asserts that the retained source is connected and `hasPointerCapture(1) === true`, releases that real capture, observes a real `lostpointercapture`, sends the later pointer-up, and proves `uses === 0` with the Filter orb available and unselected.
- Internal SelectionState and DragState capture an InteractionEpoch. `attemptUse`, selected target activation, pointer movement, pointer settlement, and tap selection compare the captured epoch with the current rendered boundary before acting. Existing passive cleanup remains in place.
- The semantic AssistanceState epoch compares durable reveal/filter/negation targets but not candidate visibility presentation state. Deterministic layout-effect tests cover round changes, selected activation, compatibility click suppression, AssistanceState consumption, and disabled transition; neither old nor new `onUse` receives stale settlement.

### Final verification

- `npm exec vitest run tests/client/OrbTray.test.tsx tests/client/OrbInteractionContext.test.tsx`: exit 0; 2 files and 27 tests passed.
- `npm exec playwright test tests/e2e/orb-interaction.spec.ts --workers=1`: exit 0; 1 real Chromium test passed.
- `npm run typecheck`: exit 0.
- `npm test`: exit 0; 37 files and 496 tests passed.
- `npm run build`: exit 0; Vite client and TypeScript server builds passed.
- `git diff --check`: exit 0; only repository LF-to-CRLF conversion notices were emitted by adjacent diff commands.

All Node commands used bundled Node 24 from `C:\Users\zhuyl\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`.

### Files

- Modified `src/client/components/OrbInteractionContext.tsx`
- Modified `src/client/components/OrbTray.tsx`
- Modified `src/client/styles/assistance.css`
- Modified `tests/client/OrbInteractionContext.test.tsx`
- Created `tests/e2e/orb-interaction.spec.ts`
- Created `tests/e2e/fixtures/orb-interaction-harness.html`
- Created `tests/e2e/fixtures/orb-interaction-harness.tsx`
- Appended `.superpowers/sdd/2026-08-13-orbs-hardcore-name-hints/task-5-report.md`

### Self-review

- The retained drag source preserves the required 48px button and 52px orb dimensions and remains capture-capable; it is neither visible nor exposed as a second accessible control during drag.
- `lostpointercapture`, document pointer-up, and React `onLostPointerCapture` still converge on the same `settled` guard. Listener detachment and capture release happen before any semantic use attempt, so duplicate delivery is idempotent.
- Stale settlement clears only transient UI and never calls `onUse`; the provider still owns no durable assistance mutation or persistence.
- Epoch comparison uses semantic values rather than AssistanceState object identity, preventing equivalent parent rerenders from invalidating a live interaction while invalidating durable orb-target changes. Visibility remains presentation-only.
- Round, disabled, assistance, Escape, lost-capture, and unmount passive cleanup paths remain intact, including document listeners, pointer capture, poof timers, and compatibility-click timers.
- The browser harness uses the production provider, tray, and CSS through a local Vite page. It adds no dependency, remote asset, application wiring, or production entry point.

### Concerns

- The browser regression intentionally starts a minimal local Vite component harness because Task 6 owns real App wiring; it is invoked explicitly with Playwright and is not part of `npm test`.
- `PointerEvent` remains shimmed only in JSDOM component tests; the dedicated Chromium regression covers native capture acquisition and loss.
- No known blocking issue remains.
