import { BellOff, Check, ChevronsUpDown, Clock, GitPullRequest, Hash, Inbox, Plug, Plus, Search, Settings, User } from "lucide-react";
import { Fragment, memo, useMemo, useState } from "react";

import AgentTile from "@/components/AgentTile";
import MeAvatar from "@/components/MeAvatar";
import NewWorkspaceDialog from "@/components/NewWorkspaceDialog";
import { useResizable } from "@/components/ResizeHandle";
import ShortcutKeys from "@/components/ShortcutKeys";
import { MoveMenu, RowMenu, type Moves } from "@/components/RowMenu";
import { DevBadge, SidebarToggle } from "@/components/SidebarToggle";
import UpdateRow from "@/components/UpdateRow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { useAgentGlances } from "@/hooks/useAgentGlances";
import { DROP_LINE, DragGhost, useDragReorder, type DropResult } from "@/hooks/useDragReorder";
import { setChannelMember, useChannelsReady } from "@/hooks/useChannels";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useInbox } from "@/hooks/useInbox";
import { updateMe, useMe } from "@/hooks/useMe";
import type { ManualCheck } from "@/hooks/useUpdater";
import { saveOrder, useSavedOrder, useWorkspaces } from "@/hooks/useWorkspaces";
import { isUnread } from "@/lib/channels";
import { sidebarTime } from "@/lib/clock";
import { openCount } from "@/lib/inbox";
import { applyOrder, moveBy, moveRelative, readSections, type Section } from "@/lib/order";
import type { ExportFormat } from "@/lib/exportSession";
import { STATUSES, statusMeta } from "@/lib/me";
import { inkTint } from "@/lib/mascots";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import { workspaceLine } from "@/lib/workspace";
import type { Channel, SessionStatus } from "@/types/events";

/// Which of the four places under Jump to is open, for the lit row.
export type SidebarPage = "inbox" | "routines" | "prs" | "plugins" | "channels" | null;

type Props = {
  /// The agents of the workspace on screen, in the order they were made.
  agents: RosterAgent[];
  /// The agent whose chat or composer the main column is showing.
  activeAgentId: string | null;
  page: SidebarPage;
  statusBySession: Record<string, SessionStatus>;
  askingSessions: Set<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenSettings: (tab?: "profile" | "workspace") => void;
  onOpenPalette: () => void;
  onChangeWorkspace: (id: string) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenAgent: (agentId: string) => void;
  onNewAgent: () => void;
  onOpenInbox: () => void;
  onOpenRoutines: () => void;
  onOpenPrs: () => void;
  /// Open pull requests waiting on the reader, drawn as the row's count.
  prNeedsYou?: number;
  onOpenPlugins: () => void;
  onNewChannel: () => void;
  /// The workspace's channels, archived ones included; the list leaves those out.
  channels: Channel[];
  activeChannelId: string | null;
  onOpenChannel: (id: string) => void;
  onFork: (sessionId: string, worktree: boolean) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  onExport: (sessionId: string, format: ExportFormat) => void;
  updateStatus: React.ComponentProps<typeof UpdateRow>["status"];
  updateBlocked: boolean;
  updateManual: ManualCheck;
  onInstallUpdate: () => void;
};

