import { Clock, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import RoutineEditor from "@/components/routines/RoutineEditor";
import RoutinesSkeleton from "@/components/routines/RoutinesSkeleton";
import RoutineRow from "@/components/routines/RoutineRow";
import RunSheet from "@/components/routines/RunSheet";
import WeekStrip from "@/components/routines/WeekStrip";
import { Button } from "@/components/ui/button";
import { PageSheet } from "@/components/ui/page-sheet";
import { toast } from "@/components/ui/toast";
import { useRoutines } from "@/hooks/useRoutines";
import type { RosterAgent } from "@/lib/roster";
import {
  blankRoutine,
  counts,
  dateKeyIn,
  filterRoutines,
  inputOf,
  newSecret,
  nextText,
  weekBuckets,
  type Channel,
  type Filter,
  type WeekMark,
} from "@/lib/routines";
import { takeRoutineDraft, useRoutineDraft } from "@/lib/routineDraft";
import { useJumpTarget } from "@/lib/jumpTarget";
import { cn } from "@/lib/utils";
import type { Routine, RoutineInput } from "@/types/events";

const TABS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "schedule", label: "Scheduled" },
  { key: "webhook", label: "Webhooks" },
];

const LINK = "cursor-pointer text-ink underline decoration-ink4 underline-offset-[3px]";

