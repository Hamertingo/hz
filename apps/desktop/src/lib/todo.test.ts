import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  planLine,
  planOf,
  planRows,
  todoMutation,
  todoRowSummary,
  todoTimeline,
  type TodoSource,
} from "@/lib/todo";
import type { ToolResult } from "@/types/events";

/// The real `mcode acp` capture of a `todowrite` turn — the same file the Rust
/// mapper tests read. Built into `TodoSource` here rather than hand-written
/// because the whole point of this reader is *where* the list rides: the
/// announcement carries no arguments at all, the list arrives on the update
/// behind it, and a fixture that already had it in the right place would prove
/// nothing.
const MCODE_CAPTURE = new URL(
  "../../src-tauri/src/harness/mcode/fixtures/todowrite.jsonl",
  import.meta.url,
);

function todoEvents(): TodoSource[] {
  const events: TodoSource[] = [];
  const named = new Map<string, string>();

  for (const raw of readFileSync(MCODE_CAPTURE, "utf8").split("\n")) {
    if (!raw.startsWith("<< ")) continue;
    const message = JSON.parse(raw.slice(3)) as Record<string, any>;
    if (message.method !== "session/update") continue;
    const update = message.params.update as Record<string, any>;

    // The announcement names the call; it carries no arguments.
    if (update.sessionUpdate === "tool_call") {
      named.set(update.toolCallId, update.name ?? "");
      continue;
    }
    if (update.sessionUpdate !== "tool_call_update") continue;

    const name = named.get(update.toolCallId);
    if (!name) continue;

    if (update.status === "in_progress" && update.rawInput) {
      events.push({
        payload: {
          type: "tool_call_started",
          callId: update.toolCallId,
          name,
          input: update.rawInput,
        },
      });
    }
    if (update.status === "completed" && update.rawOutput) {
      events.push({
        payload: {
          type: "tool_call_completed",
          callId: update.toolCallId,
          result: {
            text: "",
            isError: false,
            structured: update.rawOutput,
            exitCode: null,
            durationMs: null,
            images: [],
          } as ToolResult,
        },
      });
    }
  }

  return events;
}

/// One plan call as the two events the reader sees: the call, and — where the
/// harness answers with a list — its result.
function call(callId: string, input: unknown, structured?: unknown): TodoSource[] {
  const events: TodoSource[] = [
    { payload: { type: "tool_call_started", callId, name: "todowrite", input } } as never,
  ];
  if (structured !== undefined) {
    events.push({
      payload: {
        type: "tool_call_completed",
        callId,
        result: {
          text: "",
          isError: false,
          structured,
          exitCode: null,
          durationMs: null,
          images: [],
        } as ToolResult,
      },
    } as never);
  }
  return events;
}

describe("todoTimeline", () => {
  /// **The list is on the call's input**, under `todos` — the name mcode's
  /// tool carries, and the same key Claude's list uses. The row keys are not:
  /// mcode writes `content`, where the result-side shape pi used writes
  /// `subject`, so the name alone is not what makes this reader work.
  it("reads mcode's list off the call's own input", () => {
    const { byCallId, plan } = todoTimeline(todoEvents());

    expect(plan).not.toBeNull();
    expect(plan!.tasks.map((task) => task.subject)).toEqual([
      "Read the README",
      "Fix the typos in the README",
      "Run the tests",
    ]);
    expect(plan!.done).toBe(0);
    expect(plan!.total).toBe(3);
    expect(plan!.current?.subject).toBe("Read the README");

    // One call, one snapshot: the whole list as that call left it, which is
    // what a transcript row opens onto.
    expect(byCallId.size).toBe(1);
    const [snapshot] = [...byCallId.values()];
    expect(snapshot.map((task) => task.status)).toEqual([
      "in_progress",
      "pending",
      "pending",
    ]);
  });

  it("reads Claude's list off the call itself", () => {
    const { byCallId, plan } = todoTimeline([
      {
        payload: {
          type: "tool_call_started",
          callId: "c1",
          name: "TodoWrite",
          input: {
            todos: [
              { content: "Add the parser", status: "completed" },
              { content: "Write the mapper", status: "in_progress", activeForm: "writing the mapper" },
              { content: "Render the panel", status: "pending" },
            ],
          } as never,
        },
      },
    ]);

    expect(plan!.total).toBe(3);
    expect(plan!.done).toBe(1);
    expect(plan!.current!.activeForm).toBe("writing the mapper");
    // Positional rows carry no id: an index is not an identity the agent knows.
    expect(plan!.tasks.map((task) => task.id)).toEqual([null, null, null]);
    expect(byCallId.get("c1")).toHaveLength(3);
  });

  it("keeps an input-carried list when its result says nothing about it", () => {
    const events: TodoSource[] = [
      ...call("c1", { todos: [{ content: "one", status: "pending" }] }),
      {
        payload: {
          type: "tool_call_completed",
          callId: "c1",
          result: {
            text: "ok",
            isError: false,
            structured: null,
            exitCode: null,
            durationMs: null,
            images: [],
          } as ToolResult,
        },
      },
    ];

    expect(todoTimeline(events).plan!.total).toBe(1);
  });


  it("ignores another tool's calls", () => {
    const { byCallId, plan } = todoTimeline([
      {
        payload: {
          type: "tool_call_completed",
          callId: "r1",
          result: {
            text: "file",
            isError: false,
            structured: { details: { tasks: [{ subject: "no", status: "pending" }] } } as never,
            exitCode: null,
            durationMs: null,
            images: [],
          } as ToolResult,
        },
      },
    ]);

    expect(byCallId.size).toBe(0);
    expect(plan).toBeNull();
  });

  it("has no plan for a session that never opened one", () => {
    expect(todoTimeline([]).plan).toBeNull();
    expect(todoTimeline([...call("c1", { action: "list" })]).plan).toBeNull();
  });
});

