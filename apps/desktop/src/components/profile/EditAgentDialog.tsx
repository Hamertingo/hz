import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Book, ChevronLeft, Clock, Flag, FolderIcon, Globe, Pause, Plus, Shield, Smile, User, X, Zap, AppWindow } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import { homeShort } from "@/components/chat/AgentChatHeader";
import { Group, Row, Section, UnderlineTabs, Val } from "@/components/kit/kit";
import { PluginMark } from "@/components/plugins/parts";
import { EngineRows, NoteRow } from "@/components/profile/ProfileDetails";
import { AgentSafetyRows } from "@/components/safety/SafetyRows";
import LoginsSheet, { useLogins } from "@/components/sheets/LoginsSheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useNotes } from "@/hooks/useAgentProfile";
import { usePlugins } from "@/hooks/usePlugins";
import { useRoutines } from "@/hooks/useRoutines";
import { addFolder } from "@/lib/agentAccess";
import { MODE_COPY } from "@/lib/permission";
import type { RosterAgent } from "@/lib/roster";
import { whenText } from "@/lib/routines";
import type { ApprovalPolicy, Routine } from "@/types/events";

type Tab = "general" | "routines" | "access";
type Page = "instr" | "skills" | "memory" | "apps" | "folders" | null;

const STANCES: ApprovalPolicy[] = ["plan", "manual", "auto", "bypassPermissions"];

const inl = "w-[190px] rounded-md bg-transparent px-1.5 py-[3px] text-right text-[12.5px] text-ink outline-none transition-colors hover:bg-s3 focus:bg-s3";

function when(r: Routine): string {
  const t = r.trigger;
  return t.kind === "schedule" ? `${whenText(t.days)} at ${t.time}` : `when ${t.source} ${t.event}`;
}

function Page({ title, count, action, onAction, back, children }: { title: string; count?: ReactNode; action?: string; onAction?: () => void; back: () => void; children: ReactNode }) {
  return (
    <>
      <Button variant="ghost" size="sm" className="mb-1.5 -ml-2" onClick={back}>
        <ChevronLeft /> Back
      </Button>
      <Section title={title} count={count} action={action} onAction={onAction} large className="mt-0" />
      {children}
    </>
  );
}

