import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import type { HookInfo, Routine, RoutineInput, RoutineList, Running } from "@/types/events";

const NO_HOOK: HookInfo = { port: null, base: "" };

/// The reader's routines and which of them are running, kept current from the
/// backend's `routines_changed` event.
///
/// Every write answers and then the list is read again, rather than patched, so
/// what is on screen is what the file holds: a run that finished while a dialog
/// was open arrives the same way as one the reader just started.
export function useRoutines(active: boolean) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [running, setRunning] = useState<Running[]>([]);
  const [hook, setHook] = useState<HookInfo>(NO_HOOK);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<RoutineList>("routines_list");
      if (!live.current) return;
      setRoutines(list.routines);
      setRunning(list.running);
      setError(null);
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      if (live.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void reload();
    invoke<HookInfo>("routine_hook_info")
      .then((info) => live.current && setHook(info))
      .catch(() => {});
    const off = listen("routines_changed", () => void reload());
    return () => {
      void off.then((f) => f()).catch(() => {});
    };
  }, [active, reload]);

  /// Runs a write, reads the list again, and answers whether it worked.
  const act = useCallback(
    async <T>(command: string, args: Record<string, unknown>): Promise<T | null> => {
      try {
        const out = await invoke<T>(command, args);
        setError(null);
        await reload();
        return out;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [reload],
  );

  return {
    routines,
    running,
    hook,
    error,
    loaded,
    reload,
    save: (input: RoutineInput) => act<Routine>("routine_save", { input }),
    setOn: (id: string, on: boolean) => act<Routine>("routine_set_on", { id, on }),
    remove: (id: string) => act<null>("routine_delete", { id }),
    restore: (id: string) => act<Routine>("routine_restore", { id }),
    duplicate: (id: string) => act<Routine>("routine_duplicate", { id }),
    skip: (id: string, date: string) => act<Routine>("routine_skip", { id, date }),
    runNow: (id: string) => act<null>("routine_run_now", { id }),
  };
}
