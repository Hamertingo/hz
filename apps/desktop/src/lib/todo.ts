import type { ToolResult } from "@/types/events";
import type { JsonValue } from "@/types/serde_json/JsonValue";

/// The plan an agent keeps, read out of the session's own event log.
///
/// **The list rides the call's input, and it is always the whole list.**
/// mcode's `todowrite` sends `{todos: [{content, status, priority}]}` as its
/// arguments — a snapshot rather than a mutation, which is why nothing here
/// folds one call forward onto another. Its *result* carries the same list
/// under `details.todos`, and that is deliberately unread: the call is already
/// on screen, and a reader that went looking at results would draw a plan one
/// line late.
///
/// **The newest snapshot is the whole answer**, and each one is kept against
/// its call id because a transcript row is history: expanding one has to show
/// the list as it stood *then*.

export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoTask = {
  /// The harness's own id where it has one. Claude's rows are positional and
  /// carry none: an id invented from an index is a number the reader could
  /// quote at the agent and get nothing for.
  id: number | null;
  subject: string;
  status: TodoStatus;
  /// Present-continuous label the agent wrote for the step it is on — "wiring
  /// the mapper". What the surfaces name a running task by, since it says what
  /// is happening where the subject says what the task is.
  activeForm: string | null;
  description: string | null;
  /// Ids this task waits on, empty where the harness carries none.
  blockedBy: number[];
  owner: string | null;
};

export type TodoPlan = {
  tasks: TodoTask[];
  done: number;
  total: number;
  /// The task being worked on, if any. Stated once because three surfaces ask
  /// it — the strip's collapsed line, the panel's header, a row's summary.
  current: TodoTask | null;
};

/// Tool names whose calls carry a plan.
///
/// `todowrite` is mcode's, and the list it sends under `todos` is the same
/// shape Claude's is — same key, same `content`/`status` per row — because the
/// tool was written to match. `TodoWrite` and `todo` are kept beside it: a
/// session recorded by a build that ran those harnesses still reads.
const PLAN_TOOLS = new Set(["todowrite", "todo", "TodoWrite"]);

/// Whether a call by this name carries a plan. Exported so every surface asks
/// the same question instead of keeping a second list of names to drift from.
export function isPlanTool(name: string): boolean {
  return PLAN_TOOLS.has(name);
}

/// What a plan surface needs off an event, and nothing else — so nothing here
/// can be broken by a field added to a payload elsewhere, and a test can hand
/// it the two arms it reads rather than a whole `AgentEvent`.
export type TodoSource = {
  payload:
    | { type: "tool_call_started"; callId: string; name: string; input: JsonValue }
    | { type: "tool_call_completed"; callId: string; result: ToolResult };
};

/// The plan at each call that moved it, keyed by call id, plus where the list
/// stands now.
///
/// Per-call as well as newest because a transcript row is history: expanding
/// one has to show the list *as it stood then*, which is the only thing that
/// makes a call worth a row at all.
export function todoTimeline(
  events: readonly TodoSource[],
): { byCallId: Map<string, TodoTask[]>; plan: TodoPlan | null } {
  const byCallId = new Map<string, TodoTask[]>();
  let tasks: TodoTask[] | null = null;

  for (const event of events) {
    const { payload } = event;
    if (payload.type !== "tool_call_started") continue;
    if (!PLAN_TOOLS.has(payload.name)) continue;

    // The whole list, every time. mcode's `todowrite` sends a snapshot rather
    // than a mutation, so there is nothing to fold forward and nothing to read
    // off the result behind it — the call *is* the state of the plan.
    const whole = inputList(payload.input);
    if (!whole) continue;
    tasks = whole;
    byCallId.set(payload.callId, whole);
  }

  return { byCallId, plan: planOf(tasks ?? []) };
}

export function planOf(tasks: TodoTask[]): TodoPlan | null {
  if (tasks.length === 0) return null;
  const done = tasks.filter((task) => task.status === "completed").length;
  return {
    tasks,
    done,
    total: tasks.length,
    current: tasks.find((task) => task.status === "in_progress") ?? null,
  };
}