/// The page: a week of runs, then every routine as a sentence whose underlined
/// words change it. Backed by `automations.rs`; this file holds no schedule of
/// its own and draws what the backend says.
export default function RoutinesView({
  active,
  agents,
  allAgents,
  workspaceName,
  channels,
  onOpenChat,
  onClose,
}: {
  active: boolean;
  onClose?: () => void;
  /// The workspace's agents, who a routine can be given to.
  agents: RosterAgent[];
  /// Every agent, so a routine of another workspace's agent is not drawn as nobody's.
  allAgents: RosterAgent[];
  workspaceName: string;
  channels: Channel[];
  onOpenChat: (agentId: string) => void;
}) {
  const r = useRoutines(active);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<{ seed: RoutineInput; existing: Routine | null } | null>(null);
  const [mark, setMark] = useState<WeekMark | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const draft = useRoutineDraft();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  // A run that just finished should pop in without waiting for the next tick.
  useEffect(() => setNow(Date.now()), [r.routines]);

  const inWorkspace = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const known = useMemo(() => new Set(allAgents.map((a) => a.id)), [allAgents]);
  // Mine: the workspace's agents' routines, plus the ones from before agents.
  const mine = useMemo(
    () => r.routines.filter((x) => inWorkspace.has(x.agentId) || !known.has(x.agentId)),
    [r.routines, inWorkspace, known],
  );
  const [dayKey, setDayKey] = useState<string | null>(null);
  const week = useMemo(() => weekBuckets(mine, now), [mine, now]);
  const onDay = useMemo(
    () => new Set(week.find((d) => d.date === dayKey)?.marks.map((m) => m.routineId)),
    [week, dayKey],
  );
  const shown = filterRoutines(mine, filter).filter((x) => dayKey === null || onDay.has(x.id));
  const tabCounts = counts(mine);
  const agentOf = (id: string) => allAgents.find((a) => a.id === id) ?? null;

  const openNew = useCallback(
    (prompt = "", agentId?: string | null) => {
      const who = agents.find((a) => a.id === agentId) ?? agents[0];
      setEditing({
        seed: { ...blankRoutine(who?.id ?? "", crypto.randomUUID(), newSecret()), prompt },
        existing: null,
      });
    },
    [agents],
  );

  // Jump to → Routines opens the routine in the editor; "New routine" opens a blank one.
  const [wanted, setWanted] = useState<string | null>(null);
  useJumpTarget("routine", (t) => (t.id === null ? openNew() : setWanted(t.id)));
  // Waits for the list: a page opened by the jump has not read its routines yet.
  useEffect(() => {
    const existing = wanted ? r.routines.find((x) => x.id === wanted) : undefined;
    if (!existing) return;
    setEditing({ seed: inputOf(existing), existing });
    setWanted(null);
  }, [wanted, r.routines]);

  // `/routine` and "Make it a routine" leave their words here; the editor takes them.
  useEffect(() => {
    if (!active || !draft) return;
    const taken = takeRoutineDraft();
    if (taken) openNew(taken.text, taken.agentId);
  }, [active, draft, openNew]);

  const patch = (routine: Routine, change: Partial<RoutineInput>) => void r.save({ ...inputOf(routine), ...change });

  const remove = async (routine: Routine) => {
    await r.remove(routine.id);
    setEditing(null);
    toast(`${routine.name} deleted`, {
      icon: <Clock />,
      ms: 8000,
      action: { label: "Undo", onClick: () => void r.restore(routine.id) },
    });
  };

  const run = async (routine: Routine) => {
    setMark(null);
    await r.runNow(routine.id);
  };

  const skip = async (routine: Routine, date: string) => {
    setMark(null);
    if (await r.skip(routine.id, date)) toast("Skipped. It runs again as usual after this.", { icon: <Clock /> });
  };

  const toggle = async (routine: Routine, on: boolean) => {
    await r.setOn(routine.id, on);
  };

  const save = async (input: RoutineInput) => {
    const saved = await r.save(input);
    if (!saved) return false;
    const fresh = editing?.existing === null;
    toast(fresh ? `${saved.name} is on · next ${nextText(saved, Date.now())}` : "Saved", { icon: <Clock /> });
    if (fresh) setFilter("all");
    return true;
  };

  const duplicate = async (routine: Routine) => {
    if (await r.duplicate(routine.id)) toast(`${routine.name} copied. The copy is paused.`, { icon: <Clock /> });
  };

  const skipNext = async (routine: Routine) => {
    if (!routine.nextRunAt || routine.trigger.kind !== "schedule") return;
    await skip(routine, dateKeyIn(routine.trigger.tz, Date.parse(routine.nextRunAt)));
  };

  const markRoutine = mark ? r.routines.find((x) => x.id === mark.routineId) : undefined;

  return (
    <PageSheet
      active={active}
      title="Routines"
      onClose={onClose}
      actions={
        <Button variant="solid" onClick={() => openNew()} disabled={agents.length === 0}>
          <Plus className="size-3.5" /> New routine
        </Button>
      }
    >
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-5">
          {r.error && <p className="mb-4 text-[13px] text-red">{r.error}</p>}
          {!r.loaded ? (
            <RoutinesSkeleton />
          ) : (
            <>
          {mine.length > 0 && <WeekStrip days={week} routines={mine} selected={dayKey} onSelect={setDayKey} onOpen={setMark} />}

          <div className="mx-1 mt-5 mb-2 flex items-baseline gap-1.5 leading-normal">
            <b className="text-xs leading-normal font-medium text-ink3">{filter === "all" ? "All routines" : TABS.find((t) => t.key === filter)?.label}</b>
            <i className="text-xs not-italic text-ink4">{shown.length}</i>
            {tabCounts.webhook > 0 && (
              <span className="ml-auto flex gap-0.5">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilter(t.key)}
                    className={cn(
                      "h-[22px] cursor-pointer rounded-full px-2 text-[11.5px] font-medium transition-colors",
                      filter === t.key ? "bg-s3 text-ink" : "text-ink3 hover:text-ink",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </span>
            )}
          </div>

          {shown.length > 0 && (
          <div className="flex flex-col gap-0 rounded-[13px] bg-s1 shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:top-0 [&>*+*]:before:right-0 [&>*+*]:before:left-3 [&>*+*]:before:h-px [&>*+*]:before:bg-line">
            {shown.map((routine) => (
              <RoutineRow
                key={routine.id}
                routine={routine}
                agent={agentOf(routine.agentId)}
                agents={agents}
                running={r.running.find((x) => x.id === routine.id)}
                onEdit={() => setEditing({ seed: inputOf(routine), existing: routine })}
                onPatch={(change) => patch(routine, change)}
                onRun={() => void run(routine)}
                onToggle={(on) => void toggle(routine, on)}
                onDuplicate={() => void duplicate(routine)}
                onSkip={() => void skipNext(routine)}
                onDelete={() => void remove(routine)}
              />
            ))}
          </div>
          )}
          {shown.length === 0 && r.loaded && (
            <div className="flex flex-col items-center gap-2 px-4 py-7 text-center text-[12.5px] text-ink3">
              {mine.length === 0 ? (
                <>
                  <p>No routines in {workspaceName} yet.</p>
                  {agents.length > 0 ? (
                    <button type="button" className={LINK} onClick={() => openNew()}>
                      Make the first one
                    </button>
                  ) : (
                    <p>Make an agent first: a routine is something an agent does.</p>
                  )}
                </>
              ) : dayKey !== null ? (
                <>
                  <p>Nothing scheduled for {week.find((d) => d.date === dayKey)?.label}.</p>
                  <button type="button" className={LINK} onClick={() => setDayKey(null)}>
                    Show all
                  </button>
                </>
              ) : (
                <p>Nothing of this kind yet.</p>
              )}
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <RoutineEditor
          key={editing.seed.id}
          seed={editing.seed}
          existing={editing.existing}
          agents={agents}
          channels={channels}
          hook={r.hook}
          error={r.error}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={() => editing.existing && void remove(editing.existing)}
        />
      )}
      <RunSheet
        mark={mark}
        routine={markRoutine}
        agent={mark ? (agentOf(mark.agentId) ?? undefined) : undefined}
        channels={channels}
        onClose={() => setMark(null)}
        onSkip={(routine, date) => void skip(routine, date)}
        onRun={(routine) => void run(routine)}
        onOpenChat={(id) => {
          setMark(null);
          onOpenChat(id);
        }}
      />
    </PageSheet>
  );
}
