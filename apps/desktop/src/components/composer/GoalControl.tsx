import { Pause, Pencil, Play, Target, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compactTokens, formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Goal, GoalMove } from "@/types/events";

/// The goal a session is chasing: the live band, and the canned dialog that
/// makes and edits one.
///
/// **Two variants, one control.** `band` is the live state — status, how long it
/// has been running, what it has cost, and the moves — and `row` is the single
/// button that starts a goal where there is none. They are one component because
/// they share the dialog, the actions and the wording; a second component would
/// be a second place for "Set goal" to be spelled.
///
/// **Why a band and not the chip that used to sit in the composer's row.** The
/// runtime's own TUI draws this as a two-line banner above its composer, and that
/// is what it is: state that is *moving* — an elapsed count, a token share, a
/// status word — against a chip that could carry one truncated number of it. The
/// row keeps the start button, which is all it was ever good for.
///
/// A goal this build cannot place is still drawn: the status is the agent's own
/// word, and an unfamiliar one gets its own text rather than no band at all.
export default function GoalControl({
  sessionId,
  goal,
  variant,
  onError,
}: {
  sessionId: string | null;
  goal: Goal | null;
  /// `row` draws the start button, `band` the live line. See the note above.
  variant: "row" | "band";
  /// Taken *at the start* of an action rather than passed a message at the end,
  /// so a failure that lands after the reader has moved on is dropped instead of
  /// written into whatever composer they moved to. `failUnlessLeft` fits it.
  onError: () => (e: unknown) => void;
}) {
  // `null` closed, `undefined` a new goal, a goal being edited.
  const [editing, setEditing] = useState<Goal | undefined | null>(null);
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");

  // **Above every early return, because a hook cannot be one.** The band and the
  // start button are two renders of one component, and React counts hooks per
  // render — a goal appearing mid-session must not add one.
  const elapsed = useElapsed(goal);

  // The goal rides the session's own child, so there is nothing to set one on
  // before a session exists — and a new-task composer draws none of this.
  if (!sessionId) return null;

  // The row's button exists only where there is nothing to show: a goal that is
  // running, paused or finished is the band's, and a second control for it in the
  // row said the same thing twice.
  if (variant === "row" && goal) return null;
  if (variant === "band" && !goal) return null;

  const move = moveFor(goal?.status ?? "");

  const open = (editing: Goal | undefined) => {
    setObjective(editing?.objective ?? "");
    setBudget(editing?.tokenBudget ? String(editing.tokenBudget) : "");
    setEditing(editing);
  };

  const save = async () => {
    const fail = onError();
    const cleaned = objective.trim();
    // A nameless goal is a budget with nothing to spend it on, and the agent
    // would take it: nothing downstream could then say what this session is for,
    // which is the one thing a goal is for.
    if (!cleaned) return;

    const tokens = budget.trim() ? Number(budget.trim()) : null;
    const tokenBudget = tokens !== null && Number.isFinite(tokens) && tokens > 0 ? tokens : null;
    setEditing(null);

    try {
      if (editing) {
        await invoke("edit_session_goal", { sessionId, objective: cleaned, tokenBudget });
      } else {
        await invoke("create_session_goal", { sessionId, objective: cleaned, tokenBudget });
      }
    } catch (e) {
      fail(e);
    }
  };

  const moveGoal = async (m: GoalMove) => {
    const fail = onError();
    try {
      await invoke("move_session_goal", { sessionId, move: m });
    } catch (e) {
      fail(e);
    }
  };

  const clear = async () => {
    const fail = onError();
    try {
      await invoke("clear_session_goal", { sessionId });
    } catch (e) {
      fail(e);
    }
  };

  const dialog = (
    <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
      <DialogContent className="max-w-100">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit goal" : "Set a goal"}</DialogTitle>
          <DialogDescription>
            The agent works towards it on its own, across turns, and keeps its own count. A budget
            is optional, and one that runs out pauses the goal rather than ending it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={objective}
            placeholder="What is this session for?"
            onChange={(e) => setObjective(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <Input
            value={budget}
            inputMode="numeric"
            placeholder="Token budget, e.g. 50000 — empty for none"
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button disabled={!objective.trim()} onClick={() => void save()}>
            {editing ? "Save" : "Set goal"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (variant === "row") {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => open(undefined)}
              className="text-muted-foreground/70"
            >
              <Target className="size-3 shrink-0" />
              Goal
            </Button>
          </TooltipTrigger>
          <TooltipContent>Give this session an objective to work towards</TooltipContent>
        </Tooltip>
        {dialog}
      </>
    );
  }

  const live = goal!;
  return (
    <div
      className={cn(
        // One line of state and one of substance, against the composer's card
        // and just above it — the vendor's own arrangement, and the reason the
        // objective fits: a band this wide can name the work, where the row's
        // chip could only ever count it.
        "flex flex-col gap-0.5 rounded-lg border border-border/60 bg-composer px-2.5 py-1.5 text-ui",
      )}
    >
      <div className="flex items-center gap-2">
        <Target className={cn("size-3.5 shrink-0", toneOf(live))} />
        <span className={cn("shrink-0 font-medium", toneOf(live))}>{labelOf(live)}</span>
        <span className="shrink-0 text-muted-foreground">
          · {formatElapsed(elapsed * 1_000)} {live.status === "active" ? "active" : ""}
        </span>
        <span className="truncate text-muted-foreground">{live.objective}</span>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">{policyOf(live)}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Goal actions">
                <Pencil />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-wrap font-normal text-muted-foreground">
                {live.objective}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* **The move that applies, by the agent's own table** — see
                  `moveFor`: `active` pauses, everything the runtime can still be
                  nudged forward resumes, and a finished or budget-limited goal
                  offers neither. */}
              {move && (
                <DropdownMenuItem onSelect={() => void moveGoal(move)}>
                  {move === "active" ? <Play /> : <Pause />}
                  {move === "active" ? "Resume" : "Pause"}
                </DropdownMenuItem>
              )}
              {/* A finished goal is replaced rather than edited, which is the
                  vendor's own arm for it: `complete` offers a *new* goal. */}
              {live.status === "complete" ? (
                <DropdownMenuItem onSelect={() => open(undefined)}>
                  <Target /> New goal
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => open(live)}>
                  <Pencil /> Edit…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void clear()}>
                <Trash2 /> Clear
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {live.lastVerification && (
        <div className="pl-5.5 text-muted-foreground">{verificationOf(live)}</div>
      )}

      {dialog}
    </div>
  );
}

/// The runtime's count, with the reader's own second hand in between.
///
/// **The push is the baseline and the clock is the interpolation**, which is the
/// vendor's arrangement for the same reason: a goal push carries
/// `timeUsedSeconds` but arrives when something in the goal *moves*, not on a
/// schedule — so a band that only repainted on pushes would sit still through a
/// long stretch of work, which is exactly the stretch a reader watches.
///
/// Only an `active` goal ticks. The runtime stops counting when it stops working,
/// so a paused one that kept ticking would drift upward on screen and claim time
/// nobody spent.
function useElapsed(goal: Goal | null): number {
  const active = goal?.status === "active";
  const seconds = goal?.timeUsedSeconds ?? 0;
  const [now, setNow] = useState(() => Date.now());
  const [baseline, setBaseline] = useState(() => ({ seconds, at: Date.now() }));

  // A fresh push is a fresh baseline — the number on it is the runtime's own.
  useEffect(() => {
    setBaseline({ seconds, at: Date.now() });
  }, [seconds, goal?.goalId]);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return seconds;
  return baseline.seconds + Math.max(0, Math.floor((now - baseline.at) / 1_000));
}

/// What the band calls the goal.
///
/// **The agent's own words**, and an `active` goal that is parked reads as its
/// wait rather than as "Active" — the status keeps its meaning while the label
/// says what is actually happening, which is the vendor's rule and the one that
/// tells a reader the agent is waiting on *them*.
function labelOf(goal: Goal): string {
  const wait = goal.status === "active" ? goal.executionWait?.reason : undefined;
  if (wait) return WAIT_LABELS[wait] ?? "Waiting";
  if (goal.status === "active") return "Active";
  if (goal.status === "paused") return "Paused";
  if (goal.status === "blocked") return "Blocked";
  if (goal.status === "complete") return "Complete";
  if (goal.status === "budget_limited") return "Budget limited";
  if (goal.status === "usage_limited") return "Usage limited";
  // The vendor's own fallback for a word it does not know.
  return "Usage limited";
}

/// What an `active` goal is parked on, in the vendor's phrasing.
const WAIT_LABELS: Record<string, string> = {
  questionnaire: "Waiting for your answer",
  permission: "Waiting for permission",
  plan: "Waiting for Plan to finish",
  required_background: "Waiting for background tasks",
  automation_owner_conflict: "Waiting for automation",
  dependency_unavailable: "Waiting for a dependency",
  verification: "Verifying the result",
  unknown: "Waiting for requirements",
};

/// The colour, in this app's own vocabulary rather than a new one.
///
/// `--accent-command` is the yellow the sidebar already spends on "this is for
/// you", which is exactly what a blocked or budget-limited goal is; `--accent-add`
/// is the finished green it spends on a session that is done; `destructive` is
/// the refusal. An `active` goal gets no colour at all — it is the ordinary
/// state, and a band that shouts while nothing is wrong teaches the reader to
/// ignore it.
function toneOf(goal: Goal): string {
  if (goal.status === "active" && goal.executionWait) return "text-accent-command";
  if (goal.status === "blocked") return "text-destructive";
  if (goal.status === "budget_limited" || goal.status === "usage_limited")
    return "text-accent-command";
  if (goal.status === "complete") return "text-accent-add";
  if (goal.status === "active") return "text-foreground";
  return "text-muted-foreground";
}

/// What it has cost, and the brake the reader set.
///
/// The share is this app's own addition to the vendor's line: a budget nobody
/// can see the edge of is not a brake, and the whole reason a reader sets one is
/// to watch it.
function policyOf(goal: Goal): string {
  const tokens = `${compactTokens(goal.tokensUsed)} tokens`;
  const turns = goal.turnsUsed === 1 ? "1 turn" : `${goal.turnsUsed} turns`;
  if (goal.tokenBudget) {
    const share = Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100));
    return `${tokens} of ${compactTokens(goal.tokenBudget)} · ${share}% · ${turns}`;
  }
  return `${tokens} · ${turns}`;
}

