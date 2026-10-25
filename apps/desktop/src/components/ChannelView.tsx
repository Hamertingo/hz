import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { BellOff, Download, Hash, Pencil, Bell, PanelRight, Trash2, Users, MoreHorizontal, Square, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import ChannelAbout from "@/components/channel/ChannelAbout";
import { InlineApproval, MessageRow, NoteRow, Rule, type Cast } from "@/components/channel/ChannelRows";
import MembersSheet from "@/components/channel/MembersSheet";
import TaskSheet from "@/components/channel/TaskSheet";
import ChatInput from "@/components/ChatInput";
import ReplyBar from "@/components/composer/ReplyBar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  archiveChannel,
  exportChannel,
  markChannelRead,
  postToChannel,
  retryChannel,
  reactInChannel,
  setChannelMember,
  stopChannel,
  updateChannel,
  useChannel,
} from "@/hooks/useChannels";
import { readDraft, useDraft, writeDraft } from "@/hooks/useDraft";
import { resolveInboxItem, useInbox } from "@/hooks/useInbox";
import { useMe } from "@/hooks/useMe";
import { isFailureNote } from "@/lib/channelWorking";
import { addressChips, composerHint, exportName, feedRows } from "@/lib/channels";
import { cancelReply, replyFor, startReply, useReplyDraft } from "@/lib/replyDraft";
import { quoteLine } from "@/lib/reply";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Attachment, Channel, InboxItem, Task } from "@/types/events";

/// The chat's own key for a channel's draft and reply, so neither can collide with
/// a session id.
const draftKey = (id: string) => `channel:${id}`;

/// One chip per person the draft names; someone outside the channel says so,
/// because naming them does not bring them in.
function MentionChips({
  draftId,
  everyone,
  members,
  lead,
}: {
  draftId: string;
  everyone: RosterAgent[];
  members: string[];
  lead: RosterAgent | undefined;
}) {
  const [text] = useDraft(draftId);
  const chips = addressChips(text, everyone, members);
  if (chips.length === 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-s3 px-2.5 py-[3px] text-xs text-ink3">
        @ {lead ? `${lead.name} leads` : "pick who answers"}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {chips.map(({ agent, inChannel }) => (
        <span
          key={agent.id}
          className={cn(
            "flex h-[26px] items-center gap-1.5 rounded-full bg-s3 py-0 pr-2.5 pl-[3px] text-xs font-medium",
            !inChannel && "text-amber",
          )}
          title={inChannel ? undefined : `${agent.name} is not in this channel, so will not answer`}
        >
          <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={20} className="rounded-full!" />
          {agent.name}
          {!inChannel && <em className="text-[11px] font-normal not-italic">not in channel</em>}
        </span>
      ))}
    </span>
  );
}

function MenuItem({ icon: Icon, children, onSelect, danger }: { icon: LucideIcon; children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={cn(danger && "text-red focus:text-red")}>
      <Icon />
      {children}
    </DropdownMenuItem>
  );
}

