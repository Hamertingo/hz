import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarDay, clockTime, formatDuration, formatElapsed } from "@/lib/format";

/// Fixed so "today" is a known afternoon rather than whenever the suite runs —
/// every case here is about which side of a midnight a timestamp falls on, and
/// a real clock would make half of them flip depending on the hour.
const NOW = new Date(2026, 7, 27, 14, 0, 0); // 27 Aug 2026, local

describe("calendarDay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it("names the two days that have names", () => {
    expect(calendarDay(new Date(2026, 7, 27, 9, 0).toISOString())).toBe("Today");
    expect(calendarDay(new Date(2026, 7, 26, 23, 30).toISOString())).toBe("Yesterday");
  });

  /// Calendar days, not a 24-hour window. Something touched at 11pm last night
  /// is yesterday's work by 1am, and an elapsed-hours reading would call it
  /// today for another two hours.
  it("counts midnights, not hours", () => {
    vi.setSystemTime(new Date(2026, 7, 27, 1, 0));

    expect(calendarDay(new Date(2026, 7, 26, 23, 0).toISOString())).toBe("Yesterday");
    // Two hours earlier and one hour apart, but the same day.
    expect(calendarDay(new Date(2026, 7, 27, 0, 30).toISOString())).toBe("Today");
  });

  it("falls back to a date past yesterday", () => {
    expect(calendarDay(new Date(2026, 7, 23, 12, 0).toISOString())).toBe("Aug 23");
  });

  /// The year is noise on every row within this year and the only thing telling
  /// two rows apart across one.
  it("adds the year only once it stops being obvious", () => {
    expect(calendarDay(new Date(2025, 7, 23, 12, 0).toISOString())).toBe("Aug 23, 2025");
  });

  /// A row still has to draw. An unparseable stamp costs its own cell, never the
  /// list around it.
  it("is empty for something that is not a date", () => {
    expect(calendarDay("not a date")).toBe("");
  });

  /// A stamp from the future — clock skew between this machine and the tracker's
  /// — reads as today rather than as a negative day count.
  it("reads a future stamp as today", () => {
    expect(calendarDay(new Date(2026, 7, 28, 9, 0).toISOString())).toBe("Today");
  });
});

describe("formatDuration", () => {
  /// The decimal is the whole reason this exists: a fast turn and a slow one are
  /// both "2s" with whole seconds, and the reader is looking at this to tell
  /// them apart.
  it("keeps a tenth of a second under a minute", () => {
    expect(formatDuration(2300)).toBe("2.3s");
    expect(formatDuration(9400)).toBe("9.4s");
    expect(formatDuration(0)).toBe("0.0s");
  });

  it("drops the decimal once it is minutes", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(95_400)).toBe("1m 35s");
  });

  /// Nothing should reach this, and a clock step backwards would — so the
  /// reading is a zero rather than a negative count.
  it("never goes below zero", () => {
    expect(formatDuration(-500)).toBe("0.0s");
  });
});

describe("formatElapsed", () => {
  /// The live row redraws every second, so a tenth would be a `.0` that changes
  /// under the reader's eye and says nothing.
  it("counts whole seconds, with no decimal", () => {
    expect(formatElapsed(2300)).toBe("2s");
    expect(formatElapsed(9900)).toBe("9s");
    expect(formatElapsed(0)).toBe("0s");
  });

  /// Rounded down, so the number is time actually spent — 59.9s must not read as
  /// a minute the wait has not reached.
  it("does not round a wait up into the next unit", () => {
    expect(formatElapsed(59_900)).toBe("59s");
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(95_400)).toBe("1m 35s");
  });

  it("never goes below zero", () => {
    expect(formatElapsed(-500)).toBe("0s");
  });
});

describe("clockTime", () => {
  /// Built from local components on purpose: the figure is read off the Date's
  /// own local fields, so a fixture written in UTC would pass in UTC and fail
  /// everywhere the machine is set to anything else.
  it("draws the local wall clock, 24-hour and zero-padded", () => {
    expect(clockTime(new Date(2026, 8, 19, 9, 5).toISOString())).toBe("09:05");
    expect(clockTime(new Date(2026, 8, 19, 14, 32).toISOString())).toBe("14:32");
    expect(clockTime(new Date(2026, 8, 19, 0, 0).toISOString())).toBe("00:00");
    // Midnight belongs to the day it opens, not to noon — 24:00 on the clock
    // face is the hour a reader is least able to disambiguate.
    expect(clockTime(new Date(2026, 8, 19, 23, 59).toISOString())).toBe("23:59");
  });

  it("answers nothing for a stamp it cannot read", () => {
    expect(clockTime("half past nine")).toBeNull();
  });
});
