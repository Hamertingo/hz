import { describe, expect, it } from "vitest";

import { compactingOf } from "@/lib/compaction";
import type { AgentEvent, SessionSnapshot } from "@/types/events";

/// Only the two fields the walk reads: the newest `user_message`'s text, and
/// what sits around it. A whole `AgentEvent` would be a hundred lines of
/// nothing to say the same thing.
const prompt = (text: string) =>
  ({ payload: { type: "user_message", text } }) as unknown as AgentEvent;

const turnEnd = () =>
  ({ payload: { type: "turn_completed" } }) as unknown as AgentEvent;

const session = (events: AgentEvent[]) => ({ events }) as unknown as SessionSnapshot;

describe("compactingOf", () => {
  it("is false while nothing is running", () => {
    expect(compactingOf(session([prompt("/compact")]), false)).toBe(false);
    expect(compactingOf(null, true)).toBe(false);
  });

  it("is true while the newest prompt is the command", () => {
    expect(compactingOf(session([prompt("/compact")]), true)).toBe(true);
    // The command takes an instruction with it — `requestCompaction` is passed
    // the rest of the line.
    expect(compactingOf(session([prompt("/compact keep the API changes")]), true)).toBe(true);
  });

  /// The CLI never echoes a prompt back, so the newest one is what the reader
  /// last sent — which is the whole rule. Anything else is a turn that happens
  /// to be running, and it draws the working indicator instead.
  it("is false for anything that is not the command", () => {
    expect(compactingOf(session([prompt("hello")]), true)).toBe(false);
    expect(compactingOf(session([prompt("how do I /compact this?")]), true)).toBe(false);
    expect(compactingOf(session([]), true)).toBe(false);
  });

  /// A name, not a prefix: `/compacting` is a different word, and the CLI would
  /// refuse it as an unknown command rather than rewrite the conversation.
  it("matches the command's name and not its spelling", () => {
    expect(compactingOf(session([prompt("/compacting")]), true)).toBe(false);
    expect(compactingOf(session([prompt("/compactx")]), true)).toBe(false);
  });

  /// What ends it: the CLI's answer, then the reader's next prompt. The turn
  /// closing is what the `busy` gate is for, since a prompt that never came
  /// back would otherwise leave the line up forever.
  it("stops at the prompt that follows", () => {
    expect(compactingOf(session([prompt("/compact"), prompt("now do the next thing")]), true)).toBe(
      false,
    );
    expect(compactingOf(session([prompt("/compact")]), true)).toBe(true);
  });

  it("reads the newest prompt, not the first one it finds", () => {
    const events = [prompt("/compact"), turnEnd(), prompt("carry on")];
    expect(compactingOf(session(events), true)).toBe(false);
  });
});
