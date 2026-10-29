import { ChevronLeft, Lock } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";

import AgentTile from "@/components/AgentTile";
import { Markdown } from "@/components/chat/Markdown";
import { SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/useMe";
import { usePairDetail } from "@/hooks/useTeamTalk";
import { closeSheet, useChatSheet } from "@/lib/chatSheets";
import { formatClock } from "@/lib/clock";
import { useRoster, type RosterAgent } from "@/lib/roster";
import { talkWords } from "@/lib/teamTalk";

/// The thread two agents keep, drawn over the whole chat column as a chat of its
/// own: their two faces in the header, their messages as bubbles, and in place of
/// a composer a note that the reader can read it but not write in it.
export default function ThreadView() {
  const sheet = useChatSheet();
  if (sheet?.kind !== "thread") return null;
  return <Thread a={sheet.a} b={sheet.b} />;
}

function Thread({ a, b }: { a: string; b: string }) {
  const roster = useRoster();
  const words = talkWords(useMe().language);
  const detail = usePairDetail(a, b);
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentA = roster.agents.find((x) => x.id === a);
  const agentB = roster.agents.find((x) => x.id === b);
  const messages = detail ? detail.messages : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSheet();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opens on the newest message, and follows new ones while live.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      <header className="relative flex h-(--titlebar-h) shrink-0 items-center justify-center px-3" data-tauri-drag-region="deep">
        <button
          type="button"
          onClick={closeSheet}
          aria-label={words.back}
          className="absolute left-3 grid size-8 cursor-pointer place-items-center rounded-full bg-s1 text-ink2 transition-colors hover:bg-s2 hover:text-ink"
        >
          <ChevronLeft className="size-4" strokeWidth={2.2} />
        </button>
        <div className="flex h-8 items-center gap-2 rounded-full bg-s1 pr-3.5 pl-1.5">
          <span className="flex items-center">
            {agentA && <Face agent={agentA} size={22} />}
            {agentB && <span className="-ml-2"><Face agent={agentB} size={22} /></span>}
          </span>
          <span className="text-[14px] font-semibold text-ink">
            {agentA?.name ?? "Agent"} {words.and} {agentB?.name ?? "Agent"}
          </span>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto flex max-w-[936px] flex-col gap-[5px] px-7 pt-4 pb-6">
          {detail === null ? (
            <SkeletonRegion label="Reading">
              <SkeletonText lines={4} />
            </SkeletonRegion>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink3">{words.empty}</p>
          ) : (
            messages.map((m, i) => {
              if (m.kind === "note") {
                return (
                  <p key={m.seq} className="my-2 text-center text-[12px] text-ink3">
                    {m.text}
                  </p>
                );
              }
              const agent = roster.agents.find((x) => x.id === m.from);
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const first = prev?.kind !== "message" || prev.from !== m.from;
              const last = next?.kind !== "message" || next.from !== m.from;
              return (
                <div key={m.seq} className={first ? "mt-3" : undefined}>
                  {first && (
                    <div className="mb-1 ml-[45px] text-[12.5px] font-semibold" style={{ color: agent?.color }}>
                      {agent?.name ?? "Agent"}
                    </div>
                  )}
                  <div className="flex items-end gap-[9px]">
                    <span className="w-9 shrink-0">{last && agent && <Face agent={agent} size={36} />}</span>
                    <div className="relative max-w-[min(640px,100%)] min-w-0 rounded-[16px] bg-s2 px-[13px] pt-2 pb-1.5 text-[13.5px] leading-[1.6] wrap-anywhere [&_.text-chat]:leading-[1.6] [--fs-chat:0.84375rem]">
                      <Markdown>{m.text}</Markdown>
                      <time className="mt-px block text-right text-[10.5px] text-ink4 tabular-nums">{formatClock(new Date(m.ts))}</time>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex shrink-0 justify-center pt-1 pb-4">
        <span className="inline-flex h-9 items-center gap-2 rounded-full bg-s1 px-4 text-[13px] text-ink3">
          <Lock className="size-3.5" strokeWidth={2} />
          {words.readOnly}
        </span>
      </div>
    </div>
  );
}

function Face({ agent, size }: { agent: RosterAgent; size: number }) {
  return <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={size} />;
}
