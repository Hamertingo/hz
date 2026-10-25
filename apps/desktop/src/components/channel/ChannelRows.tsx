import { Check, Copy, Flag, Reply, Shield, SmilePlus } from "lucide-react";
import { useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { Markdown } from "@/components/chat/Markdown";
import EmojiPicker from "@/components/chat/EmojiPicker";
import MeAvatar from "@/components/MeAvatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jumpToSeq } from "@/lib/jump";
import { clockTime, firstLine, TASK_LABEL, taskTone, type Named } from "@/lib/channels";
import { inkTint } from "@/lib/mascots";
import { QUICK_REACTIONS } from "@/lib/reactions";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { ChannelMessage, InboxItem, Me, Task } from "@/types/events";

/// What a row needs to know about the people in the room.
export type Cast = {
  me: Me;
  agents: RosterAgent[];
};

const TONE: Record<ReturnType<typeof taskTone>, string> = {
  amber: "bg-amber",
  green: "bg-green",
  ink2: "bg-ink2",
  ink3: "bg-ink3",
};

/// The coloured dot a task's state is drawn with.
export function StatusDot({ status }: { status: Task["status"] }) {
  return <i className={cn("inline-block size-1.5 flex-none rounded-full", TONE[taskTone(status)])} />;
}

/// A line across the feed: a day, or a round.
export function Rule({ children, round = false }: { children: React.ReactNode; round?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 text-[11.5px] font-medium text-ink4",
        round ? "mt-[18px] mb-2" : "mt-[18px] mb-3 before:h-px before:flex-1 before:bg-line",
        "after:h-px after:flex-1 after:bg-line",
      )}
    >
      {children}
    </div>
  );
}

