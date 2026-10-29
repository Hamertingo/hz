import { describe, expect, it } from "vitest";

import { activityOf, verbFor } from "@/lib/agentStatus";
import type { AgentEvent } from "@/types/events";

const ev = (payload: Record<string, unknown>): AgentEvent => ({ payload } as unknown as AgentEvent);
const started = (callId: string, name: string, toolType: string) => ev({ type: "tool_call_started", callId, name, toolType });
const completed = (callId: string) => ev({ type: "tool_call_completed", callId });

describe("activityOf", () => {
  it("reflects before anything happens and thinks between steps", () => {
    expect(activityOf([], "waiting")).toBe("reflecting");
    expect(activityOf([started("1", "Read", "file_read"), completed("1")], "waiting")).toBe("thinking");
  });

  it("names the tool still running", () => {
    expect(activityOf([started("1", "Bash", "shell")], undefined)).toBe("mac");
    expect(activityOf([started("1", "Edit", "file_edit")], undefined)).toBe("code");
    expect(activityOf([started("1", "mcp__hyzevm__browser_goto", "mcp")], undefined)).toBe("computer");
    expect(activityOf([started("1", "desktop_click", "mcp")], undefined)).toBe("computer");
    expect(activityOf([started("1", "TodoWrite", "other")], undefined)).toBe("planning");
  });

  it("treats a call whose result arrived as done", () => {
    expect(activityOf([started("1", "Bash", "shell")], "waiting", (id) => id === "1")).toBe("thinking");
  });

  it("follows the stream: reasoning thinks, reply text writes", () => {
    expect(activityOf([started("1", "Bash", "shell")], "thinking")).toBe("thinking");
    expect(activityOf([], "writing")).toBe("writing");
  });
});

describe("verbFor", () => {
  it("speaks the reader's language", () => {
    expect(verbFor("reflecting", "Português")).toBe("refletindo");
    expect(verbFor("computer", "Português")).toBe("usando o computador dele");
    expect(verbFor("thinking", "English")).toBe("is thinking");
    expect(verbFor("writing", "Español")).toBe("escribiendo");
    expect(verbFor("working", null)).toBe("is working");
  });
});

describe("team activities", () => {
  it("name the teammate in each language", () => {
    expect(verbFor("waitingFor", "English", "Viktor")).toBe("is waiting for Viktor");
    expect(verbFor("workingFor", "Português", "Atlas")).toBe("trabalhando para Atlas");
    expect(verbFor("waitingFor", "Español", "Atlas")).toBe("esperando a Atlas");
  });
});
