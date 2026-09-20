import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { tracked } from "@/lib/slow";
import type { PrListItem, PrListState, PrUnavailable } from "@/types/events";

/// How long a listing is trusted. The same window the panel's own read uses, and
/// for the same reason: `gh` costs the better part of a second, and a reader
/// stepping between the page and a session should not pay for it twice.
const FRESH_MS = 30_000;

type Page = { items: PrListItem[]; viewer: string | null };
type Cached = Page & { at: number };

/// A row, and which repository it came from.
///
/// **The page spans repositories, so a row has to say which one it is in.** Two
/// checkout of the same project each have their own `feature` branch, and a title
/// alone cannot tell them apart — nor can a click, which has to open the right
/// one's pull request.
export type PrRow = PrListItem & { cwd: string; repo: string };

/// How a row is identified across the page: the checkout it came from and its
/// number, which together are unique. **The basename is not enough** — two
/// checkouts of one project each have their own `#12` — so this is the `cwd`.
export const prKey = (pr: Pick<PrRow, "cwd" | "number">) => `${pr.cwd}#${pr.number}`;

/// Module-level so a trip into a session and back is free — the panel's own
/// caches make the same bargain, and this page is left and re-entered far more
/// often than it is refreshed. **Per repository**, so adding one to the page
/// costs one call and the others stay cached.
const cache = new Map<string, Cached>();
/// Which read is the newest for a key, so an answer from an older one — a
/// different search, a different state — cannot land on top of a newer one.
const latest = new Map<string, number>();
/// The failure of a repository, by the key it was read under. Equivalent to
/// caching an empty answer, and cleared with the cache: a stale failure is as
/// wrong as a stale listing, and more confusing.
const failed = new Map<string, unknown>();

const pageKey = (cwd: string, state: PrListState, query: string) =>
  `${cwd}\0${state}\0${query.trim()}`;

type State = {
  items: PrRow[];
  viewer: string | null;
  /// Repositories that could not be read, and the first thing one of them said.
  /// Only ever shown where rows are: a listing that failed for one repository of
  /// six is a sentence under the five, not a page with nothing on it.
  failed: { count: number; detail: string } | null;
  /// The page has nothing at all to show and this is why.
  error: PrUnavailable | null;
  loading: boolean;
};

/// The pull requests of every repository this page is pointed at.
export function usePrList(
  cwds: string[],
  active: boolean,
  state: PrListState,
  query: string,
) {
  const key = cwds.join("\n");
  const [page, setPage] = useState<State>(() => merged(cwds, state, query));

  const keyRef = useRef(key);
  keyRef.current = key;

  /// Guards a landing answer the way the panel's own hook does: the reader can be
  /// on another project by the time this returns, and a stale `setState` would put
  /// one repository's rows under another's header.
  const commit = useCallback((k: string, update: (prev: State) => State) => {
    if (keyRef.current === k) setPage(update);
  }, []);

  const read = useCallback(
    async (force: boolean, k: string = key, list: string[] = cwds) => {
      if (!list.length) {
        setPage({ items: [], viewer: null, failed: null, error: null, loading: false });
        return;
      }

      const now = Date.now();
      const stale = list.filter((cwd) => {
        const hit = cache.get(pageKey(cwd, state, query));
        return force || !hit || now - hit.at >= FRESH_MS;
      });

      if (stale.length) commit(k, (prev) => ({ ...prev, loading: true }));

      // **In parallel, and that is the difference from a session.** Each is one
      // short-lived `gh`, not a 400MB agent child, so six repositories cost the
      // slowest of the six rather than the sum.
      await Promise.all(
        stale.map(async (cwd) => {
          const page = pageKey(cwd, state, query);
          const seq = (latest.get(page) ?? 0) + 1;
          latest.set(page, seq);

          try {
            const answer = await tracked(
              "Reading this repository's pull requests",
              invoke<Page>("list_pull_requests", { cwd, state, search: query.trim() || null }),
            );
            // A newer read for this repository has already answered, so this one
            // is stale by construction — the search box types faster than `gh`.
            if (latest.get(page) !== seq) return;
            cache.set(page, { ...answer, at: Date.now() });
          } catch (e) {
            if (latest.get(page) !== seq) return;
            // Kept as a failure per repository rather than thrown: one repo this
            // `gh` cannot answer for must not take the others off the screen.
            cache.set(page, { items: [], viewer: null, at: Date.now() });
            failed.set(page, e);
          }
        }),
      );

      commit(k, () => merged(list, state, query));
    },
    [cwds, key, state, query, commit],
  );

  // Read on arrival and whenever the question changes, but not while the page is
  // hidden: a listing nobody is looking at is a spawn per keystroke elsewhere.
  useEffect(() => {
    if (!active) return;
    void read(false);
  }, [active, read]);

  return {
    ...page,
    refresh: useCallback(() => void read(true), [read]),
    /// Drops every cached listing — called after a write, because a merge changes
    /// what this page should say about a repository it is not looking at.
    invalidate: useCallback(() => {
      cache.clear();
      failed.clear();
      void read(true);
    }, [read]),
  };
}

