import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { kit } from "@/lib/kit";
import { tracked as slow } from "@/lib/slow";
import type { CliInfo, CliLimits, CliProgress, SpendOverview } from "@/types/events";
import { listen } from "@tauri-apps/api/event";

/// The CLIs in the order the pages list them.
export const CLI_ORDER = ["claude-acp", "codex-acp", "opencode"] as const;

/// The plan windows of every CLI, read from the CLIs themselves (cached five
/// minutes on the Rust side) and re-read on request.
///
/// **One read per CLI, side by side**, so each card fills as its own read lands
/// and a slow CLI costs its own card and nothing else. `reading` is per CLI too:
/// a card with data already on screen shows a small spinner while it is re-read
/// instead of going back to a skeleton.
export function useLimits(workspaceId: string | undefined) {
  const [byCli, setByCli] = useState<Record<string, CliLimits>>({});
  const [reading, setReading] = useState<Record<string, boolean>>({});
  const alive = useRef(true);

  const readOne = useCallback(
    async (harness: string, refresh: boolean) => {
      setReading((r) => ({ ...r, [harness]: true }));
      try {
        const [next] = await slow(
          "Reading plan limits",
          invoke<CliLimits[]>("plan_limits", { workspaceId, refresh, harness }),
        );
        if (alive.current && next) setByCli((m) => ({ ...m, [harness]: next }));
      } catch (e) {
        console.error("[limits]", e);
      } finally {
        if (alive.current) setReading((r) => ({ ...r, [harness]: false }));
      }
    },
    [workspaceId],
  );

  const readAll = useCallback((refresh: boolean) => Promise.all(CLI_ORDER.map((h) => readOne(h, refresh))), [readOne]);

  useEffect(() => {
    alive.current = true;
    void readAll(false);
    return () => {
      alive.current = false;
    };
  }, [readAll]);

  return {
    byCli,
    reading,
    anyReading: Object.values(reading).some(Boolean),
    refresh: () => readAll(true),
  };
}

/// This month's spend per agent.
export function useSpend(workspaceId: string | undefined) {
  const [spend, setSpend] = useState<SpendOverview | null>(null);
  useEffect(() => {
    let live = true;
    void slow("Adding up this month", invoke<SpendOverview>("usage_spend", { workspaceId }))
      .then((s) => live && setSpend(s))
      .catch((e) => console.error("[spend]", e));
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return spend;
}

/// What an action in flight on one CLI has printed so far.
export type CliRun = { step: string; lines: string[]; done: boolean; ok: boolean };

/// The CLIs (version, path, account), their last update check, and the progress
/// of whatever the reader started on each. Read one by one, so a card is drawn
/// the moment its own CLI answers.
export function useClis() {
  const [byCli, setByCli] = useState<Record<string, CliInfo>>({});
  const [reading, setReading] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<Record<string, CliRun>>({});
  const [checking, setChecking] = useState(false);

  const reloadOne = useCallback(async (harness: string) => {
    setReading((r) => ({ ...r, [harness]: true }));
    try {
      const info = await slow("Reading the CLIs", invoke<CliInfo>("cli_info", { harness }));
      setByCli((m) => ({ ...m, [harness]: info }));
    } catch (e) {
      console.error("[clis]", e);
    } finally {
      setReading((r) => ({ ...r, [harness]: false }));
    }
  }, []);

  useEffect(() => {
    for (const h of CLI_ORDER) void reloadOne(h);
    let off: (() => void) | undefined;
    let gone = false;
    void listen<CliProgress>("cli_progress", ({ payload: p }) => {
      setRuns((prev) => {
        const old = prev[p.harness];
        const fresh = !old || old.done || old.step !== p.step;
        const lines = [...(fresh ? [] : old.lines), p.line].slice(-6);
        return { ...prev, [p.harness]: { step: p.step, lines, done: p.done, ok: p.ok } };
      });
      if (p.done) void reloadOne(p.harness);
    }).then((fn) => {
      if (gone) fn();
      else off = fn;
    });
    return () => {
      gone = true;
      off?.();
    };
  }, [reloadOne]);

  const check = async () => {
    setChecking(true);
    try {
      const all = await invoke<CliInfo[]>("cli_check_updates");
      setByCli(Object.fromEntries(all.map((c) => [c.harness, c])));
    } finally {
      setChecking(false);
    }
  };

  // The registry check behind `kit_engine_updates` runs at most every six hours and hands what it
  // finds to the rows, so a newer version shows with its Update button without pressing Check.
  const autoCheck = useCallback(async () => {
    const found = await kit.engineUpdates().catch(() => []);
    if (found.length) for (const h of CLI_ORDER) void reloadOne(h);
  }, [reloadOne]);

  return { byCli, reading, runs, checking, check, autoCheck };
}
