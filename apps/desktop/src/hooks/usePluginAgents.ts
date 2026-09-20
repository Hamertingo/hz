import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentPick } from "@/lib/agents";

import type { AgentDetail, AgentDraft, PluginAgent } from "@/types/events";

/// How long a roster read is worth keeping between visits — the number
/// [`usePluginSkills`](usePluginSkills.ts) uses, for the same reason: the answer
/// is a fact about the machine, and the read costs the control child's first boot
/// when none is up.
const FRESH_MS = 60_000;

let cached: { agents: PluginAgent[]; at: number } | null = null;

const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

/// Drops the cached roster, so the next pass asks again.
///
/// **Called after a write, and it is what makes a save visible.** The listing and
/// the form are two components, and the form is what knows a write landed — a
/// screen left on the list would otherwise draw the roster as it was before the
/// press.
export function forgetAgents() {
  cached = null;
  announce();
}

/// The Agents this machine holds, built-in roles included.
///
/// **One read for the whole screen.** The three built-in roles and every custom
/// Agent come back together, because the store answers them as one list and a
/// group heading that needed its own round trip would be a heading that arrives
/// late.
export function usePluginAgents(active: boolean) {
  const [agents, setAgents] = useState<PluginAgent[] | null>(() => cached?.agents ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /// Bumped by every read, so one that lands after a newer one is dropped.
  const reads = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && cached && Date.now() - cached.at < FRESH_MS) {
      setAgents(cached.agents);
      return;
    }

    const read = ++reads.current;
    setLoading(true);
    try {
      const answer = await invoke<PluginAgent[]>("list_plugin_agents");
      if (read !== reads.current) return;
      cached = { agents: answer, at: Date.now() };
      setAgents(answer);
      setError(null);
    } catch (cause) {
      if (read !== reads.current) return;
      setError(String(cause));
    } finally {
      if (read === reads.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  // A write anywhere on this screen makes the listing stale, and the form that
  // made it is not above this component — see [`forgetAgents`].
  useEffect(() => {
    const listener = () => void load(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { agents, error, loading, refresh };
}

/// The read behind a form, and the two writes it can make.
///
/// **The draft is the form's and the answer is the agent's.** Nothing is written
/// until Save, and a refusal comes back in the agent's own words — so this holds
/// what the reader was shown, sends what they pressed, and takes what comes back
/// as the truth about what is now stored.
export function useAgentEditor(pick: AgentPick) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /// Bumped by every read, so a detail that lands after a newer pick is dropped.
  const reads = useRef(0);

  const isNew = pick?.mode === "new";
  const name = pick?.mode === "agent" ? pick.name : null;

  useEffect(() => {
    setError(null);

    if (!pick || pick.mode === "new") {
      setDetail(null);
      setLoading(false);
      return;
    }

    const read = ++reads.current;
    setLoading(true);
    void invoke<AgentDetail | null>("get_plugin_agent", { name: pick.name })
      .then((answer) => {
        if (read !== reads.current) return;
        if (!answer) {
          setError("This agent is gone — it was removed since this list was read.");
          return;
        }
        setDetail(answer);
      })
      .catch((cause) => {
        if (read !== reads.current) return;
        setError(String(cause));
      })
      .finally(() => {
        if (read === reads.current) setLoading(false);
      });
  }, [pick]);

  /// Writes the draft down — a creation on a new pick, a rewrite on an old one.
  ///
  /// **The values arrive from the form rather than being read off this hook.**
  /// The form owns what is on screen, and a hook keeping its own copy would be a
  /// second place the same characters live, free to disagree with the box the
  /// reader last typed in.
  const save = useCallback(
    async (draft: AgentDraft, address: string | null): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const answer = await invoke<AgentDetail>(
          address ? "update_plugin_agent" : "create_plugin_agent",
          address ? { name: address, draft } : { draft },
        );
        // What came back is what is stored, which is the agent's word rather than
        // a guess about what it did with a blank field.
        setDetail(answer);
        forgetAgents();
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (!name) return false;
    setSaving(true);
    setError(null);
    try {
      await invoke<boolean>("delete_plugin_agent", { name });
      forgetAgents();
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [name]);

  return { isNew, name, detail, loading, saving, error, save, remove };
}
