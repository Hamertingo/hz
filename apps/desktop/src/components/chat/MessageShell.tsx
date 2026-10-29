import { Check, Clock, Copy, Ellipsis, FileText, Link2, Reply, Sparkles, SmilePlus, Trash2 } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import EmojiPicker from "@/components/chat/EmojiPicker";
import MeAvatar from "@/components/MeAvatar";
import { SendState } from "@/components/chat/cards";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { useMe } from "@/hooks/useMe";
import { hideMessage, restoreMessage, useHiddenMessages } from "@/lib/chatMarks";
import { jumpToSeq } from "@/lib/jump";
import { kit } from "@/lib/kit";
import { markdownToHtml, pdfTitle } from "@/lib/pdfHtml";
import { QUICK_REACTIONS, toggleReaction, useReactions } from "@/lib/reactions";
import { rememberInChat } from "@/lib/remember";
import { quoteLine, replyTo } from "@/lib/reply";
import { poseOf, type Pose } from "@/lib/face";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { ReplyTo } from "@/types/events";

/// The reader's face in an agent chat: their photo or the head they picked.
export function PersonFace({ size = 36 }: { size?: number }) {
  const me = useMe();
  return <MeAvatar me={me} size={size} />;
}

/// An agent's face, the tile every surface draws it on. Pressed, it opens the
/// agent's profile. `pose` is what it is doing: `work` while it answers.
export function AgentFace({ agent, size = 28, pose }: { agent: RosterAgent; size?: number; pose?: Pose }) {
  const chat = useAgentChatActions();
  const tile = (
    <AgentTile
      id={agent.id}
      kind={agent.kind}
      color={agent.color}
      shape={agent.shape}
      look={agent.look}
      photo={agent.photo}
      pose={pose ?? poseOf({})}
      size={size}
    />
  );
  if (!chat) return tile;
  return (
    <button
      type="button"
      onClick={() => chat.onOpenProfile(agent.id)}
      aria-label={`Open ${agent.name}'s profile`}
      className="cursor-pointer rounded-(--r2) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {tile}
    </button>
  );
}

/// What a reply carries above its words: a rule in the quoted person's colour, their name, one line of
/// what they said. Pressing it scrolls to the original and flashes it.
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
      className="mt-0.5 mb-1.5 flex min-w-[180px] max-w-full cursor-pointer flex-col py-px pl-[9px] text-left"
    >
      <b className="text-xs font-medium text-ink2">{name}</b>
      <span className="max-w-[400px] truncate text-[12.5px] text-ink3">{quote.text}</span>
    </button>
  );
}