describe("planLine", () => {
  it("names the step being worked on", () => {
    const plan = planOf([
      {
        id: 1,
        subject: "Wire the reader",
        status: "completed",
        activeForm: "wiring the reader",
        description: null,
        blockedBy: [],
        owner: null,
      },
      {
        id: 2,
        subject: "Draw the panel",
        status: "in_progress",
        activeForm: "drawing the panel",
        description: null,
        blockedBy: [1],
        owner: null,
      },
    ]);

    expect(planLine(plan!)).toBe("1/2 · drawing the panel");
  });

  it("falls back to the subject where the agent wrote no continuous label", () => {
    const plan = planOf([
      {
        id: null,
        subject: "one",
        status: "in_progress",
        activeForm: null,
        description: null,
        blockedBy: [],
        owner: null,
      },
    ]);

    expect(planLine(plan!)).toBe("0/1 · one");
  });

  it("says so when everything is done and nothing is running", () => {
    const plan = planOf([
      {
        id: 1,
        subject: "one",
        status: "completed",
        activeForm: null,
        description: null,
        blockedBy: [],
        owner: null,
      },
    ]);

    expect(planLine(plan!)).toBe("1/1 · all done");
  });
});

describe("planRows", () => {
  const task = (subject: string, status: "pending" | "in_progress" | "completed") => ({
    id: null,
    subject,
    status,
    activeForm: null,
    description: null,
    blockedBy: [],
    owner: null,
  });

  it("shows everything a plan fits", () => {
    const tasks = [task("a", "completed"), task("b", "in_progress"), task("c", "pending")];
    expect(planRows(tasks, 5)).toEqual({ shown: tasks, hidden: 0 });
  });

  it("drops finished rows first, oldest first", () => {
    const { shown, hidden } = planRows(
      [
        task("a", "completed"),
        task("b", "completed"),
        task("c", "in_progress"),
        task("d", "pending"),
        task("e", "pending"),
      ],
      3,
    );

    expect(shown.map((row) => row.subject)).toEqual(["c", "d", "e"]);
    expect(hidden).toBe(2);
  });

  it("cuts the tail when nothing is finished to drop", () => {
    const { shown, hidden } = planRows(
      [task("a", "in_progress"), task("b", "pending"), task("c", "pending")],
      2,
    );

    expect(shown.map((row) => row.subject)).toEqual(["a", "b"]);
    expect(hidden).toBe(1);
  });
});

describe("todoRowSummary", () => {
  it("says what a mutation did, since the plan it stands in is the body's answer", () => {
    expect(todoMutation({ action: "create", subject: "Wire the reader" })).toBe(
      "Wire the reader",
    );
    expect(todoMutation({ action: "update", id: 1, status: "in_progress" })).toBe(
      "#1 → in_progress",
    );
    expect(todoMutation({ action: "update", id: 1 })).toBe("#1");
    expect(todoMutation({ action: "delete", id: 2 })).toBe("#2");
    expect(todoMutation({ action: "clear" })).toBe("all");
    expect(todoMutation({ action: "list" })).toBeNull();
  });

  it("says where the plan stands when the call carried the whole list", () => {
    const tasks = [
      {
        id: null,
        subject: "a",
        status: "in_progress" as const,
        activeForm: "doing a",
        description: null,
        blockedBy: [],
        owner: null,
      },
    ];

    expect(todoRowSummary({ todos: [] } as never, tasks)).toBe("0/1 · doing a");
    expect(todoRowSummary({ action: "create", subject: "a" } as never, tasks)).toBe("a");
  });
});
