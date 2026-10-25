import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronRight, Moon, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Markdown } from "@/components/chat/Markdown";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import Spinner from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { SkeletonRegion, SkeletonRows } from "@/components/ui/skeleton";
import { agoLabel, clock } from "@/components/profile/parts";
import { useTidied } from "@/hooks/useAgentProfile";
import {
  NOTE_TAGS,
  TAG_TABS,
  asTag,
  composeNote,
  filterNotes,
  frontValue,
  noteFileName,
  tagCounts,
  withFront,
  type Note,
  type NoteTag,
  type TagTab,
} from "@/lib/memoryNotes";
import { withIndexLine } from "@/lib/remember";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { NoteUsage } from "@/types/events";

const TAG_CHIP = "rounded-[5px] bg-s3 px-1.5 py-px text-[10.5px] font-medium text-ink2";

export default function ProfileMemory({
  agent,
  notes,
  usage,
  reload,
  hold,
  focus,
}: {
  agent: RosterAgent;
  notes: Note[] | null;
  usage: Record<string, NoteUsage>;
  reload: () => Promise<void>;
  hold: (on: boolean) => void;
  onChange: (next: RosterAgent) => void;
  /// A note to open on arrival, from another tab.
  focus: string | null;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TagTab>("all");
  const [open, setOpen] = useState<string | null>(focus);
  const [editing, setEditing] = useState<{ title: string; body: string; tag: NoteTag | "" } | null>(null);
  const [forgetting, setForgetting] = useState<Note | null>(null);
  const [tidying, setTidying] = useState(false);
  const [tidied, setTidied] = useTidied(agent.id);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    if (focus) {
      setOpen(focus);
      setTab("all");
      setQuery("");
    }
  }, [focus]);
  useEffect(() => hold(editing !== null), [editing, hold]);

  const all = notes ?? [];
  const counts = tagCounts(all);
  const list = useMemo(() => filterNotes(all, tab, query), [all, tab, query]);
  const note = all.find((n) => n.name === open) ?? list[0] ?? null;

  const startEdit = (n: Note) => setEditing({ title: n.title, body: n.body.replace(/^#\s+.+\n+/, ""), tag: n.tag ?? "" });

  const save = async () => {
    if (!note || !editing) return;
    const title = editing.title.trim() || note.title;
    const body = `# ${title}\n\n${editing.body.trim()}\n`;
    let front = withFront(note.front, "tag", editing.tag || null);
    if (!frontValue(front, "by")) front = withFront(front, "by", "you");
    try {
      await invoke("agent_memory_write", { agentId: agent.id, name: note.name, content: composeNote(front, body) });
      setEditing(null);
      // The effect that releases the hold runs after this render; the reload below
      // would otherwise find the list still held and skip.
      hold(false);
      await reload();
      toast(`Saved. ${agent.name} reads it from the next message.`);
    } catch (e) {
      toast(String(e));
    }
  };

  const create = async () => {
    const taken = new Set(all.map((n) => n.name));
    const name = noteFileName("New note", taken);
    const today = new Date().toISOString().slice(0, 10);
    const front: [string, string][] = [
      ["tag", "Project"],
      ["by", "you"],
      ["learned", today],
    ];
    try {
      await invoke("agent_memory_write", {
        agentId: agent.id,
        name,
        content: composeNote(front, "# New note\n\nWrite what the agent should remember.\n"),
      });
      const index = await invoke<string>("agent_memory_read", { agentId: agent.id, name: "MEMORY.md" }).catch(() => "");
      await invoke("agent_memory_write", {
        agentId: agent.id,
        name: "MEMORY.md",
        content: withIndexLine(index, { name, title: "New note" }),
      });
      await reload();
      setTab("all");
      setQuery("");
      setOpen(name);
      setEditing({ title: "New note", body: "Write what the agent should remember.", tag: "Project" });
    } catch (e) {
      toast(String(e));
    }
  };

  const forget = async (n: Note) => {
    try {
      await invoke("agent_memory_forget", { agentId: agent.id, name: n.name });
      setOpen(null);
      await reload();
      toast("Forgotten", {
        ms: 7000,
        action: {
          label: "Undo",
          onClick: () =>
            void invoke("agent_memory_restore", { agentId: agent.id, name: n.name })
              .then(async () => {
                await reload();
                setOpen(n.name);
              })
              .catch((e) => toast(String(e))),
        },
      });
    } catch (e) {
      toast(String(e));
    }
  };

  const tidy = async () => {
    setTidying(true);
    try {
      const result = await invoke<NonNullable<typeof tidied>>("agent_memory_tidy", { agentId: agent.id });
      setTidied(result);
      setShowSummary(true);
      await reload();
      toast(
        result.before === result.after
          ? "Tidied. Nothing needed merging."
          : `Tidied: ${result.before} notes became ${result.after}`,
      );
    } catch (e) {
      toast(String(e));
    } finally {
      setTidying(false);
    }
  };

  const used = note ? usage[note.name] : undefined;

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <label className="flex h-8 max-w-[280px] flex-1 items-center gap-2 rounded-(--r2) bg-s2 px-2.5 text-ink3">
          <Search className="size-[13px]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search what ${agent.name} knows`}
            aria-label="Search notes"
            className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink4"
          />
        </label>
        <div className="flex gap-1">
          {TAG_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-(--r1) px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                tab === t.key ? "bg-active text-ink" : "text-ink3 hover:text-ink2",
              )}
            >
              {t.label} <em className="text-[11px] font-normal text-ink4 not-italic">{counts[t.key]}</em>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-xs text-ink3">
          <Moon className="size-[13px]" />
          <button
            type="button"
            disabled={!tidied}
            onClick={() => setShowSummary((v) => !v)}
            className="cursor-pointer hover:text-ink disabled:cursor-default disabled:hover:text-ink3"
          >
            {tidied ? `Tidied ${agoLabel(tidied.atMs)}` : "Never tidied"}
          </button>
          <Button variant="outline" size="sm" disabled={tidying || !agent.sessionId} onClick={() => void tidy()}>
            {tidying ? <Spinner /> : null}
            {tidying ? "Tidying…" : "Tidy now"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void create()}>
            <Plus /> Note
          </Button>
        </div>
      </div>

      {tidied && showSummary && (
        <div className="mb-3.5 rounded-(--r3) bg-s1 px-4 py-3 text-[13px] leading-[1.6] text-ink2 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="mb-1 text-xs text-ink3">
            {agent.name}'s summary · {clock(tidied.atMs)} · {tidied.before} → {tidied.after} notes
          </div>
          <div className="whitespace-pre-wrap">{tidied.summary || "It said nothing."}</div>
        </div>
      )}

      <div className="grid min-h-[470px] grid-cols-[300px_1fr] overflow-hidden rounded-(--r4) shadow-[inset_0_0_0_1px_var(--line)] max-[860px]:grid-cols-1">
        <div className="max-h-[560px] overflow-y-auto border-r border-line bg-s1 p-1.5">
          {notes === null ? (
            <SkeletonRegion label="Reading notes" className="p-1.5">
              <SkeletonRows count={5} avatar="none" />
            </SkeletonRegion>
          ) : list.length === 0 ? (
            <div className="p-5 text-ink3">
              {all.length === 0 ? `${agent.name} remembers nothing yet.` : `Nothing matches “${query || TAG_TABS.find((t) => t.key === tab)?.label}”.`}
            </div>
          ) : (
            list.map((n) => (
              <button
                key={n.name}
                type="button"
                onClick={() => {
                  setEditing(null);
                  setOpen(n.name);
                }}
                className={cn(
                  "block w-full cursor-pointer rounded-(--r2) px-3 py-2.5 text-left transition-colors hover:bg-hover",
                  note?.name === n.name && "bg-active",
                )}
              >
                <div className="text-[13px] font-[550]">{n.title}</div>
                <div className="mt-0.5 truncate text-xs text-ink3">{n.summary}</div>
                <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink4">
                  <span className={TAG_CHIP}>{n.tag ?? n.rawTag ?? "Note"}</span>
                  {agoLabel(n.modifiedMs)} · used {usage[n.name]?.count ?? 0}×
                </div>
              </button>
            ))
          )}
        </div>

        {note ? (
          <div className="min-w-0 px-7 py-6">
            {editing ? (
              <>
                <select
                  value={editing.tag}
                  onChange={(e) => setEditing({ ...editing, tag: asTag(e.target.value) ?? "" })}
                  aria-label="Tag"
                  className="rounded-[5px] bg-s3 px-1.5 py-px text-[10.5px] font-medium text-ink2 outline-none"
                >
                  <option value="">No tag</option>
                  {NOTE_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  aria-label="Title"
                  className="mt-2.5 block w-full rounded-md bg-transparent px-1.5 py-0.5 text-[19px] font-semibold tracking-[-0.015em] shadow-[0_0_0_1px_var(--line3)] outline-none"
                />
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  aria-label="Note"
                  rows={12}
                  autoFocus
                  className="mt-[18px] block w-full resize-y rounded-md bg-transparent px-1.5 py-1 text-sm leading-[1.7] text-ink2 shadow-[0_0_0_1px_var(--line3)] outline-none"
                />
                <div className="mt-[22px] flex gap-1.5">
                  <Button variant="solid" size="sm" onClick={() => void save()}>
                    <Check /> Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className={TAG_CHIP}>{note.tag ?? note.rawTag ?? "Note"}</span>
                <h2 className="mt-2.5 text-[19px] font-semibold tracking-[-0.015em]">{note.title}</h2>
                <div className="mt-1 text-xs text-ink3">
                  Written by {note.by === "you" ? "you" : note.by === "agent" ? agent.name : "—"} · {agoLabel(note.modifiedMs)} · used in{" "}
                  {used?.count ?? 0} {used?.count === 1 ? "answer" : "answers"}
                </div>
                <div className="mt-[18px] text-sm leading-[1.7] text-ink2">
                  <Markdown>{note.body.replace(/^#\s+.+\n+/, "")}</Markdown>
                </div>
                <div className="mt-[22px] flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => startEdit(note)}>
                    <Pencil /> Edit
                  </Button>
                  <Button variant="bad" size="sm" onClick={() => setForgetting(note)}>
                    <Trash2 /> Forget
                  </Button>
                </div>
                {(note.learned || note.source || used?.lastMs) && (
                  <div className="mt-6 flex flex-col gap-[7px] border-t border-line pt-3.5 text-xs text-ink3">
                    {(note.learned || note.source) && (
                      <div className="flex items-center gap-2">
                        <ChevronRight className="size-2.5 shrink-0" />
                        Learned {note.learned ? `on ${note.learned}` : ""}
                        {note.source ? `, from “${note.source}”` : ""}
                      </div>
                    )}
                    {used?.lastMs ? (
                      <div className="flex items-center gap-2">
                        <ChevronRight className="size-2.5 shrink-0" />
                        Last read in an answer {agoLabel(used.lastMs)}
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="px-7 py-6 text-ink3">{notes ? `${agent.name} remembers nothing yet.` : ""}</div>
        )}
      </div>

      <ConfirmDialog
        open={forgetting !== null}
        onOpenChange={(o) => !o && setForgetting(null)}
        title={`Forget “${forgetting?.title ?? ""}”?`}
        description={`${agent.name} stops knowing this from the next message. You can undo it for a few seconds.`}
        confirmLabel="Forget"
        onConfirm={() => forgetting && void forget(forgetting)}
      />
    </div>
  );
}

