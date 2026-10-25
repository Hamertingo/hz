import { ChevronRight, ChevronsUpDown, FileText, Lock } from "lucide-react";
import type { ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { Skeleton, SkeletonRegion, SkeletonRows } from "@/components/ui/skeleton";
import { homeShort } from "@/components/chat/AgentChatHeader";
import { EffortMenu, ModelMenu, modelLabel } from "@/components/profile/ConfigMenus";
import { Blk, Meter, agoLabel, clock } from "@/components/profile/parts";
import type { ProfileProps } from "@/components/profile/AgentProfile";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { openSheet } from "@/lib/chatSheets";
import { CLI } from "@/lib/cli";
import { MODE_COPY } from "@/lib/permission";
import type { Note } from "@/lib/memoryNotes";
import { cn } from "@/lib/utils";
import type { ActivityScan, FeedItem, Model } from "@/types/events";

/// The four stances as meter levels, narrowest first: plan, ask first, auto, full access.
export const LEVEL = { plan: 0, manual: 1, auto: 2, dontAsk: 2, bypassPermissions: 3 } as const;

/// What a feed row opens: a sheet beside the page, the chat, or a note.
export function openFeedItem(
  item: FeedItem,
  agent: ProfileProps["agent"],
  go: { chat: () => void; note: (name: string) => void },
) {
  switch (item.kind) {
    case "pr":
      if (item.url && item.number && item.repo) {
        openSheet({ kind: "pr", number: item.number, repo: item.repo, url: item.url, agentId: agent.id });
      }
      break;
    case "file":
      if (item.path) openSheet({ kind: "file", path: item.path, agentId: agent.id });
      break;
    case "team_ask":
    case "team_message":
      openSheet({
        kind: "exchange",
        from: agent.name,
        to: item.peer ?? "a teammate",
        ask: item.ask ?? "",
        answer: item.answer ?? null,
        ts: new Date(item.atMs).toISOString(),
      });
      break;
    case "team_in":
      openSheet({
        kind: "exchange",
        from: item.peer ?? "a teammate",
        to: agent.name,
        ask: item.ask ?? "",
        answer: null,
        ts: new Date(item.atMs).toISOString(),
      });
      break;
    case "note":
      if (item.note) go.note(item.note);
      break;
    default:
      go.chat();
  }
}

/// The first few sentences of the instructions, without the headings, as the
/// excerpt under "How it works".
export function excerpt(instructions: string, max = 330): string {
  const text = instructions
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.trim() !== "---")
    .join(" ")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

const ROW = "flex items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-[13px] first:border-t-0";
const CLICK = "cursor-pointer transition-colors hover:bg-hover";

function SheetRow({
  label,
  children,
  onClick,
  end,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  end?: ReactNode;
}) {
  const body = (
    <>
      <span className="w-20 flex-none text-ink3">{label}</span>
      <b className="flex min-w-0 items-center gap-[7px] font-medium">{children}</b>
      <span className="ml-auto text-ink4">{end}</span>
    </>
  );
  if (!onClick) return <div className={ROW}>{body}</div>;
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()} className={cn(ROW, CLICK)}>
      {body}
    </div>
  );
}

