import React from "react";

export type KeywordStateDisplayValue = "false" | "true" | "false → true" | "true → false";

function XIcon() {
  return <svg data-icon="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>;
}

function CheckIcon() {
  return <svg data-icon="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
    <path d="m5 12 4.5 4.5L19 7" />
  </svg>;
}

function StateIcon({ present }: { present: boolean }) {
  return present ? <CheckIcon /> : <XIcon />;
}

export function KeywordStateIcons({ displayValue }: { displayValue: KeywordStateDisplayValue }) {
  const [base, upgraded] = displayValue.split(" → ") as ["false" | "true", ("false" | "true")?];
  const changed = upgraded !== undefined;
  return <span className="keyword-state-icons" aria-hidden="true">
    <StateIcon present={base === "true"} />
    {changed && <><span className="keyword-state-icons__arrow">→</span><StateIcon present={upgraded === "true"} /></>}
  </span>;
}
