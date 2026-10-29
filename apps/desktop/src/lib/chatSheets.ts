import { useSyncExternalStore } from "react";

import type { PendingAsk } from "@/lib/transcript";

/// The one panel a chat has open beside it: a document, a pull request, the two
/// messages of an old exchange between agents, the thread two agents keep
/// (`a` is the chat's own agent), the details of a request, or a shell.
export type ChatSheet =
  | { kind: "file"; path: string; agentId: string }
  | { kind: "pr"; number: number; repo: string; url: string; agentId: string }
  | {
      kind: "exchange";
      from: string;
      to: string;
      ask: string;
      answer: string | null;
      ts: string;
    }
  | { kind: "thread"; a: string; b: string }
  | { kind: "approval"; ask: PendingAsk & { type: "permission_requested" } }
  | { kind: "terminal"; agentId: string; cwd: string };

let current: ChatSheet | null = null;
const listeners = new Set<() => void>();

function set(next: ChatSheet | null) {
  current = next;
  for (const l of listeners) l();
}

export function openSheet(sheet: ChatSheet) {
  set(sheet);
}

export function closeSheet() {
  set(null);
}

export function useChatSheet(): ChatSheet | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