function NavRow({
  icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className="group flex h-[30px] w-full cursor-pointer items-center gap-2.5 rounded-(--r1) px-2.5 text-[13px] text-ink2 transition-colors hover:bg-hover hover:text-ink data-[active]:bg-active data-[active]:text-ink [&_svg]:size-[15px] [&_svg]:text-ink3 data-[active]:[&_svg]:text-ink"
    >
      {icon}
      {label}
      {count ? (
        <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-s3 px-1.5 text-[11px] font-medium text-ink tabular-nums">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SectionTitle({
  children,
  addLabel,
  onAdd,
  dnd,
  drop,
  dragging,
  moves,
}: {
  id: string;
  children: React.ReactNode;
  addLabel: string;
  onAdd: () => void;
  /// Press-and-hold drag handlers: the header is the handle for moving the section.
  dnd: object;
  drop: "before" | "after" | "on" | null;
  dragging: boolean;
  moves: Moves;
}) {
  return (
    <MoveMenu moves={moves} labels={["Move section up", "Move section down"]}>
      <div
        data-drop={drop ?? undefined}
        data-dragging={dragging || undefined}
        {...dnd}
        className={cn(
          "mx-2 mt-5 mb-1 flex cursor-grab items-center rounded-(--r1) px-2.5 text-[11.5px] font-medium text-ink3 active:cursor-grabbing",
          DROP_LINE,
        )}
      >
        {children}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={addLabel}
              onClick={onAdd}
              className="ml-auto grid size-[22px] cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{addLabel}</TooltipContent>
        </Tooltip>
      </div>
    </MoveMenu>
  );
}

/// One agent: its face, name and role, and on the right the chip that matters
/// most (working, needs you), else an unread dot, else when it last spoke. The
/// second line is what it is doing, shimmering, or the last thing it said.
function AgentRow({
  agent,
  active,
  status,
  asking,
  line,
  doing,
  atMs,
  onOpen,
  dnd,
  drop,
  dragging,
}: {
  agent: RosterAgent;
  active: boolean;
  status: SessionStatus | undefined;
  asking: boolean;
  line: string;
  doing: string | null;
  atMs: number | null;
  onOpen: () => void;
  /// The press-and-hold drag handlers and how the row looks mid-drag.
  dnd: object;
  drop: "before" | "after" | "on" | null;
  dragging: boolean;
}) {
  const working = status === "in_progress" && !asking;
  const unread = status === "completed" && !active;
  const live = inkTint(agent.color, 0.3);

  let right: React.ReactNode = (
    <span className="ml-auto text-[11px] text-ink4 tabular-nums">{sidebarTime(atMs)}</span>
  );
  if (working) {
    right = (
      <span
        className="ml-auto inline-flex items-center gap-[5px] rounded-full py-px pr-[7px] pl-1.5 text-[10.5px] leading-4 font-medium before:size-[5px] before:rounded-full before:bg-current"
        style={{ color: inkTint(agent.color, 0.4), background: `${agent.color}29` }}
      >
        Working
      </span>
    );
  } else if (asking) {
    right = (
      <span className="ml-auto inline-flex items-center gap-[5px] rounded-full bg-amber/12 py-px pr-[7px] pl-1.5 text-[10.5px] leading-4 font-medium text-amber before:size-[5px] before:rounded-full before:bg-current">
        Needs you
      </span>
    );
  } else if (unread) {
    right = <span aria-label="Unread" className="ml-auto size-[7px] shrink-0 rounded-full bg-blue" />;
  }

  const second = working && doing ? doing : line;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-active={active || undefined}
      data-drop={drop ?? undefined}
      data-dragging={dragging || undefined}
      {...dnd}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-(--r2) px-2 py-1.5 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 data-[active]:bg-active",
        DROP_LINE,
      )}
    >
      <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-[550] text-ink", unread && "font-semibold")}>{agent.name}</span>
          <span className="truncate text-[11.5px] text-ink3">{agent.role}</span>
          {agent.muted && <BellOff aria-label="Muted" className="size-3 shrink-0 text-ink4" />}
          {right}
        </div>
        <div
          className="mt-px truncate text-xs text-ink3"
          style={working ? { color: live } : undefined}
        >
          {working ? <span className="shimmer-text">{second || "Working…"}</span> : second}
        </div>
      </div>
    </div>
  );
}

