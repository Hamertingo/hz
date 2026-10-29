import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { toNote, type Note } from "@/lib/memoryNotes";
import type { ActivityScan, InstrMeta, NoteUsage, SpendView } from "@/types/events";

type MemoryFile = { name: string; size: number; modifiedMs: number };

const EMPTY: ActivityScan = { messages: [], tasks: [], feed: [], spend: [], calls: [], lastTotal: 0, open: null };

/// What the log says an agent has done. Read again when `tick` changes (a turn
/// finished) and on a slow timer while the page is open, since the log grows
/// from another room.
export function useActivity(agentId: string, tick: unknown) {
  const [scan, setScan] = useState<ActivityScan | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      invoke<ActivityScan>("agent_activity", { agentId })
        .then((s) => live && setScan(s))
        .catch(() => live && setScan((prev) => prev ?? EMPTY));
    setScan(null);
    void read();
    const timer = setInterval(read, 20_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [agentId]);

  useEffect(() => {
    invoke<ActivityScan>("agent_activity", { agentId })
      .then(setScan)
      .catch(() => {});
  }, [agentId, tick]);

  return scan;
}

/// The agent's notes, parsed, with how often each was read. The list is polled
/// because the agent writes to the same folder while the page is open; only
/// files whose modification time moved are read again.
export function useNotes(agentId: string, active: boolean) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [usage, setUsage] = useState<Record<string, NoteUsage>>({});
  const cache = useRef(new Map<string, Note>());
  // A note being typed in is not replaced under the reader's hands.
  const paused = useRef(false);

  const reload = useCallback(async () => {
    if (paused.current) return;
    try {
      const files = await invoke<MemoryFile[]>("agent_memory_list", { agentId });
      const next: Note[] = [];
      for (const f of files) {
        if (f.name === "MEMORY.md") continue;
        const hit = cache.current.get(f.name);
        if (hit && hit.modifiedMs === f.modifiedMs) {
          next.push(hit);
          continue;
        }
        const raw = await invoke<string>("agent_memory_read", { agentId, name: f.name });
        const note = toNote(f.name, raw, f.modifiedMs);
        cache.current.set(f.name, note);
        next.push(note);
      }
      const names = new Set(next.map((n) => n.name));
      for (const k of cache.current.keys()) if (!names.has(k)) cache.current.delete(k);
      setNotes(next);
      setUsage(await invoke<Record<string, NoteUsage>>("agent_memory_usage", { agentId }));
    } catch {
      setNotes((prev) => prev ?? []);
    }
  }, [agentId]);

  useEffect(() => {
    cache.current.clear();
    setNotes(null);
    void reload();
  }, [agentId, reload]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [active, reload]);

  const hold = useCallback((on: boolean) => {
    paused.current = on;
  }, []);

  return { notes, usage, reload, hold };
}

/// Instruction versions and the layers of the briefing.
export function useVersions(agentId: string) {
  const [versions, setVersions] = useState<InstrMeta[] | null>(null);
  const reload = useCallback(
    () =>
      invoke<InstrMeta[]>("agent_instr_list", { agentId })
        .then(setVersions)
        .catch(() => setVersions((v) => v ?? [])),
    [agentId],
  );
  useEffect(() => {
    setVersions(null);
    void reload();
  }, [reload]);
  return { versions, reload };
}

export function useSpend(agentId: string, dep: unknown) {
  const [spend, setSpend] = useState<SpendView | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        invoke<SpendView>("agent_spend", { agentId })
          .then((s) => live && setSpend(s))
          .catch(() => {}),
      300,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [agentId, dep]);
  return spend;
}