export default function ProfileOverview({
  agent,
  teammates,
  workspaces,
  workspace,
  working,
  scan,
  notes,
  models,
  glance,
  onTab,
  onBack,
  onChange,
  onOpenAgent,
  onOpenNote,
}: ProfileProps & {
  scan: ActivityScan | null;
  notes: Note[] | null;
  models: Model[] | null;
  glance: { line: string; doing: string | null; atMs: number | null } | undefined;
  onOpenNote: (name: string) => void;
}) {
  const cli = CLI[agent.harness];
  const mode = agent.permission ?? "auto";
  const level = LEVEL[mode];
  const recent = scan
    ? [...scan.feed.filter((f) => f.kind !== "answer" && f.kind !== "team_in").slice(0, 5)]
    : [];
  if (scan && recent.length < 5) {
    recent.push(...scan.feed.filter((f) => f.kind === "answer").slice(0, 5 - recent.length));
    recent.sort((a, b) => b.atMs - a.atMs);
  }
  const startedAgo = scan?.open ? Math.max(0, Math.round((Date.now() - scan.open.sinceMs) / 1000)) : null;
  const lockInfo = () => toast("An agent's CLI and folder are fixed. Make a new agent to change them.");
  const sameWs = (id: string | null) => id === (agent.workspaceId ?? null);

  return (
    <div className="grid grid-cols-[1fr_300px] gap-11 max-[860px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-[34px]">
        <Blk title="Right now">
          <div className="flex items-center gap-3.5 rounded-(--r3) bg-s1 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={30} />
            <div className="min-w-0">
              <div className="text-[13.5px] leading-[1.55] text-ink2">
                {working ? (
                  <span className="truncate">{glance?.doing ?? "Working"}…</span>
                ) : glance?.line ? (
                  <>
                    Last said <b className="font-medium text-ink">“{glance.line}”</b>
                  </>
                ) : (
                  <span>Nothing said yet.</span>
                )}
              </div>
              <div className="mt-[3px] text-xs text-ink3">
                {working && startedAgo !== null
                  ? `Started ${startedAgo < 60 ? `${startedAgo} seconds` : `${Math.round(startedAgo / 60)} min`} ago · asked by ${scan?.open?.by === "you" ? "you" : scan?.open?.by}`
                  : glance?.atMs
                    ? `${agoLabel(glance.atMs)} · in chat with you`
                    : "No conversation yet"}
              </div>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={onBack}>
              Open chat
            </Button>
          </div>
        </Blk>

        <Blk title="Recent work" action="All activity" onAction={() => onTab("activity")}>
          {!scan ? (
            <SkeletonRegion label="Reading the log" className="relative flex flex-col gap-4 pl-[22px]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className={i % 2 ? "h-3 w-48" : "h-3 w-64"} />
                <Skeleton className="h-2.5 w-24" />
              </div>
            ))}
          </SkeletonRegion>
          ) : recent.length === 0 ? (
            <p className="text-[13px] text-ink3">Nothing yet. What {agent.name} does lands here.</p>
          ) : (
            <div className="relative pl-[22px] before:absolute before:top-2 before:bottom-2 before:left-1 before:w-px before:bg-line2">
              {recent.map((item, i) => (
                <button
                  key={`${item.seq}-${item.kind}-${i}`}
                  type="button"
                  onClick={() => openFeedItem(item, agent, { chat: onBack, note: onOpenNote })}
                  className="relative block w-full cursor-pointer rounded-(--r1) pb-[18px] text-left outline-none before:absolute before:top-[5px] before:-left-[22px] before:size-[9px] before:rounded-full before:bg-background before:shadow-[inset_0_0_0_1.5px_var(--ink4)] focus-visible:ring-2 focus-visible:ring-ring/50 data-[hi=true]:before:bg-(--tint) data-[hi=true]:before:shadow-none"
                  data-hi={i === 0}
                >
                  <div className="flex items-baseline gap-2 text-[13px]">
                    {item.title}
                    <span className="ml-auto text-[11.5px] text-ink4">
                      {Date.now() - item.atMs < 86_400_000 ? clock(item.atMs) : agoLabel(item.atMs)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-ink3">{item.sub}</div>
                </button>
              ))}
            </div>
          )}
        </Blk>

        <Blk title={`How ${agent.name} works`} action="Edit instructions" onAction={() => onTab("instructions")}>
          {agent.instructions.trim() ? (
            <div className="border-l-2 border-(--tint) pl-3.5 text-[13.5px] leading-[1.7] text-ink2">
              {excerpt(agent.instructions)}
            </div>
          ) : (
            <p className="text-[13px] text-ink3">No instructions yet. They are the first thing {agent.name} reads.</p>
          )}
        </Blk>
      </div>

      <div className="flex min-w-0 flex-col gap-[34px]">
        <Blk title="Sheet">
          <div className="overflow-hidden rounded-(--r3) shadow-[inset_0_0_0_1px_var(--line)]">
            <SheetRow label="Runs on" onClick={lockInfo} end={<Lock className="size-[11px]" />}>
              {cli?.brand && <BrandMark slug={cli.brand} size={13} bare />}
              {cli?.label ?? agent.harness}
            </SheetRow>
            <ModelMenu agent={agent} models={models} onChange={onChange}>
              <button type="button" className={cn(ROW, CLICK, "w-full text-left")}>
                <span className="w-20 flex-none text-ink3">Model</span>
                <b className="min-w-0 truncate font-medium">{modelLabel(models, agent)}</b>
                <ChevronsUpDown className="ml-auto size-[10px] text-ink4" />
              </button>
            </ModelMenu>
            <EffortMenu agent={agent} models={models} onChange={onChange}>
              <button type="button" className={cn(ROW, CLICK, "w-full text-left")}>
                <span className="w-20 flex-none text-ink3">Effort</span>
                <b className="font-medium capitalize">{agent.effort ?? "Default"}</b>
                <ChevronsUpDown className="ml-auto size-[10px] text-ink4" />
              </button>
            </EffortMenu>
            <SheetRow label="Can do" onClick={() => onTab("access")} end={<ChevronRight className="size-[10px]" />}>
              <Meter level={level} />
              {MODE_COPY[mode].label}
            </SheetRow>
            <SheetRow label="Folder" onClick={lockInfo} end={<Lock className="size-[11px]" />}>
              <span className="truncate font-mono text-xs">{homeShort(agent.projectPath)}</span>
            </SheetRow>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(ROW, CLICK, "w-full text-left")}>
                  <span className="w-20 flex-none text-ink3">Workspace</span>
                  <b className="flex min-w-0 items-center gap-[7px] truncate font-medium">
                    {workspace && <WorkspaceLogo {...workspace} size={16} />}
                    <span className="truncate">{workspace?.name ?? "None"}</span>
                  </b>
                  <ChevronsUpDown className="ml-auto size-[10px] text-ink4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">
                  Move to workspace
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={agent.workspaceId ?? ""}
                  onValueChange={(id) => {
                    if (sameWs(id)) return;
                    const to = workspaces.find((w) => w.id === id);
                    onChange({ ...agent, workspaceId: id });
                    toast(`${agent.name} moved to ${to?.name ?? "another workspace"}`);
                  }}
                >
                  {workspaces.map((w) => (
                    <DropdownMenuRadioItem key={w.id} value={w.id}>
                      <WorkspaceLogo {...w} size={18} />
                      {w.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Blk>

        <Blk title="Knows" action="Open memory" onAction={() => onTab("memory")}>
          {!notes ? (
            <SkeletonRegion label="Reading its notes">
              <SkeletonRows count={3} avatar="none" />
            </SkeletonRegion>
          ) : notes.length === 0 ? (
            <p className="text-[13px] text-ink3">{agent.name} remembers nothing yet.</p>
          ) : (
            <div>
              {notes.slice(0, 4).map((n) => (
                <button
                  key={n.name}
                  type="button"
                  onClick={() => onOpenNote(n.name)}
                  className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line py-2 text-left text-[13px] first:border-t-0"
                >
                  <FileText className="size-[13px] shrink-0 text-ink3" />
                  <span className="truncate">{n.title}</span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-ink4">{agoLabel(n.modifiedMs)}</span>
                </button>
              ))}
            </div>
          )}
        </Blk>

        <Blk title="Works with">
          {teammates.length === 0 ? (
            <p className="text-[13px] text-ink3">No teammates yet. Make another agent and they can work together.</p>
          ) : (
            <div className="flex flex-col gap-px">
              {teammates.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenAgent(m.id)}
                  className="-mx-2 flex cursor-pointer items-center gap-2.5 rounded-(--r2) px-2 py-1.5 text-left text-[13px] hover:bg-hover"
                >
                  <AgentTile id={m.id} kind={m.kind} color={m.color} size={26} />
                  <span>{m.name}</span>
                  <em className="ml-auto truncate text-[11.5px] text-ink4 not-italic">{m.role}</em>
                </button>
              ))}
            </div>
          )}
        </Blk>
      </div>
    </div>
  );
}

