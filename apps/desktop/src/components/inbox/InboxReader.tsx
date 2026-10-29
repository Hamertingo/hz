import { ArrowUp, Check, ChevronRight, Code, Lock, Plus, RefreshCw, Reply, Archive, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import { KIND } from "@/components/inbox/InboxList";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { inboxTrail } from "@/hooks/useInbox";
import {
  clockTime,
  diffOf,
  morePosts,
  readApproval,
  readDone,
  readMention,
  readQuestion,
  verdictCopy,
} from "@/lib/inbox";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { InboxItem, TrailStep } from "@/types/events";

export type ReaderActions = {
  resolve: (verdict: string, extra?: string) => void;
  archive: () => void;
  undo: () => void;
  openChat: () => void;
  openProfile: () => void;
  openAccess: () => void;
  ask: () => void;
  editFirst: () => void;
  seeDiff: () => void;
  busy: boolean;
};

const VERB: Record<InboxItem["kind"], string> = {
  approval: "wants your ok",
  question: "has a question",
  mention: "mentioned you",
  done: "finished something",
};

/// The reading pane's body: who, what kind, the title, the context the decision
/// needs, why the agent stopped and how it got there. The action bar is below it.
export function Reader({
  item,
  agent,
  actions,
  leaving,
}: {
  item: InboxItem;
  agent: RosterAgent;
  actions: ReaderActions;
  leaving: boolean;
}) {
  const kind = KIND[item.kind];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto max-w-[640px] px-8 pt-3 pb-10", leaving ? "animate-read-out" : "animate-read-in")}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={actions.openProfile} aria-label={`Open ${agent.name}'s profile`} className="flex cursor-pointer">
            <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={38} />
          </button>
          <div>
            <div className="text-[13.5px] font-semibold">{agent.name}</div>
            <div className="text-xs text-ink3">
              {agent.role ? `${agent.role} · ` : ""}
              {VERB[item.kind]}
            </div>
          </div>
          <span className="ml-auto text-xs text-ink4">{clockTime(item.created)}</span>
        </div>
        <span
          className="mt-[26px] inline-flex items-center gap-1.5 rounded-full py-[3px] pr-[9px] pl-[7px] text-[11.5px] font-medium"
          style={{ color: kind.tone, background: `color-mix(in srgb, ${kind.tone} 12%, transparent)` }}
        >
          <kind.Icon className="size-3" /> {kind.label}
        </span>
        <h1 className="mt-3 text-2xl leading-tight font-semibold tracking-[-0.025em]">{item.title}</h1>
        {item.sub && <div className="mt-1.5 text-sm leading-normal text-ink3">{item.sub}</div>}
        <div className="mt-[22px]">
          <Context item={item} agent={agent} actions={actions} />
        </div>
        {item.why && (
          <div className="mt-[18px] flex items-center gap-2 text-[12.5px] text-ink3">
            <Lock className="size-[13px] text-ink4" /> {item.why}
            {item.kind === "approval" && (
              <button
                type="button"
                onClick={actions.openAccess}
                className="cursor-pointer text-ink2 underline underline-offset-2 hover:text-ink"
              >
                Change this
              </button>
            )}
          </div>
        )}
        <Trail item={item} />
      </div>
    </div>
  );
}