/// A line from hz itself: an agent that could not answer. `onRetry` is given only
/// to the newest failure, which is the one a retry can answer.
export function NoteRow({ message, onRetry }: { message: ChannelMessage; onRetry?: () => void }) {
  return (
    <div data-msg-seq={message.seq} className="my-2 text-center text-xs text-ink4">
      {message.text}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 cursor-pointer font-medium text-ink2 underline underline-offset-2 hover:text-ink"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/// The reader's own words with each `@name` drawn as a mention.
function Said({ text, people }: { text: string; people: Named[] }) {
  const names = people
    .map((p) => p.name)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = names.length ? text.split(new RegExp(`(@(?:${names.join("|")}|all|everyone|channel)(?![\\p{L}\\p{N}_]))`, "giu")) : [text];
  return (
    <p className="max-w-[760px] text-[14px] leading-[1.6] break-words whitespace-pre-wrap text-ink">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} className="rounded-[5px] bg-blue/14 px-[3px] font-medium text-blue">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/// The one-line quote a reply carries, joined to the message by a bar in the
/// quoted person's colour. Pressing it scrolls to the original.
function Quote({ quote, cast }: { quote: ChannelMessage; cast: Cast }) {
  const agent = cast.agents.find((a) => a.id === quote.from);
  const color = quote.from === "me" ? cast.me.avatar.color : (agent?.color ?? cast.me.avatar.color);
  const name = quote.from === "me" ? cast.me.name || "You" : (agent?.name ?? "Agent");
  return (
    <button
      type="button"
      onClick={() => jumpToSeq(quote.seq)}
      title="Jump to the message"
      style={{ boxShadow: `inset 2px 0 0 ${color}` }}
      className="my-1 flex w-max max-w-full cursor-pointer flex-col gap-px rounded-r-lg bg-s1 py-[5px] pr-3 pl-[11px] text-left transition-colors hover:bg-s2"
    >
      <b className="text-xs font-semibold" style={{ color: inkTint(color, 0.35) }}>
        {name}
      </b>
      <span className="max-w-[520px] truncate text-[12.5px] leading-snug text-ink3">{firstLine(quote.text)}</span>
    </button>
  );
}

/// A task an agent announced, as a card in the feed.
export function TaskCard({ task, agent, onOpen }: { task: Task; agent?: RosterAgent; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2.5 flex max-w-[560px] cursor-pointer items-center gap-2.5 rounded-(--r3) bg-s2 px-3.5 py-2.5 text-left text-[13.5px] shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s3"
    >
      <span className="flex items-center gap-[5px] text-[11px] font-medium text-ink3">
        <Flag className="size-3" /> Task
      </span>
      <span className="min-w-0 truncate font-[550]">{task.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink2">
        {agent && <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={18} />}
        {agent?.name}
        <span aria-hidden>·</span>
        <span className={cn(task.status === "writing" && "shimmer-text", task.status === "waiting_for_you" && "text-amber")}>
          {TASK_LABEL[task.status]}
        </span>
      </span>
    </button>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="grid size-7 cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3.5"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/// One message: a face, a bold name and the time, the words, the task it opened
/// and its reactions. A bar floats at the right under the pointer.
export function MessageRow({
  message,
  quoted,
  task,
  cast,
  onReact,
  onReply,
  onOpenTask,
  onOpenProfile,
}: {
  message: ChannelMessage;
  quoted?: ChannelMessage;
  task?: Task;
  cast: Cast;
  onReact: (seq: number, emoji: string) => void;
  onReply: (message: ChannelMessage) => void;
  onOpenTask: (task: Task) => void;
  onOpenProfile: (agentId: string) => void;
}) {
  const mine = message.from === "me";
  const agent = mine ? undefined : cast.agents.find((a) => a.id === message.from);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const owner = task ? cast.agents.find((a) => a.id === task.owner) : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      data-msg-seq={message.seq}
      className="group/msg relative -mx-3 flex gap-3 rounded-(--r3) px-3 py-2.5 transition-colors hover:bg-hover"
    >
      <div className="pt-0.5">
        {mine ? (
          <MeAvatar me={cast.me} size={36} />
        ) : agent ? (
          <button
            type="button"
            onClick={() => onOpenProfile(agent.id)}
            aria-label={`Open ${agent.name}'s profile`}
            className="cursor-pointer rounded-(--r2) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={36} />
          </button>
        ) : (
          <span className="block size-9 rounded-(--r2) bg-s2" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold">{mine ? cast.me.name || "You" : (agent?.name ?? "Someone")}</span>
          {!mine && agent?.role && <span className="text-[11.5px] text-ink3">{agent.role}</span>}
          <span className="text-[11.5px] tabular-nums text-ink4">{clockTime(message.ts)}</span>
        </div>

        {quoted && <Quote quote={quoted} cast={cast} />}

        {mine ? (
          <Said text={message.text} people={cast.agents} />
        ) : (
          <div className="max-w-[760px] text-[14px] leading-[1.6]">
            <Markdown>{message.text}</Markdown>
          </div>
        )}

        {message.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.attachments.map((a) => (
              <span key={a.path} title={a.path} className="rounded-full bg-s2 px-2.5 py-[3px] text-xs text-ink2">
                {a.name}
              </span>
            ))}
          </div>
        )}

        {task && <TaskCard task={task} agent={owner} onOpen={() => onOpenTask(task)} />}

        {message.reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(message.seq, r.emoji)}
                aria-pressed={r.by.includes("me")}
                aria-label={`${r.emoji} ${r.by.length}`}
                className={cn(
                  "flex h-6 cursor-pointer items-center gap-[5px] rounded-full px-2 text-xs transition-colors",
                  r.by.includes("me")
                    ? "bg-blue/12 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--blue)_30%,transparent)] hover:bg-blue/20"
                    : "bg-s2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-s3",
                )}
              >
                {r.emoji}
                <em className="text-[11px] tabular-nums text-ink3 not-italic">{r.by.length}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className={cn(
          "absolute -top-3.5 right-3 z-10 flex items-center gap-px rounded-(--r2) bg-(--pop) p-[3px] shadow-(--shadow) ring-1 ring-line2 transition-opacity",
          picking ? "opacity-100" : "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100",
        )}
      >
        <Popover open={picking} onOpenChange={setPicking}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="React"
                  className="grid size-7 cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3.5"
                >
                  <SmilePlus />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">React</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="p-2">
            <div className="mb-1.5 flex gap-0.5 border-b border-line pb-1.5">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onReact(message.seq, emoji);
                    setPicking(false);
                  }}
                  aria-label={`React ${emoji}`}
                  className="grid size-8 cursor-pointer place-items-center rounded-(--r1) text-[17px] transition-transform hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <EmojiPicker
              onPick={(emoji) => {
                onReact(message.seq, emoji);
                setPicking(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <BarButton label="Reply" onClick={() => onReply(message)}>
          <Reply />
        </BarButton>
        <BarButton label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
        </BarButton>
      </div>
    </div>
  );
}

/// An approval one of the room's agents is blocked on. The same item the Inbox
/// holds: answering here settles it there.
export function InlineApproval({
  item,
  agent,
  busy,
  onAnswer,
  onOpen,
}: {
  item: InboxItem;
  agent?: RosterAgent;
  busy: boolean;
  onAnswer: (item: InboxItem, verdict: "ALLOWED" | "DENIED" | "NOT NOW") => void;
  onOpen: () => void;
}) {
  const post = (item.payload as { form?: string }).form === "post";
  return (
    <div className="-mx-3 flex gap-3 px-3 py-2.5">
      <div className="pt-0.5">
        {agent && <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={36} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[13.5px] font-semibold">{agent?.name ?? "An agent"}</div>
        <div className="max-w-[600px] rounded-(--r3) bg-amber/5 px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--amber)_22%,transparent)]">
          <div className="flex items-center gap-2 text-[12.5px] text-ink2">
            <Shield className="size-3 shrink-0 text-amber" />
            <span className="min-w-0 truncate">Waiting for you · {item.title}</span>
          </div>
          {item.why && <p className="mt-1 text-xs text-ink3">{item.why}</p>}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => onAnswer(item, "ALLOWED")}>
              {post ? "Publish" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" onClick={onOpen}>
              Open
            </Button>
            <Button size="sm" variant="outline" className="text-red" disabled={busy} onClick={() => onAnswer(item, post ? "NOT NOW" : "DENIED")}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
