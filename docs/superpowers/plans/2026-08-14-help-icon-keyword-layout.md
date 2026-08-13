# Help Icon and Keyword Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible “How to play” text trigger with the approved Slay the Spire map-question artwork and give all four Keyword Icons rows a stable, non-overlapping two-column layout.

**Architecture:** Copy the approved PNG into the client asset graph without modifying its bytes, then expose it through a decorative masked span inside the existing accessible help button. Keep `KeywordStateIcons` unchanged and add a help-only list class whose fixed icon column accommodates the full X/check transition while the flexible label column stays aligned. Extend existing unit and Playwright coverage rather than creating a second help implementation.

**Tech Stack:** React 19, TypeScript, CSS, Vitest + Testing Library, Playwright, Node crypto, Sharp, Vite.

## Global Constraints

- Presentation only: do not change modal behavior, game rules, persistence, card data, orb behavior, or answer selection.
- Copy exact bytes from `C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\images\map_icons\map_unknown.png` into `src/client/assets/map_unknown.png`.
- The approved source is a 73×72 ARGB PNG with SHA-256 `015f662a6dc840ea7f01f8c86216abbd9b3e102022b1da18be26a4bbda4d038d`.
- Use the PNG as a CSS mask; do not recolor or otherwise rewrite the bitmap.
- The visible trigger contains no “How to play” text and no fallback `?` glyph at any viewport, while retaining `aria-label="How to play"`.
- The trigger is a 48×48 circular control and never falls below the 44×44 accessible target minimum.
- Keep `KeywordStateIcons` as the sole source of the X, check, and transition-arrow graphics.
- Widen only the Keyword Icons list’s first column; do not change the icon-column widths for Basics, Result colors, Orbs, Name hints, or Modes.
- Preserve Close, true-backdrop click, Escape, focus trap, focus return, and selected-orb behavior.
- Verify responsive geometry at 390×844, 768×1024, and 1440×900.
- Use supported Node `>=22.12`; prefer the bundled Node 24 runtime already used by this project.
- Do not add `Co-Authored-By` trailers.

---

## File Structure

- Create `src/client/assets/map_unknown.png`: exact deployable copy of the approved local question-mark map asset.
- Create `tests/client/help-asset.test.ts`: stable repository-asset hash, format, and dimension contract independent of the developer’s local dashboard directory.
- Modify `src/client/components/GameGuide.tsx`: icon-only trigger markup and help-specific Keyword Icons list hook.
- Modify `src/client/styles/global.css`: circular map-node styling, masked artwork, and fixed Keyword Icons column.
- Modify `tests/client/GameGuide.test.tsx`: accessible trigger, no-visible-copy, artwork hook, and exact keyword icon-sequence assertions.
- Modify `tests/e2e/game.spec.ts`: responsive trigger/artwork and Keyword Icons layout measurements.

### Task 1: Preserve the approved map asset and expose icon-only semantic markup

**Files:**
- Create: `src/client/assets/map_unknown.png`
- Create: `tests/client/help-asset.test.ts`
- Modify: `src/client/components/GameGuide.tsx`
- Modify: `tests/client/GameGuide.test.tsx`

**Interfaces:**
- Consumes: the local source PNG and the existing `KeywordStateIcons({ displayValue })` component.
- Produces: `.game-guide__trigger-art` as the decorative mask target and `.game-guide__keyword-list` as the help-only grid hook used by Task 2.

- [ ] **Step 1: Write the failing repository-asset test**

Create `tests/client/help-asset.test.ts` with a fixed checksum and metadata contract so CI never depends on the external dashboard path:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { expect, test } from "vitest";

const assetPath = fileURLToPath(new URL("../../src/client/assets/map_unknown.png", import.meta.url));

test("preserves the approved Slay the Spire unknown-map artwork", async () => {
  const bytes = await readFile(assetPath);
  expect(createHash("sha256").update(bytes).digest("hex"))
    .toBe("015f662a6dc840ea7f01f8c86216abbd9b3e102022b1da18be26a4bbda4d038d");
  await expect(sharp(bytes).metadata()).resolves.toMatchObject({
    format: "png",
    width: 73,
    height: 72,
    hasAlpha: true,
  });
});
```

- [ ] **Step 2: Write the failing GameGuide trigger and keyword-sequence tests**

In the first `GameGuide` test, assert that the accessible trigger has no visible text node, contains one decorative artwork target, and that each keyword row has the approved icon sequence:

```tsx
const trigger = screen.getByRole("button", { name: "How to play" });
expect(trigger).toHaveAttribute("aria-label", "How to play");
expect(trigger).toHaveTextContent(/^$/);
expect(trigger.querySelector(".game-guide__trigger-art[aria-hidden='true']")).not.toBeNull();

fireEvent.click(trigger);
const keywordSection = within(screen.getByRole("dialog", { name: "How to play" }))
  .getByRole("heading", { name: "Keyword icons" })
  .closest("section")!;
expect(keywordSection.querySelector("ul")).toHaveClass("game-guide__keyword-list");

