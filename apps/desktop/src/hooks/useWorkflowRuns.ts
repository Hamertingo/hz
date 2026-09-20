import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { tracked } from "@/lib/slow";
import { isLive } from "@/lib/runs";
import { asUnavailable, describe } from "@/hooks/usePrList";
import type { PrUnavailable, WorkflowRun } from "@/types/events";

/// A run, and which repository it came from.
///
/// The page spans repositories, so a row has to say which one it is in: two
/// checkouts each run their own `CI`, and a title alone cannot tell them apart.
export type RunRow = WorkflowRun & { cwd: string; repo: string };

/// How a row is identified across the page: the checkout and the run's own id,
/// which together are unique. Not the number, which is unique only within its
/// workflow.
export const runKey = (run: Pick<RunRow, "cwd" | "id">) => `${run.cwd}#${run.id}`;

/// How long a listing is trusted before the page asks again.
///
/// **A minute, not the hour the pull request list keeps.** CI moves on its own
/// schedule and the reader is often watching it move: a push starts a run within
/// seconds, and a list that believed itself for an hour would answer "nothing
/// here" about a build that started a moment ago. The polling below is what
/// covers the case this window cannot — a run already on screen, still going.
const FRESH_MS = 60_000;

/// How often a list holding something in flight is re-read.
///
/// The pull request panel's own interval, for its own reason: only while
/// something is *moving*, and only while the surface is on screen. A page of
/// finished runs costs nothing at all.
const POLL_MS = 15_000;

type Page = { runs: WorkflowRun[]; at: number };

/// Module-level, so the sub-tab is free to flip between twice — the bargain
/// every other list in this app makes. **Per repository**, so adding one costs
/// one call and the others stay cached.
const cache = new Map<string, Page>();
/// Which read is the newest for a key, so an answer from an older one cannot
/// land on top of a newer one.
const latest = new Map<string, number>();
/// The failure of a repository, by the key it was read under. Equivalent to
/// caching an empty answer, and cleared with the cache: a stale failure is as
/// wrong as a stale listing.
const failed = new Map<string, unknown>();

const pageKey = (cwd: string, branch: string | null) => `${cwd}\0${branch ?? ""}`;

type State = {
  runs: RunRow[];
  /// Repositories that could not be read, and the first thing one of them said.
  failed: { count: number; detail: string } | null;
  /// Nothing at all could be read, and this is why.
  error: PrUnavailable | null;
  loading: boolean;
};

function merged(cwds: string[], branch: string | null): State {
  const runs: RunRow[] = [];
  let answers = 0;
  let misses = 0;

  for (const cwd of cwds) {
    const key = pageKey(cwd, branch);

    // A failure is checked before the cache, for the `usePrList` reason: a read
    // that threw also caches an empty answer, so the other order counts the
    // repository as one that answered.
    if (failed.has(key)) {
      misses += 1;
      continue;
    }

    const hit = cache.get(key);
    if (!hit) continue;

    answers += 1;
    const repo = cwd.split("/").filter(Boolean).at(-1) ?? cwd;
    for (const run of hit.runs) runs.push({ ...run, cwd, repo });
  }

  // Newest first across repositories, which is the order `gh` already gives
  // within one — comparing the stamps is what makes one list out of several.
  runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (!answers && misses) {
    const first = cwds.map((cwd) => failed.get(pageKey(cwd, branch))).find(Boolean);
    return { runs: [], failed: null, error: asUnavailable(first), loading: false };
  }

  return {
    runs,
    failed: misses
      ? {
          count: misses,
          // `describe`'d, not `String`'d: a refusal crosses the bridge as a
          // tagged object and `String` on one is `[object Object]`.
          detail: describe(cwds.map((cwd) => failed.get(pageKey(cwd, branch))).find(Boolean) ?? ""),
        }
      : null,
    error: null,
    loading: false,
  };
}

/// The workflow runs of every repository the page is pointed at.
///
/// `branch` is the one narrowing that goes to the host: `gh run list --branch`
/// is server-side, and "did what I just pushed pass" is the question a reader
/// actually arrives with. Everything else the page offers is a filter over rows
/// already in hand.
export function useWorkflowRuns(cwds: string[], active: boolean, branch: string | null) {
  const key = `${cwds.join("\n")}\0${branch ?? ""}`;
  const [page, setPage] = useState<State>(() => merged(cwds, branch));

  const keyRef = useRef(key);
  keyRef.current = key;

  const commit = useCallback((k: string, update: (prev: State) => State) => {
    if (keyRef.current === k) setPage(update);
  }, []);

  const read = useCallback(
    async (force: boolean, k: string = key, list: string[] = cwds, on: string | null = branch) => {
      if (!list.length) {
        setPage({ runs: [], failed: null, error: null, loading: false });
        return;
      }

      const now = Date.now();
      const stale = list.filter((cwd) => {
        const hit = cache.get(pageKey(cwd, on));
        return force || !hit || now - hit.at >= FRESH_MS;
      });

      if (stale.length) commit(k, (prev) => ({ ...prev, loading: true }));

      await Promise.all(
        stale.map(async (cwd) => {
          const page = pageKey(cwd, on);
          const seq = (latest.get(page) ?? 0) + 1;
          latest.set(page, seq);

          try {
            const answer = await tracked(
              "Reading this repository's workflow runs",
              invoke<WorkflowRun[]>("list_workflow_runs", { cwd, branch: on }),
            );
            // A newer read for this repository has already answered, so this one
            // is stale by construction.
            if (latest.get(page) !== seq) return;
            cache.set(page, { runs: answer, at: Date.now() });
            failed.delete(page);
          } catch (e) {
            if (latest.get(page) !== seq) return;
            // Kept as a failure per repository rather than thrown: one repo this
            // `gh` cannot answer for must not take the others off the screen —
            // and, for `usePrList`'s reason, nothing is cached beside it: an
            // empty answer written here would be trusted for the whole window.
            failed.set(page, e);
          }
        }),
      );

      commit(k, () => merged(list, on));
    },
    [cwds, key, branch, commit],
  );

  // Read on arrival and whenever the question changes, but not while the page is
  // hidden: a listing nobody is looking at is a spawn per interval elsewhere.
  useEffect(() => {
    if (!active) return;
    void read(false);
  }, [active, read]);

  /// **While something is in flight the page watches it**, and stops the moment
  /// nothing is: a build is the one thing here that changes on its own, and a
  /// reader who pushed is waiting for exactly this number. Everything else about
  /// this list is read once and left alone.
  const watching = useMemo(() => page.runs.some(isLive), [page.runs]);
  useEffect(() => {
    if (!active || !watching) return;
    const timer = setInterval(() => void read(true), POLL_MS);
    return () => clearInterval(timer);
  }, [active, watching, read]);

  return {
    ...page,
    /// Forces a read past the cache — the Refresh button, and a re-run or a
    /// dispatch made anywhere.
    refresh: useCallback(() => void read(true), [read]),
    /// Drops every cached listing. Called after a write, because a re-run
    /// changes what this page should say about a repository it is not looking at.
    invalidate: useCallback(() => {
      cache.clear();
      failed.clear();
      void read(true);
    }, [read]),
  };
}
