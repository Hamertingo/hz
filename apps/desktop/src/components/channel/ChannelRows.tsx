import { Check, Copy, Flag, Info, Reply, SmilePlus } from "lucide-react";
import { useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { Markdown } from "@/components/chat/Markdown";
import EmojiPicker from "@/components/chat/EmojiPicker";
import { ApprovalCard, SysRow } from "@/components/chat/cards";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jumpToSeq } from "@/lib/jump";
import { clockTime, firstLine, TASK_LABEL, taskTone, type Named } from "@/lib/channels";
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

/// A day label, or a round line, in the feed.
export function Rule({ children, round = false }: { children: React.ReactNode; round?: boolean }) {
  if (round) return <SysRow icon={<Info />}>{children}</SysRow>;
  return <div className="self-center pt-2.5 pb-1.5 text-center text-[11.5px] font-medium text-ink4">{children}</div>;
}

/// A line from hz itself: an agent that could not answer. `onRetry` is given only
/// to the newest failure, which is the one a retry can answer.
export function NoteRow({ message, onRetry }: { message: ChannelMessage; onRetry?: () => void }) {
  return (
    <div data-msg-seq={message.seq}>
      <SysRow icon={<Info />} link={onRetry ? "Retry" : undefined} onLink={onRetry}>
        {message.text}
      </SysRow>
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
    <p className="break-words whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} className="font-medium text-blue">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/// The one-line quote a reply carries, joined to the message by a rule. Pressing it scrolls to the original.
function Quote({ quote, cast }: { quote: ChannelMessage; cast: Cast }) {
  const agent = cast.agents.find((a) => a.id === quote.from);
  const name = quote.from === "me" ? cast.me.name || "You" : (agent?.name ?? "Agent");
  return (
    <button
      type="button"
      onClick={() => jumpToSeq(quote.seq)}
      title="Jump to the message"
      className="mt-[3px] mb-1.5 flex min-w-[180px] max-w-full cursor-pointer flex-col border-l-2 border-ink4 py-0 pl-[9px] text-left"
    >
      <b className="text-xs font-medium text-ink2">{name}</b>
      <span className="max-w-[400px] truncate text-[12.5px] text-ink3">{firstLine(quote.text)}</span>
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
          className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink4 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[15px]"
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

  const name = mine ? cast.me.name || "You" : (agent?.name ?? "Someone");

  return (
    <div
      data-msg-seq={message.seq}
      className={cn("group/msg chat-rise relative flex max-w-full flex-col", mine ? "items-end" : "items-start")}
    >
      {!mine && (
        <div className="mt-2.5 mb-[3px] ml-[35px] flex items-center gap-1.5 text-xs font-medium">
          {name}
          {agent?.role && <i className="font-normal text-ink4 not-italic">{agent.role}</i>}
        </div>
      )}

      <div className={cn("relative flex max-w-full items-end gap-[9px]", mine && "flex-row-reverse")}>
        {!mine && (
          <div className="mt-0.5 self-start">
            {agent ? (
              <button
                type="button"
                onClick={() => onOpenProfile(agent.id)}
                aria-label={`Open ${agent.name}'s profile`}
                className="cursor-pointer rounded-(--r2) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={26} />
              </button>
            ) : (
              <span className="block size-[26px] rounded-(--r2) bg-s2" />
            )}
          </div>
        )}

        <div
          className={cn(
            "relative max-w-[min(560px,100%)] min-w-0 rounded-[16px] px-[13px] pt-2 pb-1.5 text-[13.5px] leading-[1.6] wrap-anywhere [&_.text-chat]:leading-[1.6] [--fs-chat:0.84375rem]",
            !mine && "bg-s2",
          )}
          style={mine ? { background: "color-mix(in srgb, var(--acc, var(--ink)) 22%, var(--background))" } : undefined}
        >
          {quoted && <Quote quote={quoted} cast={cast} />}

          {mine ? <Said text={message.text} people={cast.agents} /> : <Markdown>{message.text}</Markdown>}

          {message.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {message.attachments.map((a) => (
                <span key={a.path} title={a.path} className="rounded-full bg-s2 px-2.5 py-[3px] text-xs text-ink2">
                  {a.name}
                </span>
              ))}
            </div>
          )}

          <time className={cn("mt-px block text-right text-[10.5px] tabular-nums", mine ? "text-ink/45" : "text-ink4")}>
            {clockTime(message.ts)}
          </time>
        </div>

        <div
          className={cn(
            "absolute top-1/2 z-10 flex -translate-y-1/2 items-center transition-opacity",
            mine ? "right-full mr-1" : "left-full ml-1",
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
                    className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink4 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[15px]"
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

      {task && <TaskCard task={task} agent={owner} onOpen={() => onOpenTask(task)} />}

      {message.reactions.length > 0 && (
        <div className="mx-1 mt-1 flex flex-wrap gap-1">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(message.seq, r.emoji)}
              aria-pressed={r.by.includes("me")}
              aria-label={`${r.emoji} ${r.by.length}`}
              className={cn(
                "flex h-[22px] cursor-pointer items-center gap-1 rounded-full px-[7px] text-[13px] shadow-[inset_0_0_0_1px_var(--line2)] transition-colors hover:bg-s2",
                r.by.includes("me") && "bg-s3 shadow-[inset_0_0_0_1px_var(--line3)]",
              )}
            >
              {r.emoji}
              {r.by.length > 1 && <em className="text-[11px] font-medium text-ink2 not-italic">{r.by.length}</em>}
            </button>
          ))}
        </div>
      )}
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
    <div className="chat-rise">
      <ApprovalCard
        who={agent?.name ?? "An agent"}
        title={item.title}
        detail={item.why || undefined}
        disabled={busy}
        onApprove={() => onAnswer(item, "ALLOWED")}
        onDeny={() => onAnswer(item, post ? "NOT NOW" : "DENIED")}
        extra={
          <Button variant="ghost" size="sm" className="text-ink3" onClick={onOpen}>
            Open
          </Button>
        }
      />
    </div>
  );
}
