import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";

import type { AgentEvent, Glance } from "@/types/events";

/// What the sidebar shows under an agent's name: the last thing it said and
/// when, and — while it works — what it is doing right now.
type Entry = { line: string; atMs: number | null; doing: string | null };

let entries: Record<string, Entry> = {};
const listeners = new Set<() => void>();

function patch(sessionId: string, next: Partial<Entry>) {
  const prev = entries[sessionId] ?? { line: "", atMs: null, doing: null };
  entries = { ...entries, [sessionId]: { ...prev, ...next } };
  for (const l of listeners) l();
}

const firstLine = (text: string) =>
  text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160) ?? "";

/// A tool call's title, or its name, as "what it is doing".
export function doingOf(title: string | null, name: string): string {
  return (title ?? name).trim().slice(0, 120);
}

let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  // Only the events that change a row. Deltas are the bulk of the stream and
  // none of them matters here.
  void listen<AgentEvent>("agent_event", ({ payload: e }) => {
    const p = e.payload;
    if (e.subagent) return;
    if (p.type === "tool_call_started") {
      patch(e.sessionId, { doing: doingOf(p.title, p.name) });
    } else if (p.type === "assistant_text") {
      const line = firstLine(p.text);
      patch(e.sessionId, line ? { line, atMs: Date.now() } : { atMs: Date.now() });
    } else if (p.type === "turn_completed") {
      patch(e.sessionId, { doing: null, atMs: Date.now() });
    }
  }).catch(() => {});
}

function subscribe(l: () => void) {
  listeners.add(l);
  listenOnce();
  return () => listeners.delete(l);
}

/// The glance of each given session, read from the log's end once per session
/// and kept live from the event stream after.
export function useAgentGlances(sessionIds: string[]): Record<string, Entry> {
  const key = sessionIds.join(",");
  useEffect(() => {
    const need = sessionIds.filter((id) => !entries[id]);
    if (need.length === 0) return;
    void invoke<Glance[]>("agent_glances", { sessionIds: need })
      .then((glances) => {
        for (const g of glances) {
          if (!entries[g.sessionId]) patch(g.sessionId, { line: g.line, atMs: g.atMs });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useSyncExternalStore(subscribe, () => entries);
}