/// The verifier's verdict, where the runtime keeps one — the only place the *why*
/// of a goal that has not finished is written down.
function verificationOf(goal: Goal): string {
  const verification = goal.lastVerification;
  if (!verification) return "";
  const verdict =
    {
      met: "Met",
      not_met: "Not met",
      impossible: "Impossible",
      inconclusive: "Inconclusive",
    }[verification.verdict] ?? "Inconclusive";
  const items = [`Latest verifier: ${verdict}`];
  if (verification.verdict === "not_met" && verification.notMetStreak > 0) {
    items.push(`not-met streak ${verification.notMetStreak}`);
  }
  if (verification.missing.length > 0) {
    const shown = verification.missing.slice(0, 2).join("; ");
    const rest = verification.missing.length - 2;
    items.push(`missing: ${shown}${rest > 0 ? ` +${rest}` : ""}`);
  }
  return items.join(" · ");
}

/// Which move the menu offers, where either applies.
///
/// **Read off the agent's own table rather than invented here.** Its `actionHint`
/// offers pause on `active`; resume on `paused`; and **resume on every status it
/// does not name**, `blocked` among them, which is a goal waiting on the reader
/// rather than one that is over. `complete` and `budget_limited` offer neither: a
/// finished goal has nothing to pause, and a budget-limited one is refused a
/// resume outright ("This Goal exhausted its execution budget. Clear it, then
/// start a new Goal"), so raising the budget through Edit is the way on.
///
/// An unknown status therefore reads as resumable, which is upstream's own
/// fallback and the safe direction: a press the runtime refuses is a sentence,
/// where a missing button is a goal nothing in this app can move.
function moveFor(status: string): GoalMove | null {
  if (status === "active") return "paused";
  if (status === "complete" || status === "budget_limited") return null;
  return "active";
}
