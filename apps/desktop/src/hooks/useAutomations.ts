import { useCallback, useEffect, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import type { Automation, ModelId } from "@/types/events";

export type NewAutomation = {
  name: string;
  prompt: string;
  projectPath: string;
  model: ModelId;
  everyMinutes: number;
};

/// The reader's automations, read once when settings opens.
///
/// Owned by the dialog rather than by the section, for the reason every other
/// read in there is: a body is built when the reader reaches its tab, so a read
/// living there is a tab that is blank for as long as its children take.
export function useAutomations(open: boolean) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;

    invoke<Automation[]>("list_automations")
      .then((list) => {
        if (!live) return;
        setAutomations(list);
        setError(null);
      })
      .catch((e: unknown) => live && setError(String(e)));

    return () => {
      live = false;
    };
  }, [open]);

  /// Every write answers with the whole list, so the two cannot drift: a create
  /// and a delete both leave the screen showing what the file holds.
  const adopt = useCallback((list: Automation[], e: unknown) => {
    setError(e ? String(e) : null);
    if (!e) setAutomations(list);
  }, []);

  const create = useCallback(
    async (input: NewAutomation) => {
      try {
        const created = await invoke<Automation>("create_automation", input);
        setAutomations((prev) => [...prev, created]);
        setError(null);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        adopt(await invoke<Automation[]>("delete_automation", { id }), null);
      } catch (e) {
        adopt([], e);
      }
    },
    [adopt],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        adopt(await invoke<Automation[]>("set_automation_enabled", { id, enabled }), null);
      } catch (e) {
        adopt([], e);
      }
    },
    [adopt],
  );

  return { automations, error, create, remove, setEnabled };
}
