import { Check, ChevronDown, Clock, Folder as FolderIcon, GitPullRequest, Hand, Plug, Plus, Search, Settings, User, Users } from "lucide-react";
import { memo, useMemo, useState } from "react";

import AgentTile from "@/components/AgentTile";
import InboxPopover from "@/components/inbox/InboxPopover";
import MeAvatar from "@/components/MeAvatar";
import NewWorkspaceDialog from "@/components/NewWorkspaceDialog";
import { useResizable } from "@/components/ResizeHandle";
import { RowMenu } from "@/components/RowMenu";
import ShortcutKeys from "@/components/ShortcutKeys";
import { DevBadge, SidebarToggle } from "@/components/SidebarToggle";
import { ChannelTile, ConvRow, PinTile, type Conv } from "@/components/sidebar/ConvRow";
import UpdateRow from "@/components/UpdateRow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fieldClassName } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { useAgentGlances } from "@/hooks/useAgentGlances";
import { archiveChannel, setChannelMember, updateChannel, useChannelsReady } from "@/hooks/useChannels";
import { DragGhost, useDragReorder, type DropResult } from "@/hooks/useDragReorder";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useInbox } from "@/hooks/useInbox";
import { updateMe, useMe } from "@/hooks/useMe";
import { usePlugins } from "@/hooks/usePlugins";
import type { ManualCheck } from "@/hooks/useUpdater";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { isUnread } from "@/lib/channels";
import { sidebarTime } from "@/lib/clock";
import type { ExportFormat } from "@/lib/exportSession";
import { openCount } from "@/lib/inbox";
import { STATUSES, statusMeta } from "@/lib/me";
import { moveRelative } from "@/lib/order";
import { rosterPatch, rosterRemove, useRoster, type RosterAgent } from "@/lib/roster";
import {
  MAX_PINS,
  arrangeRows,
  channelRow,
  poseFor,
  updateSide,
  useSide,
  withFolderMove,
  withHidden,
  withNewFolder,
  withPin,
  withRead,
  withoutRow,
} from "@/lib/sidebar";
import { teamActivity } from "@/lib/teamTalk";
import { cn } from "@/lib/utils";
import { useTeamStatus } from "@/hooks/useTeamTalk";
import type { Channel, SessionStatus } from "@/types/events";

/// Which page is open beside the chat, for the lit button.
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
  /// Opens an agent's profile. Falls back to its chat when the shell does not pass it.
  onEditAgent?: (agentId: string) => void;
  /// A call with an agent and its versions: shown in the row menu only where the shell wires them.
  onCallAgent?: (agentId: string) => void;
  onAgentVersions?: (agentId: string) => void;
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

const MENU_ITEM = "h-[31px] gap-2.5 rounded-(--r1) px-[9px] py-0 text-[13px] focus:bg-active";

type Filter = "all" | "unread" | "channels" | "agents";
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "channels", label: "Channels" },
  { key: "agents", label: "Agents" },
];

