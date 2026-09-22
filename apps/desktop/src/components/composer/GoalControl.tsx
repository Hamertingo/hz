import { Pause, Pencil, Play, Target, Trash2 } from "lucide-react";
import { useState } from "react";

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
import { compactTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Goal, GoalMove } from "@/types/events";

/// The goal a session is chasing, and the three things that move it.
///
/// **In the composer's row, not in the band above it.** That band is the handoff
/// peek's, and it is given up the moment anything else is drawn in it — so a goal
/// there would cost Commit and Create PR for as long as the goal lasted, which for
/// a goal is the whole session. The row under the text has room it was already
/// paying for, and it is where the other two statements about *how this is going*
/// sit: what the agent may do, and what the window has cost.
///
/// **The objective is the point, and the budget is the reason a goal beats a
/// note.** The agent's own object carries both, and the numbers move without
/// anybody pressing anything — which is why the store behind this is filled by a
/// push rather than kept in step here.
///
/// A goal this build cannot place is still drawn: the status is the agent's own
/// word and an unfamiliar one gets a neutral mark rather than no row at all.
export default function GoalControl({
  sessionId,
  goal,
  onError,
}: {
  sessionId: string | null;
  goal: Goal | null;
  /// Taken *at the start* of an action rather than passed a message at the end,
  /// so a failure that lands after the reader has moved on is dropped instead of
  /// written into whatever composer they moved to. `failUnlessLeft` fits it.
  onError: () => (e: unknown) => void;
}) {
  // `null` closed, `undefined` a new goal, a goal being edited.
  const [editing, setEditing] = useState<Goal | undefined | null>(null);
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");

  // The goal rides the session's own child, so there is nothing to set one on
  // before a session exists — and a new-task composer draws none of this.
  if (!sessionId) return null;

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

  // The value is the agent's own word for it — the status a goal is moved *to*,
  // not the verb a button is labelled with. `active` is also what a goal is
  // created as, which is why resuming is not a third status.
  const move = async (m: GoalMove) => {
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

  return (
    <>
      {goal ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  size="xs"
                  variant="ghost"
                  // The count is what the row has space for; the objective is what
                  // the reader needs when they look at it, and a tooltip is where
                  // a sentence goes in a row this short.
                  className={cn(
                    "max-w-40 gap-1.5 text-muted-foreground",
                    goal.status === "paused" && "text-muted-foreground/70",
                    (goal.status === "blocked" || goal.status === "budget_limited") &&
                      "text-destructive",
                  )}
                >
                  <Target className="size-3 shrink-0" />
                  <span className="truncate">{goalLabel(goal)}</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{goal.objective}</TooltipContent>
          </Tooltip>
          {/* Wide enough for the objective to read as a sentence: the menu
              shrink-wraps to its content, and a wrapping label's own minimum is
              its longest word — so without a width of its own the objective drew
              as a column four words tall. */}
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-wrap font-normal text-muted-foreground">
              {goal.objective}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* **Only the move that applies, and none at all where this build
                cannot know one.** A finished goal has nothing to pause, and an
                unfamiliar status could mean either direction — so those offer the
                two things that always make sense, Edit and Clear, rather than a
                button whose press the agent would refuse. */}
            {goal.status === "paused" && (
              <DropdownMenuItem onSelect={() => void move("active")}>
                <Play /> Resume
              </DropdownMenuItem>
            )}
            {goal.status === "active" && (
              <DropdownMenuItem onSelect={() => void move("paused")}>
                <Pause /> Pause
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => open(goal)}>
              <Pencil /> Edit…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void clear()}>
              <Trash2 /> Clear
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
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
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="max-w-100">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit goal" : "Set a goal"}</DialogTitle>
            <DialogDescription>
              The agent works towards it and keeps its own count. A budget is optional, and one that
              runs out pauses the goal rather than ending it.
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
    </>
  );
}

/// What the row says in the space of a few words.
///
/// **The count first, because that is what moves.** A budget the reader set gets
/// its spend against it; without one there is nothing to be a share of, so the
/// turns are what the agent has put into it.
///
/// **A status that is not `active` says so in a word.** The colour alone was
/// tried and a paused goal drew exactly like a running one — the dim is a shade
/// nobody reads, and the row is the only place a goal is drawn at all, so the
/// menu would have been the only thing saying a goal had stopped. An unfamiliar
/// status gets no word invented for it: the count is still true and is drawn
/// alone, the safe direction for a vocabulary this app does not own.
function goalLabel(goal: Goal): string {
  if (goal.status === "complete") return "Goal done";
  if (goal.status === "budget_limited") return "Out of budget";

  const progress = goal.tokenBudget
    ? `${Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100))}% · ${compactTokens(goal.tokensUsed)}`
    : goal.turnsUsed === 1
      ? "1 turn"
      : `${goal.turnsUsed} turns`;

  if (goal.status === "paused") return `Paused · ${progress}`;
  if (goal.status === "blocked") return `Blocked · ${progress}`;
  return progress;
}
