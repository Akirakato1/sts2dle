# Prototype Subtitle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public hero subtitle with the exact text `Prototype`.

**Architecture:** Keep the existing `App` hero markup and CSS unchanged. Add a focused UI regression around the visible subtitle, then make the one-string production change and deploy it through the existing direct-`main` Render workflow.

**Tech Stack:** React 19, TypeScript, Testing Library, Vitest, Vite, Git, Render.

## Global Constraints

- The exact visible subtitle is `Prototype` with no period.
- Do not change styling, layout, accessibility, navigation, gameplay, snapshot data, or deployment configuration.
- Do not add a `Co-Authored-By` commit trailer.
- Push directly to `main`; do not create a branch or pull request.

---

### Task 1: Change and deploy the hero subtitle

**Files:**
- Modify: `tests/client/app.test.tsx`
- Modify: `src/client/App.tsx:282`

**Interfaces:**
- Consumes: the existing `App` React component and its Testing Library render helpers.
- Produces: a rendered hero containing visible text `Prototype` and no former subtitle.

- [x] **Step 1: Write the failing UI regression**

Add these assertions to the existing App hero/help test after the application has rendered:

```tsx
expect(screen.getByText("Prototype", { selector: ".subtitle" })).toBeVisible();
expect(screen.queryByText("A daily card deduction.")).not.toBeInTheDocument();
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm exec vitest run tests/client/app.test.tsx
```

Expected: FAIL because `.subtitle` still contains `A daily card deduction.` and `Prototype` is absent.

- [x] **Step 3: Make the minimal production change**

In `src/client/App.tsx`, preserve the existing element and class while replacing only its text:

```tsx
<p className="subtitle">Prototype</p>
```

- [x] **Step 4: Verify GREEN and production safety**

Run:

```powershell
npm exec vitest run tests/client/app.test.tsx
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0; the production diff contains only the App string and its regression assertions.

- [ ] **Step 5: Commit and push**

```powershell
git add -- src/client/App.tsx tests/client/app.test.tsx docs/superpowers/plans/2026-08-14-prototype-subtitle.md
git commit -m "copy: label site as prototype"
git push origin HEAD:main
```

- [ ] **Step 6: Verify Render**

Open the authenticated Render service and require the new commit to become Live. Open `https://sts2dle.onrender.com`, wait for card data to load, and require the hero subtitle to be exactly `Prototype`.
