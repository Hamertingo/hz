import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { noteTitle } from "@/lib/palette";
import type { Plugin, PluginSnapshot, Routine, RoutineList } from "@/types/events";

export type NoteRef = { agentId: string; file: string; title: string };

/// `loading` is true from the box opening until all three reads have settled, so
/// the palette can draw skeleton rows for the groups still on their way.
type Sources = { routines: Routine[]; plugins: Plugin[]; notes: NoteRef[]; loading: boolean };
const EMPTY: Sources = { routines: [], plugins: [], notes: [], loading: false };

/// What Jump to lists that no store already holds: routines, connected plugins
/// and every agent's notes. Read when the box opens, in parallel, and each read
/// that fails just leaves its group empty — a palette that waits on three
/// backends to open is slower than the keystroke that called it.
export function usePaletteSources(open: boolean, workspaceId: string | null, agentIds: readonly string[]): Sources {
  const [sources, setSources] = useState<Sources>(EMPTY);
  const key = agentIds.join(",");

  useEffect(() => {
    if (!open) return;
    let live = true;
    const part = (patch: Partial<Sources>) => live && setSources((prev) => ({ ...prev, ...patch }));

    part({ loading: true });
    const reads: Promise<unknown>[] = [];
    reads.push(
      invoke<RoutineList>("routines_list")
        .then((l) => part({ routines: l.routines }))
        .catch(() => {}),
    );
    if (workspaceId) {
      reads.push(
        invoke<PluginSnapshot>("plugins_list", { workspaceId })
          .then((s) => part({ plugins: s.plugins }))
          .catch(() => {}),
      );
    }
    const notes = Promise.all(
      agentIds.map((agentId) =>
        invoke<{ name: string }[]>("agent_memory_list", { agentId })
          .then((files) =>
            files
              .filter((f) => f.name !== "MEMORY.md")
              .map((f) => ({ agentId, file: f.name, title: noteTitle(f.name) })),
          )
          .catch(() => [] as NoteRef[]),
      ),
    ).then((lists) => part({ notes: lists.flat() }));
    reads.push(notes);
    void Promise.all(reads).then(() => part({ loading: false }));

    return () => {
      live = false;
    };
    // `key` stands for the agent list, which is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, key]);

  return sources;
}