function IconBtn({
  label,
  hint,
  on,
  badge,
  onClick,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  on?: boolean;
  badge?: number;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          data-on={on || undefined}
          className="relative grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-(--r1) text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 data-[on]:bg-s3 data-[on]:text-ink aria-expanded:bg-s3 aria-expanded:text-ink [&_svg]:size-[16px]"
        >
          {children}
          {badge ? (
            <span className="side-dot absolute top-px right-px grid h-[15px] min-w-[15px] place-items-center rounded-full bg-red px-1 text-[9.5px] font-semibold text-white shadow-[0_0_0_2px_var(--side)]">
              {badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

/// The connected-apps button, apart so the plugin read re-renders only itself.
function PlugButton({ workspaceId, onClick }: { workspaceId: string | null; onClick: () => void }) {
  const { plugins } = usePlugins(workspaceId, true);
  const on = plugins.filter((p) => p.status === "connected").length;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Connected apps"
          onClick={onClick}
          className="relative grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-(--r1) text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plug className="size-[16px]" />
          {on > 0 && (
            <span className="absolute top-px right-px grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] px-1 text-[9.5px] font-semibold text-ink2 shadow-[0_0_0_2px_var(--side)]">
              {on}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>Connect apps</TooltipContent>
    </Tooltip>
  );
}

function NewFolderDialog({ open, onCancel, onCreate }: { open: boolean; onCancel: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[420px]" aria-describedby={undefined}>
        <DialogTitle className="text-[15px] font-semibold">New folder</DialogTitle>
        <div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Launch week"
            aria-label="Folder name"
            className={cn(fieldClassName, "h-[34px]")}
          />
          <p className="mt-2 text-xs leading-[1.55] text-ink3">Folders group conversations in the sidebar. Collapse one to keep it quiet.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="solid" disabled={!trimmed} onClick={submit}>
            Create folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/// The left column: a way to jump anywhere and start something, your pinned conversations as faces, every
/// agent and channel in one list you can filter, fold into folders and drag into order, and you at the foot.
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
  onEditAgent,
  onCallAgent,
  onAgentVersions,
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
  const [inboxOpen, setInboxOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  // undefined: closed. null: make a folder and leave it empty. A row: make it and file that row in it.
  const [folderFor, setFolderFor] = useState<string | null | undefined>(undefined);
  const { style, handle } = useResizable({
    storageKey: "hz.sidebarWidth",
    initial: 300,
    min: 260,
    edge: "right",
    label: "Resize the sidebar",
    pane: collapsed ? undefined : "sidebar",
  });

  const wsId = active?.id ?? null;
  const side = useSide(wsId);
  const sessionIds = useMemo(() => agents.flatMap((a) => (a.sessionId ? [a.sessionId] : [])), [agents]);
  const glances = useAgentGlances(sessionIds);
  const teamStatus = useTeamStatus();
  const dnd = useDragReorder();
  const channelsReady = useChannelsReady();
  const inbox = useInbox();
  const needsYou = useMemo(() => openCount(inbox.items, new Set(agents.map((a) => a.id))), [inbox.items, agents]);

  const convs = useMemo<Conv[]>(() => {
    const now = Date.now();
    const out: Conv[] = [];
    for (const a of agents) {
      const sid = a.sessionId;
      const glance = sid ? glances[sid] : undefined;
      const status = sid ? statusBySession[sid] : undefined;
      const asking = sid ? askingSessions.has(sid) : false;
      const ownChat = status === "in_progress" && !asking;
      // Its own chat first; otherwise what it is doing for a teammate.
      const team = ownChat ? null : teamActivity(teamStatus, a.id);
      const who = team ? team.who.map((id) => roster.agents.find((x) => x.id === id)?.name ?? "a teammate").join(", ") : undefined;
      const working = ownChat || team?.activity === "workingFor";
      const token = String(glance?.atMs ?? 0);
      const finished = status === "completed" && a.id !== activeAgentId && side.seen[a.id] !== token;
      const unread = finished || side.unread.includes(a.id);
      out.push({
        row: a.id,
        kind: "agent",
        id: a.id,
        name: a.name,
        role: a.role,
        color: a.color,
        agent: a,
        pose: poseFor(working, glance?.atMs ?? null, now),
        at: glance?.atMs ?? 0,
        time: sidebarTime(glance?.atMs ?? null, now),
        line: (unread && glance?.digest) || glance?.line || "",
        working,
        activity: ownChat ? (glance?.activity ?? "thinking") : working ? "workingFor" : null,
        who,
        waitingFor: team?.activity === "waitingFor",
        asking,
        unread,
        token,
        muted: a.muted === true,
      });
    }
    for (const c of channels) {
      if (c.archived) continue;
      const row = channelRow(c.id);
      const lead = roster.agents.find((a) => a.id === c.lead);
      const token = String(c.lastAgentSeq);
      out.push({
        row,
        kind: "channel",
        id: c.id,
        name: c.name,
        role: `${c.members.length} ${c.members.length === 1 ? "agent" : "agents"}`,
        color: lead?.color ?? "#8d8d88",
        lead,
        pose: "idle",
        at: c.lastTs,
        time: sidebarTime(c.lastTs || null, now),
        line: c.purpose,
        working: false,
        asking: false,
        unread: (isUnread(c) && side.seen[row] !== token) || side.unread.includes(row),
        token,
        muted: c.muted,
      });
    }
    return out;
  }, [agents, channels, glances, statusBySession, askingSessions, activeAgentId, roster.agents, side.seen, side.unread, teamStatus]);

  const byRow = useMemo(() => new Map(convs.map((c) => [c.row, c])), [convs]);
  const unreadCount = convs.filter((c) => c.unread && !side.hidden.includes(c.row)).length;

  const flagged = agents.filter((a) => a.pinned).map((a) => a.id);
  const pins = [...side.pins, ...flagged.filter((id) => !side.pins.includes(id))].filter((r) => byRow.has(r)).slice(0, MAX_PINS);

  const hiddenCount = convs.filter((c) => side.hidden.includes(c.row)).length;
  const ordered = useMemo(() => {
    const shown = convs.filter((c) => !pins.includes(c.row) && (showHidden || !side.hidden.includes(c.row)));
    return arrangeRows(shown.map((c) => ({ id: c.row, at: c.at })), side.order);
    // `pins` is rebuilt every render from the two inputs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs, side.order, side.hidden, side.pins, showHidden, flagged.join(",")]);
  const passes = (c: Conv) =>
    filter === "unread" ? c.unread : filter === "channels" ? c.kind === "channel" : filter === "agents" ? c.kind === "agent" : true;
  const shown = ordered.map((r) => byRow.get(r)).filter((c): c is Conv => !!c && passes(c));
  const folderOf = new Map(side.folders.flatMap((f) => f.ids.map((r) => [r, f.id] as const)));
  const loose = shown.filter((c) => !folderOf.has(c.row));

  if (collapsed) return null;

  const status = statusMeta(me.status);
  const wsName = active?.name ?? "Workspace";
  const edit = <T,>(f: (s: typeof side) => typeof side, then?: T) => {
    if (wsId) updateSide(wsId, f);
    return then;
  };

  const openConv = (c: Conv) => {
    if (sel.size > 0) {
      setSel((prev) => {
        const next = new Set(prev);
        if (!next.delete(c.row)) next.add(c.row);
        return next;
      });
      return;
    }
    if (c.kind === "channel") return onOpenChannel(c.id);
    const a = c.agent!;
    if (a.sessionId) onSelectSession(a.sessionId);
    else onOpenAgent(a.id);
  };

  const isActive = (c: Conv) => (c.kind === "channel" ? page === "channels" && c.id === activeChannelId : c.id === activeAgentId && page !== "channels");

  const pinConv = (c: Conv) => {
    const pinned = pins.includes(c.row);
    if (!pinned && pins.length >= MAX_PINS) return void toast("Four pins at most. Unpin one first.", { ms: 2200 });
    edit((s) => withPin(s, c.row, !pinned));
    if (c.agent) rosterPatch(c.id, { pinned: !pinned });
  };

  const hide = (rows: string[]) => {
    edit((s) => withHidden(s, rows, true));
    setSel(new Set());
    toast(rows.length === 1 ? "Hidden from the sidebar" : `${rows.length} hidden`, {
      ms: 6000,
      action: { label: "Undo", onClick: () => edit((s) => withHidden(s, rows, false)) },
    });
  };

  const toggleRead = (c: Conv) => edit((s) => withRead(s, c.row, c.unread, c.token));

  const makeFolder = (name: string) => {
    const id = crypto.randomUUID();
    const row = folderFor;
    edit((s) => {
      const next = withNewFolder(s, id, name);
      return row ? withFolderMove(next, row, id) : next;
    });
    setFolderFor(undefined);
    toast(row ? `Moved to ${name}` : `${name} created. Move conversations into it.`, { ms: 2400 });
  };

  const copyId = (c: Conv) => {
    void navigator.clipboard?.writeText(c.id).catch(() => {});
    toast("ID copied", { ms: 1400 });
  };

  const remove = (c: Conv) => {
    edit((s) => withoutRow(s, c.row));
    if (c.kind === "channel") return void archiveChannel(c.id, true).catch((e) => toast(String(e)));
    // The agent goes whether or not its session still exists: an index that lost
    // the session left an agent nothing else could remove.
    if (c.agent?.sessionId) void onDelete(c.agent.sessionId);
    rosterRemove(c.id);
  };

  /// Released an agent: before or after another row reorders, on a channel adds it.
  const dropAgent = (agent: RosterAgent, { over }: DropResult) => {
    if (!over) return;
    if (over.kind === "channel") {
      const target = channels.find((c) => c.id === over.id);
      if (!target || target.members.includes(agent.id)) return;
      void setChannelMember(target.id, agent.id, true)
        .then(() =>
          toast(`${agent.name} added to #${target.name}`, {
            action: { label: "Undo", onClick: () => void setChannelMember(target.id, agent.id, false).catch((e) => toast(String(e))) },
            ms: 6000,
          }),
        )
        .catch((e) => toast(String(e)));
      return;
    }
    reorder(agent.id, over.id, over.after);
  };

  const reorder = (row: string, target: string, after: boolean) =>
    edit((s) => ({ ...s, order: moveRelative(ordered, row, target, after) }));

  const menu = (c: Conv, row: React.ReactNode) => {
    const a = c.agent;
    const sid = a?.sessionId ?? null;
    return (
      <RowMenu
        key={c.row}
        pinned={pins.includes(c.row)}
        onPin={() => pinConv(c)}
        onSelect={() => setSel((prev) => new Set(prev).add(c.row))}
        folders={side.folders.map((f) => ({ id: f.id, name: f.name }))}
        inFolder={folderOf.get(c.row) ?? null}
        onFolder={(id) => edit((s) => withFolderMove(s, c.row, id))}
        onNewFolder={() => setFolderFor(c.row)}
        unread={c.unread}
        onToggleRead={() => toggleRead(c)}
        editLabel={a ? `Edit ${a.name}…` : "Edit channel…"}
        onEdit={a ? () => (onEditAgent ?? onOpenAgent)(a.id) : () => onOpenChannel(c.id)}
        callLabel={a && onCallAgent ? `Call ${a.name}` : undefined}
        onCall={a && onCallAgent ? () => onCallAgent(a.id) : undefined}
        onVersions={a && onAgentVersions ? () => onAgentVersions(a.id) : undefined}
        onCopyId={() => copyId(c)}
        workspaces={a ? workspaces.map((w) => ({ id: w.id, name: w.name })) : undefined}
        workspaceId={wsId}
        onMoveWorkspace={
          a
            ? (id) => {
                rosterPatch(a.id, { workspaceId: id });
                edit((s) => withoutRow(s, c.row));
                toast(`Moved to ${workspaces.find((w) => w.id === id)?.name ?? "the workspace"}`, {
                  ms: 6000,
                  action: { label: "Undo", onClick: () => rosterPatch(a.id, { workspaceId: wsId }) },
                });
              }
            : undefined
        }
        muted={c.muted}
        onMute={() => {
          if (a) rosterPatch(a.id, { muted: !a.muted });
          else void updateChannel(c.id, { muted: !c.muted }).catch((e) => toast(String(e)));
          toast(c.muted ? "Unmuted" : "Muted. It still works, quietly.", { ms: 1600 });
        }}
        onExport={sid ? (format) => onExport(sid, format) : undefined}
        onFork={sid ? (worktree) => void onFork(sid, worktree) : undefined}
        forkDisabled={sid ? statusBySession[sid] === "in_progress" : undefined}
        onHide={() => hide([c.row])}
        onDelete={() => remove(c)}
      >
        {row}
      </RowMenu>
    );
  };

  let n = 0;
  const rowOf = (c: Conv) => {
    const st = dnd.stateOf(c.kind, c.id);
    const bound = dnd.bind({
      kind: c.kind,
      id: c.id,
      accepts: c.kind === "agent" ? ["agent", "channel"] : ["channel"],
      ghost: (
        <span className="flex items-center gap-2.5">
          {c.agent ? <AgentTile id={c.agent.id} kind={c.agent.kind} color={c.agent.color} shape={c.agent.shape} look={c.agent.look} photo={c.agent.photo} size={28} /> : <ChannelTile color={c.color} size={28} />}
          <span className="truncate text-[13px] font-medium">{c.name}</span>
        </span>
      ),
      onDrop: (r) => {
        if (c.agent) return dropAgent(c.agent, r);
        if (r.over) reorder(c.row, channelRow(r.over.id), r.over.after);
      },
    });
    // An agent already in the channel is not a target: dropping it does nothing.
    const drag = dnd.drag;
    const inChannel = c.kind === "channel" && st.drop === "on" && drag?.kind === "agent" && channels.find((x) => x.id === c.id)?.members.includes(drag.id);
    return menu(
      c,
      <ConvRow
        c={c}
        active={isActive(c)}
        selected={sel.has(c.row)}
        index={n++}
        onOpen={() => openConv(c)}
        dnd={bound}
        drop={inChannel ? null : st.drop}
        dragging={st.dragging}
      />,
    );
  };

  const pinTile = (c: Conv, count: number) => menu(c, <PinTile c={c} active={isActive(c)} count={count} onOpen={() => openConv(c)} />);

  return (
    <aside
      className="relative flex shrink-0 select-none flex-col border-r border-line bg-[color-mix(in_oklab,var(--side)_var(--vibrancy-alpha,100%),transparent)]"
      style={style}
    >
      {handle}

      <div
        data-drag-left=""
        data-tauri-drag-region="deep"
        className={cn("flex h-(--titlebar-h) shrink-0 items-center gap-0.5 px-2", fullscreen ? "justify-start" : "justify-end")}
      >
        <Popover open={inboxOpen} onOpenChange={setInboxOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Waiting for you"
              data-on={page === "inbox" || undefined}
              className="relative grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-(--r1) text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 data-[on]:bg-s3 data-[on]:text-ink aria-expanded:bg-s3 aria-expanded:text-ink"
            >
              <Hand className="size-[16px]" />
              {needsYou > 0 && (
                <span className="side-dot absolute top-px right-px grid h-[15px] min-w-[15px] place-items-center rounded-full bg-red px-1 text-[9.5px] font-semibold text-white shadow-[0_0_0_2px_var(--side)]">
                  {needsYou}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-auto p-1.5">
            <InboxPopover agents={agents} onOpenAgent={onOpenAgent} onOpenPage={onOpenInbox} onClose={() => setInboxOpen(false)} />
          </PopoverContent>
        </Popover>
        <IconBtn label="Search" hint={<ShortcutKeys ids={["palette.open"]} />} onClick={onOpenPalette}>
          <Search />
        </IconBtn>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="New"
                  className="relative grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-(--r1) text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-s3 aria-expanded:text-ink"
                >
                  <Plus className="size-[16px]" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>New</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto min-w-[210px]">
            <DropdownMenuItem onSelect={onNewAgent}>
              <Plus />
              New agent
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onNewChannel}>
              <Users />
              New channel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFolderFor(null)}>
              <FolderIcon />
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenRoutines} data-active={page === "routines" || undefined}>
              <Clock />
              Routines
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenPrs}>
              <GitPullRequest />
              Pull requests
              {prNeedsYou ? <span className="ml-auto text-ink3 tabular-nums">{prNeedsYou}</span> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenPlugins}>
              <Plug />
              Connect apps
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SidebarToggle onToggle={onToggleCollapsed} />
      </div>

      {pins.length > 0 && (
        <div
          className="relative grid gap-1 px-2.5 pt-0.5 pb-2.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(pins.length, 4))}, minmax(0, 1fr))` }}
        >
          {pins.map((r) => {
            const c = byRow.get(r);
            return c ? <span key={r} className="contents">{pinTile(c, pins.length)}</span> : null;
          })}
        </div>
      )}

      <div className="flex justify-center gap-1 px-2.5 pb-2" role="tablist" aria-label="Show">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          const count = f.key === "unread" ? unreadCount : 0;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                on ? "bg-ink text-background" : "bg-s3 text-ink hover:bg-line3",
              )}
            >
              {f.label}
              {count > 0 && <i className={cn("text-[11px] font-medium not-italic", on ? "text-background/60" : "text-ink3")}>{count}</i>}
            </button>
          );
        })}
      </div>

      {sel.size > 0 && (
        <div className="animate-pop-in mx-2.5 mb-2 flex items-center gap-1 rounded-(--r2) bg-s2 py-[5px] pr-[5px] pl-3 text-[12.5px] font-medium">
          <span>{sel.size} selected</span>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              edit((s) => [...sel].reduce((acc, r) => withRead(acc, r, true, byRow.get(r)?.token ?? ""), s));
              setSel(new Set());
              toast("Marked as read", { ms: 1400 });
            }}
          >
            Read
          </Button>
          <Button variant="ghost" size="sm" onClick={() => hide([...sel])}>
            Hide
          </Button>
          <Button variant="solid" size="sm" onClick={() => setSel(new Set())}>
            Done
          </Button>
        </div>
      )}

      <div className="scrollbar-overlay flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 [scrollbar-gutter:auto]!">
        <div key={`${wsId}:${filter}`} className="side-rise flex flex-col">
          {!channelsReady && convs.length === 0 && <p className="px-2.5 py-3 text-[13px] text-ink3">Reading…</p>}
          {loose.map(rowOf)}
          {side.folders.map((f) => {
            const its = shown.filter((c) => folderOf.get(c.row) === f.id);
            if (its.length === 0 && filter !== "all") return null;
            const shut = side.shut.includes(f.id);
            return (
              <div key={f.id} className="contents">
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() => edit((s) => ({ ...s, shut: shut ? s.shut.filter((x) => x !== f.id) : [...s.shut, f.id] }))}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 pt-3 pb-1 text-[11.5px] font-medium text-ink3 transition-colors outline-none hover:text-ink2 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <ChevronDown className={cn("size-3 transition-transform duration-200", shut && "-rotate-90")} />
                  {f.name}
                  <i className="ml-auto pr-1 text-ink4 not-italic">{its.length}</i>
                </button>
                {!shut && its.map(rowOf)}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && convs.length > 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-7 text-center text-[12.5px] text-ink3">
            Nothing here.
            <button type="button" onClick={() => setFilter("all")} className="cursor-pointer rounded-md px-2 py-[3px] font-medium text-ink2 hover:bg-s2 hover:text-ink">
              Show everything
            </button>
          </div>
        )}
        {convs.length === 0 && channelsReady && <p className="px-2.5 py-3 text-[13px] text-ink3">No agents in this workspace yet.</p>}
        {hiddenCount > 0 && (
          <div className="py-2 text-center">
            <button type="button" onClick={() => setShowHidden((v) => !v)} className="cursor-pointer rounded-md px-2 py-[3px] text-[12.5px] font-medium text-ink2 hover:bg-s2 hover:text-ink">
              {showHidden ? "Hide the hidden again" : `Show ${hiddenCount} hidden`}
            </button>
          </div>
        )}
      </div>

      <UpdateRow status={updateStatus} blocked={updateBlocked} manual={updateManual} onInstall={onInstallUpdate} />

      <div className="flex items-center gap-1 border-t border-line px-2 pt-2 pb-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Your menu"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-[9px] rounded-(--r2) px-1.5 py-[5px] text-left outline-none transition-colors hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-s2"
            >
              <span className="relative flex shrink-0">
                <MeAvatar me={me} size={30} />
                <i className={cn("absolute -right-px -bottom-px size-[9px] rounded-full shadow-[0_0_0_2px_var(--side)]", status.dot)} />
              </span>
              <span className="min-w-0">
                <b className="block truncate text-[12.5px] leading-[1.3] font-medium text-ink">{me.name}</b>
                <span className="flex items-center gap-1 text-[11.5px] text-ink3">
                  <span className="truncate">{wsName}</span>
                  <ChevronDown className="size-[11px] shrink-0" />
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-auto min-w-[211px]">
            {workspaces.map((w, i) => (
              <DropdownMenuItem key={w.id} onSelect={() => onChangeWorkspace(w.id)} className={MENU_ITEM}>
                <WorkspaceLogo name={w.name} mark={w.mark} color={w.color} logo={w.logo} size={20} />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {i < 9 && <span className="pl-[18px] text-xs text-ink3">{"⌘"}{i + 1}</span>}
                {w.id === wsId && <Check className="ml-3.5 size-[15px] text-ink!" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => setCreating(true)} className={MENU_ITEM}>
              <Plus className="size-[15px] text-ink3" />
              New workspace…
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2 my-1 bg-line" />
            <DropdownMenuLabel className="px-[9px] pt-1.5 pb-[3px] text-[11.5px] font-medium text-ink3">Status</DropdownMenuLabel>
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => updateMe({ status: s.id })} className={MENU_ITEM}>
                <i className={cn("mx-1.5 size-2 rounded-full", s.dot)} />
                <span className="min-w-0 flex-1">{s.label}</span>
                {s.id === me.status && <Check className="size-[15px] text-ink!" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="mx-2 my-1 bg-line" />
            <DropdownMenuItem onSelect={() => onOpenSettings("profile")} className={MENU_ITEM}>
              <User className="size-[15px] text-ink3" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenSettings()} className={MENU_ITEM}>
              <Settings className="size-[15px] text-ink3" />
              Settings
              <span className="ml-auto pl-[18px] text-xs text-ink3">{"⌘"},</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PlugButton workspaceId={wsId} onClick={onOpenPlugins} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => onOpenSettings()}
              className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-(--r1) text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Settings className="size-[16px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            Settings <ShortcutKeys ids={["settings"]} />
          </TooltipContent>
        </Tooltip>
      </div>

      <DragGhost kinds={["agent", "channel"]} />

      {import.meta.env.DEV && <DevBadge />}

      <NewFolderDialog open={folderFor !== undefined} onCancel={() => setFolderFor(undefined)} onCreate={makeFolder} />

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