/// The agent's settings as one dialog: General, Routines and Access, with a page behind each row that holds a list.
/// Every control writes the same roster entry the profile panel does.
export default function EditAgentDialog({
  agent,
  open,
  onOpenChange,
  onChange,
  onLook,
  onRoutines,
}: {
  agent: RosterAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: RosterAgent) => void;
  onLook: () => void;
  onRoutines?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [page, setPage] = useState<Page>(null);
  const [logins, setLogins] = useState(false);
  const routines = useRoutines(open);
  const plugins = usePlugins(agent.workspaceId, open);
  const { notes, reload, hold } = useNotes(agent.id, open && page === "memory");
  const { logins: signedIn } = useLogins(agent.id, open);
  const instrTimer = useRef(0);
  const [instr, setInstr] = useState(agent.instructions);

  useEffect(() => {
    if (open) {
      setTab("general");
      setPage(null);
      setInstr(agent.instructions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent.id]);

  const mine = routines.routines.filter((r) => r.agentId === agent.id && !r.deletedAt);
  const connected = plugins.plugins.filter((p) => p.status === "connected");
  const allowed = connected.filter((p) => p.grants.includes(agent.id));
  const stance = (agent.permission ?? "auto") as ApprovalPolicy;
  const folders = agent.folders ?? [];
  const skillsOn = plugins.skills.filter((s) => s.grants.includes(agent.id));

  const addFolderPath = async () => {
    const picked = await pickFolder({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    onChange({ ...agent, folders: addFolder(folders, picked) });
    toast(`${agent.name} can work in ${homeShort(picked)}`);
  };

  const body = (() => {
    if (page === "instr")
      return (
        <Page title="Instructions" back={() => setPage(null)}>
          <textarea
            rows={8}
            value={instr}
            placeholder={`You are ${agent.name}, the ${agent.role.toLowerCase() || "assistant"} agent.`}
            onChange={(e) => {
              setInstr(e.target.value);
              window.clearTimeout(instrTimer.current);
              const text = e.target.value;
              instrTimer.current = window.setTimeout(() => onChange({ ...agent, instructions: text }), 500);
            }}
            className="max-h-[260px] min-h-[120px] w-full resize-y overflow-y-auto rounded-(--r1) bg-s1 px-[11px] py-[9px] text-[13px] leading-[1.55] text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none transition-[box-shadow,background] focus:bg-s2 focus:shadow-[inset_0_0_0_1px_var(--line3)]"
          />
          <p className="px-1 py-2 text-xs leading-[1.55] text-ink3">Saved as you type. {agent.name} reads it from the next message.</p>
        </Page>
      );
    if (page === "skills")
      return (
        <Page title="Skills" count={`${skillsOn.length} on`} back={() => setPage(null)}>
          <Group>
            {plugins.skills.map((s) => (
              <Row
                key={s.slug}
                lead={<Zap />}
                title={s.name}
                right={
                  <Switch
                    checked={s.grants.includes(agent.id)}
                    onCheckedChange={(on) =>
                      void plugins.saveSkill({ slug: s.slug, name: s.name, md: s.md, grants: on ? [...s.grants, agent.id] : s.grants.filter((g) => g !== agent.id) })
                    }
                    aria-label={s.name}
                  />
                }
              />
            ))}
            {plugins.skills.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-ink3">No skills yet.</div>}
          </Group>
        </Page>
      );
    if (page === "memory")
      return (
        <Page title="Memory" count={notes?.length ?? 0} back={() => setPage(null)}>
          <Group>
            {notes?.length ? notes.map((n) => <NoteRow key={n.name} note={n} agent={agent} reload={reload} hold={hold} />) : <div className="px-3 py-2.5 text-[12.5px] text-ink3">Nothing remembered yet.</div>}
          </Group>
        </Page>
      );
    if (page === "apps")
      return (
        <Page title="Connected apps" back={() => setPage(null)}>
          <Group>
            {connected.map((p) => (
              <Row
                key={p.id}
                bareLead
                lead={<PluginMark face={{ id: p.id, slug: p.slug, mark: p.name[0] }} size={34} />}
                title={p.name}
                sub={p.description}
                right={
                  <Switch
                    checked={p.grants.includes(agent.id)}
                    onCheckedChange={(on) => void plugins.setGrant(p.id, agent.id, on).then(() => toast(`${agent.name} ${on ? "can now use" : "can't use"} ${p.name}`))}
                    aria-label={p.name}
                  />
                }
              />
            ))}
            {connected.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-ink3">Nothing is connected yet.</div>}
          </Group>
        </Page>
      );
    if (page === "folders")
      return (
        <Page title="Folders" back={() => setPage(null)}>
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
            <Row lead={<Plus />} title="Add a folder" onClick={() => void addFolderPath()} />
          </Group>
        </Page>
      );

    if (tab === "general")
      return (
        <>
          <Section title="Profile" className="mt-0" />
          <Group>
            <Row lead={<User />} title="Name" right={<input aria-label="Name" key={agent.name} defaultValue={agent.name} onBlur={(e) => e.target.value.trim() && e.target.value !== agent.name && onChange({ ...agent, name: e.target.value.trim() })} className={inl} />} />
            <Row lead={<Flag />} title="Role" right={<input aria-label="Role" key={agent.role} defaultValue={agent.role} onBlur={(e) => e.target.value !== agent.role && onChange({ ...agent, role: e.target.value })} className={inl} />} />
            <Row
              lead={<Smile />}
              title="Look"
              right={
                <Val kind="next">
                  <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} size={24} />
                </Val>
              }
              onClick={onLook}
            />
          </Group>
          <Section title="How it works" />
          <Group>
            <Row lead={<Book />} title="Instructions" sub={<span className="line-clamp-2 break-words">{(agent.instructions || `${agent.role} agent`).slice(0, 300).replace(/\s+/g, " ")}</span>} right={<Val kind="next" />} onClick={() => setPage("instr")} />
            <EngineRows agent={agent} onChange={onChange} />
            <Row lead={<Zap />} title="Skills" right={<Val kind="next">{skillsOn.length}</Val>} onClick={() => setPage("skills")} />
            <Row lead={<Book />} title="Memory" right={<Val kind="next">{notes?.length ?? ""}</Val>} onClick={() => setPage("memory")} />
          </Group>
          <Section title="Queue" />
          <Group>
            <Row
              lead={<Pause />}
              title={`Pause ${agent.name}`}
              sub="What it's doing finishes, the rest waits."
              right={<Switch checked={agent.paused === true} onCheckedChange={(on) => onChange({ ...agent, paused: on })} aria-label={`Pause ${agent.name}`} />}
            />
            <div className="px-3 py-2.5 text-[12.5px] text-ink3">
              {agent.paused ? `${agent.name} is paused. Routines and messages wait here.` : `Nothing waiting. Routines and messages from other agents show up here while ${agent.name} is busy or paused.`}
            </div>
          </Group>
        </>
      );
    if (tab === "routines")
      return (
        <>
          <Section title="Routines" count={mine.length} action="New routine" onAction={onRoutines} large className="mt-0" />
          <Group>
            {mine.length ? (
              mine.map((r) => <Row key={r.id} lead={<Clock />} title={r.name} sub={when(r)} right={<Switch checked={r.on} onCheckedChange={(on) => void routines.setOn(r.id, on)} aria-label={r.name} />} onClick={onRoutines} />)
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-7 text-center text-[12.5px] text-ink3">
                <p>No routines for {agent.name} yet.</p>
                <Button variant="outline" size="sm" onClick={onRoutines}>
                  <Plus /> New routine
                </Button>
              </div>
            )}
          </Group>
        </>
      );
    return (
      <>
        <Section title="What it can reach" className="mt-0" />
        <Group>
          <Row lead={<AppWindow />} title="Connected apps" right={<Val kind="next">{`${allowed.length} of ${connected.length}`}</Val>} onClick={() => setPage("apps")} />
          <Row lead={<FolderIcon />} title="Folders" right={<Val kind="next">{folders.length + 1}</Val>} onClick={() => setPage("folders")} />
          <Row lead={<Globe />} title="Browser logins" right={<Val kind="next">{signedIn?.length ?? ""}</Val>} onClick={() => setLogins(true)} />
        </Group>
        <Section title="Permission" />
        <Group>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="w-full text-left">
                <Row lead={<Shield />} title={MODE_COPY[stance].label} sub={MODE_COPY[stance].hint} right={<Val kind="down">Change</Val>} className="hover:bg-s2" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Permission</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={stance} onValueChange={(v) => onChange({ ...agent, permission: v as ApprovalPolicy })}>
                {STANCES.map((m) => (
                  <DropdownMenuRadioItem key={m} value={m}>
                    <span className="flex flex-col">
                      {MODE_COPY[m].label}
                      <span className="text-[11.5px] font-normal text-ink4">{MODE_COPY[m].hint}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Group>
        <AgentSafetyRows agent={agent} onChange={onChange} />
      </>
    );
  })();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showClose={false} className="flex max-h-[calc(100vh-64px)] w-[580px] max-w-[calc(100vw-48px)]! flex-col gap-0 overflow-hidden rounded-(--r4)! border-0 bg-(--sheet) p-0!">
          <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-2">
            <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} size={44} />
            <DialogTitle className="min-w-0 flex-1 truncate text-[16px] leading-[1.3] font-semibold tracking-[-0.015em]">Edit {agent.name}</DialogTitle>
            <DialogDescription className="sr-only">{agent.name}'s settings</DialogDescription>
            <Button variant="solid" className="h-[30px]" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
          {!page && (
            <UnderlineTabs
              className="mx-5 justify-center"
              value={tab}
              onChange={setTab}
              options={[
                { value: "general", label: "General" },
                { value: "routines", label: "Routines" },
                { value: "access", label: "Access" },
              ]}
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">{body}</div>
        </DialogContent>
      </Dialog>
      <LoginsSheet agent={agent} open={logins} onOpenChange={setLogins} />
    </>
  );
}
