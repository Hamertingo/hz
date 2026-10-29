import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ChannelDetail, ChannelMessage, PairThread, TeamStatus } from "@/types/events";

/// Who waits for and works for whom (`talk.rs`), kept live from `team_status`.
let status: TeamStatus[] = [];
/// Each agent's pair threads, by agent id, read once and kept live from
/// `channel_message`.
let pairs: Record<string, PairThread[]> = {};
const listeners = new Set<() => void>();
let started = false;
let refetch = 0;

function emit() {
  for (const l of listeners) l();
}

async function loadPairs(agentId: string) {
  try {
    pairs = { ...pairs, [agentId]: await invoke<PairThread[]>("team_pairs", { agentId }) };
    emit();
  } catch {
    // No backend (a plain browser without a mock) reads as no threads.
  }
}

function start() {
  if (started) return;
  started = true;
  void listen<TeamStatus[]>("team_status", (e) => {
    status = e.payload;
    emit();
  }).catch(() => {});
  void listen<{ channelId: string; message: ChannelMessage }>("channel_message", ({ payload }) => {
    let known = false;
    const next: Record<string, PairThread[]> = {};
    for (const [agent, list] of Object.entries(pairs)) {
      next[agent] = list.map((p) => {
        if (p.channelId !== payload.channelId) return p;
        known = true;
        return p.messages.some((m) => m.seq === payload.message.seq) ? p : { ...p, messages: [...p.messages, payload.message] };
      });
    }
    if (known) {
      pairs = next;
      emit();
      return;
    }
    // A thread nobody has read yet may be a new one: read the open agents again, once a burst settles.
    window.clearTimeout(refetch);
    refetch = window.setTimeout(() => {
      for (const agent of Object.keys(pairs)) void loadPairs(agent);
    }, 120);
  }).catch(() => {});
  void invoke<TeamStatus[]>("team_status")
    .then((s) => {
      status = s;
      emit();
    })
    .catch(() => {});
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
}

export function useTeamStatus(): TeamStatus[] {
  return useSyncExternalStore(subscribe, () => status);
}

const NONE: PairThread[] = [];

/// The pair threads `agentId` is in, for its chat's "N messages with X" lines.
export function usePairThreads(agentId: string | null): PairThread[] {
  useEffect(() => {
    if (agentId && !pairs[agentId]) void loadPairs(agentId);
  }, [agentId]);
  return useSyncExternalStore(subscribe, () => (agentId ? (pairs[agentId] ?? NONE) : NONE));
}

/// The thread between two agents, for the read-only sheet, kept live. `null`
/// while reading, `false` when they have not written to each other yet.
export function usePairDetail(a: string, b: string): ChannelDetail | null | false {
  const [detail, setDetail] = useState<ChannelDetail | null | false>(null);
  useEffect(() => {
    let live = true;
    let channelId: string | null = null;
    setDetail(null);
    const read = () =>
      invoke<ChannelDetail | null>("team_pair_between", { a, b })
        .then((d) => {
          if (!live) return;
          channelId = d?.channel.id ?? null;
          setDetail(d ?? false);
        })
        .catch(() => live && setDetail(false));
    void read();
    const off = listen<{ channelId: string; message: ChannelMessage }>("channel_message", ({ payload }) => {
      // The first message of a thread opened before it existed.
      if (channelId === null) return void read();
      if (payload.channelId !== channelId) return;
      setDetail((d) =>
        d && !d.messages.some((m) => m.seq === payload.message.seq) ? { ...d, messages: [...d.messages, payload.message] } : d,
      );
    });
    return () => {
      live = false;
      void off.then((f) => f()).catch(() => {});
    };
  }, [a, b]);
  return detail;
}
