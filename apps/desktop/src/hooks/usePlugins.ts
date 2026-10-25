import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ConnectCreds,
  CustomInput,
  Plugin,
  PluginSnapshot,
  PluginTest,
  Policy,
  SkillInput,
  ToolPolicy,
} from "@/types/events";

const EMPTY: PluginSnapshot = { plugins: [], skills: [], catalog: [], calls: [] };

/// A workspace's plugins, Skills, the catalog and the last two weeks of calls,
/// kept current from the backend's `plugins_changed` event.
///
/// Every write answers with the whole snapshot and that is what is drawn, so the
/// page shows what the files hold: a call an agent made while a sheet was open
/// arrives the same way as a switch the reader just pressed.
export function usePlugins(workspaceId: string | null, active: boolean) {
  const [snap, setSnap] = useState<PluginSnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const live = useRef(true);
  // The workspace a late answer was asked for; one that arrives after a switch is dropped.
  const current = useRef(workspaceId);
  current.current = workspaceId;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const next = await invoke<PluginSnapshot>("plugins_list", { workspaceId });
      if (live.current && current.current === workspaceId) {
        setSnap(next);
        setError(null);
      }
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      if (live.current) setLoaded(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    setSnap(EMPTY);
    setLoaded(false);
  }, [workspaceId]);

  useEffect(() => {
    if (!active || !workspaceId) return;
    void reload();
    // A burst of calls is a burst of events; one read per beat is enough.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = listen("plugins_changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 250);
    });
    return () => {
      clearTimeout(timer);
      void off.then((f) => f()).catch(() => {});
    };
  }, [active, workspaceId, reload]);

  /// Runs a write that answers with the snapshot. Resolves to whether it worked;
  /// the reason is in `error`.
  const act = useCallback(
    async (command: string, args: Record<string, unknown>): Promise<boolean> => {
      if (!workspaceId) return false;
      try {
        const next = await invoke<PluginSnapshot>(command, { workspaceId, ...args });
        if (live.current && current.current === workspaceId) setSnap(next);
        setError(null);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [workspaceId],
  );

  return {
    ...snap,
    error,
    loaded,
    reload,
    setGrant: (id: string, agentId: string, on: boolean) => act("plugin_set_grant", { id, agentId, on }),
    setPolicy: (id: string, tool: string, policy: Policy) => act("plugin_set_policy", { id, tool, policy }),
    configure: (id: string, policies: ToolPolicy[], grants: string[]) =>
      act("plugin_configure", { id, policies, grants }),
    disconnect: (id: string) => act("plugin_disconnect", { id }),
    addCustom: (input: CustomInput) => act("plugin_add_custom", { input }),
    saveSkill: (input: SkillInput) => act("skill_save", { input }),
    deleteSkill: (slug: string) => act("skill_delete", { slug }),
    /// Signs in to a catalog server. Waits for the browser, and rejects with the
    /// reason, so the Connect flow can show it where the button was.
    connect: async (catalogId: string, creds?: ConnectCreds): Promise<Plugin> => {
      const plugin = await invoke<Plugin>("plugin_connect", { workspaceId, catalogId, creds: creds ?? null });
      await reload();
      return plugin;
    },
    cancelConnect: (catalogId: string) => invoke("plugin_connect_cancel", { workspaceId, catalogId }).catch(() => {}),
    reconnect: async (id: string, creds?: ConnectCreds): Promise<Plugin> => {
      const plugin = await invoke<Plugin>("plugin_reconnect", { workspaceId, id, creds: creds ?? null });
      await reload();
      return plugin;
    },
    /// Lists a connected plugin's tools again.
    retest: async (id: string): Promise<PluginTest> => {
      const result = await invoke<PluginTest>("plugin_retest", { workspaceId, id });
      await reload();
      return result;
    },
  };
}

/// Starts a server and lists its tools before anything is saved.
export function testServer(input: CustomInput): Promise<PluginTest> {
  return invoke<PluginTest>("plugin_test", { input });
}
