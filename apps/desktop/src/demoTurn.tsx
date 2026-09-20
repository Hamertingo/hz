import React from "react";
import ReactDOM from "react-dom/client";

import TurnBlock from "@/components/chat/TurnBlock";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildTranscript } from "@/lib/transcript";
import type { AgentEvent, AgentEventPayload } from "@/types/events";
import "./App.css";

/// One turn, built by the real walk so the rule that keeps the answer out of the
/// work is exercised rather than assumed.
function event(seq: number, payload: AgentEventPayload): AgentEvent {
  return {
    id: `e${seq}`,
    sessionId: "s1",
    harness: "mcode",
    seq,
    ts: new Date(Date.UTC(2026, 8, 20, 12, 0, seq)).toISOString(),
    turnId: "t1",
    subagent: null,
    payload,
    raw: null,
  };
}

const NAMES = ["Bash", "Read", "Edit", "Bash", "Grep"];

function call(seq: number): AgentEvent {
  const name = NAMES[seq % NAMES.length];
  return event(seq, {
    type: "tool_call_started",
    callId: `call-${seq}`,
    name,
    toolType: "other",
    input: { command: `cd /Users/you/code/hz && ${name.toLowerCase()} something` },
    rawInput: null,
    title: `${name} cd /Users/you/code/hz && ${name.toLowerCase()} something`,
  });
}

function thought(seq: number, text: string): AgentEvent {
  return event(seq, { type: "reasoning", block: null, text, encrypted: false });
}

const FINAL = "Done — the three call sites share one helper now, and the suite is green.";

const EVENTS: AgentEvent[] = [
  event(0, {
    type: "user_message",
    text: "Refactor the three duplicated call sites onto one helper.",
    images: [],
    issues: [],
    from: null,
    cwd: "/Users/you/code/hz",
    baseline: null,
    queued: false,
  }),
  call(1),
  thought(2, "The three call sites share a shape; one helper will hold it."),
  call(3),
  call(4),
  thought(5, "Applying it now."),
  call(6),
  call(7),
  event(8, { type: "assistant_text", block: null, text: FINAL }),
  event(9, {
    type: "turn_completed",
    status: "success",
    stopReason: null,
    finalText: FINAL,
    usage: null,
    durationMs: 41_000,
    head: null,
    authFailed: false,
  }),
];

const TURNS = buildTranscript(EVENTS, false).turns;

/// Asks one thing: opened, does the turn's work read as ordinary chat — no rule
/// down its left — while `Thought` keeps its own? Delete the page once answered.
function Demo() {
  React.useEffect(() => {
    if (new URLSearchParams(location.search).get("open") !== "1") return;
    const timer = setTimeout(() => {
      document.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
    }, 250);
    return () => clearTimeout(timer);
  }, []);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <TurnBlock
            turn={TURNS[0]}
            subagentById={new Map()}
            resultByCallId={new Map()}
            onOpenSubagent={() => {}}
            onOpenSession={() => {}}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
