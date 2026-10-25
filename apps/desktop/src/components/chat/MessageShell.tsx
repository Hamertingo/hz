import { Check, Clock, Copy, Ellipsis, Link2, Reply, Sparkles, SmilePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import EmojiPicker from "@/components/chat/EmojiPicker";
import MeAvatar from "@/components/MeAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { useMe } from "@/hooks/useMe";
import { hideMessage, restoreMessage, useHiddenMessages } from "@/lib/chatMarks";
import { jumpToSeq } from "@/lib/jump";
import { inkTint } from "@/lib/mascots";
import { QUICK_REACTIONS, toggleReaction, useReactions } from "@/lib/reactions";
import { rememberInChat } from "@/lib/remember";
import { quoteLine, replyTo } from "@/lib/reply";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { ReplyTo } from "@/types/events";

/// The reader's face in an agent chat: their photo or the head they picked.
export function PersonFace({ size = 36 }: { size?: number }) {
  const me = useMe();
  return <MeAvatar me={me} size={size} />;
}

/// An agent's face, the tile every surface draws it on. Pressed, it opens the
/// agent's profile.
export function AgentFace({ agent, size = 36 }: { agent: RosterAgent; size?: number }) {
  const chat = useAgentChatActions();
  if (!chat) return <AgentAvatar agent={agent} size={size} />;
  return (
    <button
      type="button"
      onClick={() => chat.onOpenProfile(agent.id)}
      aria-label={`Open ${agent.name}'s profile`}
      className="cursor-pointer rounded-(--r2) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <AgentAvatar agent={agent} size={size} />
    </button>
  );
}

/// The one-line quote a reply carries above its words, joined to the message by a
/// bar in the quoted person's colour. Pressing it scrolls to the original and
/// flashes it.
function ReplyQuote({ quote }: { quote: ReplyTo }) {
  const roster = useRoster();
  const me = useMe();
  const who = quote.agent === "me" ? null : roster.agents.find((a) => a.id === quote.agent);
  const color = who?.color ?? me.avatar.color;
  const name = quote.agent === "me" ? (me.name || "You") : (who?.name ?? "Agent");

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
      <span className="max-w-[520px] truncate text-[12.5px] leading-snug text-ink3">{quote.text}</span>
    </button>
  );
}

/// One message in an agent chat: a face, a bold name and the time, then the
/// words — the same row for the reader and for the agent, left-aligned in one
/// column, the way a team chat reads. A bar floats at the right while the pointer
/// is over it, and the reader's reactions sit under the words.
export default function MessageShell({
  face,
  name,
  status,
  time,
  copy,
  reactKey,
  seq,
  author,
  quote,
  tint,
  children,
}: {
  face: React.ReactNode;
  name: string;
  /// Beside the name, for what the message is doing right now ("in progress").
  status?: React.ReactNode;
  time?: string | null;
  /// The message's own text, for Copy, Reply and Remember. Absent draws none.
  copy?: string;
  /// Where this message's reactions and its tombstone are kept. Absent draws no
  /// bar at all.
  reactKey?: string;
  /// The event this message is, which a reply to it points at and a jump finds.
  seq?: number;
  /// Who said it: `"me"`, or a roster agent's id.
  author?: string;
  /// What this message answers, when the reader used Reply on it.
  quote?: ReplyTo | null;
  tint?: string;
  children: React.ReactNode;
}) {
  const chat = useAgentChatActions();
  const reactions = useReactions(reactKey);
  const hidden = useHiddenMessages(chat?.sessionId ?? null);

  if (reactKey && hidden.includes(reactKey)) return null;

  return (
    <div
      data-msg-seq={seq}
      className="group/msg relative -mx-3 flex gap-3 rounded-(--r3) px-3 py-2.5 transition-colors hover:bg-hover"
      style={tint ? ({ "--tint": tint } as React.CSSProperties) : undefined}
    >
      <div className="pt-0.5">{face}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-foreground">{name}</span>
          {status}
          {time && <span className="text-[11.5px] tabular-nums text-ink4">{time}</span>}
        </div>

        {quote && <ReplyQuote quote={quote} />}

        {children}

        {reactKey && reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {reactions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleReaction(reactKey, emoji)}
                aria-label={`Remove ${emoji}`}
                className="flex h-6 cursor-pointer items-center gap-[5px] rounded-full bg-blue/12 px-2 text-xs shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--blue)_30%,transparent)] transition-colors hover:bg-blue/20"
              >
                {emoji}
                <em className="text-[11px] tabular-nums text-ink3 not-italic">1</em>
              </button>
            ))}
          </div>
        )}
      </div>

      {reactKey && <HoverBar text={copy} reactKey={reactKey} seq={seq} author={author} />}
    </div>
  );
}

function BarButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            "grid size-7 cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3.5",
            pressed && "bg-hover text-ink",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/// The actions under the pointer: react, reply, copy, and a menu of the rest.
///
/// Reply and the menu are the agent chat's alone — they need the chat's
/// context — while a message with no words (a turn still working) offers react
/// and nothing else.
function HoverBar({
  text,
  reactKey,
  seq,
  author,
}: {
  text?: string;
  reactKey: string;
  seq?: number;
  author?: string;
}) {
  const chat = useAgentChatActions();
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef(0);

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Nowhere in a transcript to put an error sentence, and the text is still
      // there to select by hand.
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  const canReply = chat !== null && text && seq !== undefined && author !== undefined;
  const sessionId = chat?.sessionId ?? null;

  const remember = async () => {
    if (!chat || !text) return;
    try {
      await rememberInChat(chat.agent.id, text);
      toast(`${chat.agent.name} saved it to memory`, { icon: <Sparkles /> });
    } catch (e) {
      toast(`Could not save it: ${String(e)}`);
    }
  };

  const remove = () => {
    if (!sessionId) return;
    hideMessage(sessionId, reactKey);
    toast("Message deleted", {
      icon: <Trash2 />,
      action: { label: "Undo", onClick: () => restoreMessage(sessionId, reactKey) },
      ms: 6000,
    });
  };

  // Stays drawn while a popover or the menu it opened is open, or the pointer
  // leaving the row for the popover would close what it is reaching for.
  const stay = picking || menuOpen;

  return (
    <div
      className={cn(
        "absolute -top-3.5 right-3 z-10 flex items-center gap-px rounded-(--r2) bg-(--pop) p-[3px] shadow-(--shadow) ring-1 ring-line2 transition-opacity",
        stay
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100",
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
                  toggleReaction(reactKey, emoji);
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
              toggleReaction(reactKey, emoji);
              setPicking(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {canReply && (
        <BarButton
          label="Reply"
          onClick={() => {
            const target = replyTo(seq, text, author);
            chat.onReply({
              ...target,
              name: author === "me" ? "yourself" : chat.agent.name,
            });
          }}
        >
          <Reply />
        </BarButton>
      )}

      {text && (
        <BarButton label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
        </BarButton>
      )}

      {chat && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  className="grid size-7 cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3.5"
                >
                  <Ellipsis />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            {text && (
              <DropdownMenuItem onSelect={() => void remember()}>
                <Sparkles /> Remember this
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                const link = `hz://chat/${chat.sessionId ?? chat.agent.id}#${seq ?? ""}`;
                void navigator.clipboard.writeText(link).then(
                  () => toast("Link copied"),
                  () => toast("Could not copy the link"),
                );
              }}
            >
              <Link2 /> Copy link
            </DropdownMenuItem>
            {text && (
              <DropdownMenuItem onSelect={() => chat.onRoutine(quoteLine(text, 400))}>
                <Clock /> Make it a routine
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2 /> Delete message
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
