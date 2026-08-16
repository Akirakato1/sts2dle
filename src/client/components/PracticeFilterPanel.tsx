import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  KEYWORD_FILTER_NONE,
  POWER_FILTER_NONE,
  type CardFilterGroupName,
  type CardFilterOptions,
  type CardFilterState,
  type CardFilterValue,
} from "../game/card-filter.js";
import { formatCardTarget } from "../../shared/comparison.js";
import type { CardTarget } from "../../shared/domain.js";

export const FILTER_HELP_DISMISSED_KEY = "stsdle:filter-help-dismissed:v1";

export interface PracticeFilterPanelProps {
  state: CardFilterState;
  options: CardFilterOptions;
  disabled: boolean;
  onGroupDisabledChange(group: CardFilterGroupName, disabled: boolean): void;
  onValueChange(group: CardFilterGroupName, value: CardFilterValue, selected: boolean): void;
}

interface GroupDefinition {
  key: CardFilterGroupName;
  label: string;
}

const GROUPS: readonly GroupDefinition[] = [
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
  if (group === "target") return formatCardTarget(value as CardTarget);
  return String(value);
}

function storageHasDismissal(): boolean {
  try {
    return window.localStorage.getItem(FILTER_HELP_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function storeDismissal(): void {
  try {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
  } catch {
    // Help remains usable when storage is unavailable.
  }
}

export function PracticeFilterPanel({
  state,
  options,
  disabled,
  onGroupDisabledChange,
  onValueChange,
}: PracticeFilterPanelProps): React.JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTitleId = useId();
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const helpDialogRef = useRef<HTMLDivElement>(null);
  const previouslyEnabledRef = useRef(false);
  const dismissedThisMountRef = useRef(false);

  const closeHelp = useCallback(() => {
    dismissedThisMountRef.current = true;
    storeDismissal();
    setHelpOpen(false);
    queueMicrotask(() => helpTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const justEnabled = !disabled && !previouslyEnabledRef.current;
    previouslyEnabledRef.current = !disabled;
    if (justEnabled && !dismissedThisMountRef.current && !storageHasDismissal()) setHelpOpen(true);
  }, [disabled]);

  useEffect(() => {
    if (!helpOpen) return;
    helpCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeHelp();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(helpDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closeHelp, helpOpen]);

  return <section className={`practice-filter${disabled ? " practice-filter--disabled" : ""}`} aria-label="Practice filters">
    <header className="practice-filter__header">
      <h2>Manual filters</h2>
      <button
        ref={helpTriggerRef}
        type="button"
        className="practice-filter__help-trigger"
        aria-label="Filter help"
        onClick={() => setHelpOpen(true)}
      >?</button>
    </header>
    <div className="practice-filter__groups">
      {GROUPS.map(({ key, label }) => {
        const group = state[key];
        const values = options[key] as CardFilterValue[];
        const valuesDisabled = disabled || group.disabled;
        return <fieldset key={key} className="practice-filter__group" aria-label={label}>
          <legend>{label}</legend>
          <label className="practice-filter__choice practice-filter__choice--disable">
            <input
              type="checkbox"
              aria-label="Disable"
              checked={group.disabled}
              disabled={disabled}
              onChange={(event) => {
                if (!disabled) onGroupDisabledChange(key, event.currentTarget.checked);
              }}
            />
            <span>Disable</span>
          </label>
          <div className={`practice-filter__values${valuesDisabled ? " practice-filter__values--disabled" : ""}`}>
            {values.map((value) => {
              const valueLabel = formatValue(key, value);
              return <label key={`${typeof value}:${String(value)}`} className="practice-filter__choice">
                <input
                  type="checkbox"
                  aria-label={valueLabel}
                  checked={(group.selected as CardFilterValue[]).includes(value)}
                  disabled={valuesDisabled}
                  onChange={(event) => {
                    if (!valuesDisabled) onValueChange(key, value, event.currentTarget.checked);
                  }}
                />
                <span>{valueLabel}</span>
              </label>;
            })}
          </div>
          {!group.disabled && group.selected.length === 0 && <p className="practice-filter__warning">Choose at least one.</p>}
        </fieldset>;
      })}
    </div>
    {helpOpen && <div className="practice-filter-help__backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) closeHelp();
    }}>
      <div
        ref={helpDialogRef}
        className="practice-filter-help__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={helpTitleId}
      >
        <header className="practice-filter-help__header">
          <h2 id={helpTitleId}>Filter help</h2>
          <button
            ref={helpCloseRef}
            type="button"
            className="practice-filter-help__close"
            aria-label="Close filter help"
            onClick={closeHelp}
          >×</button>
        </header>
        <ul>
          <li><strong>Disable</strong> accepts any value for that group and preserves your checks.</li>
          <li>An enabled group with nothing checked matches no cards.</li>
          <li>Class, Type, Mana, Rarity, and Target use <strong>OR</strong> within each group.</li>
          <li>Powers and Keywords use <strong>AND</strong>: a card form must have every checked value.</li>
          <li><strong>Power None</strong> means that form has no powers and clears other power choices.</li>
          <li><strong>Keyword None</strong> means that form has no keywords and clears other keyword choices.</li>
          <li>Enabled groups combine with <strong>AND</strong>.</li>
          <li>Base and upgraded forms are evaluated separately; one complete form must satisfy every enabled group.</li>
        </ul>
      </div>
    </div>}
  </section>;
}
