import { Check, ChevronDown, ChevronUp, Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import InboxList, { InboxListSkeleton, InboxReaderSkeleton } from "@/components/inbox/InboxList";
import { ActionBar, Reader, Settled, type ReaderActions } from "@/components/inbox/InboxReader";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  archiveInboxItem,
  markMentionsRead,
  resolveInboxItem,
  undoInboxItem,
  useInbox,
  useInboxLoaded,
} from "@/hooks/useInbox";
import { TabButton, TabRow } from "@/components/TabRow";
import {
  INBOX_FILTERS,
  diffOf,
  firstOpen,
  groupItems,
  inboxCounts,
  inboxOrder,
  keyAction,
  readApproval,
  stepFrom,
  verdictCopy,
  type InboxFilter,
} from "@/lib/inbox";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { useJumpTarget } from "@/lib/jumpTarget";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/types/events";

/// How long the reader fades out, and how long the check holds before the next
/// item comes up. The mockup's own numbers.
const FADE_MS = 200;
const HOLD_MS = 1100;

type SettledState = { id: string; word: string; line: string; ok: boolean };

/// The agents' inbox: a list of what is waiting on you and a reading pane that
/// takes one decision at a time. J and K move; the letter on a button acts.
export default function AgentInbox({
  active,
  workspaceAgents,
  onOpenAgent,
  onOpenProfile,
  onOpenAccess,
  onAsk,
}: {
  /// The page is up, so its keys are live.
  active: boolean;
  /// The agents of the workspace on screen, for the zero view.
  workspaceAgents: RosterAgent[];
  onOpenAgent: (agentId: string) => void;
  onOpenProfile: (agentId: string) => void;
  onOpenAccess: (agentId: string) => void;
  /// Opens the agent's chat with words waiting in the composer.
  onAsk: (agentId: string, text: string) => void;
}) {
  const { items, clearedToday } = useInbox();
  const loaded = useInboxLoaded();
  const roster = useRoster();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [sel, setSel] = useState<string | null | undefined>(undefined);
  // Jump to → Needs you lands on its item.
  useJumpTarget("inbox", (t) => setSel(t.id));
  const [leaving, setLeaving] = useState<string | null>(null);
  const [settled, setSettled] = useState<SettledState | null>(null);
  const [busy, setBusy] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const timers = useRef<number[]>([]);

  const agentOf = useCallback((id: string) => roster.agents.find((a) => a.id === id), [roster.agents]);
  const known = useMemo(() => items.filter((i) => agentOf(i.agentId)), [items, agentOf]);
  const groups = useMemo(() => groupItems(known, filter), [known, filter]);
  const order = useMemo(() => inboxOrder(groups), [groups]);
  const counts = useMemo(() => inboxCounts(known), [known]);

  // Undefined asks for the first thing waiting; null is the reader having
  // finished, which is the zero view even while settled rows sit in the list.
  const current: InboxItem | null =
    sel === null ? null : (order.find((i) => i.id === sel) ?? order.find((i) => i.state === "open") ?? null);
  const agent = current ? agentOf(current.agentId) : undefined;

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) window.clearTimeout(t);
    };
  }, []);

  const settledRef = useRef<SettledState | null>(null);
  settledRef.current = settled;
  // Read on every render by the key handler and the timers below.
  const latest = useRef({ order, current, busy });
  latest.current = { order, current, busy };

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const decide = useCallback(
    async (item: InboxItem, verdict: string, extra?: string) => {
      if (latest.current.busy) return;
      const who = agentOf(item.agentId)?.name ?? "The agent";
      const form = item.kind === "approval" ? readApproval(item).form : undefined;
      setBusy(true);
      try {
        const next = await resolveInboxItem(item.id, verdict, extra);
        const after = next.items.find((i) => i.id === item.id);
        const [word, line] = verdictCopy(verdict === "ALWAYS" ? "ALLOWED" : verdict, who, form);
        const ok = verdict !== "DENIED" && verdict !== "NOT NOW" && verdict !== "SKIPPED";
        setLeaving(item.id);
        later(() => setSettled({ id: item.id, word, line, ok }), FADE_MS);
        later(() => {
          const open = firstOpen(inboxOrder(groupItems(next.items.filter((i) => agentOf(i.agentId)), filter)));
          setSel(open);
          setSettled(null);
          setLeaving(null);
        }, HOLD_MS);
        const always = item.kind === "approval" ? readApproval(item).always?.replace(/`/g, "") : null;
        const message = verdict === "ALWAYS" && always ? `${always}. ${who} won't ask again.` : `${word} · ${item.title}`;
        if (after && !after.sent) {
          toast(message, {
            icon: ok ? <Check /> : undefined,
            action: { label: "Undo", onClick: () => void undo(item.id) },
          });
        } else {
          toast(`${message} · sent to ${who}`, { icon: ok ? <Check /> : undefined });
        }
      } catch (e) {
        toast(String(e).replace(/^Error: /, ""));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentOf, filter],
  );

  const undo = async (id: string) => {
    try {
      await undoInboxItem(id);
      setSettled(null);
      setLeaving(null);
      setSel(id);
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };

  const archive = async (item: InboxItem) => {
    try {
      await archiveInboxItem(item.id, true);
      setSel(undefined);
      toast("Archived", { action: { label: "Undo", onClick: () => void archiveInboxItem(item.id, false).then(() => setSel(item.id)) } });
    } catch (e) {
      toast(String(e));
    }
  };

  const step = useCallback(
    (delta: number) => {
      const id = stepFrom(latest.current.order, latest.current.current?.id ?? null, delta);
      if (id) {
        setSettled(null);
        setLeaving(null);
        setSel(id);
      }
    },
    [],
  );

  // J and K walk the list; the letters the buttons wear decide. Dormant while
  // the reader is typing, a sheet is up, or the pane is showing its check.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']") || target.closest("[role='dialog']"))) return;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "arrowdown") {
        e.preventDefault();
        return step(1);
      }
      if (key === "k" || key === "arrowup") {
        e.preventDefault();
        return step(-1);
      }
      const { current: item, busy: working } = latest.current;
      if (!item || working || settledRef.current) return;
      const action = keyAction(item, key);
      if (!action) return;
      e.preventDefault();
      if (action.type === "resolve") void decide(item, action.verdict);
      else if (action.type === "answer") void decide(item, "ANSWERED", action.choice);
      else if (action.type === "archive") void archive(item);
      else if (action.type === "edit") onAsk(item.agentId, "Before you publish: ");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, decide, step, onAsk]);

  const readAll = async () => {
    try {
      const n = await markMentionsRead();
      toast(n === 0 ? "No mentions to mark" : `${n} mention${n === 1 ? "" : "s"} marked read`, { icon: n ? <Check /> : undefined, ms: n ? undefined : 1400 });
    } catch (e) {
      toast(String(e));
    }
  };

  const actions: ReaderActions | null =
    current && agent
      ? {
          resolve: (verdict, extra) => void decide(current, verdict, extra),
          archive: () => void archive(current),
          undo: () => void undo(current.id),
          openChat: () => onOpenAgent(agent.id),
          openProfile: () => onOpenProfile(agent.id),
          openAccess: () => onOpenAccess(agent.id),
          ask: () => onAsk(agent.id, "Before you go on: "),
          editFirst: () => onAsk(agent.id, "Before you publish: "),
          seeDiff: () => setDiffOpen(true),
          busy,
        }
      : null;

  const position = current ? order.findIndex((i) => i.id === current.id) + 1 : 0;
  const diff = current && current.kind === "approval" ? diffOf(readApproval(current).input) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-none items-center gap-3.5 px-4">
        <TabRow>
          {INBOX_FILTERS.map((f) => (
            <TabButton key={f.key} active={filter === f.key} label={f.label} count={counts[f.key]} onClick={() => {
              setFilter(f.key);
              setSel(undefined);
            }} />
          ))}
        </TabRow>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-xs text-ink4">{clearedToday} cleared today</span>
          <Button variant="ghost" size="sm" onClick={() => void readAll()}>
            <Check /> Mark mentions read
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {!loaded ? <InboxListSkeleton /> : <InboxList groups={groups} agentOf={agentOf} selectedId={current?.id ?? null} onOpen={(id) => {
          setSettled(null);
          setLeaving(null);
          setSel(id);
        }} />}

        <div className="relative flex min-w-0 flex-1 flex-col" style={{ "--tint": agent?.color ?? "var(--green)" } as React.CSSProperties}>
          {!loaded ? (
            <InboxReaderSkeleton />
          ) : current && agent && actions ? (
            <>
              <div className="flex h-12 flex-none items-center gap-1.5 pr-3.5 pl-7 text-xs text-ink3">
                <span>
                  <Key>J</Key> <Key>K</Key> to move{current.state === "open" ? " · letters on the buttons act" : ""}
                </span>
                <span className="mr-1 ml-auto tabular-nums">
                  {position} of {order.length}
                </span>
                <Nav label="Previous" keyName="K" onClick={() => step(-1)} icon={<ChevronUp />} />
                <Nav label="Next" keyName="J" onClick={() => step(1)} icon={<ChevronDown />} />
              </div>
              {settled && settled.id === current.id ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <Settled word={settled.word} line={settled.line} ok={settled.ok} />
                </div>
              ) : (
                <>
                  <Reader item={current} agent={agent} actions={actions} leaving={leaving === current.id} />
                  <div className={cn(leaving === current.id && "invisible")}>
                    <ActionBar item={current} agent={agent} actions={actions} />
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Zero agents={workspaceAgents} cleared={clearedToday} onOpen={onOpenAgent} />
            </div>
          )}
        </div>
      </div>

      {current && agent && diff && (
        <Sheet
          open={diffOpen}
          onOpenChange={setDiffOpen}
          width={600}
          title={diff.path?.split("/").pop() ?? "The change"}
          sub={diff.path ?? undefined}
          icon={<AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={28} />}
          footer={
            current.state === "open" ? (
              <>
                <Button variant="bad" onClick={() => { setDiffOpen(false); void decide(current, "DENIED"); }}>
                  Deny
                </Button>
                <Button variant="solid" className="ml-auto" onClick={() => { setDiffOpen(false); void decide(current, "ALLOWED"); }}>
                  Allow once
                </Button>
              </>
            ) : undefined
          }
        >
          <div className="overflow-hidden rounded-(--r3) bg-s1 font-mono text-[11.5px] leading-[1.75] shadow-[inset_0_0_0_1px_var(--line)]">
            {diff.lines.map((l, i) => (
              <div
                key={i}
                className={cn(
                  "px-3.5 whitespace-pre",
                  l.kind === "add" && "bg-green/8 text-green",
                  l.kind === "del" && "bg-red/8 text-red",
                )}
              >
                {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
                {l.text}
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="inline-block rounded-[5px] bg-s3 px-[5px] py-px font-sans text-[11px] leading-4 text-ink3">{children}</kbd>;
}

function Nav({ label, keyName, onClick, icon }: { label: string; keyName: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label} (${keyName})`}
          onClick={onClick}
          className="grid size-7 cursor-pointer place-items-center rounded-(--r2) text-ink3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[15px]"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label} ({keyName})
      </TooltipContent>
    </Tooltip>
  );
}

/// Inbox zero: the faces of the team, and what each is doing.
function Zero({ agents, cleared, onOpen }: { agents: RosterAgent[]; cleared: number; onOpen: (id: string) => void }) {
  return (
    <div className="mx-auto max-w-[420px] animate-read-in px-6 py-[110px] text-center">
      <div className="mb-[22px] flex justify-center">
        {agents.length === 0 ? (
          <span className="grid size-12 place-items-center rounded-full bg-s2 text-ink3">
            <Inbox className="size-5" />
          </span>
        ) : (
          agents.slice(0, 5).map((a) => (
            <span key={a.id} className="-ml-2 flex rounded-xl ring-[3px] ring-background first:ml-0">
              <AgentTile id={a.id} kind={a.kind} color={a.color} size={40} />
            </span>
          ))
        )}
      </div>
      <h2 className="text-xl font-semibold tracking-[-0.02em]">You're all caught up</h2>
      <p className="mt-1.5 leading-[1.55] text-ink3">
        {cleared === 0 ? "Nothing cleared yet today." : `${cleared} thing${cleared === 1 ? "" : "s"} cleared today.`} Your agents will knock when they need a decision.
      </p>
      <div className="mt-[22px] flex flex-wrap justify-center gap-1.5">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a.id)}
            className="flex h-7 cursor-pointer items-center gap-[7px] rounded-full bg-s2 pr-2.5 pl-[3px] text-xs text-ink2 transition-colors hover:bg-s3 hover:text-ink"
          >
            <AgentTile id={a.id} kind={a.kind} color={a.color} size={22} className="rounded-full" />
            {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}
