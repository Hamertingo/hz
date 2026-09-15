import { describe, expect, it } from "vitest";

import { todoPlan } from "./FollowupStrip";

describe("todoPlan", () => {
  it("reads a TodoWrite list with its counts", () => {
    const plan = todoPlan([
      {
        todos: [
          { content: "Write the mapper", status: "completed" },
          { content: "Wire the panel", status: "in_progress", activeForm: "Wiring the panel" },
          { content: "Run the tests", status: "pending" },
        ],
      },
    ]);

    expect(plan?.done).toBe(1);
    expect(plan?.total).toBe(3);
    expect(plan?.current).toBe("Wiring the panel");
  });

  it("reads omp's bare-string items as pending", () => {
    const plan = todoPlan([{ items: ["Testar ciclo de todo"], op: "init" }]);

    expect(plan?.done).toBe(0);
    expect(plan?.total).toBe(1);
  });

  it("folds a done op over the newest init instead of going blank", () => {
    const plan = todoPlan([
      { items: ["Testar ciclo de todo"], op: "init" },
      { op: "done", task: "Testar ciclo de todo" },
    ]);

    expect(plan?.done).toBe(1);
    expect(plan?.total).toBe(1);
  });

  it("a newer init replaces the list the ops fold over", () => {
    const plan = todoPlan([
      { items: ["First"], op: "init" },
      { op: "done", task: "First" },
      { items: ["Second"], op: "init" },
    ]);

    expect(plan?.done).toBe(0);
    expect(plan?.total).toBe(1);
  });

  it("falls back to the content where no active form is written", () => {
    const plan = todoPlan([{ todos: [{ content: "Write the mapper", status: "in_progress" }] }]);

    expect(plan?.current).toBe("Write the mapper");
  });

  it("reports no current step once everything is done", () => {
    const plan = todoPlan([{ todos: [{ content: "Write the mapper", status: "completed" }] }]);

    expect(plan?.current).toBeNull();
  });

  it("refuses anything that is not a plan rather than drawing a guess", () => {
    expect(todoPlan([])).toBeNull();
    expect(todoPlan([null])).toBeNull();
    expect(todoPlan([{}])).toBeNull();
    expect(todoPlan([{ todos: [] }])).toBeNull();
    expect(todoPlan([{ todos: [{ content: "No status here" }] }])).toBeNull();
    expect(todoPlan([{ todos: "just a string" }])).toBeNull();
    // An op with no init before it names a task against nothing.
    expect(todoPlan([{ op: "done", task: "Orphan" }])).toBeNull();
  });
});