function Trail({ item }: { item: InboxItem }) {
  const [steps, setSteps] = useState<TrailStep[] | null>(null);
  return (
    <details
      key={item.id}
      className="group/hist mt-[30px] border-t border-line pt-4"
      onToggle={(e) => {
        if (e.currentTarget.open && steps === null) {
          inboxTrail(item.id).then(setSteps).catch(() => setSteps([]));
        }
      }}
    >
      <summary className="flex w-max cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-ink3 hover:text-ink2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-[13px] transition-transform group-open/hist:rotate-90" /> How it got here
      </summary>
      <div className="relative mt-3.5 pl-[22px] before:absolute before:top-2 before:bottom-2 before:left-1 before:w-px before:bg-line2">
        {steps === null && (
          <SkeletonRegion label="Reading the conversation" className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className={i === 1 ? "h-3 w-40" : "h-3 w-56"} />
                <Skeleton className="h-2.5 w-3/4" />
              </div>
            ))}
          </SkeletonRegion>
        )}
        {steps?.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <div
              key={`${s.title}-${i}`}
              className={cn(
                "relative before:absolute before:top-[5px] before:-left-[22px] before:size-[9px] before:rounded-full",
                last ? "before:bg-ink" : "before:bg-background before:shadow-[inset_0_0_0_1.5px_var(--ink4)]",
                last ? "pb-0" : "pb-[18px]",
              )}
            >
              <div className="flex items-baseline gap-2 text-[13px]">
                {s.title}
                {s.at > 0 && <span className="ml-auto text-[11.5px] text-ink4">{clockTime(s.at)}</span>}
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink3">{s.sub}</div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function Context({ item, agent, actions }: { item: InboxItem; agent: RosterAgent; actions: ReaderActions }) {
  const [text, setText] = useState("");
  const [allPosts, setAllPosts] = useState(false);

  if (item.kind === "approval") {
    const a = readApproval(item);
    if (a.form === "post") {
      const shown = allPosts ? a.posts : a.posts.slice(0, 2);
      const more = morePosts(a.posts.length, shown.length);
      return (
        <>
          <div className="flex flex-col gap-1.5">
            {shown.map((p, i) => (
              <div key={i} className="flex gap-[11px] rounded-(--r3) bg-s1 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
                <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 text-[12.5px]">
                    <b className="font-semibold">{agent.name}</b>
                    <em className="text-xs text-ink4 not-italic">
                      {i + 1}/{a.posts.length}
                    </em>
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink2">{p}</div>
                  <div className="mt-1.5 text-[11px] text-ink4 tabular-nums">{p.length} / 280</div>
                </div>
              </div>
            ))}
          </div>
          {more > 0 && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAllPosts(true)}>
              <Plus /> {more} more post{more === 1 ? "" : "s"}
            </Button>
          )}
        </>
      );
    }
    const diff = a.form === "edit" ? diffOf(a.input) : null;
    return (
      <>
        <div className="rounded-(--r3) bg-s1 px-3.5 py-3 font-mono text-xs leading-[1.7] whitespace-pre-wrap text-ink2 shadow-[inset_0_0_0_1px_var(--line)]">
          {a.command ? (
            <span className="text-ink">$ {a.command}</span>
          ) : a.path ? (
            <>
              <span className="text-ink">
                {a.tool} {a.path}
              </span>
            </>
          ) : (
            <span className="text-ink">{a.tool}</span>
          )}
          {a.form === "tool" && Object.keys(a.input).length > 0 && (
            <>
              {"\n"}
              {JSON.stringify(a.input, null, 2).slice(0, 600)}
            </>
          )}
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {diff && (
            <Button size="sm" variant="outline" onClick={actions.seeDiff}>
              <Code /> See the diff
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={actions.ask}>
            <Reply /> Ask {agent.name} something
          </Button>
        </div>
      </>
    );
  }

  if (item.kind === "question") {
    const q = readQuestion(item);
    const send = () => {
      if (text.trim()) actions.resolve("ANSWERED", text.trim());
    };
    return (
      <>
        {q.choices.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {q.choices.map((c, i) => (
              <button
                key={c}
                type="button"
                disabled={actions.busy || item.state !== "open"}
                onClick={() => actions.resolve("ANSWERED", c)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-(--r3) bg-s1 px-3.5 py-3 text-left text-[13.5px] shadow-[inset_0_0_0_1px_var(--line)] transition-[background,box-shadow] hover:bg-s2 hover:shadow-[inset_0_0_0_1px_var(--line3)] disabled:cursor-default disabled:opacity-60"
              >
                <span className="grid size-5 place-items-center rounded-md bg-s3 text-[11px] text-ink3 tabular-nums">{i + 1}</span>
                {c}
              </button>
            ))}
          </div>
        )}
        {item.state === "open" ? (
          <ReplyBox value={text} onChange={setText} onSend={send} placeholder="Or answer in your own words…" disabled={actions.busy} />
        ) : q.answer ? (
          <div className="mt-2.5 rounded-(--r3) bg-s1 px-3.5 py-3 text-[13.5px] shadow-[inset_0_0_0_1px_var(--line)]">{q.answer}</div>
        ) : null}
      </>
    );
  }

  if (item.kind === "mention") {
    const m = readMention(item);
    const send = () => {
      if (text.trim()) actions.resolve("REPLIED", text.trim());
    };
    return (
      <>
        <div className="flex gap-3 rounded-(--r3) bg-s1 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
          <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 text-[12.5px]">
              <b className="font-semibold">{agent.name}</b>
              <em className="text-xs text-ink4 not-italic">{m.place}</em>
            </div>
            <div className="mt-0.5 line-clamp-[12] text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink2">{m.text}</div>
          </div>
        </div>
        {item.state === "open" && (
          <ReplyBox value={text} onChange={setText} onSend={send} placeholder={`Reply in ${item.channel ? `#${item.channel}` : `${agent.name}'s chat`}…`} disabled={actions.busy} />
        )}
      </>
    );
  }

  const d = readDone(item);
  return (
    <div className="rounded-(--r3) bg-s1 px-3.5 py-3 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink2 shadow-[inset_0_0_0_1px_var(--line)]">
      {d.summary}
    </div>
  );
}

function ReplyBox({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-1.5 rounded-full bg-card py-1 pr-1 pl-3.5 shadow-[inset_0_0_0_1px_var(--line2)]">
      <input
        value={value}
        data-ifree
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        className="h-[34px] min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink4"
      />
      <button
        type="button"
        aria-label="Send"
        disabled={disabled || !value.trim()}
        onClick={onSend}
        className="grid size-7 cursor-pointer place-items-center rounded-full bg-ink text-background transition-opacity disabled:opacity-40"
      >
        <ArrowUp className="size-[15px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <Kbd className="ml-0.5 -mr-1 bg-s2 text-ink3 group-data-[variant=solid]/button:bg-background/15 group-data-[variant=solid]/button:text-background/70">{children}</Kbd>;
}

const BAR = "h-[34px] px-3.5";

/// The bar under the reader: the decision, with the letter each button answers to.
export function ActionBar({
  item,
  agent,
  actions,
  settledAt,
}: {
  item: InboxItem;
  agent: RosterAgent;
  actions: ReaderActions;
  settledAt?: number;
}) {
  const { busy } = actions;
  const open = item.state === "open";
  let buttons: ReactNode;

  if (!open && item.kind !== "done") {
    const [word] = verdictCopy(item.resolution ?? "", agent.name);
    const undo = (
      <Button variant="ghost" className={cn(BAR, "ml-auto")} disabled={item.sent || busy} onClick={actions.undo}>
        <RefreshCw /> Undo
      </Button>
    );
    buttons = (
      <>
        <span className="flex items-center gap-2 font-medium" style={{ color: item.ok ? "var(--green)" : "var(--red)" }}>
          {item.ok ? <Check className="size-[15px]" /> : <X className="size-[15px]" />} {word} at {clockTime(settledAt ?? item.resolvedAt ?? item.created)}
        </span>
        {item.sent ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto">{undo}</span>
            </TooltipTrigger>
            <TooltipContent>Already sent</TooltipContent>
          </Tooltip>
        ) : (
          undo
        )}
      </>
    );
  } else if (item.kind === "approval") {
    const a = readApproval(item);
    if (a.form === "post") {
      buttons = (
        <>
          <Button variant="solid" className={BAR} disabled={busy} onClick={() => actions.resolve("ALLOWED")}>
            Approve and publish <Key>A</Key>
          </Button>
          <Button variant="outline" className={BAR} disabled={busy} onClick={actions.editFirst}>
            Edit first <Key>E</Key>
          </Button>
          <Button variant="bad" className={cn(BAR, "ml-auto")} disabled={busy} onClick={() => actions.resolve("NOT NOW")}>
            Not now <Key>D</Key>
          </Button>
        </>
      );
    } else {
      buttons = (
        <>
          <Button variant="solid" className={BAR} disabled={busy} onClick={() => actions.resolve("ALLOWED")}>
            Allow once <Key>A</Key>
          </Button>
          {a.always && (
            <Button variant="outline" className={BAR} disabled={busy} onClick={() => actions.resolve("ALWAYS")}>
              {a.always.replace(/`/g, "")}
            </Button>
          )}
          <Button variant="bad" className={cn(BAR, "ml-auto")} disabled={busy} onClick={() => actions.resolve("DENIED")}>
            Deny <Key>D</Key>
          </Button>
        </>
      );
    }
  } else if (item.kind === "question") {
    buttons = (
      <>
        <Button variant="outline" className={BAR} onClick={actions.openChat}>
          <Reply /> Open {agent.name}'s chat
        </Button>
        <Button variant="ghost" className={cn(BAR, "ml-auto")} disabled={busy} onClick={() => actions.resolve("SKIPPED")}>
          Skip for now <Key>D</Key>
        </Button>
      </>
    );
  } else if (item.kind === "mention") {
    buttons = (
      <>
        <Button variant="outline" className={BAR} onClick={actions.openChat}>
          <Reply /> Open {agent.name}'s chat
        </Button>
        <Button variant="ghost" className={cn(BAR, "ml-auto")} disabled={busy} onClick={() => actions.resolve("READ")}>
          Mark read <Key>D</Key>
        </Button>
      </>
    );
  } else {
    buttons = (
      <>
        <Button variant="outline" className={BAR} onClick={actions.openChat}>
          Open {agent.name}'s chat
        </Button>
        <Button variant="ghost" className={cn(BAR, "ml-auto")} onClick={actions.archive}>
          <Archive /> Archive <Key>D</Key>
        </Button>
      </>
    );
  }

  return (
    <div className="flex flex-none justify-center border-t border-line px-5 py-3">
      <div className="flex w-full max-w-[640px] items-center gap-2 px-3">{buttons}</div>
    </div>
  );
}

/// The check that replaces the reader for a beat after a decision.
export function Settled({ word, line, ok }: { word: string; line: string; ok: boolean }) {
  const tone = ok ? "var(--green)" : "var(--red)";
  return (
    <div className="flex animate-read-in flex-col items-center justify-center gap-3 py-20">
      <span
        className="grid size-[52px] animate-settle place-items-center rounded-full"
        style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}
      >
        {ok ? <Check className="size-6" strokeWidth={2.2} /> : <X className="size-6" strokeWidth={2.2} />}
      </span>
      <b className="text-base font-semibold">{word}</b>
      <span className="text-[13px] text-ink3">{line}</span>
    </div>
  );
}