/// The left column: workspace, a way to jump anywhere, the few places that are
/// not conversations, channels, the agents of this workspace, and you.
function AgentSidebar({
  agents,
  activeAgentId,
  page,
  statusBySession,
  askingSessions,
  collapsed,
  onToggleCollapsed,
  onOpenSettings,
  onOpenPalette,
  onChangeWorkspace,
  onSelectSession,
  onOpenAgent,
  onNewAgent,
  onOpenInbox,
  onOpenRoutines,
  onOpenPrs,
  prNeedsYou,
  onOpenPlugins,
  onNewChannel,
  channels,
  activeChannelId,
  onOpenChannel,
  onFork,
  onDelete,
  onExport,
  updateStatus,
  updateBlocked,
  updateManual,
  onInstallUpdate,
}: Props) {
  const fullscreen = useFullscreen();
  const { workspaces, active, create } = useWorkspaces();
  const me = useMe();
  const roster = useRoster();
  const [creating, setCreating] = useState(false);
  const { style, handle } = useResizable({
    storageKey: "hz.sidebarWidth",
    initial: 256,
    min: 240,
    edge: "right",
    label: "Resize the sidebar",
    pane: collapsed ? undefined : "sidebar",
  });

  const sessionIds = useMemo(() => agents.flatMap((a) => (a.sessionId ? [a.sessionId] : [])), [agents]);
  const glances = useAgentGlances(sessionIds);

  const working = useMemo(
    () => agents.filter((a) => a.sessionId && statusBySession[a.sessionId] === "in_progress").length,
    [agents, statusBySession],
  );
  const channelOrder = useSavedOrder(active?.id ?? null, "channels");
  const live = useMemo(
    () => applyOrder(channels.filter((c) => !c.archived).sort((a, b) => a.created - b.created), channelOrder),
    [channels, channelOrder],
  );
  const dnd = useDragReorder();
  const channelsReady = useChannelsReady();
  const wsId = active?.id ?? null;
  const agentIds = agents.map((a) => a.id);
  const channelIds = live.map((c) => c.id);

  const sections = readSections(useSavedOrder(wsId, "sections"));
  const sectionMoves = (id: Section): Moves => {
    const i = sections.indexOf(id);
    return {
      up: i > 0 && wsId ? () => void saveOrder(wsId, "sections", moveBy(sections, id, -1)) : undefined,
      down: i < sections.length - 1 && wsId ? () => void saveOrder(wsId, "sections", moveBy(sections, id, 1)) : undefined,
    };
  };
  const sectionProps = (id: Section) => {
    const st = dnd.stateOf("section", id);
    return {
      moves: sectionMoves(id),
      drop: st.drop,
      dragging: st.dragging,
      dnd: dnd.bind({
        kind: "section",
        id,
        accepts: ["section"],
        ghost: <span className="px-1 text-[11.5px] font-medium capitalize text-ink3">{id}</span>,
        onDrop: ({ over }) => {
          if (over && wsId) void saveOrder(wsId, "sections", moveRelative(sections, id, over.id, over.after));
        },
      }),
    };
  };

  const agentMoves = (id: string): Moves => {
    const i = agentIds.indexOf(id);
    return {
      up: i > 0 && wsId ? () => void saveOrder(wsId, "agents", moveBy(agentIds, id, -1)) : undefined,
      down: i < agentIds.length - 1 && wsId ? () => void saveOrder(wsId, "agents", moveBy(agentIds, id, 1)) : undefined,
    };
  };
  const channelMoves = (id: string): Moves => {
    const i = channelIds.indexOf(id);
    return {
      up: i > 0 && wsId ? () => void saveOrder(wsId, "channels", moveBy(channelIds, id, -1)) : undefined,
      down: i < channelIds.length - 1 && wsId ? () => void saveOrder(wsId, "channels", moveBy(channelIds, id, 1)) : undefined,
    };
  };

  /// Released an agent: before or after another agent reorders, on a channel adds it.
  const dropAgent = (agent: RosterAgent, { over }: DropResult) => {
    if (!over || !wsId) return;
    if (over.kind === "agent") {
      void saveOrder(wsId, "agents", moveRelative(agentIds, agent.id, over.id, over.after));
      return;
    }
    const target = live.find((c) => c.id === over.id);
    if (!target || target.members.includes(agent.id)) return;
    void setChannelMember(target.id, agent.id, true)
      .then(() =>
        toast(`${agent.name} added to #${target.name}`, {
          action: { label: "Undo", onClick: () => void setChannelMember(target.id, agent.id, false).catch((e) => toast(String(e))) },
          ms: 6000,
        }),
      )
      .catch((e) => toast(String(e)));
  };
  const inbox = useInbox();
  const needsYou = useMemo(() => openCount(inbox.items, new Set(agents.map((a) => a.id))), [inbox.items, agents]);

  if (collapsed) return null;

  const status = statusMeta(me.status);

  const channelsBlock = (
    <>
        <SectionTitle id="channels" addLabel="New channel" onAdd={onNewChannel} {...sectionProps("channels")}>
          Channels
        </SectionTitle>
        <div className="flex flex-col gap-px px-2">
          {!channelsReady && (
            <SkeletonRegion label="Reading channels" className="flex flex-col gap-px">
              {[28, 20, 24].map((w, i) => (
                <div key={i} className="flex h-[30px] items-center gap-2 px-2.5">
                  <Skeleton className="size-[13px]" />
                  <Skeleton className="h-3" style={{ width: `${w * 4}px` }} />
                </div>
              ))}
            </SkeletonRegion>
          )}
          {channelsReady && live.length === 0 && <p className="px-2.5 py-1 text-[13px] text-ink3">No channels yet.</p>}
          {live.map((c) => {
            const unread = isUnread(c);
            const on = page === "channels" && c.id === activeChannelId;
            const st = dnd.stateOf("channel", c.id);
            // An agent already in the channel is not a target: dropping it does nothing.
            const drop = st.drop === "on" && dnd.drag && c.members.includes(dnd.drag.id) ? null : st.drop;
            return (
              <MoveMenu key={c.id} moves={channelMoves(c.id)}>
              <button
                type="button"
                onClick={() => onOpenChannel(c.id)}
                data-active={on || undefined}
                data-drop={drop ?? undefined}
                data-dragging={st.dragging || undefined}
                {...dnd.bind({
                  kind: "channel",
                  id: c.id,
                  accepts: ["channel"],
                  ghost: (
                    <span className="flex items-center gap-2 text-[13px]">
                      <Hash className="size-[13px] text-ink4" />
                      {c.name}
                    </span>
                  ),
                  onDrop: ({ over }) => {
                    if (over && wsId) void saveOrder(wsId, "channels", moveRelative(channelIds, c.id, over.id, over.after));
                  },
                })}
                className={cn(
                  "flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-(--r1) px-2.5 text-left text-[13px] text-ink2 transition-colors hover:bg-hover hover:text-ink data-[active]:bg-active data-[active]:text-ink",
                  DROP_LINE,
                )}
              >
                <Hash className="size-[13px] shrink-0 text-ink4" />
                <span className={cn("min-w-0 flex-1 truncate", unread && "font-semibold text-ink")}>{c.name}</span>
                {c.muted && <BellOff aria-label="Muted" className="size-3 shrink-0 text-ink4" />}
                <span className="flex shrink-0">
                  {c.members
                    .slice(0, 3)
                    .flatMap((id) => roster.agents.filter((a) => a.id === id))
                    .map((a, i) => (
                      <span key={a.id} className={cn("rounded-[5px] shadow-[0_0_0_2px_var(--side)]", i > 0 && "-ml-[5px]")}>
                        <AgentTile id={a.id} kind={a.kind} color={a.color} size={16} />
                      </span>
                    ))}
                </span>
              </button>
              </MoveMenu>
            );
          })}
        </div>
    </>
  );
  const agentsBlock = (
    <>
        <SectionTitle id="agents" addLabel="Create agent" onAdd={onNewAgent} {...sectionProps("agents")}>
          Agents
        </SectionTitle>
        <div className="flex flex-col gap-px px-2">
          {agents.length === 0 && <p className="px-2.5 py-1 text-[13px] text-ink3">No agents in this workspace yet.</p>}
          {agents.map((agent) => {
            const sessionId = agent.sessionId;
            const glance = sessionId ? glances[sessionId] : undefined;
            const st = dnd.stateOf("agent", agent.id);
            const bound = dnd.bind({
              kind: "agent",
              id: agent.id,
              accepts: ["agent", "channel"],
              ghost: (
                <span className="flex items-center gap-2.5">
                  <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={28} />
                  <span className="truncate text-[13px] font-[550]">{agent.name}</span>
                </span>
              ),
              onDrop: (r) => dropAgent(agent, r),
            });
            const row = (
              <AgentRow
                agent={agent}
                active={agent.id === activeAgentId}
                status={sessionId ? statusBySession[sessionId] : undefined}
                asking={sessionId ? askingSessions.has(sessionId) : false}
                line={glance?.line ?? ""}
                doing={glance?.doing ?? null}
                atMs={glance?.atMs ?? null}
                onOpen={() => (sessionId ? onSelectSession(sessionId) : onOpenAgent(agent.id))}
                dnd={bound}
                drop={st.drop}
                dragging={st.dragging}
              />
            );
            if (!sessionId) {
              return (
                <MoveMenu key={agent.id} moves={agentMoves(agent.id)}>
                  {row}
                </MoveMenu>
              );
            }

            return (
              <RowMenu
                key={agent.id}
                onFork={(worktree) => void onFork(sessionId, worktree)}
                forkDisabled={statusBySession[sessionId] === "in_progress"}
                onDelete={() => void onDelete(sessionId)}
                onExport={(format) => onExport(sessionId, format)}
                moves={agentMoves(agent.id)}
              >
                {row}
              </RowMenu>
            );
          })}
        </div>
    </>
  );


  return (
    <aside
      className="relative flex shrink-0 select-none flex-col border-r border-line bg-[color-mix(in_oklab,var(--side)_var(--vibrancy-alpha,100%),transparent)]"
      style={style}
    >
      {handle}

      <div
        data-drag-left=""
        data-tauri-drag-region="deep"
        className={cn(
          "flex h-(--titlebar-h) shrink-0 items-center px-2",
          fullscreen ? "justify-start" : "justify-end",
        )}
      >
        <SidebarToggle onToggle={onToggleCollapsed} />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="mx-2 flex cursor-pointer items-center gap-2.5 rounded-(--r2) px-2 py-[7px] text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-hover"
          >
            {active && <WorkspaceLogo name={active.name} mark={active.mark} color={active.color} logo={active.logo} size={30} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                {active?.name ?? "Workspace"}
              </span>
              <span className="mt-px block truncate text-[11.5px] text-ink3">{workspaceLine(agents.length, working)}</span>
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-ink4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-[260px]">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => {
            const count = roster.agents.filter((a) => a.workspaceId === w.id).length;
            return (
              <DropdownMenuItem key={w.id} onSelect={() => onChangeWorkspace(w.id)} className="gap-2.5">
                <WorkspaceLogo name={w.name} mark={w.mark} color={w.color} logo={w.logo} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{w.name}</span>
                  <span className="block text-[11.5px] text-ink3">
                    {count} {count === 1 ? "agent" : "agents"}
                  </span>
                </span>
                {w.id === active?.id && <Check className="size-3.5 text-ink2" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            Create workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenSettings("workspace")}>
            <Settings />
            Workspace settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={onOpenPalette}
        className="mx-3 mt-2 mb-1.5 flex h-8 cursor-pointer items-center gap-2 rounded-(--r2) bg-s2 px-2.5 text-[13px] text-ink3 transition-colors hover:bg-s3 hover:text-ink2"
      >
        <Search className="size-[13px]" />
        Jump to…
        <ShortcutKeys ids={["palette.open"]} className="ml-auto" />
      </button>

      <nav className="flex flex-col gap-px px-2 pt-1">
        <NavRow icon={<Inbox />} label="Inbox" active={page === "inbox"} count={needsYou} onClick={onOpenInbox} />
        <NavRow icon={<Clock />} label="Routines" active={page === "routines"} onClick={onOpenRoutines} />
        <NavRow icon={<GitPullRequest />} label="Pull requests" active={page === "prs"} count={prNeedsYou} onClick={onOpenPrs} />
        <NavRow icon={<Plug />} label="Plugins" active={page === "plugins"} onClick={onOpenPlugins} />
      </nav>

      <div className="scrollbar-overlay flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {sections.map((section) =>
          section === "channels" ? (
            <Fragment key="channels">{channelsBlock}</Fragment>
          ) : (
            <Fragment key="agents">{agentsBlock}</Fragment>
          ),
        )}
      </div>

      <UpdateRow
        status={updateStatus}
        blocked={updateBlocked}
        manual={updateManual}
        onInstall={onInstallUpdate}
      />

      <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Set your status"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-(--r2) text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <MeAvatar me={me} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-[550] text-ink">{me.name}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-ink3">
                  <i className={cn("size-1.5 rounded-full", status.dot)} />
                  {status.label}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-auto min-w-[240px]">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => updateMe({ status: s.id })}>
                <i className={cn("size-2 rounded-full", s.dot)} />
                <span className="min-w-0 flex-1">
                  <span className="block">{s.label}</span>
                  <span className="block text-[11.5px] text-ink3">{s.hint}</span>
                </span>
                {s.id === me.status && <Check className="size-3.5 text-ink2" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onOpenSettings("profile")}>
              <User />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenSettings()}>
              <Settings />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => onOpenSettings()} className="size-[30px] text-ink3">
              <Settings className="size-[15px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            Settings <ShortcutKeys ids={["settings"]} />
          </TooltipContent>
        </Tooltip>
      </div>

      <DragGhost kinds={["agent", "channel"]} />

      {import.meta.env.DEV && <DevBadge />}

      <NewWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(name, color, context) => {
          void create(name, color, context).then((made) => {
            if (!made) return;
            toast(`${made.name} is ready. Make its first agent.`, {
              action: { label: "Create agent", onClick: onNewAgent },
              ms: 6000,
            });
          });
        }}
      />
    </aside>
  );
}

export default memo(AgentSidebar);
