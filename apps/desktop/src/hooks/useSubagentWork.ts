import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";

import type { AgentEvent } from "@/types/events";

/// How often a live child is re-read.
///
/// **A poll, and that is the shape of the thing rather than a shortcut.** A
/// delegated Session is a separate runtime session whose updates never reach this
/// app, so there is nothing to subscribe to; the agent offers a page read, and a
/// reader watching a subagent is watching a read repeat. Fast enough that a child
/// looks like it is working, slow enough that a roster of six is six small reads
/// rather than sixty.
const POLL_MS = 1200;

/// member session id → the child's own session, as this app's events.
///
/// Module-level for the reason every other cache here is: the panel is rebuilt on
/// every session event, and a read that crosses to the agent must not ride a
/// re-render. Keyed by the child's own id, which is what the agent's request takes.
const work = new Map<string, AgentEvent[]>();

/// What a child with nothing read yet answers with.
///
/// One array rather than a fresh `[]` per call: this is handed straight to
/// `buildTranscript`, whose memo is keyed on the array — a new one every render
/// would walk the same (empty) event list on every delta of the parent's turn.
const NO_MESSAGES: AgentEvent[] = [];

const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return version;
}

/// The live work of the delegated children named, read while `live`.
///
/// **One poll for the whole set, not one per row.** Every member is read in the
/// same pass, because they are all reads of the same child agent and a timer per
/// row would be a timer per subagent.
///
/// The caller names one member — the subagent whose conversation the column is
/// showing. The shape is the panel's, since the sidebar's rows can want a page of
/// them at once.
export function useSubagentWork(
  sessionId: string | null,
  memberIds: readonly string[],
  live: boolean,
) {
  // The store lives outside React, so a render has to be told when it moved.
  const revision = useSyncExternalStore(subscribe, snapshot);

  // The ids as one string: an array rebuilt every render would restart the poll on
  // every event, and the caller is rebuilt on every event.
  const key = memberIds.join(",");

  useEffect(() => {
    if (!sessionId || !key) return;
    // Read off the key rather than closing over the array, so this effect never
    // holds a stale list of who is running.
    const ids = key.split(",");
    let cancelled = false;

    const read = async () => {
      for (const memberSessionId of ids) {
        try {
          const messages = await invoke<AgentEvent[]>("session_delegation_messages", {
            sessionId,
            memberSessionId,
            limit: null,
          });
          if (cancelled) return;
          work.set(memberSessionId, messages);
          emit();
        } catch {
          // A child that finished — or a session whose agent has gone — stops
          // answering. The last read stands rather than the row going blank.
        }
      }
    };

    // **Once, always.** A child's *last* read is the one carrying its answer, and
    // it happens exactly when the child stops being active — so a poll that only
    // ran while something was running could stop one read short and leave the
    // view holding a transcript that ends on the tool call. This is that read.
    void read();
    if (!live) return;

    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId, live, key]);

  return {
    revision,
    messagesFor: (memberId: string | null) =>
      memberId ? work.get(memberId) ?? NO_MESSAGES : NO_MESSAGES,
  };
}