/// A channel: its header, the feed of what was said, the composer and the column
/// of facts beside it. Agents answer in threads of their own; what shows here is
/// what they post.
export default function ChannelView({
  channelId,
  workspaceAgents,
  workspaceName,
  active,
  onEdit,
  onOpenProfile,
  onMessageAgent,
  onOpenInbox,
  onArchived,
  composer,
}: {
  channelId: string;
  /// The agents of the workspace on screen.
  workspaceAgents: RosterAgent[];
  workspaceName: string;
  /// The page is up, so a new message counts as read.
  active: boolean;
  onEdit: (channel: Channel) => void;
  onOpenProfile: (agentId: string) => void;
  /// Opens the agent's own chat.
  onMessageAgent: (agentId: string) => void;
  onOpenInbox: () => void;
  onArchived: (channel: Channel) => void;
  /// Dictation, which the shell owns beside the settings dialog it may need.
  composer?: { dictation?: ReactNode; dictating?: boolean; onCancelRecording?: () => boolean };
}) {
  const { detail, working, error } = useChannel(channelId);
  const roster = useRoster();
  const me = useMe();
  const inbox = useInbox();
  const reply = useReplyDraft(draftKey(channelId));
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [membersOpen, setMembersOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(() => localStorage.getItem("hz.channelAbout") !== "closed");
  const toggleAbout = () =>
    setAboutOpen((open) => {
      localStorage.setItem("hz.channelAbout", open ? "closed" : "open");
      return !open;
    });
  const [task, setTask] = useState<Task | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const channel = detail?.channel ?? null;
  const members = useMemo(
    () => (channel ? channel.members.flatMap((id) => roster.agents.filter((a) => a.id === id)) : []),
    [channel, roster.agents],
  );
  const cast: Cast = useMemo(() => ({ me, agents: roster.agents }), [me, roster.agents]);
  const rows = useMemo(() => (detail && channel ? feedRows(detail.messages, channel.rounds) : []), [detail, channel]);
  const bySeq = useMemo(() => new Map((detail?.messages ?? []).map((m) => [m.seq, m])), [detail?.messages]);
  const taskById = useMemo(() => new Map((detail?.tasks ?? []).map((t) => [t.id, t])), [detail?.tasks]);
  const lead = members.find((m) => m.id === channel?.lead) ?? members[0];

  // Approvals the room's agents are blocked on: the Inbox's own items, found by
  // the threads they were raised in.
  const threadSessions = useMemo(() => new Set((detail?.threads ?? []).map((t) => t.sessionId)), [detail?.threads]);
  const approvals = useMemo(
    () =>
      inbox.items.filter(
        (i) => i.kind === "approval" && i.state === "open" && !i.archived && i.sessionId && threadSessions.has(i.sessionId),
      ),
    [inbox.items, threadSessions],
  );

  // A new message keeps the feed at the bottom unless the reader scrolled up.
  const lastSeq = detail?.messages.at(-1)?.seq ?? 0;
  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastSeq, approvals.length, working.agents.length, channelId, detail === null]);

  // Everything up to the newest message is read while the page is open on it.
  useEffect(() => {
    if (active && channel && channel.readSeq < channel.lastSeq) void markChannelRead(channel.id);
  }, [active, channel?.id, channel?.lastSeq, channel?.readSeq]);

  const send = useCallback(
    async (text: string, attachments: Attachment[]) => {
      const target = replyFor(draftKey(channelId));
      setSendError(null);
      try {
        await postToChannel(channelId, text, target?.seq ?? null, attachments.map((a) => a.path));
        cancelReply(draftKey(channelId));
        stick.current = true;
      } catch (e) {
        setSendError(String(e));
        // The composer cleared itself on send; a refused post must not eat the
        // words, unless the reader has already started something new.
        if (!readDraft(draftKey(channelId))) writeDraft(draftKey(channelId), text);
      }
    },
    [channelId],
  );

  const answer = async (item: InboxItem, verdict: "ALLOWED" | "DENIED" | "NOT NOW") => {
    setBusy(item.id);
    try {
      await resolveInboxItem(item.id, verdict);
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(null);
    }
  };

  const exportMd = async () => {
    if (!channel) return;
    try {
      const contents = await exportChannel(channel.id);
      const path = await save({ defaultPath: exportName(channel), filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (path === null) return;
      await invoke("write_text_file", { path, contents });
      toast(`Saved ${exportName(channel)}`, { icon: <Download /> });
    } catch (e) {
      toast(`Could not export: ${String(e)}`);
    }
  };

  if (error && !detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
        <p className="text-[13px] text-ink2">{error}</p>
      </div>
    );
  }
  if (!detail || !channel) return <div className="min-h-0 flex-1" />;

  const typing = working.agents.flatMap((id) => roster.agents.filter((a) => a.id === id));
  const hint = composerHint(channel.mode, channel.rounds, lead?.name ?? "The lead");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[62px] flex-none items-center gap-3 border-b border-line px-5">
        <span className="grid size-[34px] flex-none place-items-center rounded-[9px] border border-line2 text-ink2">
          <Hash className="size-[15px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[14.5px] font-semibold">
            {channel.name}
            {channel.muted && <BellOff aria-label="Muted" className="size-3 text-ink4" />}
          </div>
          <div className="truncate text-xs text-ink3">{channel.purpose || "No purpose yet."}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            aria-label="Members"
            className="mr-1.5 flex cursor-pointer"
          >
            {members.map((m, i) => (
              <span key={m.id} className={cn("rounded-[7px] ring-2 ring-background", i > 0 && "-ml-1.5")}>
                <AgentTile id={m.id} kind={m.kind} color={m.color} size={22} />
              </span>
            ))}
          </button>
          <Button variant="outline" size="sm" onClick={() => setMembersOpen(true)}>
            <Users /> {members.length + 1}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={aboutOpen ? "Hide channel info" : "Show channel info"} aria-pressed={aboutOpen} onClick={toggleAbout}>
            <PanelRight />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Channel menu">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <MenuItem icon={Pencil} onSelect={() => onEdit(channel)}>
                Edit channel
              </MenuItem>
              <MenuItem
                icon={channel.muted ? Bell : BellOff}
                onSelect={() => void updateChannel(channel.id, { muted: !channel.muted })}
              >
                {channel.muted ? "Unmute" : "Mute"}
              </MenuItem>
              <MenuItem icon={Download} onSelect={() => void exportMd()}>
                Export to .md
              </MenuItem>
              <DropdownMenuSeparator />
              <MenuItem icon={Trash2} danger onSelect={() => setArchiving(true)}>
                Archive channel
              </MenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={feedRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto max-w-[940px] px-10 pt-7 pb-10">
              {rows.length === 0 && (
                <p className="py-16 text-center text-[13px] text-ink3">
                  Nothing here yet. @mention someone to start.
                </p>
              )}
              {rows.map((row) => {
                switch (row.kind) {
                  case "day":
                    return <Rule key={row.key}>{row.label}</Rule>;
                  case "round":
                    return (
                      <Rule key={row.key} round>
                        {row.label}
                      </Rule>
                    );
                  case "note":
                    return (
                      <NoteRow
                        key={row.key}
                        message={row.message}
                        onRetry={
                          row.message.seq === lastSeq && isFailureNote(row.message.text) && typing.length === 0
                            ? () => void retryChannel(channel.id).catch((e) => setSendError(String(e)))
                            : undefined
                        }
                      />
                    );
                  default: {
                    const m = row.message;
                    return (
                      <MessageRow
                        key={row.key}
                        message={m}
                        quoted={m.replyTo ? bySeq.get(m.replyTo) : undefined}
                        task={m.taskId ? taskById.get(m.taskId) : undefined}
                        cast={cast}
                        onReact={(seq, emoji) => void reactInChannel(channel.id, seq, emoji)}
                        onReply={(msg) =>
                          startReply(draftKey(channel.id), {
                            seq: msg.seq,
                            text: quoteLine(msg.text),
                            agent: msg.from,
                            name: msg.from === "me" ? "yourself" : (roster.agents.find((a) => a.id === msg.from)?.name ?? "Agent"),
                          })
                        }
                        onOpenTask={setTask}
                        onOpenProfile={onOpenProfile}
                      />
                    );
                  }
                }
              })}
              {approvals.map((item) => (
                <InlineApproval
                  key={item.id}
                  item={item}
                  agent={roster.agents.find((a) => a.id === item.agentId)}
                  busy={busy === item.id}
                  onAnswer={(i, v) => void answer(i, v)}
                  onOpen={onOpenInbox}
                />
              ))}
            </div>
          </div>

          <div className="mx-auto w-full max-w-[1020px] px-10 pb-[18px]">
            <ChatInput
              onSend={(message, attachments) => void send(message, attachments)}
              sessionId={draftKey(channel.id)}
              placeholder={`Message #${channel.name} — @ to pick who answers`}
              note={hint}
              mentionAgents={workspaceAgents}
              mentionMembers={channel.members}
              workingAgents={new Set(working.agents)}
              recipient={
                <MentionChips
                  draftId={draftKey(channel.id)}
                  everyone={workspaceAgents}
                  members={channel.members}
                  lead={lead}
                />
              }
              replyBar={reply ? <ReplyBar draft={reply} onCancel={() => cancelReply(draftKey(channel.id))} /> : undefined}
              onCancelReply={() => cancelReply(draftKey(channel.id))}
              status={
                typing.length > 0 ? (
                  <div className="mb-2.5 flex h-[30px] w-max items-center gap-2.5 rounded-full bg-s2 pr-1.5 pl-1 text-[12.5px] text-ink2">
                    <span className="flex">
                      {typing.map((a, i) => (
                        <span key={a.id} className={cn("rounded-full", i > 0 && "-ml-1.5")}>
                          <AgentTile id={a.id} kind={a.kind} color={a.color} size={22} className="rounded-full!" />
                        </span>
                      ))}
                    </span>
                    <span className="shimmer-text">
                      {typing.map((a) => a.name).join(", ")} {typing.length === 1 ? "is" : "are"} answering
                      {working.round ? ` · round ${working.round} of ${channel.rounds}` : ""}
                    </span>
                    <button
                      type="button"
                      aria-label="Stop"
                      onClick={() => void stopChannel(channel.id)}
                      className="grid size-[22px] cursor-pointer place-items-center rounded-full bg-black/35 text-ink2 transition-colors hover:text-ink"
                    >
                      <Square className="size-2.5 fill-current" />
                    </button>
                  </div>
                ) : undefined
              }
              error={sendError}
              onDismissError={() => setSendError(null)}
              dictation={composer?.dictation}
              dictating={composer?.dictating}
              onCancelRecording={composer?.onCancelRecording}
            />
          </div>
        </div>

        {aboutOpen && (
        <ChannelAbout
          onClose={toggleAbout}
          channel={channel}
          me={me}
          members={members}
          tasks={detail.tasks}
          onOpenProfile={onOpenProfile}
          onAddMember={() => setMembersOpen(true)}
          onOpenTask={setTask}
        />
        )}
      </div>

      <MembersSheet
        open={membersOpen}
        onOpenChange={setMembersOpen}
        channel={channel}
        agents={workspaceAgents}
        workspaceName={workspaceName}
        onMember={(agentId, on) => {
          const name = roster.agents.find((a) => a.id === agentId)?.name ?? "Agent";
          void setChannelMember(channel.id, agentId, on)
            .then(() => toast(`${name} ${on ? "joined" : "left"} #${channel.name}`, { ms: 1600 }))
            .catch((e) => toast(String(e)));
        }}
        onLead={(agentId) => void updateChannel(channel.id, { lead: agentId }).catch((e) => toast(String(e)))}
        onRounds={(rounds) => void updateChannel(channel.id, { rounds }).catch((e) => toast(String(e)))}
      />

      <TaskSheet
        task={task ? (detail.tasks.find((t) => t.id === task.id) ?? task) : null}
        channel={channel}
        owner={task ? roster.agents.find((a) => a.id === task.owner) : undefined}
        messages={detail.messages}
        onClose={() => setTask(null)}
        onOpenOwner={(id) => {
          setTask(null);
          onOpenProfile(id);
        }}
        onMessageOwner={(id) => {
          setTask(null);
          onMessageAgent(id);
        }}
      />

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive #${channel.name}?`}
        description="It leaves the sidebar. Agents stop answering in it. You can bring it back from Jump to."
        confirmLabel="Archive"
        onConfirm={() => {
          setArchiving(false);
          void archiveChannel(channel.id, true)
            .then((c) => {
              onArchived(c);
              toast(`#${c.name} archived`, {
                action: { label: "Undo", onClick: () => void archiveChannel(c.id, false).catch((e) => toast(String(e))) },
                ms: 6000,
              });
            })
            .catch((e) => toast(String(e)));
        }}
      />
    </div>
  );
}
