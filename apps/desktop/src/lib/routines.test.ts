import { describe, expect, it } from "vitest";

import {
  clock,
  counts,
  dateKeyIn,
  destLabel,
  filterRoutines,
  hookUrl,
  nextText,
  occurrences,
  sentenceParts,
  sentenceText,
  weekBuckets,
  weekStartOf,
  whenText,
} from "@/lib/routines";
import type { Routine } from "@/types/events";

function routine(patch: Partial<Routine> = {}): Routine {
  return {
    id: "r1",
    name: "Weekly numbers",
    agentId: "atlas",
    trigger: { kind: "schedule", days: [0], time: "09:00", tz: "UTC" },
    act: "pulls the weekly numbers",
    prompt: "p",
    to: "agent_chat",
    quiet: true,
    on: true,
    nextRunAt: null,
    skipped: [],
    runs: [],
    secret: null,
    createdAt: "",
    deletedAt: null,
    projectPath: null,
    model: null,
    legacyEveryMinutes: null,
    ...patch,
  } as Routine;
}

// Monday 2026-09-21, noon UTC.
const NOW = Date.parse("2026-09-21T12:00:00Z");

describe("whenText", () => {
  it("names the common sets and lists the rest", () => {
    expect(whenText([0, 1, 2, 3, 4, 5, 6])).toBe("every day");
    expect(whenText([4, 3, 2, 1, 0])).toBe("every weekday");
    expect(whenText([5, 6])).toBe("every weekend");
    expect(whenText([0])).toBe("every Monday");
    expect(whenText([0, 2, 4])).toBe("on Mon, Wed, Fri");
  });
});

describe("sentence", () => {
  it("builds the schedule sentence with a menu on each underlined word", () => {
    const r = routine();
    const parts = sentenceParts(r, "Atlas");
    expect(parts.filter((p) => p.chip).map((p) => p.chip)).toEqual(["days", "time", "agent", "act", "to"]);
    expect(sentenceText(r, "Atlas")).toBe("Every Monday at 09:00, Atlas pulls the weekly numbers and posts it in Atlas's chat.");
  });

  it("builds the webhook sentence", () => {
    const r = routine({ trigger: { kind: "webhook", source: "Stripe", event: "charge.dispute.created" }, to: "inbox", act: "drafts a reply" });
    expect(sentenceText(r, "Atlas")).toBe("When Stripe sends charge.dispute.created, Atlas drafts a reply and puts it in Inbox.");
    expect(sentenceParts(r, "Atlas").filter((p) => p.chip).map((p) => p.chip)).toEqual(["src", "ev", "agent", "act", "to"]);
  });

  it("says something when nothing is said yet", () => {
    expect(sentenceText(routine({ act: " " }), "Vex")).toContain("Vex does something");
  });

  it("names a destination in words", () => {
    expect(destLabel("pr_comment", "A")).toBe("a PR comment");
    expect(destLabel("channel:c1", "A", [{ id: "c1", name: "general" }])).toBe("#general");
    expect(destLabel("channel:gone", "A")).toBe("#gone");
  });
});

describe("occurrences", () => {
  const WEEK = 7 * 86_400_000;

  it("finds the days a schedule falls on, in its own zone", () => {
    const r = routine({ trigger: { kind: "schedule", days: [0, 2], time: "09:00", tz: "UTC" } });
    const at = occurrences(r, NOW, NOW + WEEK).map((ms) => new Date(ms).toISOString());
    expect(at).toEqual(["2026-09-23T09:00:00.000Z", "2026-09-28T09:00:00.000Z"]);
  });

  it("moves the instant with a fixed offset", () => {
    const r = routine({ trigger: { kind: "schedule", days: [2], time: "09:00", tz: "-03:00" } });
    expect(new Date(occurrences(r, NOW, NOW + WEEK)[0]).toISOString()).toBe("2026-09-23T12:00:00.000Z");
  });

  it("passes over a skipped date and a paused routine, and has none for a webhook", () => {
    const skipped = routine({ trigger: { kind: "schedule", days: [2], time: "09:00", tz: "UTC" }, skipped: ["2026-09-23"] });
    expect(occurrences(skipped, NOW, NOW + 3 * 86_400_000)).toEqual([]);
    expect(occurrences(routine({ on: false }), NOW, NOW + WEEK)).toEqual([]);
    expect(occurrences(routine({ trigger: { kind: "webhook", source: "GitHub", event: "push" } }), NOW, NOW + WEEK)).toEqual([]);
    expect(occurrences(routine({ legacyEveryMinutes: 30 }), NOW, NOW + WEEK)).toEqual([]);
  });

  it("reads the date an instant falls on in a zone", () => {
    expect(dateKeyIn("-03:00", Date.parse("2026-09-22T01:00:00Z"))).toBe("2026-09-21");
    expect(dateKeyIn("UTC", Date.parse("2026-09-22T01:00:00Z"))).toBe("2026-09-22");
  });
});