const expectedKeywords = [
  { label: "Absent", icons: ["x"] },
  { label: "Present", icons: ["check"] },
  { label: "Gained on upgrade", icons: ["x", "check"] },
  { label: "Lost on upgrade", icons: ["check", "x"] },
] as const;
for (const [index, expected] of expectedKeywords.entries()) {
  const row = keywordSection.querySelectorAll("li")[index]!;
  expect(row.querySelectorAll("svg[data-icon]")).toHaveLength(expected.icons.length);
  expect([...row.querySelectorAll("svg[data-icon]")].map((icon) => icon.getAttribute("data-icon")))
    .toEqual(expected.icons);
  expect(row.querySelector(":scope > span:last-child")).toHaveTextContent(expected.label);
}
```

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```powershell
npm exec vitest run tests/client/help-asset.test.ts tests/client/GameGuide.test.tsx
```

Expected: the asset test fails with `ENOENT`; the guide test fails because the current trigger renders `?How to play`, has no `.game-guide__trigger-art`, and the keyword list lacks `.game-guide__keyword-list`.

- [ ] **Step 4: Copy the exact approved PNG and verify its bytes before staging**

Run:

```powershell
New-Item -ItemType Directory -Force 'src\client\assets' | Out-Null
Copy-Item -LiteralPath 'C:\Users\zhuyl\AppData\Roaming\sts2-dashboard\Assets\images\map_icons\map_unknown.png' -Destination 'src\client\assets\map_unknown.png'
Get-FileHash 'src\client\assets\map_unknown.png' -Algorithm SHA256
```

Expected SHA-256: `015F662A6DC840EA7F01F8C86216ABBD9B3E102022B1DA18BE26A4BBDA4D038D`.

- [ ] **Step 5: Replace visible trigger copy with the mask hook and identify the keyword list**

Change only the trigger child and the Keyword Icons list class in `GameGuide.tsx`:

```tsx
<button
  ref={triggerRef}
  type="button"
  className="game-guide__trigger"
  aria-label="How to play"
  onClick={() => setOpen(true)}
>
  <span className="game-guide__trigger-art" aria-hidden="true" />
</button>
```

```tsx
<ul className="game-guide__icon-list game-guide__keyword-list game-guide__row-list">
```

Do not change dialog state, keyboard handlers, `KeywordStateIcons`, row labels, or modal markup.

- [ ] **Step 6: Run focused GREEN and typecheck**

Run:

```powershell
npm exec vitest run tests/client/help-asset.test.ts tests/client/GameGuide.test.tsx
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the asset and semantic markup**

```powershell
git add src/client/assets/map_unknown.png src/client/components/GameGuide.tsx tests/client/help-asset.test.ts tests/client/GameGuide.test.tsx
git commit -m "feat: add map question help icon"
```

### Task 2: Style the map node and prove responsive keyword alignment

**Files:**
- Modify: `src/client/styles/global.css`
- Modify: `tests/e2e/game.spec.ts`

**Interfaces:**
- Consumes: `.game-guide__trigger-art` and `.game-guide__keyword-list` from Task 1.
- Produces: a 48×48 icon-only map-node trigger and a fixed-width keyword icon column with a shared label edge.

- [ ] **Step 1: Add browser assertions before changing CSS**

Inside the existing 390×844, 768×1024, and 1440×900 viewport loop, extend the help-trigger and open-dialog checks. Assert the trigger has no rendered text, the frame and art centers align, and keyword labels share an X coordinate without overlap:

```ts
await expect(helpTrigger).toHaveText("");
const triggerVisualGeometry = await helpTrigger.evaluate((element) => {
  const art = element.querySelector<HTMLElement>(".game-guide__trigger-art")!;
  const frame = element.getBoundingClientRect();
  const artwork = art.getBoundingClientRect();
  return {
    frame: { width: frame.width, height: frame.height, x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
    artwork: { x: artwork.x + artwork.width / 2, y: artwork.y + artwork.height / 2 },
    radius: getComputedStyle(element).borderRadius,
    maskImage: getComputedStyle(art).maskImage || getComputedStyle(art).webkitMaskImage,
  };
});
expect(triggerVisualGeometry.frame.width).toBe(48);
expect(triggerVisualGeometry.frame.height).toBe(48);
expect(triggerVisualGeometry.radius).toBe("50%");
expect(triggerVisualGeometry.maskImage).toContain("map_unknown.png");
expect(Math.abs(triggerVisualGeometry.frame.x - triggerVisualGeometry.artwork.x)).toBeLessThanOrEqual(.5);
expect(Math.abs(triggerVisualGeometry.frame.y - triggerVisualGeometry.artwork.y)).toBeLessThanOrEqual(.5);
```

After opening the dialog:

