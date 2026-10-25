import { Check, Hash, Inbox, MessageSquare, MessageSquareReply, Webhook } from "lucide-react";
import { useState, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fieldClassName } from "@/components/ui/input";
import {
  ALL_DAYS,
  DAY_LETTERS,
  SOURCES,
  SOURCE_BRAND,
  TIME_PRESETS,
  WEEKDAYS,
  sentenceParts,
  type Channel,
  type Chip,
} from "@/lib/routines";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { RoutineInput } from "@/types/events";

/// A service's mark: its brand where there is one, a webhook glyph on paper where
/// it is custom.
export function SourceMark({ source, size = 16 }: { source: string; size?: number }) {
  const slug = SOURCE_BRAND[source];
  if (slug) return <BrandMark slug={slug} size={size} />;
  return (
    <span
      className="inline-grid shrink-0 place-items-center bg-(--paper) text-neutral-700"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      <Webhook style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={2} />
    </span>
  );
}

const CK =
  "cursor-pointer text-ink2 underline decoration-ink4 decoration-dotted underline-offset-[3px] transition-colors hover:text-ink hover:decoration-ink2 hover:decoration-solid focus-visible:outline-none focus-visible:text-ink";

/// A row in a chip's menu: an optional lead, a label, a check when it is the pick.
function Option({
  lead,
  children,
  sub,
  checked,
  onClick,
}: {
  lead?: ReactNode;
  children: ReactNode;
  sub?: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-(--r2) px-2 py-1.5 text-left text-[13px] text-ink2 outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover"
    >
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {sub && <span className="text-xs text-ink4">{sub}</span>}
      {checked && <Check className="size-3.5 text-ink" />}
    </button>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <div className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium text-ink3">{children}</div>
);

export type Patch = (patch: Partial<RoutineInput>) => void;

type SentenceProps = {
  routine: Pick<RoutineInput, "trigger" | "act" | "to" | "agentId" | "prompt">;
  agent: RosterAgent | null;
  agents: RosterAgent[];
  channels: Channel[];
  onPatch: Patch;
  /// "Edit the full prompt" in the what-it-does menu.
  onEditPrompt: () => void;
};

/// A routine as one sentence whose underlined words open their own menu: days,
/// time, who, what, where, which service, which event. Each pick is saved at once.
export default function Sentence({ routine, agent, agents, channels, onPatch, onEditPrompt }: SentenceProps) {
  const name = agent?.name ?? "Nobody";
  const parts = sentenceParts(routine, name, channels);
  return (
    // The card behind this opens the editor on a click; a click on a word is
    // not that, and the menus are portaled children that bubble the same way.
    <span onClick={(e) => e.stopPropagation()}>
      {parts.map((p, i) =>
        p.chip ? (
          <ChipMenu
            key={i}
            chip={p.chip}
            text={p.text}
            routine={routine}
            agent={agent}
            agents={agents}
            channels={channels}
            onPatch={onPatch}
            onEditPrompt={onEditPrompt}
          />
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

function ChipMenu({
  chip,
  text,
  routine,
  agent,
  agents,
  channels,
  onPatch,
  onEditPrompt,
}: SentenceProps & { chip: Chip; text: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pick: Patch = (patch) => {
    onPatch(patch);
    close();
  };
  const t = routine.trigger;
  const isAgent = chip === "agent";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            CK,
            isAgent && "inline-flex items-center gap-[5px] align-[-3px] font-medium text-ink no-underline hover:text-ink",
          )}
        >
          {isAgent && agent && <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={18} />}
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-1.5", chip === "act" ? "w-[340px]" : "w-[250px]")}>
        {chip === "agent" && (
          <>
            <Label>Who runs it</Label>
            {agents.map((a) => (
              <Option
                key={a.id}
                lead={<AgentTile id={a.id} kind={a.kind} color={a.color} size={20} />}
                sub={a.role}
                checked={a.id === routine.agentId}
                onClick={() => pick({ agentId: a.id })}
              >
                {a.name}
              </Option>
            ))}
          </>
        )}
        {chip === "to" && (
          <>
            <Label>Where the result goes</Label>
            <Option lead={<MessageSquare className="size-4 text-ink3" />} checked={routine.to === "agent_chat"} onClick={() => pick({ to: "agent_chat" })}>
              {agent?.name ?? "Agent"}&apos;s chat
            </Option>
            {channels.map((c) => (
              <Option key={c.id} lead={<Hash className="size-4 text-ink3" />} checked={routine.to === `channel:${c.id}`} onClick={() => pick({ to: `channel:${c.id}` })}>
                {c.name}
              </Option>
            ))}
            <Option lead={<Inbox className="size-4 text-ink3" />} checked={routine.to === "inbox"} onClick={() => pick({ to: "inbox" })}>
              Inbox
            </Option>
            <Option lead={<MessageSquareReply className="size-4 text-ink3" />} checked={routine.to === "pr_comment"} onClick={() => pick({ to: "pr_comment" })}>
              a PR comment
            </Option>
          </>
        )}
        {chip === "src" && t.kind === "webhook" && (
          <>
            <Label>Which service calls</Label>
            {Object.keys(SOURCES).map((s) => (
              <Option
                key={s}
                lead={<SourceMark source={s} size={18} />}
                checked={s === t.source}
                onClick={() => pick({ trigger: { kind: "webhook", source: s, event: SOURCES[s][0] } })}
              >
                {s}
              </Option>
            ))}
          </>
        )}
        {chip === "ev" && t.kind === "webhook" && (
          <>
            <Label>Which event</Label>
            {(SOURCES[t.source] ?? [t.event]).map((e) => (
              <Option key={e} checked={e === t.event} onClick={() => pick({ trigger: { kind: "webhook", source: t.source, event: e } })}>
                <code className="font-mono text-[11.5px]">{e}</code>
              </Option>
            ))}
          </>
        )}
        {chip === "time" && t.kind === "schedule" && (
          <TimeMenu time={t.time} onSet={(time) => pick({ trigger: { ...t, time } })} />
        )}
        {chip === "days" && t.kind === "schedule" && (
          <DaysMenu days={t.days} onSet={(days) => onPatch({ trigger: { ...t, days } })} onDone={close} />
        )}
        {chip === "act" && (
          <ActMenu
            name={agent?.name ?? "The agent"}
            value={routine.act}
            onSave={(act) => pick({ act })}
            onFull={() => {
              close();
              onEditPrompt();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function TimeMenu({ time, onSet }: { time: string; onSet: (time: string) => void }) {
  const [custom, setCustom] = useState(time);
  return (
    <>
      <Label>At</Label>
      {TIME_PRESETS.map((p) => (
        <Option key={p} checked={p === time} onClick={() => onSet(p)}>
          {p}
        </Option>
      ))}
      <div className="mt-1 flex gap-1.5 border-t border-line px-1 pt-2">
        <input
          type="time"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className={cn(fieldClassName, "h-[30px] py-0 tabular-nums")}
        />
        <Button size="sm" variant="solid" disabled={!custom} onClick={() => onSet(custom)}>
          Set
        </Button>
      </div>
    </>
  );
}

function DaysMenu({ days, onSet, onDone }: { days: number[]; onSet: (days: number[]) => void; onDone: () => void }) {
  return (
    <div className="px-1 pb-1">
      <Label>Which days</Label>
      <div className="flex gap-1">
        {DAY_LETTERS.map((letter, i) => {
          const on = days.includes(i);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => {
                // The last day stays: a schedule with none never runs, and says nothing.
                if (on && days.length === 1) return;
                onSet(on ? days.filter((d) => d !== i) : [...days, i].sort());
              }}
              className={cn(
                "grid size-[30px] cursor-pointer place-items-center rounded-full text-xs font-medium transition-colors",
                on ? "bg-ink text-background" : "bg-s2 text-ink3 hover:bg-s3",
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => onSet(ALL_DAYS)}>
          Every day
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSet(WEEKDAYS)}>
          Weekdays
        </Button>
        <Button size="sm" variant="solid" className="ml-auto" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ActMenu({
  name,
  value,
  onSave,
  onFull,
}: {
  name: string;
  value: string;
  onSave: (act: string) => void;
  onFull: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <div className="px-1 pb-1">
      <Label>What {name} does, in a few words</Label>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && text.trim() && onSave(text.trim())}
        className={fieldClassName}
      />
      <div className="mt-2 flex items-center">
        <button type="button" onClick={onFull} className="cursor-pointer text-xs text-ink2 underline decoration-ink4 underline-offset-[3px] hover:text-ink">
          Edit the full prompt
        </button>
        <Button size="sm" variant="solid" className="ml-auto" disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          Save
        </Button>
      </div>
    </div>
  );
}
