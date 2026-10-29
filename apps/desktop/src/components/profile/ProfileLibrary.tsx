import { ExternalLink, FileText, Film, Image as ImageIcon, Link2 } from "lucide-react";

import BrandMark from "@/components/BrandMark";
import { Group, Row, Section } from "@/components/kit/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { BRANDS } from "@/lib/brands";
import { openSheet } from "@/lib/chatSheets";
import type { RosterAgent } from "@/lib/roster";
import type { ActivityScan, FeedItem } from "@/types/events";

/// "github.com" -> "github", when the app knows that brand.
function brandOf(url: string | null): string | null {
  try {
    const parts = new URL(url ?? "").hostname.split(".");
    const slug = parts.at(-2) ?? "";
    return slug in BRANDS ? slug : null;
  } catch {
    return null;
  }
}

/// What a feed row opens: a sheet beside the page, the chat, or a note.
function openFeedItem(
  item: FeedItem,
  agent: RosterAgent,
  go: { chat: () => void; note: (name: string) => void },
) {
  switch (item.kind) {
    case "pr":
      if (item.url && item.number && item.repo) {
        openSheet({ kind: "pr", number: item.number, repo: item.repo, url: item.url, agentId: agent.id });
      }
      break;
    case "file":
      if (item.path) openSheet({ kind: "file", path: item.path, agentId: agent.id });
      break;
    case "team_ask":
    case "team_message":
      openSheet({
        kind: "exchange",
        from: agent.name,
        to: item.peer ?? "a teammate",
        ask: item.ask ?? "",
        answer: item.answer ?? null,
        ts: new Date(item.atMs).toISOString(),
      });
      break;
    case "team_in":
      openSheet({
        kind: "exchange",
        from: item.peer ?? "a teammate",
        to: agent.name,
        ask: item.ask ?? "",
        answer: null,
        ts: new Date(item.atMs).toISOString(),
      });
      break;
    case "note":
      if (item.note) go.note(item.note);
      break;
    default:
      go.chat();
  }
}

const WEEK = 7 * 86_400_000;

/// "This week", "Last week", then a count back, so the list reads the way the mockup's does.
function weekLabel(ms: number, now: number): string {
  const n = Math.floor((now - ms) / WEEK);
  return n <= 0 ? "This week" : n === 1 ? "Last week" : `${n} weeks ago`;
}

/// What an agent made or opened, newest first, grouped by week.
export default function ProfileLibrary({ agent, scan, onOpenNote, onChat }: { agent: RosterAgent; scan: ActivityScan | null; onOpenNote: (name: string) => void; onChat: () => void }) {
  if (!scan)
    return (
      <div className="mt-3.5 space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-[10px]" />
        ))}
      </div>
    );
  const now = Date.now();
  const items = scan.feed.filter((f) => f.kind === "file" || f.kind === "image" || f.kind === "pr" || f.kind === "note" || f.url);
  const groups: { label: string; rows: FeedItem[] }[] = [];
  for (const f of items) {
    const label = weekLabel(f.atMs, now);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(f);
    else groups.push({ label, rows: [f] });
  }
  if (!groups.length) return <p className="px-1 py-8 text-center text-[12.5px] text-ink3">Nothing here yet. What {agent.name} makes shows up in this list.</p>;
  return (
    <>
      {groups.map((g) => (
        <div key={g.label}>
          <Section title={g.label} />
          <Group>
            {g.rows.map((f) => {
              const file = f.kind !== "pr" && !f.url;
              const brand = brandOf(f.url);
              const video = /\.(mp4|mov|webm)$/i.test(f.title);
              return (
                <Row
                  key={`${f.kind}-${f.seq}`}
                  bareLead
                  lead={brand ? <BrandMark slug={brand} size={34} /> : <span className="grid size-[26px] place-items-center rounded-[7px] bg-s3 text-ink2 [&_svg]:size-3.5">{video ? <Film /> : f.kind === "image" ? <ImageIcon /> : file ? <FileText /> : <Link2 />}</span>}
                  title={f.title}
                  sub={f.sub}
                  right={file ? undefined : <ExternalLink className="size-3.5 text-ink4" />}
                  onClick={() => openFeedItem(f, agent, { chat: onChat, note: onOpenNote })}
                />
              );
            })}
          </Group>
        </div>
      ))}
    </>
  );
}
