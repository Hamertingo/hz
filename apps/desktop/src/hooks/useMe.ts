import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

import { toast } from "@/components/ui/toast";
import { pickImage } from "@/hooks/useWorkspaces";
import type { Me, MePatch } from "@/types/events";

/// Who the reader is. Held here and written through `settings.rs`, which also
/// owns what the status does to notifications; the sidebar's card, the profile
/// page and every briefing read the same record.
const FALLBACK: Me = {
  name: "You",
  calls: "",
  language: "English",
  status: "available",
  avatar: { kind: "bear", color: "#e2a440" },
  photo: null,
};

let me: Me = FALLBACK;
let started = false;
const listeners = new Set<() => void>();

function set(next: Me) {
  me = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    invoke<Me>("get_me").then(set).catch((e) => {
      started = false;
      console.error("[me]", e);
    });
  }
  return () => listeners.delete(listener);
}

/// Changes the profile. Shown at once and corrected by the backend's answer, so
/// typing a name does not wait on the disk.
export function updateMe(patch: MePatch) {
  set({
    ...me,
    ...(patch.name?.trim() ? { name: patch.name } : {}),
    ...(patch.calls !== undefined && patch.calls !== null ? { calls: patch.calls } : {}),
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.avatar ? { avatar: patch.avatar, photo: null } : {}),
  });
  invoke<Me>("set_me", { patch }).then(set).catch((e) => toast(String(e)));
}

/// Picks an image from disk as the reader's photo.
export async function uploadPhoto() {
  const source = await pickImage();
  if (!source) return;
  try {
    set(await invoke<Me>("me_set_photo", { source }));
  } catch (e) {
    toast(String(e));
  }
}

export async function removePhoto() {
  try {
    set(await invoke<Me>("me_clear_photo"));
  } catch (e) {
    toast(String(e));
  }
}

export function useMe(): Me {
  return useSyncExternalStore(subscribe, () => me);
}