/// The rows from every repository's cached answer, already merged and ordered.
///
/// A repository with no answer contributes nothing rather than an error: the page
/// is a merged list, and the question of whether *some* of it could be read is a
/// sentence (`failed`), while whether *none* of it could is the page's own error.
function merged(cwds: string[], state: PrListState, query: string): State {
  const items: PrRow[] = [];
  let viewer: string | null = null;
  let answers = 0;
  let misses = 0;
  // Counted apart from `misses`, because it is not a failure: see below.
  let barren = 0;

  for (const cwd of cwds) {
    const key = pageKey(cwd, state, query);

    // **A failure is checked before the cache, and that ordering is the whole
    // of it.** A read that threw also caches an empty answer — that is what
    // stops it spawning `gh` again on every render — so looking the cache up
    // first counted the repository as one that had answered, `misses` stayed at
    // zero, and the sentence below the rows could not draw at all.
    if (failed.has(key)) {
      // **A directory that is not a GitHub repository is not a failed read.**
      // A project is a directory, and one of them being a scratch folder — or a
      // workspace holding several repositories rather than being one — is
      // ordinary. Counting it as a miss drew "1 of 2 repositories could not be
      // read — no remote" under a perfectly good listing: the page complaining
      // that a project is not a thing it never claimed to be. It contributes no
      // rows, which is what having no GitHub remote means.
      if (asUnavailable(failed.get(key)).kind === "no_remote") barren += 1;
      else misses += 1;
      continue;
    }

    const hit = cache.get(key);
    if (!hit) continue;

    answers += 1;
    viewer ??= hit.viewer;
    const repo = basename(cwd);
    for (const item of hit.items) items.push({ ...item, cwd, repo });
  }

  if (!answers && misses) {
    const first = cwds.map((cwd) => failed.get(pageKey(cwd, state, query))).find(Boolean);
    return {
      items: [],
      viewer: null,
      failed: null,
      error: asUnavailable(first),
      loading: false,
    };
  }

  // Nothing to read anywhere, and the reason is that none of it is a GitHub
  // repository — which the page says as a state rather than as a red line.
  if (!answers && !misses && barren) {
    return { items: [], viewer: null, failed: null, error: { kind: "no_remote" }, loading: false };
  }

  return {
    items,
    viewer,
    failed: misses
      ? {
          count: misses,
          detail: describe(
            cwds.map((cwd) => failed.get(pageKey(cwd, state, query))).find(Boolean) ?? "",
          ),
        }
      : null,
    error: null,
    loading: false,
  };
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/// Why one repository could not be read, as a line rather than as a tag.
///
/// A refusal that crossed the bridge is a tagged object, and `String` on one is
/// `[object Object]` — the trap `asUnavailable` was written for, one expression
/// over, and this is the sentence under the rows that a reader actually reads.
/// The kind is spelled out for the same reason: `no_cli` is a slug and "no cli"
/// is a phrase.
function describe(e: unknown): string {
  const refusal = asUnavailable(e);
  return refusal.kind === "other" ? refusal.detail : refusal.kind.replace(/_/g, " ");
}

/// The same shape the panel's reads produce, so both surfaces explain a missing
/// `gh` in the same words.
///
/// **A rejected read is usually already this shape.** The two commands answer
/// `Result<_, PrUnavailable>`, so a refusal arrives as the tagged object rather
/// than as a string — and `String(it)` is `[object Object]`, which is exactly
/// what the page printed until this checked. The string path is for a rejection
/// this app threw itself: a missing `cwd`, an unparsable answer.
export function asUnavailable(e: unknown): PrUnavailable {
  if (e && typeof e === "object" && "kind" in e) return e as PrUnavailable;

  const message = String(e);
  if (message.includes("not found")) return { kind: "no_cli" };
  if (message.includes("gh auth login") || message.includes("authentication token")) {
    return { kind: "not_authenticated" };
  }
  return { kind: "other", detail: message };
}
