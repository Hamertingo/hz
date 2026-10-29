import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Brain, Clock, Cpu, FileText, Folder as FolderIcon, Globe, History, Pencil, Plus, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import EngineMark from "@/components/EngineMark";
import { homeShort } from "@/components/chat/AgentChatHeader";
import { Group, Row, Section, Val } from "@/components/kit/kit";
import { EffortMenu, ModelMenu, modelLabel, useModels } from "@/components/profile/ConfigMenus";
import { AgentSafetyRows } from "@/components/safety/SafetyRows";
import LoginsSheet, { useLogins } from "@/components/sheets/LoginsSheet";
import VersionsSheet from "@/components/sheets/VersionsSheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useNotes, useVersions } from "@/hooks/useAgentProfile";
import { useRoutines } from "@/hooks/useRoutines";
import { addFolder } from "@/lib/agentAccess";
import { CLI } from "@/lib/cli";
import { countByDay, dayKey, startOfDay } from "@/lib/heatmap";
import { composeNote, noteFileName, type Note } from "@/lib/memoryNotes";
import { withIndexLine } from "@/lib/remember";
import { AGENT_HARNESSES, type RosterAgent } from "@/lib/roster";
import { whenText } from "@/lib/routines";
import { cn } from "@/lib/utils";
import type { ActivityScan, ApprovalPolicy, Routine } from "@/types/events";

/// The stances as the ladder draws them, narrowest first, each with what it means in two words.
const ACCESS: { value: ApprovalPolicy; label: string; sub: string; hint: string }[] = [
  { value: "plan", label: "Plan", sub: "reads", hint: "Reads and plans, changes nothing" },
  { value: "manual", label: "Ask first", sub: "asks", hint: "Asks before it edits or runs anything" },
  { value: "auto", label: "Auto", sub: "asks risky", hint: "Asks only for risky actions" },
  { value: "bypassPermissions", label: "Full access", sub: "never asks", hint: "Never asks" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function routineWhen(r: Routine): string {
  const t = r.trigger;
  return t.kind === "schedule" ? `${whenText(t.days)} at ${t.time}` : `when ${t.source} ${t.event}`;
}

/// The 26-week strip: five rows of 26 days, the colour keyed off how busy the day was.
function Heat({ scan, color }: { scan: ActivityScan | null; color: string }) {
  const cells = useMemo(() => {
    const counts = countByDay(scan?.messages ?? []);
    const today = startOfDay(Date.now());
    const n = 26 * 5;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (n - 1 - i));
      return counts.get(dayKey(d.getTime())) ?? 0;
    });
  }, [scan]);
  const top = Math.max(1, ...cells);
  return (
    <div className="grid gap-0.5 p-3" style={{ gridTemplateColumns: "repeat(26, 1fr)" }}>
      {cells.map((n, i) => {
        const v = Math.round((n / top) * 10);
        const pct = n === 0 ? 0 : v > 6 ? 100 : v > 4 ? 55 : v > 2 ? 25 : 12;
        return <i key={i} className="aspect-square rounded-xs bg-s3" style={pct ? { background: `color-mix(in srgb, ${color} ${pct}%, var(--s3))` } : undefined} />;
      })}
    </div>
  );
}

