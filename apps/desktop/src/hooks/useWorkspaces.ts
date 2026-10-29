import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useSyncExternalStore } from "react";

import { toast } from "@/components/ui/toast";
import { usePreference } from "@/lib/prefs";
import { rosterRemoveWorkspace, rosterSetFallbackWorkspace } from "@/lib/roster";
import { activeWorkspace, workspaceMark } from "@/lib/workspace";
import type { Workspace, WorkspaceDefaults, WorkspacePatch } from "@/types/events";

/// The workspaces, as `~/.hz/workspaces.json` holds them. A module-level store
/// like the roster: the sidebar, both settings pages and the new-agent dialog
/// all read it, and two copies would disagree about a rename for one frame.
let workspaces: Workspace[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Workspace[]) {
  workspaces = next;
  for (const l of listeners) l();
}

function replace(next: Workspace) {
  set(workspaces.map((w) => (w.id === next.id ? next : w)));
}

/// Reads the workspaces once. The backend makes the first one (named after the
/// folder most agents work in) on an install that has none, and the roster files
/// its pre-workspace agents there.
function load(): Promise<void> {
  loading ??= invoke<Workspace[]>("workspaces_list")
    .then((all) => {
      set(all);
      if (all[0]) rosterSetFallbackWorkspace(all[0].id);
    })
    .catch((e) => {
      loading = null;
      console.error("[workspaces]", e);
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

const fail = (e: unknown) => toast(String(e));

/// Image types a logo or a photo may be.
export const IMAGE_FILTER = [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }];

/// Asks the reader for an image and returns its path, or null if they cancel.
export async function pickImage(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: IMAGE_FILTER });
  return typeof picked === "string" ? picked : null;
}

/// Saves the sidebar order of a workspace's agents or channels. Shown at once;
/// the backend's answer replaces it, and a failed write puts the old one back.
export async function saveOrder(workspaceId: string, kind: "agents" | "channels" | "sections", order: string[]) {
  const key = kind === "agents" ? "agentOrder" : kind === "channels" ? "channelOrder" : "sectionOrder";
  const before = workspaces;
  set(workspaces.map((w) => (w.id === workspaceId ? { ...w, [key]: order } : w)));
  try {
    replace(await invoke<Workspace>("workspace_set_order", { id: workspaceId, kind, order }));
  } catch (e) {
    set(before);
    fail(e);
  }
}

/// The saved order of one workspace's agents or channels, empty before any drag.
export function useSavedOrder(workspaceId: string | null, kind: "agents" | "channels" | "sections"): string[] {
  const all = useSyncExternalStore(subscribe, () => workspaces);
  const ws = all.find((w) => w.id === workspaceId);
  const saved = kind === "agents" ? ws?.agentOrder : kind === "channels" ? ws?.channelOrder : ws?.sectionOrder;
  return saved ?? NO_ORDER;
}

const NO_ORDER: string[] = [];

/// All workspaces, the one on screen and the actions on them.
export function useWorkspaces() {
  const all = useSyncExternalStore(subscribe, () => workspaces);
  const [stored, setStored] = usePreference("hz.workspace", null);
  const active = activeWorkspace(all, stored);

  return {
    workspaces: all,
    active,
    switchTo: (id: string) => setStored(id),
    create: async (name: string, color: string, context: string) => {
      try {
        const made = await invoke<Workspace>("workspace_create", { name, color, context });
        set([...workspaces, made]);
        setStored(made.id);
        return made;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    update: async (id: string, patch: WorkspacePatch) => {
      // Shown at once, so the sidebar's name follows the keystroke; the backend's
      // answer replaces it a moment later.
      const name = patch.name?.trim();
      set(
        workspaces.map((w) =>
          w.id === id
            ? {
                ...w,
                ...(name ? { name, mark: workspaceMark(name) } : {}),
                ...(patch.color ? { color: patch.color } : {}),
                ...(patch.context !== undefined && patch.context !== null ? { context: patch.context } : {}),
              }
            : w,
        ),
      );
      try {
        replace(await invoke<Workspace>("workspace_update", { id, patch }));
      } catch (e) {
        fail(e);
      }
    },
    /// Replaces a workspace's defaults (Settings → Agent defaults and Usage &
    /// limits). Shown at once; the backend clamps and answers.
    setDefaults: async (id: string, defaults: WorkspaceDefaults) => {
      set(workspaces.map((w) => (w.id === id ? { ...w, defaults } : w)));
      try {
        replace(await invoke<Workspace>("workspace_set_defaults", { id, defaults }));
      } catch (e) {
        fail(e);
      }
    },
    remove: async (id: string) => {
      try {
        await invoke("workspace_delete", { id });
        rosterRemoveWorkspace(id);
        const rest = workspaces.filter((w) => w.id !== id);
        set(rest);
        if (stored === id && rest[0]) setStored(rest[0].id);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    uploadLogo: async (id: string) => {
      const source = await pickImage();
      if (!source) return;
      try {
        replace(await invoke<Workspace>("workspace_set_logo", { id, source }));
      } catch (e) {
        fail(e);
      }
    },
    clearLogo: async (id: string) => {
      try {
        replace(await invoke<Workspace>("workspace_clear_logo", { id }));
      } catch (e) {
        fail(e);
      }
    },
  };
}
