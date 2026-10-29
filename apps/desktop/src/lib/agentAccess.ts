
export type Talk = { mode: "everyone" | "me" | "list"; ids: string[] };
export type AskRule = { text: string; on: boolean };
export type Folder = { path: string; write: boolean };

export const DEFAULT_TALK: Talk = { mode: "everyone", ids: [] };

export function readTalk(raw: unknown): Talk {
  if (typeof raw !== "object" || raw === null) return DEFAULT_TALK;
  const t = raw as Record<string, unknown>;
  const mode = t.mode === "me" || t.mode === "list" ? t.mode : "everyone";
  const ids = Array.isArray(t.ids) ? t.ids.filter((x): x is string => typeof x === "string") : [];
  return { mode, ids };
}

export function readRules(raw: unknown): AskRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) =>
    typeof r === "object" && r !== null && typeof (r as AskRule).text === "string"
      ? [{ text: (r as AskRule).text, on: (r as AskRule).on !== false }]
      : [],
  );
}

export function readFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) =>
    typeof f === "object" && f !== null && typeof (f as Folder).path === "string"
      ? [{ path: (f as Folder).path, write: (f as Folder).write === true }]
      : [],
  );
}

/// Whether one of hz's own tool servers is on for an agent.
export function toolOn(agent: { toolsOff?: string[] }, tool: "team" | "memory"): boolean {
  return !(agent.toolsOff ?? []).includes(tool);
}

/// The agent with a tool switched on or off.
export function withTool(toolsOff: readonly string[], tool: string, on: boolean): string[] {
  const rest = toolsOff.filter((t) => t !== tool);
  return on ? rest : [...rest, tool];
}

/// A folder list with a path added once, as read only.
export function addFolder(folders: readonly Folder[], path: string): Folder[] {
  return folders.some((f) => f.path === path) ? [...folders] : [...folders, { path, write: false }];
}