```ts
const keywordGeometry = await help.locator(".game-guide__keyword-list > li").evaluateAll((rows) => rows.map((row) => {
  const icon = row.querySelector<HTMLElement>(".keyword-state-icons")!.getBoundingClientRect();
  const label = row.querySelector<HTMLElement>(":scope > span:last-child")!.getBoundingClientRect();
  return {
    iconRight: icon.right,
    labelLeft: label.left,
    iconCenter: icon.left + icon.width / 2,
    rowTop: row.getBoundingClientRect().top,
    rowBottom: row.getBoundingClientRect().bottom,
  };
}));
expect(Math.max(...keywordGeometry.map((row) => row.labelLeft)) - Math.min(...keywordGeometry.map((row) => row.labelLeft)))
  .toBeLessThanOrEqual(.5);
for (const row of keywordGeometry) expect(row.iconRight).toBeLessThanOrEqual(row.labelLeft);
for (let index = 1; index < keywordGeometry.length; index += 1) {
  expect(keywordGeometry[index]!.rowTop).toBeGreaterThanOrEqual(keywordGeometry[index - 1]!.rowBottom);
}
```

- [ ] **Step 2: Run the viewport browser test to verify RED**

First verify ownership before stopping any existing local site. If ports 3000/5173 are user-owned or unrelated, leave them untouched and use the repository’s ignored alternate-port Playwright harness. Then run the three viewport cases with bundled Node 24.

Expected RED: the trigger contains visible text, is wider than 48 pixels, lacks the masked artwork, and the transition icons extend into the label column.

- [ ] **Step 3: Add the circular map-node and mask styling**

Replace the current rectangular trigger styles in `global.css` with:

```css
.game-guide__trigger {
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  padding: 0;
  border: 1px solid #b58a4d;
  border-radius: 50%;
  color: var(--gold);
  background:
    radial-gradient(circle at 40% 34%, rgb(255 224 154 / 13%), transparent 35%),
    linear-gradient(#34271d, #211912);
  box-shadow: inset 0 1px rgb(255 255 255 / 8%), 0 0 0 1px rgb(42 26 14 / 70%);
}

.game-guide__trigger-art {
  display: block;
  width: 34px;
  height: 34px;
  background: currentColor;
  -webkit-mask: url("../assets/map_unknown.png") center / contain no-repeat;
  mask: url("../assets/map_unknown.png") center / contain no-repeat;
}

.game-guide__trigger:hover,
.game-guide__trigger:focus-visible {
  color: #f2cf78;
  border-color: #d9b45f;
  box-shadow: inset 0 1px rgb(255 255 255 / 12%), 0 0 .65rem rgb(217 180 95 / 32%);
}
```

Retain the existing focus-visible outline rule. Remove the obsolete mobile rule `.game-guide__trigger span:last-child { display: none; }`, because the trigger no longer has a text span.

- [ ] **Step 4: Add the help-only fixed keyword column**

Add these rules after the general `.game-guide__row-list` rules:

```css
.game-guide__keyword-list li {
  grid-template-columns: 4rem minmax(0, 1fr);
  align-items: center;
}

.game-guide__keyword-list .keyword-state-icons {
  width: 4rem;
  justify-self: center;
  margin-top: 0;
}
```

Do not change the general `1.6rem` row column or `.game-guide__orb-list` column.

- [ ] **Step 5: Run focused unit, browser, type, and build checks**

Run:

```powershell
npm exec vitest run tests/client/help-asset.test.ts tests/client/GameGuide.test.tsx tests/client/KeywordStateIcons.test.tsx tests/client/App.test.tsx
npm run typecheck
npm run build
```

Run the full Playwright suite with an owned fixture server (stock configuration if ports are free; otherwise the established ignored alternate-port harness):

```powershell
npm run test:e2e
```

Expected: all commands exit 0; all three viewport geometry cases pass.

- [ ] **Step 6: Run the complete final verification gate**

Run in order under bundled Node 24:

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run check
git diff --check
```

Expected: every command exits 0. Confirm the full Playwright suite makes zero normal browser requests to both official Spire Codex origins, as its existing offline guards require.

- [ ] **Step 7: Inspect the updated site at all approved viewports**

Start or refresh only repository-owned local processes. In the browser, inspect 390×844, 768×1024, and 1440×900 and confirm:

- the top-right trigger is a centered gold map-question silhouette inside a circular node with no visible text;
- the accessible name is still “How to play”;
- Close, backdrop, Escape, Tab trap, and focus return still work;
- the four keyword rows read Absent, Present, Gained on upgrade, and Lost on upgrade with aligned labels and no overlap;
- the modal remains viewport-contained and internally scrollable.

- [ ] **Step 8: Record provenance, commit, review, and publish**

Record the source path, source/repository SHA-256, 73×72 dimensions, Node version, test totals, viewport measurements, and local PID ownership in the ignored implementation report under `.superpowers/sdd/2026-08-14-help-icon-keyword-layout/`.

Then commit:

```powershell
git add src/client/styles/global.css tests/e2e/game.spec.ts
git commit -m "fix: polish help icon layout"
```

Run a read-only final review over the complete spec-to-HEAD diff. Address any Critical or Important finding test-first, rerun the affected checks and full final gate, then push direct master as previously approved:

```powershell
git push origin main
```

Expected: GitHub `main` advances to the verified final commit; no branch or pull request is created.
