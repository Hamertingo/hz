import { useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { asUnavailable, describe } from "@/hooks/usePrList";
import type { RunRow } from "@/hooks/useWorkflowRuns";
import { readLog, type LogLine } from "@/lib/logs";
import { tracked } from "@/lib/slow";

/// Module-level, so closing and reopening a step costs nothing twice.
const cache = new Map<string, LogLine[]>();

/// A run's log, read when somebody opens a step and never before.
///
/// **`enabled` is what keeps this honest.** The whole log of a failed release is
/// ~190KB and several thousand lines, and a pane that fetched it to draw a row
/// would be paying that on every run the reader clicked past. The reader opens a
/// step, the step asks for the run's log once, and every step after that reads
/// the copy.
export function useRunLog(run: RunRow, enabled: boolean) {
  const key = `${run.cwd}\0${run.id}`;
  const [lines, setLines] = useState<LogLine[] | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Whether a read is out. A ref, so raising it cannot re-run the effect that
  /// raised it — see below.
  const reading = useRef(false);

  useEffect(() => {
    // **`loading` is a ref here and must never be a dependency.** As state it
    // made this effect re-run the moment it set itself, the cleanup invalidated
    // the answer already on its way, and the new run returned early on the flag
    // the old one had raised — which is a step that reads "Reading…" for good.
    if (!enabled || lines || reading.current) return;

    let live = true;
    reading.current = true;
    setLoading(true);

    tracked(
      "Reading this run's log",
      invoke<string>("get_run_log", { cwd: run.cwd, id: run.id }),
    )
      .then((text) => {
        const parsed = readLog(text);
        cache.set(key, parsed);
        if (live) setLines(parsed);
      })
      .catch((e) => {
        if (live) setError(describe(asUnavailable(e)));
      })
      .finally(() => {
        reading.current = false;
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [enabled, lines, key, run.cwd, run.id]);

  return { lines, loading, error };
}
