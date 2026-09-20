import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { emptyConfig, type McpPick } from "@/lib/mcp";

import type { McpConfig, McpServerDetail, McpTestResult, PluginMcpServer } from "@/types/events";

/// How long a listing is worth keeping between visits — see [`usePluginSkills`]
/// for the same number and the same reason: the answer is about the machine, and
/// the read costs the control child's first boot when none is up.
const FRESH_MS = 60_000;

let cached: { servers: PluginMcpServer[]; at: number } | null = null;

/// A connection test's answer for one server, or that one is running.
export type McpTestState = { state: "testing" } | { state: "done"; result: McpTestResult };

/// What each server last answered, for as long as this app is up.
///
/// **Module-level, because two components ask.** The list draws each server's tools
/// without opening it, and the form edits one — and two copies of "does this server
/// work" would be two answers to one question, free to disagree about the same
/// process. Written by the passes below and by nothing else.
const tests = new Map<string, McpTestState>();

const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

/// Drops one server's answer, so the next pass asks again.
///
/// Called after a write: a saved change is exactly the moment the old answer
/// stopped describing the entry on disk.
export function forgetMcpTest(name: string) {
  if (tests.delete(name)) announce();
}

/// The MCP servers this machine has written down, and what each one answers.
export function usePluginMcp(active: boolean) {
  const [servers, setServers] = useState<PluginMcpServer[] | null>(
    () => cached?.servers ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /// The server whose switch is in flight, by name, so its own row can say so.
  const [switching, setSwitching] = useState<string | null>(null);
  /// Bumped whenever the answers change.
  ///
  /// The answers live in a `Map` outside React — see [`tests`] — and a mutation in
  /// place is invisible to a render. This is what makes one happen; the map is then
  /// read during it, which is why every reader of `testOf` is downstream of this.
  const [version, setAnswered] = useState(0);

  /// Bumped by every read, so one that lands after a newer one is dropped.
  const reads = useRef(0);
  /// Whether a pass is running, so entering the tab twice does not dial twice.
  const passing = useRef(false);

  const load = useCallback(async (force = false) => {
    if (!force && cached && Date.now() - cached.at < FRESH_MS) {
      setServers(cached.servers);
      return;
    }

    const read = ++reads.current;
    setLoading(true);
    try {
      const answer = await invoke<PluginMcpServer[]>("list_plugin_mcp_servers", {
        keyword: null,
      });
      if (read !== reads.current) return;
      cached = { servers: answer, at: Date.now() };
      setServers(answer);
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

  // A write anywhere in this screen makes this listing stale, and the form that made
  // it is not above this component — see the module's own note.
  useEffect(() => {
    const listener = () => {
      setAnswered((count) => count + 1);
      void load(true);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [load]);

  const refresh = useCallback(() => {
    // Every answer goes with it: a refresh is the reader asking what is true *now*,
    // and a kept answer is the one thing that cannot tell them.
    tests.clear();
    announce();
    void load(true);
  }, [load]);

  /// Switches one server, and answers whether it ended up as asked.
  const setEnabled = useCallback(
    async (server: PluginMcpServer, enabled: boolean): Promise<boolean> => {
      setSwitching(server.name);
      try {
        const moved = await invoke<PluginMcpServer>("set_plugin_mcp_server_enabled", {
          name: server.name,
          enabled,
        });
        // Off is not a connection worth asking about, and on is one that has not
        // been asked yet — either way the old answer is about a different state.
        forgetMcpTest(server.name);
        setServers((current) => {
          if (!current) return current;
          const next = current.map((row) => (row.name === moved.name ? moved : row));
          cached = { servers: next, at: Date.now() };
          return next;
        });
        setError(null);
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      } finally {
        setSwitching(null);
      }
    },
    [],
  );

  /// Tests the named servers, one at a time.
  ///
  /// **Entering the tab is what asks, and each row draws the answer.** Whether a
  /// server works is not something a listing can describe — it is a connection —
  /// and the reply carries the tool list, so a row can say what the server actually
  /// offers rather than that it is written down.
  ///
  /// Sequential rather than all at once: every one of these dials a real process or
  /// a real host, and a machine with six of them would hold six connections while
  /// the reader waits for the first. One at a time also means the rows fill in as
  /// the answers land, which is honest about what is happening.
  const testServers = useCallback(async (names: string[]) => {
    if (passing.current) return;
    passing.current = true;
    try {
      for (const name of names) {
        tests.set(name, { state: "testing" });
        announce();
        try {
          const result = await invoke<McpTestResult>("test_plugin_mcp_server", { name });
          tests.set(name, { state: "done", result });
        } catch (cause) {
          // A transport failure is an answer too, and the row has to draw one:
          // silence would look like a server that is simply slow.
          tests.set(name, {
            state: "done",
            result: {
              success: false,
              toolCount: null,
              tools: [],
              errorCode: null,
              errorMessage: String(cause),
            },
          });
        }
        announce();
      }
    } finally {
      passing.current = false;
    }
  }, []);

  /// Whichever answer is held for one server, or `undefined` for one not asked yet.
  const testOf = useCallback((name: string) => tests.get(name), []);

  /// Removes a server, from the row that draws it.
  ///
  /// The listing is re-read rather than patched, because a delete is the one write
  /// whose result the reader is looking at — the row is *gone*, and patching it out
  /// locally is a claim about a write that may have failed.
  const deleteServer = useCallback(async (name: string): Promise<boolean> => {
    try {
      await invoke<boolean>("delete_plugin_mcp_server", { name });
      forgetMcpTest(name);
      announce();
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    }
  }, []);

  return {
    servers,
    error,
    loading,
    switching,
    version,
    refresh,
    setEnabled,
    testServers,
    testOf,
    deleteServer,
  };
}

/// The form behind a row, or behind "Add server".
///
/// **The draft is local and the answer is the agent's.** Nothing is written until
/// Save, and a refusal comes back in the agent's own words — so this holds what the
/// reader has typed, sends it whole, and takes what comes back as the truth about
/// what is now stored.
export function useMcpEditor(pick: McpPick) {
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<McpConfig>(() => emptyConfig());
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /// Bumped by every read, so a detail that lands after a newer pick is dropped.
  const reads = useRef(0);

  const isNew = pick?.mode === "new";

  useEffect(() => {
    setError(null);

    if (!pick) {
      setLoading(false);
      return;
    }

    if (pick.mode === "new") {
      setName("");
      setDraft(emptyConfig());
      setEnabled(true);
      setLoading(false);
      return;
    }

    const read = ++reads.current;
    setLoading(true);
    void invoke<McpServerDetail | null>("get_plugin_mcp_server", { name: pick.name })
      .then((detail) => {
        if (read !== reads.current) return;
        if (!detail) {
          setError("This server is gone — it was removed since this list was read.");
          return;
        }
        setName(detail.name);
        setDraft(detail.config);
        setEnabled(detail.enabled);
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
  /// **The values arrive from the form rather than being read off this hook.** Two
  /// of the fields are held there as *text* — the command is one line and the
  /// environment is one per line — and a hook keeping its own copy would be a second
  /// place the same characters live, free to disagree with what is on screen at the
  /// moment Save is pressed.
  const save = useCallback(
    async (name: string, config: McpConfig): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const command = isNew ? "create_plugin_mcp_server" : "update_plugin_mcp_server";
        const detail = await invoke<McpServerDetail>(command, { name, config });
        // What came back is what is stored, which is the agent's word rather than a
        // guess about what it did with a blank field.
        setDraft(detail.config);
        setEnabled(detail.enabled);
        // The answer the row is holding is about the entry as it was.
        forgetMcpTest(detail.name);
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [isNew],
  );

  const remove = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await invoke<boolean>("delete_plugin_mcp_server", { name });
      forgetMcpTest(name);
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [name]);

  return {
    isNew,
    name,
    /// What was read, for the form to seed its fields from. Read-only here — the
    /// form owns what is on screen and hands the values back at Save.
    draft,
    enabled,
    loading,
    saving,
    error,
    save,
    remove,
  };
}
