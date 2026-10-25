import { AtSign, Check, CircleHelp, Shield, X } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import { Skeleton, SkeletonRegion, SkeletonRows } from "@/components/ui/skeleton";
import { clockTime, verdictCopy, type InboxGroup } from "@/lib/inbox";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { InboxItem, InboxKind } from "@/types/events";

/// The glyph, its colour and its word for each kind. A settled row wears the
/// green check whatever it was, as the mockup draws it.
export const KIND: Record<InboxKind, { label: string; tone: string; Icon: typeof Shield }> = {
  approval: { label: "Approval", tone: "var(--amber)", Icon: Shield },
  question: { label: "Question", tone: "var(--blue)", Icon: CircleHelp },
  mention: { label: "Mention", tone: "var(--ink2)", Icon: AtSign },
  done: { label: "Done", tone: "var(--green)", Icon: Check },
};

/// The list half of the page: rows grouped Needs you / Mentions / Earlier today.
export default function InboxList({
  groups,
  agentOf,
  selectedId,
  onOpen,
}: {
  groups: InboxGroup[];
  agentOf: (id: string) => RosterAgent | undefined;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const shown = groups.filter((g) => g.items.length > 0);
  return (
    <div className="w-[340px] flex-none overflow-y-auto border-r border-line px-2 pt-1.5 pb-6" role="listbox" aria-label="Inbox">
      {shown.length === 0 && <div className="px-3 py-8 text-ink4">Nothing here.</div>}
      {shown.map((g) => (
        <div key={g.key}>
          <div className="flex items-center gap-1.5 px-2.5 pt-4 pb-1.5 text-[11.5px] font-medium text-ink4">{g.label}</div>
          {g.items.map((item) => {
            const agent = agentOf(item.agentId);
            return agent ? (
              <Row key={item.id} item={item} agent={agent} on={item.id === selectedId} onOpen={onOpen} />
            ) : null;
          })}
        </div>
      ))}
    </div>
  );
}

/// The list before its first read: a group heading and rows with an avatar and
/// two lines, where the real rows will stand.
export function InboxListSkeleton() {
  return (
    <SkeletonRegion label="Reading the inbox" className="w-[340px] flex-none overflow-hidden border-r border-line px-2 pt-1.5">
      <Skeleton className="mx-2.5 mt-4 mb-2 h-2.5 w-16" />
      <SkeletonRows count={3} size={32} avatar="circle" />
      <Skeleton className="mx-2.5 mt-5 mb-2 h-2.5 w-20" />
      <SkeletonRows count={2} size={32} avatar="circle" />
    </SkeletonRegion>
  );
}

/// The reader's own outline: an avatar and a title, a few paragraphs, and the
/// action bar's buttons.
export function InboxReaderSkeleton() {
  return (
    <SkeletonRegion label="Reading the inbox" className="flex min-h-0 flex-1 flex-col px-7 pt-14">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <div className="mt-6 flex max-w-[560px] flex-col gap-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="mt-3 h-24 w-full rounded-(--r3)" />
      </div>
      <div className="mt-auto flex gap-2 py-5">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </SkeletonRegion>
  );
}

function Row({ item, agent, on, onOpen }: { item: InboxItem; agent: RosterAgent; on: boolean; onOpen: (id: string) => void }) {
  const settled = item.state !== "open";
  const { tone, Icon } = KIND[settled ? "done" : item.kind];
  const showResult = settled && item.kind !== "done" && item.resolution;
  const [word] = verdictCopy(item.resolution ?? "", agent.name);
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      onClick={() => onOpen(item.id)}
      className={cn(
        "relative flex w-full cursor-pointer items-start gap-[11px] rounded-(--r3) p-2.5 text-left transition-colors hover:bg-hover",
        on && "bg-active",
      )}
    >
      <span className={cn("relative flex-none", settled && "opacity-60")}>
        <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={32} />
        <span
          className={cn("absolute -right-[3px] -bottom-[3px] grid size-[15px] place-items-center rounded-full text-on-signal ring-2", on ? "ring-card" : "ring-background")}
          style={{ background: tone }}
        >
          <Icon className="size-[9px]" strokeWidth={2.6} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("flex gap-2 text-[13px] leading-[1.4]", settled ? "font-[450] text-ink3" : "font-[550]")}>
          <span className="min-w-0 flex-1">{item.title}</span>
          <span className="flex-none pt-0.5 text-[11px] font-normal text-ink4 tabular-nums">
            {clockTime(item.resolvedAt ?? item.created)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink3">
          {agent.name}
          {item.sub ? ` · ${item.sub}` : ""}
        </span>
        {showResult && item.resolution !== "FINISHED" && (
          <span
            className="mt-[5px] inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: item.ok ? "var(--green)" : "var(--red)" }}
          >
            {item.ok ? <Check className="size-[11px]" /> : <X className="size-[11px]" />} {word}
          </span>
        )}
      </span>
    </button>
  );
}