/// One memory note: its text with Edit and Forget under it, or a box to rewrite it in.
export function NoteRow({ note, agent, reload, hold }: { note: Note; agent: RosterAgent; reload: () => Promise<void>; hold: (on: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const finish = () => {
    setEditing(false);
    hold(false);
  };
  const save = async () => {
    try {
      await invoke("agent_memory_write", { agentId: agent.id, name: note.name, content: composeNote(note.front, text.trim() || "Empty note") });
      finish();
      await reload();
      toast("Saved. It reads this from the next message.");
    } catch (e) {
      toast(String(e));
    }
  };
  const forget = async () => {
    try {
      await invoke("agent_memory_forget", { agentId: agent.id, name: note.name });
      await reload();
      toast("Forgotten", {
        ms: 7000,
        action: { label: "Undo", onClick: () => void invoke("agent_memory_restore", { agentId: agent.id, name: note.name }).then(reload).catch((e) => toast(String(e))) },
      });
    } catch (e) {
      toast(String(e));
    }
  };
  const quiet = "cursor-pointer rounded-[5px] px-1.5 py-px text-xs text-ink3 transition-colors hover:bg-s3 hover:text-ink";
  return (
    <div className="px-3 py-2.5">
      {editing ? (
        <>
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="field-sizing-content min-h-12 w-full resize-none rounded-[9px] bg-s2 px-2.5 py-2 text-[13px] leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-[inset_0_0_0_1px_var(--line3)]"
          />
          <div className="mt-1 flex items-center gap-0.5">
            <Button variant="solid" size="sm" className="mr-1" onClick={() => void save()}>
              Save
            </Button>
            <button type="button" className={quiet} onClick={finish}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-[1.55]">{note.body.replace(/^#.*\n+/, "").trim() || note.summary}</p>
          <div className="-ml-1.5 mt-1 flex gap-0.5">
            <button
              type="button"
              className={quiet}
              onClick={() => {
                hold(true);
                setText(note.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" className={quiet} onClick={() => void forget()}>
              Forget
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/// The Engine, Model and Effort rows, shared by the panel and the edit dialog since both write the same entry.
export function EngineRows({ agent, onChange }: { agent: RosterAgent; onChange: (next: RosterAgent) => void }) {
  const models = useModels(agent.harness);
  const cli = CLI[agent.harness];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="w-full text-left">
            <Row lead={<Cpu />} title="Engine" right={<Val kind="down">{cli?.label ?? agent.harness}</Val>} className="hover:bg-s2" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Engine</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={agent.harness}
            onValueChange={(h) => {
              if (h === agent.harness) return;
              onChange({ ...agent, harness: h as RosterAgent["harness"], modelId: null, effort: null });
              toast(`${agent.name} now runs on ${CLI[h]?.label ?? h}`);
            }}
          >
            {AGENT_HARNESSES.map((h) => (
              <DropdownMenuRadioItem key={h} value={h}>
                <EngineMark harness={h} size={18} />
                {CLI[h]?.label ?? h}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ModelMenu agent={agent} models={models} onChange={onChange}>
        <button type="button" className="w-full text-left">
          <Row lead={<Sparkles />} title="Model" right={<Val kind="down">{modelLabel(models, agent)}</Val>} className="hover:bg-s2" />
        </button>
      </ModelMenu>
      <EffortMenu agent={agent} models={models} onChange={onChange}>
        <button type="button" className="w-full text-left">
          <Row lead={<Brain />} title="Effort" right={<Val kind="down">{agent.effort ? cap(agent.effort) : "Default"}</Val>} className="hover:bg-s2" />
        </button>
      </EffortMenu>
    </>
  );
}

/// Everything under the Details tab, top to bottom, as the mockup lays it out.
export default function ProfileDetails({
  agent,
  scan,
  onChange,
  onEdit,
  onRoutines,
}: {
  agent: RosterAgent;
  scan: ActivityScan | null;
  onChange: (next: RosterAgent) => void;
  onEdit: () => void;
  onRoutines?: () => void;
}) {
  const { notes, reload, hold } = useNotes(agent.id, true);
  const routines = useRoutines(true);
  const { versions: saved } = useVersions(agent.id);
  const { logins: signedIn } = useLogins(agent.id, true);
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState(false);
  const [logins, setLogins] = useState(false);
  const mine = routines.routines.filter((r) => r.agentId === agent.id && !r.deletedAt);
  const folders = agent.folders ?? [];
  const stance = ACCESS.find((a) => a.value === (agent.permission ?? "auto")) ?? ACCESS[2];

  const addFolderPath = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    onChange({ ...agent, folders: addFolder(folders, picked) });
    toast(`${agent.name} can work in ${homeShort(picked)}`);
  };
  const addNote = async () => {
    const name = noteFileName("New note", new Set((notes ?? []).map((n) => n.name)));
    const front: [string, string][] = [["tag", "Project"], ["by", "you"], ["learned", new Date().toISOString().slice(0, 10)]];
    try {
      await invoke("agent_memory_write", { agentId: agent.id, name, content: composeNote(front, "# New note\n\nWrite what the agent should remember.\n") });
      const index = await invoke<string>("agent_memory_read", { agentId: agent.id, name: "MEMORY.md" }).catch(() => "");
      await invoke("agent_memory_write", { agentId: agent.id, name: "MEMORY.md", content: withIndexLine(index, { name, title: "New note" }) });
      await reload();
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <>
      <Section title="Instructions" />
      {editing ? (
        <textarea
          autoFocus
          defaultValue={agent.instructions}
          onBlur={(e) => {
            setEditing(false);
            if (e.target.value !== agent.instructions) onChange({ ...agent, instructions: e.target.value });
          }}
          className="max-h-64 min-h-28 w-full resize-y overflow-y-auto rounded-[13px] bg-s1 p-3 text-[13px] leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none"
        />
      ) : (
        <Group>
          <Row lead={<FileText />} title={<span className="line-clamp-1 break-all">{agent.instructions.replace(/[#*`>_-]+/g, " ").replace(/\s+/g, " ").trim() || "No instructions yet"}</span>} sub="Read and edit what it knows how to do." right={<Val kind="next" />} onClick={() => setEditing(true)} />
        </Group>
      )}

      <Section title="Engine" />
      <Group>
        <EngineRows agent={agent} onChange={onChange} />
      </Group>

      <Section title="Routines" count={mine.length} action="New" onAction={onRoutines} />
      <Group>
        {mine.length ? (
          mine.map((r) => (
            <Row
              key={r.id}
              lead={<Clock />}
              title={r.name}
              sub={routineWhen(r)}
              right={<Switch checked={r.on} onCheckedChange={(on) => void routines.setOn(r.id, on)} aria-label={r.name} />}
              onClick={onRoutines}
            />
          ))
        ) : (
          <div className="px-3 py-2.5 text-[12.5px] text-ink3">No routines yet.</div>
        )}
      </Group>

      <Section title="Memory" count={notes?.length ?? 0} action="Add" onAction={() => void addNote()} />
      <Group>
        {notes?.length ? (
          notes.map((n) => <NoteRow key={n.name} note={n} agent={agent} reload={reload} hold={hold} />)
        ) : (
          <div className="px-3 py-2.5 text-[12.5px] text-ink3">Nothing remembered yet. Say “remember this” in the chat.</div>
        )}
      </Group>

      <Section title="Access" />
      <Group>
        <div className="grid grid-cols-4 gap-[3px] p-[5px]">
          {ACCESS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => {
                onChange({ ...agent, permission: a.value });
                toast(`${agent.name}: ${a.label}. ${a.hint}.`);
              }}
              className={cn(
                "cursor-pointer rounded-[9px] px-[3px] py-2 text-center text-xs font-medium transition-colors",
                stance.value === a.value ? "bg-s3 text-ink shadow-[inset_0_0_0_1px_var(--line3)]" : "text-ink2 hover:bg-s2 hover:text-ink",
              )}
            >
              {a.label}
              <span className="mt-px block text-[10.5px] font-normal text-ink3">{a.sub}</span>
            </button>
          ))}
        </div>
        <p className="px-3 pb-2.5 text-xs leading-[1.55] text-ink3">{stance.hint}.</p>
      </Group>

      <AgentSafetyRows agent={agent} onChange={onChange} />

      <Section title="Folders" count={folders.length + 1} />
      <Group>
        <Row lead={<FolderIcon />} title={homeShort(agent.projectPath) || "No folder"} />
        {folders.map((f) => (
          <Row
            key={f.path}
            lead={<FolderIcon />}
            title={homeShort(f.path)}
            right={
              <Button variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => onChange({ ...agent, folders: folders.filter((x) => x.path !== f.path) })}>
                <X />
              </Button>
            }
          />
        ))}
        <Row lead={<Plus />} title="Add a folder" onClick={() => void addFolderPath()} className="hover:bg-s2" />
      </Group>

      <Section title="Setup" />
      <Group>
        <Row lead={<History />} title="Versions" sub="Every change is saved. Bring an old one back." right={<Val kind="next">{saved?.length ? `v${saved[0].n}` : ""}</Val>} onClick={() => setVersions(true)} />
        <Row lead={<Globe />} title="Browser logins" sub="Sites its browser stays signed in to." right={<Val kind="next">{signedIn?.length || ""}</Val>} onClick={() => setLogins(true)} />
      </Group>

      <Section title="Activity" count="last 26 weeks" />
      <Group>
        <Heat scan={scan} color={agent.color} />
      </Group>

      <div className="mt-3.5 flex flex-wrap gap-1.5">
        <Button variant="outline" className="flex-1" onClick={onEdit}>
          <Pencil /> Edit agent
        </Button>
      </div>

      <VersionsSheet agent={agent} open={versions} onOpenChange={setVersions} onRestored={(text) => onChange({ ...agent, instructions: text })} />
      <LoginsSheet agent={agent} open={logins} onOpenChange={setLogins} />
    </>
  );
}