/// The step a running task is named by — its own continuous label where the
/// agent wrote one, its subject where it did not.
export function activeLabel(task: TodoTask): string {
  return task.activeForm ?? task.subject;
}

/// One line for where the plan stands: "3/7 · wiring the mapper". The count
/// first, since it is the part that is legible at a glance, and the step after
/// it because that is what a glance is actually looking for.
export function planLine(plan: TodoPlan): string {
  const count = `${plan.done}/${plan.total}`;
  if (plan.current) return `${count} · ${activeLabel(plan.current)}`;
  return plan.done === plan.total ? `${count} · all done` : count;
}

/// Which rows a bounded surface shows, and how many it left out.
///
/// **Completed rows go first, oldest first.** The count already says how much
/// is done, so a done row is the one the reader can re-derive, where a pending
/// one is the plan itself. rpiv-todo's own overlay drops them in the same order
/// and for the same reason.
export function planRows(
  tasks: TodoTask[],
  cap: number,
): { shown: TodoTask[]; hidden: number } {
  const shown = [...tasks];
  let hidden = 0;

  for (let i = 0; shown.length > cap && i < shown.length; ) {
    if (shown[i].status === "completed") {
      shown.splice(i, 1);
      hidden++;
    } else {
      i++;
    }
  }

  // Still over with nothing finished to drop: a long plan of unfinished work.
  // The tail goes, since the strip is for the step being worked on and what
  // comes right after it, and the panel is one click away.
  while (shown.length > cap) {
    shown.pop();
    hidden++;
  }

  return { shown, hidden };
}

/// What a `todo` row reads beside its verb.
///
/// The two shapes answer different questions. A call carrying the whole list
/// *is* a snapshot, so the row says where the plan stands; a call carrying one
/// mutation says what it did, and where the plan stands is the body's answer.
export function todoRowSummary(
  input: JsonValue,
  tasks: TodoTask[] | null,
): string | null {
  if (inputList(input) !== null && tasks) {
    const plan = planOf(tasks);
    if (plan) return planLine(plan);
  }
  return todoMutation(input);
}

/// One mutation written as the phrase a row can carry: the subject it created,
/// the id it moved, or the id it deleted.
export function todoMutation(input: JsonValue): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  const action = typeof rec.action === "string" ? rec.action : null;
  const id = typeof rec.id === "number" ? `#${rec.id}` : null;

  if (action === "create") return text(rec.subject);
  if (action === "clear") return "all";
  if (!id) return null;
  if (typeof rec.status === "string") return `${id} → ${rec.status}`;
  return id;
}

/// The list inside a call's *input*, where the harness sends it whole: Claude
/// Code's `todos` and omp's `items`. Null where the input carries a mutation
/// instead, which is pi's shape and not something to guess a list out of.
function inputList(input: JsonValue): TodoTask[] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;

  const todos = rec.todos;
  if (Array.isArray(todos)) {
    const tasks: TodoTask[] = [];
    for (const entry of todos) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      if (typeof item.content !== "string") return null;
      const state = readStatus(item.status);
      if (state === "deleted") continue;
      tasks.push({
        id: null,
        subject: item.content,
        status: state,
        activeForm: text(item.activeForm),
        description: null,
        blockedBy: [],
        owner: null,
      });
    }
    return tasks;
  }

  const items = rec.items;
  if (Array.isArray(items) && items.every((entry) => typeof entry === "string")) {
    return (items as string[]).map((subject) => ({
      id: null,
      subject,
      // Pending by construction: the op channel is what moves them, and an
      // init that arrived mid-plan would otherwise reset every row to `pending`
      // with no way to tell it apart from one that finished.
      status: "pending" as const,
      activeForm: null,
      description: null,
      blockedBy: [],
      owner: null,
    }));
  }

  return null;
}

/// `deleted` is its own answer rather than folded into one of the three: it is
/// the one status a surface must not draw, and returning `pending` for it would
/// put every task the agent killed back on screen. Anything else unrecognised
/// reads as pending, which is wrong in the safe direction.
function readStatus(value: unknown): TodoStatus | "deleted" {
  if (value === "in_progress" || value === "completed") return value;
  if (value === "deleted") return "deleted";
  return "pending";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
