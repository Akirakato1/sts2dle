// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DailyCountdown, formatCountdown, secondsUntilNextUtcDay } from "../../src/client/components/DailyCountdown.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DailyCountdown", () => {
  test("formats a fixed-width UTC countdown", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(3_661)).toBe("01:01:01");
    expect(formatCountdown(86_399)).toBe("23:59:59");
    expect(secondsUntilNextUtcDay(Date.parse("2026-08-16T23:59:58.250Z"))).toBe(2);
  });

  test("ticks from the current clock and starts the next UTC cycle at midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T23:59:58.250Z"));
    const view = render(<DailyCountdown />);
    expect(screen.getByRole("timer")).toHaveTextContent("NEXT DAILY 00:00:02");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("timer")).toHaveTextContent("NEXT DAILY 00:00:01");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("timer")).toHaveTextContent("NEXT DAILY 23:59:59");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("recovers from a delayed clock without accumulating interval drift", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00.000Z"));
    render(<DailyCountdown />);
    expect(screen.getByRole("timer")).toHaveTextContent("NEXT DAILY 14:00:00");

    vi.setSystemTime(new Date("2026-08-16T20:30:15.000Z"));
    act(() => vi.advanceTimersToNextTimer());
    expect(screen.getByRole("timer")).toHaveTextContent("NEXT DAILY 03:29:44");
  });
});
