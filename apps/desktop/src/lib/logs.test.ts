import { describe, expect, it } from "vitest";

// The real answer to `gh run view --log` for a release that went red in this
// repository — a fixture the Rust side asserts on too, read here rather than
// captured twice.
import capture from "../../src-tauri/src/fixtures/gh_run_log.txt?raw";
import {
  annotate,
  jobLog,
  logGroups,
  logText,
  parseLogLine,
  readLog,
  stripAnsi,
  tail,
} from "@/lib/logs";

/// The run's own step list, as `gh run view --json jobs` gives it. Kept short to
/// the steps the capture actually has groups for.

const line = (text: string, at: string | null = null) => ({ job: "build", at, text });

describe("parseLogLine", () => {
  it("takes the stamp off and leaves a line without one alone", () => {
    expect(parseLogLine("2026-09-05T12:02:02.8625270Z Current runner version: '2.337.0'", "build")).toEqual({
      job: "build",
      at: "2026-09-05T12:02:02.8625270Z",
      text: "Current runner version: '2.337.0'",
    });
    // A message that merely begins with digits is not a clock.
    expect(parseLogLine("2 packages installed", "build")).toEqual({
      job: "build",
      at: null,
      text: "2 packages installed",
    });
    expect(parseLogLine("", "build")).toEqual({ job: "build", at: null, text: "" });
  });
});

describe("annotate", () => {
  it("reads the runner's own markers and takes them off", () => {
    expect(annotate("##[error]Process completed with exit code 1.")).toEqual({
      kind: "error",
      text: "Process completed with exit code 1.",
    });
    expect(annotate("##[group]Run pnpm lint")).toEqual({ kind: "group", text: "Run pnpm lint" });
    expect(annotate("##[warning]Node.js 20 is deprecated")).toEqual({
      kind: "warning",
      text: "Node.js 20 is deprecated",
    });
  });

  it("leaves a line nobody annotated alone", () => {
    expect(annotate("> hz@0.22.2 lint")).toEqual({ kind: "plain", text: "> hz@0.22.2 lint" });
    // `##[` alone is not a marker: the runner's are a closed set, and a shell
    // script may print anything.
    expect(annotate("##[something-else]hi")).toEqual({
      kind: "plain",
      text: "##[something-else]hi",
    });
  });
});

describe("readLog", () => {
  it("reads the three columns off a real capture", () => {
    const lines = readLog(capture);
    expect(lines.length).toBeGreaterThan(1000);
    // The stamp comes off, so what is left is the runner's message.
    expect(lines.every((l) => l.at === null || l.at.endsWith("Z"))).toBe(true);
    // And the job column is kept, since it is the one column of the three that
    // says anything usable.
    expect(lines.every((l) => l.job === "build")).toBe(true);
    // The step column is `UNKNOWN STEP` on every line of a real run, which is
    // why nothing joins on it — the group markers below are the join.
    expect(capture).toContain("UNKNOWN STEP");
  });

  it("drops `gh`'s own blank padding and keeps a blank message", () => {
    const lines = readLog("j\ts\t2026-01-01T00:00:00Z hello\n\nj\ts\t2026-01-01T00:00:01Z \n");
    expect(lines).toHaveLength(2);
    expect(lines[1].text).toBe("");
  });
});

describe("stripAnsi", () => {
  /// A runner writes colour into its log for a terminal, and this is not one:
  /// drawn raw it is a line of punctuation nobody can read.
  it("takes the escape sequences off a real capture's lines", () => {
    expect(stripAnsi("\u001b[36;1mgit push\u001b[0m")).toBe("git push");
    expect(stripAnsi("plain")).toBe("plain");
    expect(readLog(capture).some((l) => l.text.includes("\u001b"))).toBe(false);
  });
});

describe("jobLog", () => {
  /// **The job column is the one that matters.** The step column reads
  /// `UNKNOWN STEP` on every line of a real run, so it is the job that keeps one
  /// job's log out of the pane showing another.
  it("keeps another job's lines out, and falls back to all of them", () => {
    const lines = [line("a"), line("b"), line("c")];
    lines[2].job = "other";
    expect(jobLog(lines, "build").map((l) => l.text)).toEqual(["a", "b"]);

    // **A job the log does not name falls back to every line**, because an empty
    // pane for a log that is right there is the worse answer.
    expect(jobLog(lines, "nowhere")).toHaveLength(3);
  });

  it("answers the whole of a real capture for the job it names", () => {
    const all = readLog(capture);
    expect(jobLog(all, "build")).toHaveLength(all.length);
    expect(jobLog(all, "build").length).toBeGreaterThan(1000);
  });
});

describe("logGroups", () => {
  it("splits a log on the headings the runner wrote", () => {
    const groups = logGroups([
      line("the runner's own preamble"),
      line("##[group]Run pnpm lint"),
      line("> hz@0.22.2 lint"),
      line("##[error]exit code 1"),
      line("##[group]Post Run actions/checkout@v4"),
      line("cleaning up"),
    ]);

    // What came before any heading is a block of its own, so the preamble is
    // reachable rather than dropped.
    expect(groups.map((g) => g.title)).toEqual([null, "Run pnpm lint", "Post Run actions/checkout@v4"]);
    expect(groups[1].lines.map((l) => l.text)).toEqual(["> hz@0.22.2 lint", "##[error]exit code 1"]);
    // **Each block says where it starts**, which is what a drawn line number is
    // made of: a shut heading shows the number of its first line, so the reader
    // can see how much they are folding away without opening it.
    // (the heading itself is not a line, so the preamble is one long and the
    // second block opens at 2)
    expect(groups.map((g) => g.at)).toEqual([0, 1, 3]);
  });

  /// A heading over nothing is the one control this app will not draw — and a
  /// log whose last group closed with nothing in it is the ordinary case.
  it("drops a group that opened with nothing under it", () => {
    expect(logGroups([line("##[group]A"), line("##[group]B")])).toEqual([]);
    expect(
      logGroups([line("##[group]A"), line("under A")]).map((group) => group.title),
    ).toEqual(["A"]);
  });
});

describe("tail", () => {
  it("keeps the end, which is where a step went wrong", () => {
    const lines = Array.from({ length: 500 }, (_, i) => line(`line ${i}`));
    const cut = tail(lines, 400);
    expect(cut.hidden).toBe(100);
    expect(cut.lines[0].text).toBe("line 100");
    expect(cut.lines[399].text).toBe("line 499");
    expect(tail(lines, 600)).toMatchObject({ hidden: 0 });
  });
});

describe("logText", () => {
  it("copies the words without the markers the runner talks to the interface with", () => {
    expect(logText([line("> hz@0.22.2 lint"), line("##[error]exit code 1")])).toBe(
      "> hz@0.22.2 lint\nexit code 1",
    );
  });
});
