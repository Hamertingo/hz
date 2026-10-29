import { BellOff } from "lucide-react";

import AgentIcon from "@/components/AgentIcon";
import AgentTile from "@/components/AgentTile";
import { DROP_LINE } from "@/hooks/useDragReorder";
import type { Pose } from "@/lib/face";
import { type Activity, stateFor } from "@/lib/agentStatus";
import { useMe } from "@/hooks/useMe";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

/// One line of the sidebar, an agent or a channel, with everything the row and the pinned tile draw.
export type Conv = {
  /// The agent's id, or `#` and the channel's.
  row: string;
  kind: "agent" | "channel";
  id: string;
  name: string;
  /// The agent's role, or "3 agents" for a channel.
  role: string;
  color: string;
  agent?: RosterAgent;
  /// A channel's lead, drawn as a small face on the corner of its tile.
  lead?: RosterAgent;
  pose: Pose;
  at: number;
  time: string;
  line: string;
  working: boolean;
  /// What it is doing while it works, said in place of its last line.
  activity?: Activity | null;
  /// The teammates a team activity names ("working for Viktor").
  who?: string;
  /// It wrote to `who` and is waiting on the answer: said in amber where it is otherwise idle.
  waitingFor?: boolean;
  asking: boolean;
  unread: boolean;
  /// How far the row had got, so marking it read can remember it.
  token: string;
  muted: boolean;
};

/// What a working agent is doing, in place of its last line: a small breathing dot and the words, with a sheen.
function RowActivity({ activity, who }: { activity: Activity; who?: string }) {
  const me = useMe();
  return (
    <span key={activity} className="row-act flex min-w-0 items-center gap-1.5">
      <i className="row-act-dot" aria-hidden />
      <span className="row-act-text truncate">{stateFor(activity, me.language, true, who)}…</span>
    </span>
  );
}

/// "Waiting for Viktor", in amber: it wrote to a teammate and the answer is not in.
function WaitingFor({ who }: { who: string }) {
  const me = useMe();
  return <span className="truncate text-amber">{stateFor("waitingFor", me.language, true, who)}</span>;
}

/// A channel's face: a tinted square with the hash, in its lead's colour.
export function ChannelTile({ color, size, className, lead }: { color: string; size: number; className?: string; lead?: RosterAgent }) {
  return (
    <span
      aria-hidden
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: `color-mix(in srgb, ${color} 20%, transparent)`,
        color: `color-mix(in srgb, ${color} 80%, var(--ink))`,
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      #
      {lead && size >= 28 && (
        <span className="absolute -right-1 -bottom-1 grid rounded-full bg-(--side) p-[1.5px]">
          <AgentTile id={lead.id} kind={lead.kind} color={lead.color} shape={lead.shape} look={lead.look} photo={lead.photo} size={Math.round(size * 0.42)} />
        </span>
      )}
    </span>
  );
}

function Lead({ c, size }: { c: Conv; size: number }) {
  return c.agent ? (
    <AgentTile id={c.agent.id} kind={c.agent.kind} color={c.agent.color} shape={c.agent.shape} look={c.agent.look} photo={c.agent.photo} pose={c.pose} size={size} gaze className="side-face" />
  ) : (
    <ChannelTile color={c.color} size={size} lead={c.lead} className="side-face" />
  );
}

/// A conversation in the list: face, name, engine, role and time on the first line; what it is doing or last
/// said on the second, with the unread dot or the working dots.
export function ConvRow({
  c,
  active,
  selected,
  index,
  onOpen,
  dnd,
  drop,
  dragging,
  ...rest
}: Omit<React.ComponentProps<"div">, "onClick"> & {
  c: Conv;
  active: boolean;
  selected: boolean;
  index: number;
  onOpen: () => void;
  dnd: object;
  drop: "before" | "after" | "on" | null;
  dragging: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-active={active || undefined}
      data-drop={drop ?? undefined}
      data-dragging={dragging || undefined}
      {...rest}
      {...dnd}
      style={{ "--i": index } as React.CSSProperties}
      className={cn(
        "side-row flex w-full cursor-pointer items-center gap-2.5 rounded-(--r2) px-2 py-[7px] outline-none transition-[background,transform] duration-100 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 data-[active]:bg-active",
        selected && "shadow-[inset_0_0_0_1.5px_var(--ink3)]",
        DROP_LINE,
      )}
    >
      <Lead c={c} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-ink">{c.name}</span>
          {c.role && <span className="min-w-0 truncate rounded-[6px] bg-s3 px-1.5 py-px text-[11.5px] text-ink3">{c.role}</span>}
          {c.agent && (
            <span className={cn("inline-flex size-4 shrink-0 items-center justify-center", c.agent.harness === "claude-acp" ? "text-[#d97757]" : "text-ink")}>
              <AgentIcon harness={c.agent.harness} className="size-[13px]" />
            </span>
          )}
          <span className="ml-auto shrink-0 pl-1.5 text-[11.5px] text-ink3 tabular-nums">{c.time}</span>
        </div>
        <div className={cn("mt-px flex items-center gap-1.5 text-[13px] leading-[1.5]", c.unread ? "text-ink" : "text-ink3")}>
          {c.working ? (
            <RowActivity activity={c.activity ?? "thinking"} who={c.who} />
          ) : c.asking && !c.line ? (
            <span className="truncate text-amber">Waiting for you</span>
          ) : c.waitingFor ? (
            <WaitingFor who={c.who ?? ""} />
          ) : (
            <span className="truncate">{c.line}</span>
          )}
          {c.agent?.paused && <span className="shrink-0 text-[11px] text-ink4">Paused</span>}
          {c.unread ? (
            <span aria-label="Unread" className="side-dot ml-auto size-[7px] shrink-0 rounded-full bg-blue" />
          ) : c.muted ? (
            <BellOff aria-label="Muted" className="ml-auto size-3 shrink-0 text-ink4" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/// A pinned conversation as a face with its name under it.
export function PinTile({
  c,
  active,
  onOpen,
  dnd,
  count = 4,
  ...rest
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  c: Conv;
  active: boolean;
  /// How many pins share the strip: one is a big card, and each one added shrinks them all.
  count?: number;
  onOpen: () => void;
  dnd?: object;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={c.name}
      data-gaze
      data-active={active || undefined}
      {...rest}
      {...dnd}
      className="side-pin relative flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-(--r2) px-0.5 pt-2 pb-1.5 outline-none transition-[background,transform] duration-100 hover:bg-active focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Lead c={c} size={count <= 1 ? 52 : count === 2 ? 46 : count === 3 ? 40 : 36} />
      <b className={cn("max-w-full truncate font-medium", count <= 1 ? "text-[13.5px]" : "text-[12px]", active ? "text-ink" : "text-ink2")}>{c.name}</b>
      {c.unread && <span aria-label="Unread" className="side-dot absolute top-2 right-3 size-[7px] rounded-full bg-blue shadow-[0_0_0_2px_var(--side)]" />}
    </button>
  );
}
