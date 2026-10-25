import { Clock, FileText, Hash, Inbox, Plug, Plus, Settings } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import { PluginMark } from "@/components/plugins/parts";
import type { NoteRef } from "@/hooks/usePaletteSources";
import type { PaletteItem } from "@/lib/palette";
import type { RosterAgent } from "@/lib/roster";
import { nextText } from "@/lib/routines";
import type { InboxItem, Plugin, Routine } from "@/types/events";

/// What the palette needs from the shell to build and run the Jump to rows.
export type JumpData = {
  agents: readonly RosterAgent[];
  working: ReadonlySet<string>;
  inbox: readonly InboxItem[];
  notes: readonly NoteRef[];
  routines: readonly Routine[];
  plugins: readonly Plugin[];
  now: number;
  go: {
    agent: (id: string) => void;
    inbox: (id: string) => void;
    note: (agentId: string, file: string) => void;
    routine: (id: string) => void;
    plugin: (id: string) => void;
  };
};

const KIND_WORD: Record<InboxItem["kind"], string> = {
  approval: "approval",
  question: "question",
  mention: "mention",
  done: "finished",
};

/// The rows for the groups the mockup's Jump to has: agents, what needs you,
/// notes, routines and plugins (channels are built by the shell, which also
/// restores archived ones). "Do" and the older rows (sessions, messages,
/// code, projects, workspaces) are built by the shell, which owns what they run.
export function jumpRows(d: JumpData): PaletteItem[] {
  const rows: PaletteItem[] = [];
  const byId = new Map(d.agents.map((a) => [a.id, a]));
  const tile = (a: RosterAgent) => <AgentTile id={a.id} kind={a.kind} color={a.color} size={22} />;

  for (const a of d.agents) {
    rows.push({
      kind: "agent",
      id: a.id,
      label: a.name,
      detail: a.role + (d.working.has(a.id) ? " · working" : ""),
      icon: tile(a),
      run: () => d.go.agent(a.id),
    });
  }

  for (const item of d.inbox) {
    const agent = byId.get(item.agentId);
    if (item.state !== "open" || !agent) continue;
    rows.push({
      kind: "inbox",
      id: item.id,
      label: item.title,
      detail: KIND_WORD[item.kind],
      icon: tile(agent),
      run: () => d.go.inbox(item.id),
    });
  }

  for (const n of d.notes) {
    const agent = byId.get(n.agentId);
    if (!agent) continue;
    rows.push({
      kind: "memory",
      id: `${n.agentId}:${n.file}`,
      label: n.title,
      detail: `${agent.name}'s memory`,
      icon: <FileText className="size-[13px]" />,
      run: () => d.go.note(n.agentId, n.file),
    });
  }

  for (const r of d.routines) {
    const agent = byId.get(r.agentId);
    if (!agent) continue;
    rows.push({
      kind: "routine",
      id: r.id,
      label: r.name,
      detail: `${agent.name} · ${nextText(r, d.now)}`,
      icon: <Clock className="size-[13px]" />,
      run: () => d.go.routine(r.id),
    });
  }

  for (const p of d.plugins) {
    rows.push({
      kind: "plugin",
      id: p.id,
      label: p.name,
      detail: p.description || undefined,
      icon: <PluginMark face={{ id: p.id, slug: p.slug, mark: p.mark }} size={22} />,
      run: () => d.go.plugin(p.id),
    });
  }

  return rows;
}

/// The glyphs the "Do" rows wear.
export const DO_ICONS = {
  agent: <Plus className="size-[13px]" />,
  channel: <Hash className="size-[13px]" />,
  routine: <Clock className="size-[13px]" />,
  plugin: <Plug className="size-[13px]" />,
  settings: <Settings className="size-[13px]" />,
  inbox: <Inbox className="size-[13px]" />,
};
