import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { afterPost } from "@/lib/channelWorking";
import type {
  Channel,
  ChannelDetail,
  ChannelMessage,
  ChannelPatch,
  NewChannel,
    Working,
} from "@/types/events";

/// Every channel the backend keeps, for the sidebar, Jump to and the routine
/// editor. One store, refreshed when any channel changes, so the unread dot and
/// the page beside it cannot disagree.
let list: Channel[] = [];
/// Whether the first read has answered, so a list can tell "no channels" from
/// "not read yet".
let ready = false;
let started = false;
let loadedOnce = false;
let pending = 0;
const listeners = new Set<() => void>();

function publish(next: Channel[]) {
  list = next;
  ready = true;
  for (const l of listeners) l();
}

async function refresh() {
  try {
    const next = await invoke<Channel[]>("channels_list", { workspaceId: null });
    loadedOnce = true;
    publish(next);
  } catch (e) {
    console.error("[channels]", e);
    // A failed first read still ends the wait, or the app would never land.
    if (!loadedOnce) {
      loadedOnce = true;
      publish(list);
    }
  }
}

/// A burst of events (an answer, a task, an unread mark) is one read.
function refreshSoon() {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => void refresh(), 40);
}

function start() {
  if (started) return;
  started = true;
  // Read after the listeners attach, or an event between the two is lost.
  void Promise.all([listen("channel_changed", refreshSoon), listen("channel_message", refreshSoon)]).then(
    () => void refresh(),
    () => void refresh(),
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

/// Whether the channel list has been read at least once.
export function useChannelsReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready);
}

const NONE: Channel[] = [];

/// Whether the first read has landed, so "no channels" can be told from "not read yet".
export function useChannelsLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loadedOnce);
}

/// The channels of one workspace, archived ones included. The caller filters.
export function useChannels(workspaceId: string | null): Channel[] {
  const all = useSyncExternalStore(subscribe, () => list);
  return useMemo(
    () => (workspaceId === null ? NONE : all.filter((c) => c.workspaceId === workspaceId)),
    [all, workspaceId],
  );
}

export async function createChannel(input: NewChannel): Promise<Channel> {
  const out = await invoke<Channel>("channel_create", { new: input });
  await refresh();
  return out;
}

export async function updateChannel(id: string, patch: ChannelPatch): Promise<Channel> {
  const out = await invoke<Channel>("channel_update", { id, patch });
  await refresh();
  return out;
}

export async function archiveChannel(id: string, archived: boolean): Promise<Channel> {
  const out = await invoke<Channel>("channel_archive", { id, archived });
  await refresh();
  return out;
}

export async function setChannelMember(id: string, agentId: string, member: boolean): Promise<Channel> {
  const out = await invoke<Channel>("channel_member", { id, agentId, member });
  await refresh();
  return out;
}

export function markChannelRead(id: string) {
  return invoke("channel_read", { id }).catch(() => {});
}

export function retryChannel(id: string) {
  return invoke("channel_retry", { id });
}

export function stopChannel(id: string) {
  return invoke("channel_stop", { id });
}

export function exportChannel(id: string): Promise<string> {
  return invoke<string>("channel_export", { id });
}

const NO_WORK: Working = { agents: [], round: 0 };

/// One channel open on screen: the record, the transcript, the tasks, the threads
/// and who is answering now. Read once, then kept current from the events: a new
/// message is appended as it arrives and everything else is read again.
export function useChannel(id: string | null) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<Working>(NO_WORK);
  const live = useRef(true);
  const current = useRef(id);
  current.current = id;

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const next = await invoke<ChannelDetail>("channel_get", { id });
      if (!live.current || current.current !== id) return;
      setDetail(next);
      setWorking(next.working);
      setError(null);
    } catch (e) {
      if (live.current && current.current === id) setError(String(e));
    }
  }, [id]);

  useEffect(() => {
    live.current = true;
    setDetail(null);
    setWorking(NO_WORK);
    setError(null);
    if (!id) return;

    const offs = [
      listen<{ channelId: string; message: ChannelMessage }>("channel_message", (e) => {
        if (e.payload.channelId !== id) return;
        const m = e.payload.message;
        // The answer landing ends the wait for that agent, without relying on
        // the engine's own clearing event arriving after it.
        if (m.kind === "message") setWorking((w) => afterPost(w, m.from));
        setDetail((d) => {
          if (!d || d.messages.some((x) => x.seq === m.seq)) return d;
          // The record rides along with the transcript: the page marks the room
          // read by comparing these counters, and a stale copy never saw the
          // newest message, so it never marked it and the sidebar kept its dot.
          const c = d.channel;
          const channel = {
            ...c,
            lastSeq: Math.max(c.lastSeq, m.seq),
            lastTs: m.ts,
            lastAgentSeq: m.from !== "me" && m.kind === "message" ? Math.max(c.lastAgentSeq, m.seq) : c.lastAgentSeq,
          };
          return { ...d, channel, messages: [...d.messages, m].sort((x, y) => x.seq - y.seq) };
        });
      }),
      listen<{ channelId: string }>("channel_changed", (e) => {
        if (e.payload.channelId === id) void reload();
      }),
      listen<{ channelId: string; agents: string[]; round: number }>("channel_working", (e) => {
        if (e.payload.channelId === id) setWorking({ agents: e.payload.agents, round: e.payload.round });
      }),
    ];
    // Read only once the listeners are attached: `listen` resolves
    // asynchronously, and a message landing between the read and the attach was
    // in neither, so it showed up only after a reload.
    void Promise.all(offs).then(() => {
      if (live.current && current.current === id) void reload();
    });
    return () => {
      live.current = false;
      for (const off of offs) void off.then((f) => f()).catch(() => {});
    };
  }, [id, reload]);

  return { detail, working, error, reload };
}

/// Posts the reader's message. Rejects with the backend's sentence.
export function postToChannel(id: string, text: string, replyTo: number | null, attachments: string[] = []) {
  return invoke<ChannelMessage>("channel_post", { id, text, replyTo, attachments });
}

export function reactInChannel(id: string, seq: number, emoji: string) {
  return invoke("channel_react", { id, seq, emoji });
}

