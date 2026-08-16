# Concise README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the operational README with a short public introduction to STS-dle.

**Architecture:** This is a documentation-only change. `README.md` becomes a compact landing page; detailed operational and internal documentation is removed rather than moved or duplicated.

**Tech Stack:** Markdown, PowerShell verification, Git.

## Global Constraints

- Keep only the project description, live link, four mode summaries, local-browser storage note, and attribution.
- Remove installation, development, testing, snapshot, deployment, runtime-architecture, schema, and detailed seven-feature documentation.
- Do not modify application, test, deployment, or snapshot files.
- Commit as the user without a `Co-Authored-By` trailer.

---

### Task 1: Rewrite the public README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Approved design in `docs/superpowers/specs/2026-08-17-concise-readme-design.md`.
- Produces: A concise repository landing page with working Markdown links.

- [ ] **Step 1: Record the current unwanted operational sections**

Run:

```powershell
rg -n "Prerequisites|installation|Development|Tests and offline fixture|Snapshot releases|Deploy to Render" README.md
```

Expected: matches prove the current README still contains the material scheduled for removal.

- [ ] **Step 2: Replace `README.md` with the approved concise content**

Use this exact structure and wording:

```markdown
# STS-dle

An unofficial Slay the Spire 2 card-deduction game.

**Play:** [sts2dle.onrender.com](https://sts2dle.onrender.com)

## Modes

- **Daily:** A shared puzzle with hints and three one-use orbs.
- **Hardcore Daily:** A separate puzzle with no candidates, hints, or orbs.
- **Practice:** Unlimited assisted or Hardcore rounds.
- **Search:** Filter and preview every card in the current card set.

Progress is saved locally in your browser. There are no accounts or player-progress databases.

## Attribution

Card data and image references come from [Spire Codex](https://spire-codex.com). Slay the Spire 2 belongs to [Mega Crit](https://www.megacrit.com/). STS-dle is an unofficial fan project and is not affiliated with or endorsed by Mega Crit. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for complete credits and licenses.
```

- [ ] **Step 3: Verify the required concise content**

Run:

```powershell
rg -n "sts2dle\.onrender\.com|Daily:|Hardcore Daily:|Practice:|Search:|saved locally|Spire Codex|Mega Crit|THIRD_PARTY_NOTICES" README.md
```

Expected: every required item is present.

- [ ] **Step 4: Verify operational material is absent**

Run:

```powershell
$forbidden = Select-String -Path README.md -Pattern "npm install|npm run|Prerequisites|Development|Snapshot releases|Deploy to Render|STSDLE_|seven features"
if ($forbidden) { $forbidden; exit 1 }
```

Expected: exit code 0 with no output.

- [ ] **Step 5: Review and commit**

Run:

```powershell
git diff --check
git diff -- README.md
git add -- README.md
git commit -m "docs: simplify readme"
```

Expected: only `README.md` is staged for the implementation commit, and the commit has no co-author trailer.

- [ ] **Step 6: Push direct main and confirm synchronization**

Run:

```powershell
git push origin master:main
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git status --short --branch
```

Expected: divergence is `0 0`, and the working tree is clean.