/// One message in an agent chat. The agent's sit on a soft fill with a small
/// top-left corner; the reader's are tinted by their colour and sit on the right.
/// The time is under the words, inside the bubble. A bar of quiet icons shows
/// beside the bubble while the pointer is over the row, and the reader's
/// reactions sit under it as hairline pills.
///
/// `children` is the bubble's content. What is not speech (steps, cards, a
/// terminal) goes in `after`, outside the bubble, and images the reader sent in
/// `above`. With no `children` there is no bubble at all.
export default function MessageShell({
  face,
  name,
  time,
  copy,
  reactKey,
  seq,
  author,
  quote,
  tint,
  above,
  after,
  failed,
  onRetry,
  children,
}: {
  /// Drawn beside the bubble, at its top. Absent in a one-to-one chat except while the agent works.
  face?: React.ReactNode;
  /// For assistive tech; the bubble names no one.
  name?: string;
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
  above?: React.ReactNode;
  after?: React.ReactNode;
  /// The send failed: draws "Didn't send" under the bubble.
  failed?: boolean;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  const chat = useAgentChatActions();
  const me = useMe();
  const reactions = useReactions(reactKey);
  const hidden = useHiddenMessages(chat?.sessionId ?? null);

  if (reactKey && hidden.includes(reactKey)) return null;

  const mine = author === "me";

  return (
    <div
      data-msg-seq={seq}
      aria-label={name}
      className={cn("group/msg chat-rise relative flex max-w-full flex-col", mine ? "items-end" : "items-start")}
      style={tint ? ({ "--tint": tint } as React.CSSProperties) : undefined}
    >
      {above && <div className={cn("mb-1 flex max-w-full flex-col gap-1", mine ? "items-end" : "items-start")}>{above}</div>}

      {(children || face) && (
        <div className={cn("relative flex max-w-full items-end gap-[9px]", mine && "flex-row-reverse")}>
          {face && <div className="mt-0.5 self-start">{face}</div>}
          {children && (
            <MessageContext text={copy} reactKey={reactKey} seq={seq} author={author}>
            <div
                className={cn(
                  "relative max-w-[min(560px,100%)] min-w-0 rounded-[16px] px-[13px] pt-2 pb-1.5 text-[13.5px] leading-[1.6] wrap-anywhere [&_.text-chat]:leading-[1.6] [--fs-chat:0.84375rem]",
                  mine ? "text-ink" : "bg-s2",
                )}
                style={mine ? { background: `color-mix(in srgb, var(--acc, ${me.avatar.color}) 22%, var(--background))` } : undefined}
              >
                {quote && <ReplyQuote quote={quote} />}
                {children}
                {time && (
                  <time className={cn("mt-px block text-right text-[10.5px] tabular-nums", mine ? "text-ink/45" : "text-ink4")}>{time}</time>
                )}
              </div>
            </MessageContext>
          )}
          {children && reactKey && <HoverBar text={copy} reactKey={reactKey} seq={seq} author={author} mine={mine} />}
        </div>
      )}

      {reactKey && reactions.length > 0 && (
        <div className="mx-1 mt-1 flex flex-wrap gap-1">
          {reactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => toggleReaction(reactKey, emoji)}
              aria-label={`Remove ${emoji}`}
              className="flex h-[22px] cursor-pointer items-center gap-1 rounded-full bg-s3 px-[7px] text-[13px] shadow-[inset_0_0_0_1px_var(--line3)] transition-colors hover:bg-s2"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {failed && <SendState onRetry={onRetry} />}
      {after}
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
            "grid size-[26px] cursor-pointer place-items-center rounded-md text-ink4 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[15px]",
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

/// The right-click menu on a message: the same actions as the hover bar, with the quick reactions on top.
function MessageContext({ text, reactKey, seq, author, children }: { text?: string; reactKey?: string; seq?: number; author?: string; children: React.ReactNode }) {
  const a = useMessageActions({ text, reactKey: reactKey ?? "", seq, author });
  if (!reactKey) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <div className="flex gap-0.5 px-1 pb-1.5">
          {QUICK_REACTIONS.map((emoji) => (
            <ContextMenuItem key={emoji} onSelect={() => toggleReaction(reactKey, emoji)} aria-label={`React ${emoji}`} className="grid size-8 place-items-center p-0 text-[17px]">
              {emoji}
            </ContextMenuItem>
          ))}
        </div>
        <ContextMenuSeparator />
        {a.canReply && (
          <ContextMenuItem onSelect={a.reply}>
            <Reply /> Reply
          </ContextMenuItem>
        )}
        {text && (
          <ContextMenuItem onSelect={() => void a.copy()}>
            <Copy /> Copy
          </ContextMenuItem>
        )}
        {a.chat && text && (
          <ContextMenuItem onSelect={() => void a.remember()}>
            <Sparkles /> Remember this
          </ContextMenuItem>
        )}
        {a.chat && (
          <ContextMenuItem onSelect={a.copyLink}>
            <Link2 /> Copy link
          </ContextMenuItem>
        )}
        {a.chat && text && (
          <ContextMenuItem onSelect={a.routine}>
            <Clock /> Make it a routine
          </ContextMenuItem>
        )}
        {a.chat && text && (
          <ContextMenuItem onSelect={() => void a.pdf()}>
            <FileText /> Make PDF
          </ContextMenuItem>
        )}
        {a.chat && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={a.remove}>
              <Trash2 /> Delete message
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/// What can be done to a message, shared by the hover bar and the right-click menu.
function useMessageActions({ text, reactKey, seq, author }: { text?: string; reactKey: string; seq?: number; author?: string }) {
  const chat = useAgentChatActions();
  const [copied, setCopied] = useState(false);
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

  const reply = () => {
    if (!chat || !text || seq === undefined || author === undefined) return;
    const target = replyTo(seq, text, author);
    chat.onReply({ ...target, name: author === "me" ? "yourself" : chat.agent.name });
  };
  const copyLink = () => {
    if (!chat) return;
    const link = `hz://chat/${chat.sessionId ?? chat.agent.id}#${seq ?? ""}`;
    void navigator.clipboard.writeText(link).then(
      () => toast("Link copied"),
      () => toast("Could not copy the link"),
    );
  };
  const routine = () => chat && text && chat.onRoutine(quoteLine(text, 400));
  const pdf = async () => {
    if (!chat || !text) return;
    try {
      const path = await kit.pdf(pdfTitle(text), chat.agent.id, markdownToHtml(text));
      toast(path.endsWith(".pdf") ? "PDF saved" : "No Chrome-family browser here, so it was saved as HTML", {
        icon: <FileText />,
        action: { label: "Show", onClick: () => void revealItemInDir(path) },
      });
    } catch (e) {
      toast(`Could not make the PDF: ${String(e)}`);
    }
  };

  return { chat, copied, copy, canReply, reply, remember, copyLink, routine, remove, pdf };
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
  mine,
}: {
  text?: string;
  reactKey: string;
  seq?: number;
  author?: string;
  mine: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { chat, copied, copy, canReply, reply, remember, copyLink, routine, remove, pdf } = useMessageActions({ text, reactKey, seq, author });

  // Stays drawn while a popover or the menu it opened is open, or the pointer
  // leaving the row for the popover would close what it is reaching for.
  const stay = picking || menuOpen;

  return (
    <div
      className={cn(
        "absolute top-1/2 z-10 flex -translate-y-1/2 items-center transition-opacity",
        mine ? "right-full mr-1" : "left-full ml-1",
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
          onClick={reply}
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
                  className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink4 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[15px]"
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
            <DropdownMenuItem onSelect={copyLink}>
              <Link2 /> Copy link
            </DropdownMenuItem>
            {text && (
              <DropdownMenuItem onSelect={routine}>
                <Clock /> Make it a routine
              </DropdownMenuItem>
            )}
            {text && (
              <DropdownMenuItem onSelect={() => void pdf()}>
                <FileText /> Make PDF
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
