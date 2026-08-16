import React, { useEffect, useState } from "react";

const LAST_SECOND_OF_DAY = 86_399;

export function secondsUntilNextUtcDay(nowMs: number): number {
  const now = new Date(nowMs);
  const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.min(LAST_SECOND_OF_DAY, Math.max(0, Math.ceil((nextUtcDay - nowMs) / 1_000)));
}

export function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function DailyCountdown(): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <p className="subtitle daily-countdown" role="timer" aria-label="Time remaining until the next Daily puzzle">
    <span>NEXT DAILY</span> <strong>{formatCountdown(secondsUntilNextUtcDay(nowMs))}</strong>
  </p>;
}
