import { useCallback, useEffect, useMemo, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { asUnavailable, describe } from "@/hooks/usePrList";
import type { RunRow } from "@/hooks/useWorkflowRuns";
import { isLive } from "@/lib/runs";
import { tracked } from "@/lib/slow";
import type { PrUnavailable, WorkflowRunDetail } from "@/types/events";

/// How long a read is trusted. The list's own window, and shorter than the pull
/// request page's for its reason: a run in flight changes under the reader.
const FRESH_MS = 60_000;

/// How often a run that is still moving is re-read — the run's own status, or
/// any job's. A workflow can be `completed` with a re-run still queued behind it,
/// so "the run is done" is not the same question as "nothing here will change".
const POLL_MS = 15_000;

/// Module-level, so opening a run the reader was just looking at is free.
const cache = new Map<string, { detail: WorkflowRunDetail; at: number }>();

/// One run, opened: its jobs, their steps, and nothing else.
///
/// **Read only while the pane is showing it**, and re-read only while something
/// about it is still going. A finished run is read once and left alone — nothing
/// about it changes but a re-run, and a re-run is a press that throws this away.
export function useWorkflowRun(run: RunRow, active: boolean) {
  const key = `${run.cwd}\0${run.id}`;

  const [detail, setDetail] = useState<WorkflowRunDetail | null>(
    () => cache.get(key)?.detail ?? null,
  );
  const [error, setError] = useState<PrUnavailable | null>(null);
  const [loading, setLoading] = useState(false);

  const read = useCallback(
    async (force: boolean) => {
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < FRESH_MS) return;

      setLoading(true);
      try {
        const answer = await tracked(
          "Reading this run",
          invoke<WorkflowRunDetail>("get_workflow_run", { cwd: run.cwd, id: run.id }),
        );
        cache.set(key, { detail: answer, at: Date.now() });
        setDetail(answer);
        setError(null);
      } catch (e) {
        // The pane keeps whatever it was showing: a failed refresh is a stale
        // answer with a reason, not an empty pane.
        setError(asUnavailable(e));
      } finally {
        setLoading(false);
      }
    },
    [key, run.cwd, run.id],
  );

  useEffect(() => {
    if (!active) return;
    void read(false);
  }, [active, read]);

  const live = useMemo(() => {
    if (!detail) return isLive(run);
    return isLive(detail.run) || detail.jobs.some((job) => isLive(job));
  }, [detail, run]);

  useEffect(() => {
    if (!active || !live) return;
    const timer = setInterval(() => void read(true), POLL_MS);
    return () => clearInterval(timer);
  }, [active, live, read]);

  return {
    detail,
    loading,
    /// `describe`'d, not `String`'d — a refusal is a tagged object and `String`
    /// on one is `[object Object]`.
    error: error ? describe(error) : null,
    live,
    refresh: useCallback(() => void read(true), [read]),
    /// What a write calls: the cached copy is gone *and* re-read, or the pane
    /// would paint the state the reader just left.
    invalidate: useCallback(() => {
      cache.delete(key);
      void read(true);
    }, [key, read]),
  };
}
