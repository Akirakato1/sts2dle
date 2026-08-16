# Task 3 report — Search filter panel and workspace

## RED evidence

Ran the required component command before creating the Search components:

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx
```

It failed in all three suites because the imports for `SearchFilterPanel`,
`SearchCardList`, and `SearchWorkspace` did not exist.

## GREEN verification

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx tests/client/card-filter.test.ts tests/client/search-storage.test.ts
# 5 files passed, 27 tests passed

npm run typecheck
# exit 0

git diff --check
# exit 0
```

## Files

- Added `src/client/components/SearchFilterPanel.tsx`
- Added `src/client/components/SearchCardList.tsx`
- Added `src/client/components/SearchWorkspace.tsx`
- Added component tests under `tests/client/`
- Added Search panel/list styles in `src/client/styles/search.css`
- Deleted `src/client/components/PracticeFilterPanel.tsx`
- Deleted `tests/client/PracticeFilterPanel.test.tsx`

## Commit

`a065b2863b95fdcbeeb354d009e704458c268209` — `feat: add persistent card search workspace`

## Self-review

Reviewed the staged full diff and confirmed stable result ordering, normalized
substring matching, base/upgrade badges, candidate sprites, focus/pointer
warming, persisted filters only, reset in-memory query/list state, and the
Search help dialog/accessibility contract. The obsolete Practice panel and its
test are deleted.

## Concerns

None.

## Fix Round 1/5

### RED evidence

After adding the review regressions, this command failed with the intended
behavioral defects:

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx
```

- `SearchCardList` invoked preview twice for one Enter activation path.
- `SearchWorkspace` removed the accessible Search results list when filtering
  to no cards.
- The initial computed-style assertion was not supported by JSDOM; it was
  replaced with a deterministic assertion against the imported stylesheet's
  44px control contract.

### GREEN verification

```powershell
npm exec vitest run tests/client/SearchFilterPanel.test.tsx tests/client/SearchCardList.test.tsx tests/client/SearchWorkspace.test.tsx tests/client/card-filter.test.ts tests/client/search-storage.test.ts
# 5 files passed, 27 tests passed

npm run typecheck
# exit 0

git diff --check
# exit 0
```

### Changes and review

- Search results now remain mounted as an empty scrollable list alongside the
  no-match status.
- Added NFKC query, same-name ID ordering, non-default filter persistence,
  reset scroll, and empty-list regressions.
- Removed custom Enter handling so the native button click is the only preview
  activation.
- Expanded help, Shift+Tab, and deterministic 44px CSS contract coverage.
- Reformatted the three Search components for reviewability.
- Left the deferred `.practice-filter*` CSS block untouched as instructed.
