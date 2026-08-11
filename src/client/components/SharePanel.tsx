import React, { useRef, useState } from "react";

import { formatDailyShare } from "../../shared/share.js";
import type { RoundState } from "../game/game-reducer.js";

export interface SharePanelProps {
  round: RoundState;
  utcDate: string;
  siteUrl: string;
  onNextRound(): void;
}

type CopyState = "idle" | "pending" | "success" | "error";

export function SharePanel({ round, utcDate, siteUrl, onNextRound }: SharePanelProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copyGeneration = useRef(0);
  if (round.status !== "won") return null;

  if (round.mode === "practice") {
    return <section className="share-panel" aria-label="Practice result">
      <button type="button" onClick={onNextRound}>Next random card</button>
    </section>;
  }

  const copy = async () => {
    const generation = ++copyGeneration.current;
    setCopyState("pending");
    try {
      const text = formatDailyShare({ utcDate, guesses: round.guesses, siteUrl });
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(text);
      if (copyGeneration.current === generation) setCopyState("success");
    } catch {
      if (copyGeneration.current === generation) setCopyState("error");
    }
  };

  return <section className="share-panel" aria-label="Daily result" aria-busy={copyState === "pending"}>
    <button type="button" aria-label="Copy Daily result" onClick={() => void copy()}>Copy result</button>
    {copyState === "pending" && <p role="status">Copying Daily result…</p>}
    {copyState === "success" && <p role="status">Daily result copied.</p>}
    {copyState === "error" && <p role="alert">We could not copy the Daily result. Please try again.</p>}
  </section>;
}
