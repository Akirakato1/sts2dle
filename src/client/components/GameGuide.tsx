import React, { useCallback, useEffect, useRef, useState } from "react";

import { OrbVisual } from "./OrbVisual.js";

const RESULT_LEGEND = [
  ["green", "Both base and upgraded features match"],
  ["yellow", "Exactly one version matches"],
  ["red", "Neither version matches"],
] as const;

const ORB_GUIDE = [
  ["reveal", "Reveal Orb: one use on a feature header to reveal the answer's base and upgraded pair."],
  ["filter", "Filter Orb: one use on a green result to mark matching candidates green."],
  ["negation", "Negation Orb: one use on a red result to mark impossible candidates red."],
] as const;

type GuideIconKind = "card" | "controls" | "candidates" | "hint" | "daily" | "hardcore" | "practice" | "forfeit";

function GuideRowIcon({ kind }: { kind: GuideIconKind }): React.JSX.Element {
  let artwork: React.ReactNode;
  switch (kind) {
    case "card":
      artwork = <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h6M8 15h8" /></>;
      break;
    case "controls":
      artwork = <><path d="M4 7h16M4 17h16" /><path d="M8 4v6M16 14v6" /></>;
      break;
    case "candidates":
      artwork = <><circle cx="6" cy="6" r="1.5" /><circle cx="6" cy="12" r="1.5" /><circle cx="6" cy="18" r="1.5" /><path d="M10 6h10M10 12h10M10 18h10" /></>;
      break;
    case "hint":
      artwork = <><path d="M9 18h6M10 22h4" /><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-1 .8-1.5 1.8-1.5 3.5h-4c0-1.7-.5-2.7-1.5-3.5Z" /></>;
      break;
    case "daily":
      artwork = <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>;
      break;
    case "hardcore":
      artwork = <path d="M12 3 20 6v6c0 4.8-3.1 7.7-8 9-4.9-1.3-8-4.2-8-9V6l8-3Z" />;
      break;
    case "practice":
      artwork = <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M18.2 9A7 7 0 0 0 6.4 6.4L4 9M5.8 15A7 7 0 0 0 17.6 17.6L20 15" /></>;
      break;
    case "forfeit":
      artwork = <><path d="M5 3v19" /><path d="M5 5h12l-2 4 2 4H5" /></>;
      break;
  }
  return <svg
    className="game-guide__row-icon"
    data-guide-icon={kind}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    focusable="false"
    aria-hidden="true"
  >{artwork}</svg>;
}

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
        event.stopPropagation();
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
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closeGuide, open]);

  return <section className="game-guide" aria-label="Game help">
    <button ref={triggerRef} type="button" className="game-guide__trigger" aria-label="How to play" onClick={() => setOpen(true)}>
      <span className="game-guide__trigger-art" aria-hidden="true" />
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
            <ul className="game-guide__row-list">
              <li><GuideRowIcon kind="card" /><span>Guess a base card name.</span></li>
              <li><GuideRowIcon kind="card" /><span>Compare the guess&apos;s base and upgraded versions with the answer&apos;s corresponding versions.</span></li>
              <li><GuideRowIcon kind="card" /><span>Cards with an identical complete paired feature set are accepted as equivalent answers.</span></li>
            </ul>
          </section>
          <section>
            <h3>Result colors</h3>
            <ul className="result-legend game-guide__row-list">
              {RESULT_LEGEND.map(([color, meaning]) => <li key={color}>
                <span className={`result-legend__swatch result-legend__swatch--${color}`} aria-hidden="true" />
                <span>{meaning}</span>
              </li>)}
            </ul>
          </section>
          <section>
            <h3>Set features</h3>
            <ul className="game-guide__row-list">
              <li><GuideRowIcon kind="card" /><span>Powers and Keywords are sets. Exact sets match green. Any corresponding overlap is yellow. No overlap is red.</span></li>
            </ul>
          </section>
          <section>
            <h3>Orbs and filtering</h3>
            <ul className="game-guide__orb-list game-guide__row-list">
              {ORB_GUIDE.map(([kind, description]) => <li key={kind}>
                <OrbVisual kind={kind} compact /><span>{description}</span>
              </li>)}
              <li><GuideRowIcon kind="candidates" /><span>Red candidate marking overrides green marking.</span></li>
              <li><GuideRowIcon kind="controls" /><span>Drag an orb, or operate it with click, tap, or keyboard.</span></li>
              <li><GuideRowIcon kind="candidates" /><span>Neutral, Green, and Red visibility controls only hide or show candidate rows; accepted answers never change.</span></li>
              <li><GuideRowIcon kind="controls" /><span>Practice Filter Mode checklists: Disable accepts any value; an enabled group with no checks matches no cards.</span></li>
              <li><GuideRowIcon kind="controls" /><span>Scalar groups use OR; Powers and Keywords use AND; enabled groups combine with AND. Base and upgraded forms are checked separately, while orbs and category highlights pause.</span></li>
              <li><GuideRowIcon kind="controls" /><span>Power None matches a form with no powers and clears other power choices; Keyword None does the same for keywords.</span></li>
            </ul>
          </section>
          <section>
            <h3>Name hints</h3>
            <ul className="game-guide__row-list">
              <li><GuideRowIcon kind="hint" /><span>After 5 wrong guesses, word-length lines appear.</span></li>
              <li><GuideRowIcon kind="hint" /><span>After 7 wrong guesses, the first word&apos;s first letter appears.</span></li>
              <li><GuideRowIcon kind="hint" /><span>Each later wrong guess reveals the next word&apos;s first letter, then random unrevealed characters.</span></li>
            </ul>
          </section>
          <section>
            <h3>Modes</h3>
            <ul className="game-guide__row-list">
              <li><GuideRowIcon kind="daily" /><span>Daily: one UTC-date round that restores locally and creates a share result after a win.</span></li>
              <li><GuideRowIcon kind="hardcore" /><span>Hardcore Daily: a separate daily answer with no orbs or name hints.</span></li>
              <li><GuideRowIcon kind="practice" /><span>Practice: repeatable rounds that restore the current round and reset filters on a new round.</span></li>
              <li><GuideRowIcon kind="forfeit" /><span>End game forfeits the current Practice round.</span></li>
            </ul>
          </section>
        </div>
      </div>
    </div>}
  </section>;
}
