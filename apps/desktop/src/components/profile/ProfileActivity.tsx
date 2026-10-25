import { Clock, Code, FileText, MessageSquare, Reply, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Blk, clock } from "@/components/profile/parts";
import { openFeedItem } from "@/components/profile/ProfileOverview";
import {
  HEAT_WEEKS,
  buildHeatmap,
  dayHeading,
  monthLabels,
  startOfDay,
  workLabel,
  type HeatCell,
} from "@/lib/heatmap";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { ActivityScan, FeedItem } from "@/types/events";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "chat", label: "Chats" },
  { key: "file", label: "Files" },
  { key: "team", label: "Team" },
  { key: "routine", label: "Routines" },
] as const;

const ICON: Record<string, typeof Code> = {
  pr: Code,
  file: FileText,
  note: FileText,
  answer: Reply,
  team_ask: Users,
  team_message: Users,
  team_in: Users,
  routine: Clock,
};

/// One cell's colour: the agent's own, mixed up from the card it sits on. Mixed off
/// `--surface-card` rather than a fixed near-black, because a dark base is the page
/// in dark mode and a hole in the page in light.
function shade(level: HeatCell["level"], color: string): string {
  if (level < 1) return level < 0 ? "transparent" : "var(--heat-0, var(--s3))";
  const pct = [0, 30, 55, 80, 100][level];
  return `color-mix(in oklab, ${color} ${pct}%, var(--surface-card))`;
}

export default function ProfileActivity({
  agent,
  scan,
  onBack,
  onOpenNote,
}: {
  agent: RosterAgent;
  scan: ActivityScan | null;
  onBack: () => void;
  onOpenNote: (name: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [day, setDay] = useState<string | null>(null);
  const [hover, setHover] = useState<HeatCell | null>(null);
  const now = Date.now();

  const weeks = useMemo(() => (scan ? buildHeatmap(scan.messages, HEAT_WEEKS, now) : []), [scan, Math.floor(now / 3_600_000)]);
  const labels = useMemo(() => monthLabels(weeks), [weeks]);

  const since = weeks[0]?.[0]?.ms ?? 0;
  const messages = scan?.messages.filter((m) => m >= since).length ?? 0;
  const tasks = scan?.tasks.filter((t) => t.endMs >= since && t.ok).length ?? 0;
  const secs = scan?.tasks.filter((t) => t.endMs >= since).reduce((a, t) => a + t.secs, 0) ?? 0;

  const items = (scan?.feed ?? []).filter(
    (f) => (filter === "all" || f.group === filter) && (!day || dayKeyOf(f.atMs) === day),
  );
  const groups: { heading: string; rows: FeedItem[] }[] = [];
  for (const f of items) {
    const heading = dayHeading(f.atMs, now);
    const last = groups.at(-1);
    if (last?.heading === heading) last.rows.push(f);
    else groups.push({ heading, rows: [f] });
  }

  const readout = hover
    ? `${new Date(hover.ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${hover.count} ${hover.count === 1 ? "message" : "messages"}`
    : `${messages.toLocaleString("en-US")} messages · ${tasks.toLocaleString("en-US")} tasks · ${workLabel(secs)}`;

  return (
    <div>
      <Blk title={`Last ${HEAT_WEEKS} weeks`} action={readout}>
        <div className="mt-1 flex gap-[3px]" onMouseLeave={() => setHover(null)}>
          {weeks.map((wk, wi) => (
            <div key={wi} className="flex flex-1 flex-col gap-[3px]">
              {wk.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  tabIndex={c.level < 0 ? -1 : 0}
                  disabled={c.level < 0}
                  aria-label={`${c.key}: ${c.count} messages`}
                  onMouseEnter={() => setHover(c)}
                  onFocus={() => setHover(c)}
                  onClick={() => {
                    setDay(day === c.key ? null : c.key);
                    setFilter("all");
                  }}
                  className={cn(
                    "aspect-square w-full max-w-[15px] cursor-pointer rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    c.level < 0 && "cursor-default",
                    day === c.key && "ring-2 ring-ink",
                  )}
                  style={{ background: shade(c.level, agent.color) }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="relative mt-2 h-4 text-[11.5px] text-ink4">
          {labels.map((l) => (
            <span key={l.col} className="absolute" style={{ left: `${(l.col / Math.max(1, weeks.length)) * 100}%` }}>
              {l.label}
            </span>
          ))}
        </div>
      </Blk>

      <Blk title={<>Everything {agent.name} did</>} className="mt-[30px]">
        <div className="-mt-9 mb-3 flex items-center justify-end gap-1">
          {day && (
            <button
              type="button"
              onClick={() => setDay(null)}
              className="mr-2 flex cursor-pointer items-center gap-1.5 rounded-full bg-s2 px-2.5 py-0.5 text-xs text-ink2 hover:bg-s3"
            >
              {new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              <X className="size-2.5" />
            </button>
          )}
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "cursor-pointer rounded-(--r1) px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                filter === f.key ? "bg-active text-ink" : "text-ink3 hover:text-ink2",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {!scan ? (
          <SkeletonRegion label="Reading the log" className="relative flex flex-col gap-4 pl-[22px]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className={i % 2 ? "h-3 w-48" : "h-3 w-64"} />
                <Skeleton className="h-2.5 w-24" />
              </div>
            ))}
          </SkeletonRegion>
        ) : groups.length === 0 ? (
          <p className="text-[13px] text-ink3">
            {scan.feed.length === 0
              ? `Nothing yet. What ${agent.name} does lands here.`
              : filter === "routine"
                ? "No routine has run for this agent yet."
                : "Nothing matches."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.heading}>
              <div className="mt-6 mb-1.5 text-xs font-medium text-ink3 first:mt-0">{g.heading}</div>
              {g.rows.map((f, i) => {
                const Icon = ICON[f.kind] ?? MessageSquare;
                return (
                  <button
                    key={`${f.seq}-${f.kind}-${i}`}
                    type="button"
                    onClick={() => openFeedItem(f, agent, { chat: onBack, note: onOpenNote })}
                    className="-mx-2.5 flex w-[calc(100%+20px)] cursor-pointer items-center gap-3 rounded-(--r2) px-2.5 py-[9px] text-left text-[13px] transition-colors hover:bg-hover"
                  >
                    <span className="grid size-7 flex-none place-items-center rounded-(--r2) bg-s2 text-ink3">
                      <Icon className="size-[13px]" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate">{f.title}</div>
                      <div className="truncate text-xs text-ink3">{f.sub}</div>
                    </div>
                    <span className="ml-auto flex-none text-[11.5px] text-ink4">{clock(f.atMs)}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </Blk>
    </div>
  );
}

function dayKeyOf(ms: number): string {
  const d = new Date(startOfDay(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