describe("nextText", () => {
  it("says paused and on event before it says a time", () => {
    expect(nextText(routine({ on: false }), NOW)).toBe("paused");
    expect(nextText(routine({ trigger: { kind: "webhook", source: "GitHub", event: "push" } }), NOW)).toBe("on event");
  });

  it("uses today, tomorrow and the weekday", () => {
    const at = (iso: string) => routine({ nextRunAt: iso });
    // The text is in the machine's zone, so compare against the same reading.
    const hhmm = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const soon = "2026-09-21T15:00:00Z";
    expect(nextText(at(soon), NOW)).toMatch(/^(today|tomorrow) /);
    expect(nextText(at(soon), NOW)).toContain(hhmm(soon));
    expect(nextText(at("2026-10-05T09:00:00Z"), NOW)).toMatch(/^(Sun|Mon|Tue) /);
  });
});

describe("week strip", () => {
  it("starts on the Monday of the week", () => {
    expect(weekStartOf(Date.parse("2026-09-23T10:00:00")) ).toBe("2026-09-21");
    expect(weekStartOf(Date.parse("2026-09-27T23:00:00"))).toBe("2026-09-21");
    expect(weekStartOf(Date.parse("2026-09-28T00:30:00"))).toBe("2026-09-28");
  });

  it("puts a run on its day, a failure red, and what is coming up after now", () => {
    const now = new Date(2026, 8, 23, 12, 0).getTime(); // Wednesday, local
    const ran = new Date(2026, 8, 21, 9, 0).getTime();
    const failed = new Date(2026, 8, 22, 9, 0).getTime();
    const r = routine({
      trigger: { kind: "schedule", days: [0, 1, 2, 3], time: "09:00", tz: "local" },
      runs: [
        { at: new Date(ran).toISOString(), status: "ok", durationMs: 1, cost: null, outputExcerpt: "", error: null, via: "schedule", delivery: null, needsYou: false },
        { at: new Date(failed).toISOString(), status: "fail", durationMs: 1, cost: null, outputExcerpt: "", error: "x", via: "schedule", delivery: null, needsYou: false },
      ],
    });
    const week = weekBuckets([r], now);
    expect(week).toHaveLength(7);
    expect(week[0].marks.map((m) => m.state)).toEqual(["ok"]);
    expect(week[1].marks.map((m) => m.state)).toEqual(["fail"]);
    expect(week[2].today).toBe(true);
    expect(week[2].marks).toEqual([]); // 09:00 today has passed with no record
    expect(week[3].marks.map((m) => m.state)).toEqual(["next"]);
    expect(week[3].marks[0].run).toBeNull();
    expect(week[4].marks).toEqual([]);
  });

  it("pops in a run that just finished, and draws a webhook's runs where they happened", () => {
    const now = new Date(2026, 8, 24, 15, 0).getTime();
    const just = new Date(now - 4000).toISOString();
    const older = new Date(2026, 8, 22, 11, 0).toISOString();
    const base = { status: "ok" as const, durationMs: 1, cost: null, outputExcerpt: "", error: null, via: "webhook: push", delivery: null, needsYou: false };
    const r = routine({
      trigger: { kind: "webhook", source: "GitHub", event: "push" },
      runs: [{ ...base, at: older }, { ...base, at: just }],
    });
    const week = weekBuckets([r], now);
    expect(week[1].marks).toHaveLength(1);
    expect(week[1].marks[0].fresh).toBe(false);
    expect(week[3].marks).toHaveLength(1);
    expect(week[3].marks[0].fresh).toBe(true);
  });

  it("does not draw last week's runs", () => {
    const now = new Date(2026, 8, 23, 12, 0).getTime();
    const r = routine({ runs: [{ at: new Date(2026, 8, 14, 9, 0).toISOString(), status: "ok", durationMs: 1, cost: null, outputExcerpt: "", error: null, via: "", delivery: null, needsYou: false }] });
    expect(weekBuckets([r], now).flatMap((d) => d.marks).filter((m) => m.state === "ok")).toEqual([]);
  });
});

describe("filters", () => {
  const list = [routine(), routine({ id: "r2", trigger: { kind: "webhook", source: "GitHub", event: "push" } })];
  it("counts and filters by kind", () => {
    expect(counts(list)).toEqual({ all: 2, schedule: 1, webhook: 1 });
    expect(filterRoutines(list, "webhook").map((r) => r.id)).toEqual(["r2"]);
    expect(filterRoutines(list, "all")).toHaveLength(2);
  });
});

describe("small formats", () => {
  it("clocks and hook urls", () => {
    expect(clock(7_400)).toBe("0:07");
    expect(clock(125_000)).toBe("2:05");
    expect(hookUrl("http://127.0.0.1:47831", "w1", "r1")).toBe("http://127.0.0.1:47831/hooks/w1/r1");
    expect(hookUrl("", null, "r1")).toBe("http://127.0.0.1:…/hooks/_/r1");
  });
});
