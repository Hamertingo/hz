import { useMemo, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { archiveInboxItem, resolveInboxItem, useInbox } from "@/hooks/useInbox";
import { readApproval, readQuestion, verdictCopy } from "@/lib/inbox";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/types/events";

/// What is waiting on the reader, answerable from where they stand: allow or deny an approval, pick an answer
/// to a question, dismiss a mention, all without leaving the chat. The full page is one link away for anything
/// that needs the diff or the trail.
export default function InboxPopover({
  agents,
  onOpenAgent,
  onOpenPage,
  onClose,
}: {
  agents: readonly RosterAgent[];
  onOpenAgent: (agentId: string) => void;
  onOpenPage: () => void;
  onClose: () => void;
}) {
  const { items } = useInbox();
  const [busy, setBusy] = useState<string | null>(null);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const mine = items.filter((i) => byId.has(i.agentId) && !i.archived);
  const open = mine.filter((i) => i.state === "open");
  const handled = mine.filter((i) => i.state !== "open").slice(0, 3);

  const decide = async (item: InboxItem, verdict: string, extra?: string) => {
    if (busy) return;
    setBusy(item.id);
    const who = byId.get(item.agentId)?.name ?? "The agent";
    try {
      await resolveInboxItem(item.id, verdict, extra);
      const form = item.kind === "approval" ? readApproval(item).form : undefined;
      toast(verdictCopy(verdict, who, form)[0] + " · " + item.title, { ms: 2200 });
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex max-h-[min(520px,70vh)] w-[368px] flex-col">
      <div className="group/lbl flex items-center px-[9px] pt-1.5 pb-[3px] text-[11.5px] font-medium text-ink3">
        Waiting for you · {open.length}
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenPage();
          }}
          className="ml-auto cursor-pointer rounded-md px-1.5 text-[11.5px] text-ink3 opacity-0 transition-opacity outline-none group-hover/lbl:opacity-100 hover:text-ink focus-visible:opacity-100"
        >
          Open the inbox
        </button>
      </div>
      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:auto]!">
        {open.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-7 text-center text-[12.5px] text-ink3">
            {agents[0] ? <AgentTile id={agents[0].id} kind={agents[0].kind} color={agents[0].color} size={44} pose="sleep" /> : null}
            Nothing waiting. You're all caught up.
          </div>
        )}
        {open.map((item) => (
          <Item key={item.id} item={item} agent={byId.get(item.agentId)!} busy={busy === item.id} onDecide={decide} onOpen={() => { onClose(); onOpenAgent(item.agentId); }} />
        ))}
        {handled.length > 0 && (
          <>
            <div className="mx-2 my-1 border-t border-line" />
            <div className="px-[9px] pt-1.5 pb-[3px] text-[11.5px] font-medium text-ink3">Handled</div>
            {handled.map((item) => {
              const agent = byId.get(item.agentId)!;
              return (
                <div key={item.id} className="flex gap-[11px] rounded-(--r2) p-2.5 opacity-50">
                  <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={30} pose="idle" />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-medium">{item.title}</b>
                    <span className="text-xs text-ink3">{item.resolution ? verdictCopy(item.resolution, agent.name)[0] : "Done"}</span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Item({
  item,
  agent,
  busy,
  onDecide,
  onOpen,
}: {
  item: InboxItem;
  agent: RosterAgent;
  busy: boolean;
  onDecide: (item: InboxItem, verdict: string, extra?: string) => void;
  onOpen: () => void;
}) {
  const post = item.kind === "approval" && readApproval(item).form === "post";
  const choices = item.kind === "question" ? readQuestion(item).choices : [];
  return (
    <div className="animate-pop-in flex items-start gap-[11px] rounded-(--r2) p-2.5 transition-colors hover:bg-s2">
      <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={30} pose="idle" />
      <div className="min-w-0 flex-1">
        <b className="block text-[13px] font-medium leading-[1.5]">{item.title}</b>
        {item.sub && <p className="mt-px mb-[9px] text-[12.5px] leading-[1.45] text-ink3">{item.sub}</p>}
        <div className={cn("flex flex-wrap gap-[5px]", !item.sub && "mt-2")}>
          {item.kind === "approval" && (
            <>
              <Button size="sm" variant="solid" disabled={busy} onClick={() => onDecide(item, "ALLOWED")}>
                {post ? "Approve" : "Allow"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(item, post ? "NOT NOW" : "DENIED")}>
                {post ? "Not now" : "Deny"}
              </Button>
            </>
          )}
          {item.kind === "question" &&
            choices.map((c, k) => (
              <Button key={c} size="sm" variant={k === 0 ? "solid" : "outline"} disabled={busy} onClick={() => onDecide(item, "ANSWERED", c)}>
                {c}
              </Button>
            ))}
          {item.kind === "question" && choices.length === 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(item, "SKIPPED")}>
              Skip
            </Button>
          )}
          {item.kind === "mention" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(item, "READ")}>
              Mark read
            </Button>
          )}
          {item.kind === "done" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void archiveInboxItem(item.id, true).catch((e) => toast(String(e)))}>
              Archive
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Open chat
          </Button>
        </div>
      </div>
    </div>
  );
}
