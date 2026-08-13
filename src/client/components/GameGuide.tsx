import React, { useCallback, useEffect, useRef, useState } from "react";

import { KeywordStateIcons } from "./KeywordStateIcons.js";
import { ORB_LABELS, OrbVisual } from "./OrbVisual.js";

const RESULT_LEGEND = [
  ["green", "Both base and upgraded features match"],
  ["yellow", "Exactly one version matches"],
  ["red", "Neither version matches"],
] as const;

const ORB_GUIDE = [
  ["reveal", "Show the answer's base and upgraded pair for a feature header."],
  ["filter", "Mark candidates that match a green feature pair."],
  ["negation", "Exclude candidates that match a red feature pair; red takes priority."],
] as const;

export function GameGuide(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeGuide = useCallback(() => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeGuide();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeGuide, open]);

  return <section className="game-guide" aria-label="Game help">
    <button ref={triggerRef} type="button" className="game-guide__trigger" onClick={() => setOpen(true)}>
      <span aria-hidden="true">?</span><span>How to play</span>
    </button>
    {open && <div className="game-guide__backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) closeGuide();
    }}>
      <div ref={dialogRef} className="game-guide__dialog" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
        <header className="game-guide__dialog-header">
          <h2 id="how-to-play-title">How to play</h2>
          <button ref={closeRef} type="button" className="game-guide__close" aria-label="Close help" onClick={closeGuide}>×</button>
        </header>
        <div className="game-guide__sections">
          <section>
            <h3>Basics</h3>
            <ul>
              <li>Guess a base card name; base and upgraded cards compare as a pair.</li>
              <li>Cards with identical complete paired features are equivalent answers.</li>
            </ul>
          </section>
          <section>
            <h3>Result colors</h3>
            <ul className="result-legend">
              {RESULT_LEGEND.map(([color, meaning]) => <li key={color}>
                <span className={`result-legend__swatch result-legend__swatch--${color}`} aria-hidden="true" />
                <span>{meaning}</span>
              </li>)}
            </ul>
          </section>
          <section>
            <h3>Keyword icons</h3>
            <ul className="game-guide__icon-list">
              <li><KeywordStateIcons displayValue="false" /> Absent</li>
              <li><KeywordStateIcons displayValue="true" /> Present</li>
              <li><KeywordStateIcons displayValue="false → true" /> Added on upgrade</li>
              <li><KeywordStateIcons displayValue="true → false" /> Removed on upgrade</li>
            </ul>
          </section>
          <section>
            <h3>Orbs and filtering</h3>
            <ul className="game-guide__orb-list">
              {ORB_GUIDE.map(([kind, description]) => <li key={kind}>
                <OrbVisual kind={kind} compact /> <strong>{ORB_LABELS[kind]} Orb.</strong> {description}
              </li>)}
            </ul>
          </section>
          <section>
            <h3>Name hints</h3>
            <ul>
              <li>Hints reveal the selected answer name after incorrect guesses.</li>
              <li>They are advisory and do not change which equivalent answers are accepted.</li>
            </ul>
          </section>
          <section>
            <h3>Modes</h3>
            <ul>
              <li>Daily uses the UTC date, restores progress, and shares a win result.</li>
              <li>Practice provides unlimited random rounds; Hardcore Daily has no orbs or name hints.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>}
  </section>;
}
