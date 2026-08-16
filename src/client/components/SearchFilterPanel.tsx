import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { formatCardTarget } from "../../shared/comparison.js";
import type { CardTarget } from "../../shared/domain.js";
import { getBrowserStorage } from "../browser-storage.js";
import {
  KEYWORD_FILTER_NONE,
  POWER_FILTER_NONE,
  type CardFilterGroupName,
  type CardFilterOptions,
  type CardFilterState,
  type CardFilterValue,
} from "../game/card-filter.js";

export const SEARCH_FILTER_HELP_DISMISSED_KEY = "stsdle:search-filter-help-dismissed:v1";

export interface SearchFilterPanelProps {
  state: CardFilterState;
  options: CardFilterOptions;
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
  onReset(): void;
  onGroupDisabledChange(group: CardFilterGroupName, disabled: boolean): void;
  onValueChange(group: CardFilterGroupName, value: CardFilterValue, selected: boolean): void;
}

const GROUPS: readonly { key: CardFilterGroupName; label: string }[] = [
  { key: "cardClass", label: "Class" },
  { key: "cardType", label: "Type" },
  { key: "mana", label: "Mana" },
  { key: "rarity", label: "Rarity" },
  { key: "target", label: "Target" },
  { key: "powers", label: "Powers" },
  { key: "keywords", label: "Keywords" },
];

function formatValue(group: CardFilterGroupName, value: CardFilterValue): string {
  if (value === POWER_FILTER_NONE || value === KEYWORD_FILTER_NONE) return "None";
  return group === "target" ? formatCardTarget(value as CardTarget) : String(value);
}

function dismissed(): boolean {
  const storage = getBrowserStorage();
  if (storage === null) return false;
  try { return storage.getItem(SEARCH_FILTER_HELP_DISMISSED_KEY) !== null; } catch { return false; }
}

function saveDismissal(): void {
  const storage = getBrowserStorage();
  if (storage === null) return;
  try { storage.setItem(SEARCH_FILTER_HELP_DISMISSED_KEY, "1"); } catch { /* Best effort. */ }
}

export function SearchFilterPanel({ state, options, collapsed, onCollapsedChange, onReset, onGroupDisabledChange, onValueChange }: SearchFilterPanelProps): React.JSX.Element {
  const [helpOpen, setHelpOpen] = useState(() => !dismissed());
  const titleId = useId();
  const groupsId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    saveDismissal();
    setHelpOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [close, helpOpen]);

  return <section className={`search-filter${collapsed ? " search-filter--collapsed" : ""}`} aria-label="Search filters">
    <header className={`search-filter__header${collapsed ? " search-filter__header--collapsed" : ""}`}>
      <button type="button" className="search-filter__collapse" aria-label={collapsed ? "Expand filters" : "Collapse filters"} aria-expanded={!collapsed} aria-controls={groupsId} onClick={() => onCollapsedChange(!collapsed)}>
        <span className="search-filter__chevron" aria-hidden="true">›</span>
      </button>
      <h2>Filters</h2>
      <div className="search-filter__actions">
        {!collapsed && <button type="button" className="search-filter__reset" aria-label="Reset filters" onClick={onReset}>↺</button>}
        <button ref={triggerRef} type="button" className="search-filter__help-trigger" aria-label="Filter help" onClick={() => setHelpOpen(true)}>?</button>
      </div>
    </header>
    {!collapsed && <div id={groupsId} className="search-filter__groups">
      {GROUPS.map(({ key, label }) => {
        const group = state[key];
        const values = options[key] as CardFilterValue[];
        return <fieldset key={key} className="search-filter__group" aria-label={label}>
          <legend>{label}</legend>
          <label className="search-filter__choice search-filter__choice--disable">
            <input type="checkbox" aria-label="Disable" checked={group.disabled} onChange={(event) => onGroupDisabledChange(key, event.currentTarget.checked)} />
            <span>Disable</span>
          </label>
          <div className={`search-filter__values${group.disabled ? " search-filter__values--disabled" : ""}`}>
            {values.map((value) => {
              const valueLabel = formatValue(key, value);
              return <label key={`${typeof value}:${String(value)}`} className="search-filter__choice">
                <input type="checkbox" aria-label={valueLabel} checked={(group.selected as CardFilterValue[]).includes(value)} disabled={group.disabled} onChange={(event) => onValueChange(key, value, event.currentTarget.checked)} />
                <span>{valueLabel}</span>
              </label>;
            })}
          </div>
          {!group.disabled && group.selected.length === 0 && <p className="search-filter__warning">Choose at least one.</p>}
        </fieldset>;
      })}
    </div>}
    {helpOpen && <div className="search-filter-help__backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} className="search-filter-help__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="search-filter-help__header">
          <h2 id={titleId}>Filter help</h2>
          <button ref={closeRef} type="button" className="search-filter-help__close" aria-label="Close filter help" onClick={close}>×</button>
        </header>
        <ul>
          <li><strong>Disable</strong> accepts any value for that group and preserves your checks.</li>
          <li>An enabled group with nothing checked matches no cards.</li>
          <li>Class, Type, Mana, Rarity, and Target use <strong>OR</strong> within each group.</li>
          <li>Powers and Keywords use <strong>AND</strong>: a card form must have every checked value.</li>
          <li><strong>None</strong> means that form has no Powers or Keywords and clears other choices.</li>
          <li>Enabled groups combine with <strong>AND</strong>.</li>
          <li>Base and upgraded forms are evaluated separately; one complete form must satisfy every enabled group.</li>
        </ul>
      </div>
    </div>}
  </section>;
}
